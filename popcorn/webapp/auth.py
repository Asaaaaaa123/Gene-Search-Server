"""
webapp/auth.py
==============
Signing in with Clerk, and who may change what (create_app(auth=Auth(...)), docs/ARCHITECTURE.md section 5).

Every request to the API needs a signed-in user, except the few that the page needs before signing in
(PUBLIC_API). The page signs in with Clerk in the browser (static/js/auth.js) and sends the Clerk session token as
`Authorization: Bearer <token>`. Reading (GET) also accepts the token from a cookie (SESSION_COOKIES), so that images and
downloads, which the browser loads without that header, work too. Changing anything needs the header, so that another
site cannot make a signed-in browser change something (CSRF).

Ownership. A project, a run and an analysis template record the user who made them ("owner": {"id", "name"}).
Everybody signed in sees everybody's projects, runs and analyses and can download them; only the owner changes them:
saves, uploads, regions, runs, analyses and deleting. A project or run made before signing in existed has no owner
and stays open to every signed-in user. Requests that only read, sent with POST because they carry a body (the data
check, the explorer, gene look-ups), are open to everybody (READ_POSTS).

Without `auth` (the local application, the tests) nothing changes: there are no users, and everything may be changed.

Service keys. Another program (Perspicax, which runs Popcorn's analyses as one of its tools) cannot sign in with Clerk in
a browser. It sends a key of its own as `X-Popcorn-Key: <key>` instead (ServiceKey, POPCORN_SERVICE_KEYS in
backend/popcorn_mount.py). The key acts as one fixed user, id "service:<name>": like every user it sees everything and
changes only what it made itself. A wrong key is refused (401) and never falls back to the Clerk session.
"""
from __future__ import annotations

import base64
import contextvars
import hmac
import re
from typing import Callable, NamedTuple
from urllib.parse import unquote

from starlette.requests import Request
from starlette.responses import JSONResponse

try:  # Starlette >= 0.33: the path inside a mounted application
    from starlette._utils import get_route_path
except ImportError:  # pragma: no cover
    def get_route_path(scope) -> str:
        root, path = scope.get("root_path", ""), scope["path"]
        return path[len(root):] if root and path.startswith(root) else path

SESSION_COOKIES = ("popcorn_session", "__session")   # the page's own cookie (auth.js), Clerk's
NAME_HEADER = "x-popcorn-user"                       # the display name of the user, URL-encoded (auth.js)
NAME_MAX = 80
KEY_HEADER = "x-popcorn-key"                         # a service key (ServiceKey): a program, not a person
SERVICE_PREFIX = "service:"                          # user id of a service key: "service:<name>"
KEY_MIN_LENGTH = 32
_SERVICE_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,39}")
_SERVICE_KEY = re.compile(r"[A-Za-z0-9_\-.~+/=]+")

# answered without signing in: what the page needs to show the sign-in
PUBLIC_API = re.compile(r"^/api/(health|defaults|auth|docs/[^/]+)$")
# requests that only read although they are POST (they carry a body)
READ_POSTS = re.compile(r"^/api/(projects/[^/]+/(validate|detect-samples|detect-tissue|duplicate|gene-names|explore/.+)"
                        r"|runs/[^/]+/(gene|overlap-genes))$")
# requests that make something new, owned by whoever sends them (a run with new cell types: from anybody's run)
CREATES = re.compile(r"^/api/(projects|analysis/templates|demo|runs/[^/]+/retype)$")
# requests about the user's own session (signing out)
SELF_POSTS = re.compile(r"^/api/auth/sign-out$")
PROJECT_PATH = re.compile(r"^/api/projects/(?P<id>[^/]+)(/.*)?$")
RUN_PATH = re.compile(r"^/api/runs/(?P<id>[^/]+)(/.*)?$")
TEMPLATE_PATH = re.compile(r"^/api/analysis/templates/(?P<id>[^/]+)$")
READ_METHODS = ("GET", "HEAD")


# ClerkJS and its UI components (Clerk Core 3: two scripts), the major versions the application's Frontend API serves.
# Clerk refuses sign-in from outdated versions ("This app uses an outdated version of Clerk"): keep these current
# (the latest of https://registry.npmjs.org/-/package/@clerk/clerk-js/dist-tags and of @clerk/ui).
CLERK_JS_MAJOR = "6"
CLERK_UI_MAJOR = "1"


