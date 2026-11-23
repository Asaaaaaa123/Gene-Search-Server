"""
tests/test_auth.py
==================
Signing in with Clerk and ownership (create_app(auth=Auth(...)), webapp/auth.py): every API request needs a signed-in
user except the few the page needs first; everybody sees everybody's projects, runs and analyses; only the owner
changes them. Clerk itself is replaced by a verifier that knows two tokens.
"""
from __future__ import annotations

import time
import warnings
from urllib.parse import quote

import pytest
from fastapi import FastAPI, HTTPException

with warnings.catch_warnings():  # Starlette 1.x prefers httpx2 for its TestClient; httpx still works
    warnings.filterwarnings("ignore", message=".*httpx.*")
    from fastapi.testclient import TestClient

from webapp.auth import Auth, ServiceKey, frontend_api, parse_service_keys  # noqa: E402
from webapp.server import Hosted, create_app  # noqa: E402

FAKE = "tests.fake_worker"
PUBLIC = "https://popcorn.example.org"
PK = "pk_test_dGVuZGVyLXNuaXBlLTY3MTkuY2xlcmsuYWNjb3VudHMuZGV2JA"  # tender-snipe-6719.clerk.accounts.dev
TOKENS = {"tok-alice": "user_alice", "tok-bob": "user_bob"}
SQUARE = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {
    "type": "Polygon", "coordinates": [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]]}}]}


def verify(token: str) -> str:
    if token not in TOKENS:
        raise HTTPException(401, "Invalid session")
    return TOKENS[token]


def as_user(token: str, name: str) -> dict:
    return {"Authorization": f"Bearer {token}", "X-Popcorn-User": quote(name)}


ALICE = as_user("tok-alice", "Alice Ångström")
BOB = as_user("tok-bob", "Bob")


@pytest.fixture
def client(tmp_path, tiny_demo):
    app = create_app(tmp_path / "ws", worker_module=FAKE,
                     hosted=Hosted(data_dirs=(tiny_demo["root"],), max_active_runs=2, home_url="/"),
                     auth=Auth(verify=verify, publishable_key=PK))
    with TestClient(app, base_url=PUBLIC) as c:
        yield c


def demo_config(tiny_demo: dict) -> dict:
    samples = [dict(s) for s in tiny_demo["samples"]]
    return {"data_root": str(tiny_demo["root"]), "samples": samples, "reference_sample": samples[0]["id"],
            "qc": {"min_genes": 1, "min_counts": 1}}


def new_project(client, headers, name="P", config=None) -> dict:
    r = client.post("/api/projects", json={"name": name, "config": config or {}}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def wait_final(client, rid: str, headers) -> dict:
    deadline = time.monotonic() + 60
    while True:
        rec = client.get(f"/api/runs/{rid}", headers=headers).json()
        if rec["status"] not in ("queued", "running"):
            return rec
        assert time.monotonic() < deadline
        time.sleep(0.1)


def test_frontend_api_of_a_publishable_key():
    assert frontend_api(PK) == "tender-snipe-6719.clerk.accounts.dev"
    assert frontend_api("pk_live_bm90LWEtaG9zdCQ") == "not-a-host"
    assert frontend_api("sk_test_abc") == "" and frontend_api("") == ""


def test_the_page_and_its_first_requests_need_no_sign_in(client):
    assert client.get("/").status_code == 200
    assert client.get("/api/health").json()["ok"]
    assert "config" in client.get("/api/defaults").json()
    cfg = client.get("/api/auth").json()
    assert cfg["required"] and cfg["publishable_key"] == PK
    host = "https://tender-snipe-6719.clerk.accounts.dev"
    assert cfg["clerk_js_url"] == f"{host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js"   # Clerk Core 3
    assert cfg["clerk_ui_url"] == f"{host}/npm/@clerk/ui@1/dist/ui.browser.js"


def test_the_api_needs_a_valid_session(client):
    r = client.get("/api/projects")
    assert r.status_code == 401 and "sign in" in r.json()["detail"]
    assert client.get("/api/projects", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.post("/api/projects", json={"name": "x"}).status_code == 401
    assert client.get("/api/projects", headers=ALICE).json() == []


def test_without_auth_nothing_changes(tmp_path):
    app = create_app(tmp_path / "ws", worker_module=FAKE, hosted=Hosted())
    with TestClient(app, base_url=PUBLIC) as c:
        assert c.get("/api/auth").json() == {"required": False}
        p = c.post("/api/projects", json={"name": "P"}).json()
        assert p["owner"] is None and p["can_edit"] is True
        assert c.put(f"/api/projects/{p['id']}", json={"name": "Q"}).status_code == 200


def test_everybody_sees_a_project_only_its_owner_changes_it(client):
    p = new_project(client, ALICE, "Alice's")
    assert p["owner"] == {"id": "user_alice", "name": "Alice Ångström"} and p["can_edit"] is True
    pid = p["id"]

    seen = client.get(f"/api/projects/{pid}", headers=BOB).json()
    assert seen["owner"]["name"] == "Alice Ångström" and seen["can_edit"] is False
    listed = {x["id"]: x for x in client.get("/api/projects", headers=BOB).json()}
    assert listed[pid]["can_edit"] is False and listed[pid]["owner"]["id"] == "user_alice"
    assert client.get("/api/projects", headers=ALICE).json()[0]["can_edit"] is True

    refused = [
        client.put(f"/api/projects/{pid}", json={"name": "mine now"}, headers=BOB),
        client.delete(f"/api/projects/{pid}", headers=BOB),
        client.put(f"/api/projects/{pid}/roi/S1", json=SQUARE, headers=BOB),
        client.delete(f"/api/projects/{pid}/roi/S1", headers=BOB),
        client.delete(f"/api/projects/{pid}/upload", headers=BOB),
        client.put(f"/api/projects/{pid}/upload/x/filtered_feature_bc_matrix.h5", params={"offset": 0, "size": 3},
                   content=b"abc", headers=BOB),
        client.post(f"/api/projects/{pid}/runs", json={}, headers=BOB),
    ]
    for r in refused:
        assert r.status_code == 403, r.text
        assert "belongs to Alice Ångström" in r.json()["detail"]
    assert client.get(f"/api/projects/{pid}", headers=ALICE).json()["name"] == "Alice's"

    # reading, even with POST, is open to everybody
    assert client.post(f"/api/projects/{pid}/validate", json={"data": False}, headers=BOB).status_code == 200
    # the owner changes it
    assert client.put(f"/api/projects/{pid}", json={"name": "renamed"}, headers=ALICE).json()["name"] == "renamed"
    assert client.put(f"/api/projects/{pid}/roi/S1", json=SQUARE, headers=ALICE).status_code == 200


def test_a_copy_belongs_to_whoever_made_it(client):
    pid = new_project(client, ALICE)["id"]
    copy = client.post(f"/api/projects/{pid}/duplicate", headers=BOB).json()
    assert copy["owner"]["id"] == "user_bob" and copy["can_edit"] is True
    assert client.put(f"/api/projects/{copy['id']}", json={"name": "Bob's copy"}, headers=BOB).status_code == 200
    assert client.put(f"/api/projects/{copy['id']}", json={"name": "x"}, headers=ALICE).status_code == 403


def test_a_cookie_signs_in_for_reading_only(client):
    pid = new_project(client, ALICE)["id"]
    client.cookies.set("popcorn_session", "tok-bob")
    try:
        assert client.get(f"/api/projects/{pid}").json()["can_edit"] is False
        r = client.put(f"/api/projects/{pid}", json={"name": "x"})
        assert r.status_code == 401  # changes need the Authorization header (no cross-site requests)
        mine = new_project(client, BOB)["id"]
        assert client.delete(f"/api/projects/{mine}").status_code == 401
    finally:
        client.cookies.clear()
    client.cookies.set("__session", "tok-alice")  # Clerk's own cookie works too
    try:
        assert client.get(f"/api/projects/{pid}").json()["can_edit"] is True
    finally:
        client.cookies.clear()


def test_runs_belong_to_who_started_them(client, tiny_demo):
    pid = new_project(client, ALICE, config=demo_config(tiny_demo))["id"]
    r = client.post(f"/api/projects/{pid}/runs", json={"label": "first"}, headers=ALICE)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert r.json()["owner"]["id"] == "user_alice"
    rec = wait_final(client, rid, BOB)
    assert rec["can_edit"] is False and rec["owner"]["name"] == "Alice Ångström"
    assert client.get(f"/api/runs/{rid}/log", headers=BOB).status_code == 200
    assert {x["id"]: x["can_edit"] for x in client.get("/api/runs", headers=BOB).json()}[rid] is False
    for resp in (client.post(f"/api/runs/{rid}/cancel", headers=BOB),
                 client.post(f"/api/runs/{rid}/rerun", headers=BOB),
                 client.put(f"/api/runs/{rid}/regions", json={"regions": []}, headers=BOB),
                 client.post(f"/api/runs/{rid}/analyses", json={"tool": "x", "params": {}}, headers=BOB),
                 client.delete(f"/api/runs/{rid}/analyses/a-00000000", headers=BOB),
                 client.delete(f"/api/runs/{rid}", headers=BOB)):
        assert resp.status_code == 403, resp.text
    assert client.get(f"/api/runs/{rid}", headers=BOB).status_code == 200
    assert client.delete(f"/api/runs/{rid}", headers=ALICE).status_code == 200


def test_templates_are_deleted_only_by_their_owner(client):
    storage = client.app.state.storage
    t = storage.create_template("Alice's set", [{"tool": "composition", "title": "t", "params": {}, "view": {}}],
                                owner={"id": "user_alice", "name": "Alice"})
    listed = client.get("/api/analysis/templates", headers=BOB).json()
    assert listed[0]["owner"]["name"] == "Alice" and listed[0]["can_edit"] is False
    assert client.delete(f"/api/analysis/templates/{t['id']}", headers=BOB).status_code == 403
    assert client.delete(f"/api/analysis/templates/{t['id']}", headers=ALICE).status_code == 200


def test_a_project_from_before_sign_in_stays_open(client):
    legacy = client.app.state.storage.create_project("old", {})
    seen = client.get(f"/api/projects/{legacy['id']}", headers=BOB).json()
    assert seen["owner"] is None and seen["can_edit"] is True
    assert client.put(f"/api/projects/{legacy['id']}", json={"name": "kept"}, headers=BOB).status_code == 200


def test_unknown_things_answer_404_not_403(client):
    assert client.put("/api/projects/p-00000000", json={"name": "x"}, headers=BOB).status_code == 404
    assert client.delete("/api/runs/r-20000101-000000-0000", headers=BOB).status_code == 404


def test_everybody_gets_a_demo_of_their_own(client):
    a = client.post("/api/demo", headers=ALICE).json()["project"]
    b = client.post("/api/demo", headers=BOB).json()["project"]
    assert a["id"] != b["id"] and a["owner"]["id"] == "user_alice" and b["owner"]["id"] == "user_bob"
    assert client.post("/api/demo", headers=ALICE).json()["project"]["id"] == a["id"]


def test_mounted_below_a_prefix(tmp_path):
    outer = FastAPI()
    inner = create_app(tmp_path / "ws", worker_module=FAKE, hosted=Hosted(),
                       auth=Auth(verify=verify, publishable_key=PK))
    outer.mount("/popcorn", inner)
    with TestClient(outer, base_url=PUBLIC) as c:
        inner.state.jobs.start()
        try:
            assert c.get("/popcorn/api/auth").json()["required"] is True
            assert c.get("/popcorn/api/projects").status_code == 401
            pid = c.post("/popcorn/api/projects", json={"name": "P"}, headers=ALICE).json()["id"]
            assert c.put(f"/popcorn/api/projects/{pid}", json={"name": "x"}, headers=BOB).status_code == 403
            assert c.get(f"/popcorn/api/projects/{pid}", headers=BOB).json()["can_edit"] is False
        finally:
            inner.state.jobs.stop()


def test_signing_out_ends_the_users_sessions(tmp_path):
    ended = []

    def end_sessions(user_id: str) -> int:
        ended.append(user_id)
        return 2

    app = create_app(tmp_path / "ws", worker_module=FAKE, hosted=Hosted(),
                     auth=Auth(verify=verify, publishable_key=PK, end_sessions=end_sessions))
    with TestClient(app, base_url=PUBLIC) as c:
        assert c.get("/api/auth").json()["ends_sessions"] is True
        assert c.post("/api/auth/sign-out").status_code == 401
        assert c.post("/api/auth/sign-out", headers=BOB).json() == {"ended": 2}   # anybody, for themselves
        assert ended == ["user_bob"]


def test_signing_out_without_the_backend_api(client):
    assert client.get("/api/auth").json()["ends_sessions"] is False
    r = client.post("/api/auth/sign-out", headers=ALICE)
    assert r.status_code == 501 and "cannot end sessions" in r.json()["detail"]


def test_every_change_records_who_made_it(client, tiny_demo):
    legacy = client.app.state.storage.create_project("shared", {})   # open to everybody: both may change it
    pid = legacy["id"]
    assert client.get(f"/api/projects/{pid}", headers=ALICE).json()["changed_by"] is None
    client.put(f"/api/projects/{pid}", json={"name": "renamed"}, headers=ALICE)
    seen = client.get(f"/api/projects/{pid}", headers=BOB).json()
    assert seen["changed_by"]["name"] == "Alice Ångström" and seen["changed_by"]["at"] == seen["updated"]
    client.put(f"/api/projects/{pid}/roi/S1", json=SQUARE, headers=BOB)
    listed = {p["id"]: p for p in client.get("/api/projects", headers=ALICE).json()}
    assert listed[pid]["changed_by"]["id"] == "user_bob" and listed[pid]["changed_by"]["name"] == "Bob"
    client.delete(f"/api/projects/{pid}/roi/S1", headers=ALICE)
    assert client.get(f"/api/projects/{pid}", headers=BOB).json()["changed_by"]["name"] == "Alice Ångström"

    mine = new_project(client, ALICE, config=demo_config(tiny_demo))["id"]
    rid = client.post(f"/api/projects/{mine}/runs", json={}, headers=ALICE).json()["id"]
    assert wait_final(client, rid, ALICE)["changed_by"] is None
    client.put(f"/api/runs/{rid}/regions", json={"regions": []}, headers=ALICE)
    assert client.get(f"/api/runs/{rid}", headers=BOB).json()["changed_by"]["name"] == "Alice Ångström"


SERVICE_KEY = "k" * 40
PERSPICAX = {"X-Popcorn-Key": SERVICE_KEY}


@pytest.fixture
def keyed(tmp_path, tiny_demo):
    app = create_app(tmp_path / "ws", worker_module=FAKE,
                     hosted=Hosted(data_dirs=(tiny_demo["root"],), max_active_runs=2, home_url="/"),
                     auth=Auth(verify=verify, publishable_key=PK,
                               service_keys=(ServiceKey("Perspicax", SERVICE_KEY),)))
    with TestClient(app, base_url=PUBLIC) as c:
        yield c


def test_parse_service_keys():
    good = "a" * 32
    assert parse_service_keys(None) == () and parse_service_keys(" , ") == ()
    assert parse_service_keys(f"Perspicax:{good}, other-tool:{good}b") == (
        ServiceKey("Perspicax", good), ServiceKey("other-tool", good + "b"))
    assert ServiceKey("Perspicax", good).user == {"id": "service:perspicax", "name": "Perspicax"}
    for bad in (good, f"Perspicax:{'a' * 31}", f"Per spicax:{good}", f"1x:{good}", f"P:{'a' * 31} b",
                f"P:{good},p:{good}"):
        with pytest.raises(ValueError) as e:
            parse_service_keys(bad)
        assert good not in str(e.value)   # never says the key


def test_a_service_key_signs_a_program_in(keyed, tiny_demo):
    p = keyed.post("/api/projects", json={"name": "From Perspicax", "config": demo_config(tiny_demo)},
                   headers=PERSPICAX)
    assert p.status_code == 200, p.text
    assert p.json()["owner"] == {"id": "service:perspicax", "name": "Perspicax"}
    pid = p.json()["id"]
    rid = keyed.post(f"/api/projects/{pid}/runs", json={}, headers=PERSPICAX).json()["id"]
    assert wait_final(keyed, rid, PERSPICAX)["owner"]["name"] == "Perspicax"
    # people see what it made, and only it changes it
    assert keyed.get(f"/api/projects/{pid}", headers=ALICE).json()["can_edit"] is False
    assert keyed.put(f"/api/projects/{pid}", json={"name": "x"}, headers=ALICE).status_code == 403
    # it sees what people made, and changes none of it
    mine = new_project(keyed, ALICE)["id"]
    assert keyed.get(f"/api/projects/{mine}", headers=PERSPICAX).json()["can_edit"] is False
    r = keyed.put(f"/api/projects/{mine}", json={"name": "x"}, headers=PERSPICAX)
    assert r.status_code == 403 and "belongs to Alice" in r.json()["detail"]


def test_a_wrong_service_key_is_refused(keyed):
    for headers in ({"X-Popcorn-Key": "k" * 39}, {"X-Popcorn-Key": ""},
                    {"X-Popcorn-Key": "nope", **ALICE}):   # a wrong key never falls back to the session
        r = keyed.get("/api/projects", headers=headers)
        assert r.status_code == 401 and "service key" in r.json()["detail"]
    assert keyed.get("/api/projects", headers=ALICE).status_code == 200
    assert keyed.post("/api/auth/sign-out", headers=PERSPICAX).status_code == 400


def test_no_service_keys_without_configuring_them(client):
    assert client.get("/api/projects", headers=PERSPICAX).status_code == 401
    assert "service" not in str(client.get("/api/auth").json())   # the page is told nothing about them


def test_an_analysis_says_who_made_and_changed_it(tmp_path):
    from webapp.storage import Storage
    storage = Storage(tmp_path / "ws")
    rid = "r-20260101-000000-0000"
    (storage.run_dir(rid)).mkdir(parents=True)
    card = storage.create_analysis(rid, "composition", "t", {}, by={"id": "user_alice", "name": "Alice"})
    assert card["created_by"] == {"id": "user_alice", "name": "Alice"}
    assert card["changed_by"]["name"] == "Alice"
    card["title"] = "renamed"
    saved = storage.save_analysis(rid, card, by={"id": "user_bob", "name": "Bob"})
    assert saved["created_by"]["name"] == "Alice" and saved["changed_by"]["name"] == "Bob"
    saved = storage.save_analysis(rid, {**saved, "status": "done"})   # the server keeps a result: no user
    assert saved["changed_by"]["name"] == "Bob"