class ServiceKey(NamedTuple):
    """A program's key, sent as `X-Popcorn-Key` in place of a Clerk session. It signs in as user
    {"id": "service:<name>", "name": <name>}."""
    name: str
    key: str

    @property
    def user(self) -> dict:
        return {"id": f"{SERVICE_PREFIX}{self.name.lower()}", "name": self.name}


def parse_service_keys(text: str | None) -> tuple[ServiceKey, ...]:
    """POPCORN_SERVICE_KEYS: entries "<name>:<key>" separated by commas, e.g. "Perspicax:3f9c...". The name (a letter,
    then letters, digits, - or _) is the user shown as the owner of what the program makes; the key needs at least
    KEY_MIN_LENGTH characters. Raises ValueError, naming the entry but never the key, for anything else."""
    keys: list[ServiceKey] = []
    for n, entry in enumerate((text or "").split(","), 1):
        entry = entry.strip()
        if not entry:
            continue
        name, sep, key = entry.partition(":")
        name, key = name.strip(), key.strip()
        if not sep or not _SERVICE_NAME.fullmatch(name):
            raise ValueError(f"entry {n} is not <name>:<key> with a name of letters, digits, - or _")
        if len(key) < KEY_MIN_LENGTH or not _SERVICE_KEY.fullmatch(key):
            raise ValueError(f"the key of {name} needs at least {KEY_MIN_LENGTH} characters, without spaces")
        if any(k.name.lower() == name.lower() for k in keys):
            raise ValueError(f"{name} is named twice")
        keys.append(ServiceKey(name, key))
    return tuple(keys)


class Auth(NamedTuple):
    """Sign-in with Clerk. `verify` takes a session token and returns the user id, raising on an invalid or expired
    token; `publishable_key` is the Clerk application's (pk_test_... or pk_live_...); `clerk_js_url` and
    `clerk_ui_url` are where the page loads ClerkJS and its UI components from (default: the application's Frontend
    API; with only `clerk_js_url` given, no separate UI script is loaded). `end_sessions(user_id)` ends every session of
    a user with Clerk's Backend API and returns how many (POST /api/auth/sign-out: the page asks for it when signing
    out in the browser left the user signed in); None when the server cannot. `service_keys`: the programs that may
    send a key instead of a session (ServiceKey)."""
    verify: Callable[[str], str]
    publishable_key: str
    clerk_js_url: str | None = None
    clerk_ui_url: str | None = None
    end_sessions: Callable[[str], int] | None = None
    service_keys: tuple[ServiceKey, ...] = ()


def service_user(auth: Auth, key: str) -> dict | None:
    """The user of a service key; None when it is no configured key. Compares every key in constant time."""
    sent = key.strip().encode()
    found = None
    for sk in auth.service_keys:
        if hmac.compare_digest(sent, sk.key.encode()):
            found = sk.user
    return found if sent else None


def frontend_api(publishable_key: str) -> str:
    """The Frontend API host of a Clerk publishable key ('tender-snipe-6719.clerk.accounts.dev'), '' if it is not
    one."""
    m = re.fullmatch(r"pk_(?:test|live)_([A-Za-z0-9+/=_-]+)", (publishable_key or "").strip())
    if not m:
        return ""
    data = m.group(1)
    try:
        host = base64.b64decode(data + "=" * (-len(data) % 4)).decode("ascii")
    except (ValueError, UnicodeDecodeError):
        return ""
    host = host.rstrip("$")
    return host if re.fullmatch(r"[A-Za-z0-9.-]+", host) else ""


def page_config(auth: Auth | None) -> dict:
    """GET /api/auth: whether the page must sign in, and how."""
    if auth is None:
        return {"required": False}
    host = frontend_api(auth.publishable_key)
    if auth.clerk_js_url:
        js, ui = auth.clerk_js_url, auth.clerk_ui_url
    elif host:
        js = f"https://{host}/npm/@clerk/clerk-js@{CLERK_JS_MAJOR}/dist/clerk.browser.js"
        ui = auth.clerk_ui_url or f"https://{host}/npm/@clerk/ui@{CLERK_UI_MAJOR}/dist/ui.browser.js"
    else:
        js, ui = None, None
    return {"required": True, "publishable_key": auth.publishable_key, "clerk_js_url": js, "clerk_ui_url": ui,
            "ends_sessions": auth.end_sessions is not None}


# ---- the user of the current request ---------------------------------------------------------------------------------
_user: contextvars.ContextVar[dict | None] = contextvars.ContextVar("popcorn_user", default=None)


def current_user() -> dict | None:
    """{"id", "name"} of the signed-in user of this request; None without sign-in."""
    return _user.get()


def owner_of(record: dict | None) -> dict | None:
    owner = (record or {}).get("owner")
    return owner if isinstance(owner, dict) and owner.get("id") else None


def may_change(record: dict | None) -> bool:
    """Whether the current user may change `record` (a project, run or template): always without sign-in; else when
    it has no owner or is theirs."""
    user = current_user()
    owner = owner_of(record)
    return user is None or owner is None or owner["id"] == user["id"]


def ownership(record: dict | None) -> dict:
    """The fields every answer about a project, run or template carries: who owns it and whether you may change it."""
    owner = owner_of(record)
    return {"owner": {"id": owner["id"], "name": owner.get("name") or ""} if owner else None,
            "can_edit": may_change(record)}


def clean_name(value: str | None, user_id: str) -> str:
    text = unquote(value or "").strip()
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", text)[:NAME_MAX].strip()
    return text or f"user {user_id[-6:]}"


def _token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header[:7].lower() == "bearer ":
        return header[7:].strip() or None
    if request.method in READ_METHODS:
        for name in SESSION_COOKIES:
            if request.cookies.get(name):
                return request.cookies[name]
    return None


class AuthGate:
    """ASGI middleware: signs the user of each API request in (or answers 401) and refuses changes to what is not
    theirs (403). `owner_lookup(kind, id)` returns the record of a project, run or template (None when it does not
    exist: the route then answers 404)."""

    def __init__(self, app, auth: Auth, owner_lookup: Callable[[str, str], dict | None]):
        self.app = app
        self.auth = auth
        self.owner_lookup = owner_lookup

    @staticmethod
    def _deny(status: int, detail: str) -> JSONResponse:
        return JSONResponse({"detail": detail}, status_code=status, headers={"Cache-Control": "no-store"})

    def _forbidden(self, method: str, path: str, user: dict) -> str | None:
        """Why the user may not send this request (None: they may)."""
        if (method in READ_METHODS or READ_POSTS.match(path) or SELF_POSTS.match(path)
                or (method == "POST" and CREATES.match(path))):
            return None
        for kind, pattern in (("project", PROJECT_PATH), ("run", RUN_PATH), ("template", TEMPLATE_PATH)):
            m = pattern.match(path)
            if m:
                record = self.owner_lookup(kind, unquote(m.group("id")))
                owner = owner_of(record)
                if record is None or owner is None or owner["id"] == user["id"]:
                    return None
                return (f"this {kind} belongs to {owner.get('name') or 'another user'}: you can look at it and "
                        f"download it, but only its owner can change it")
        return "this request changes something that is not yours"

    def _user(self, request: Request, path: str) -> tuple[dict | None, JSONResponse | None]:
        """The user sending `request` and None, or None and the refusal (401, or 400 for a program signing out)."""
        key = request.headers.get(KEY_HEADER)
        if key is not None:   # a program: its key or nothing, never a session as well
            user = service_user(self.auth, key)
            if user is None:
                return None, self._deny(401, "the service key (X-Popcorn-Key) is not valid")
            if SELF_POSTS.match(path):
                return None, self._deny(400, "a service key has no session to end")
            return user, None
        token = _token(request)
        if token is None:
            return None, self._deny(401, "sign in to use Popcorn Genetic")
        try:
            user_id = str(self.auth.verify(token))
        except Exception as exc:  # noqa: BLE001 - any failure of the check is a refused session
            detail = getattr(exc, "detail", None) or str(exc) or "invalid session"
            return None, self._deny(401, f"sign in again: {detail}")
        return {"id": user_id, "name": clean_name(request.headers.get(NAME_HEADER), user_id)}, None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = get_route_path(scope)
        if not path.startswith("/api/") or PUBLIC_API.match(path):
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        user, response = self._user(request, path)
        if response is None:
            reason = self._forbidden(request.method, path, user)
            response = self._deny(403, reason) if reason else None
        if response is not None:
            await response(scope, receive, send)
            return
        reset = _user.set(user)
        try:
            await self.app(scope, receive, send)
        finally:
            _user.reset(reset)
