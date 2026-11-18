// auth.js — signing in with Clerk. GET /api/auth says whether this server needs it (webapp/auth.py) and which Clerk
// application signs in; ClerkJS and its UI components (two scripts since Clerk Core 3) are loaded from that
// application. Until a user is signed in, the page shows Clerk's sign-in instead of the application. Signed in, every
// request carries the session (core.js setSession).
import { h, api, mount, icon, toast, sleep, fmt, setSession, clearSession, sessionToken, state } from './core.js';

const TOKEN_REFRESH_MS = 20000;   // the session cookie (images, downloads) stays fresh: a token lives a minute
const SIGN_OUT_WAIT_MS = 5000;    // how long signing out may take before the page reloads anyway

function loadScript(src, key, mark) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-clerk-publishable-key', key);
    s.setAttribute(mark, '');
    s.onload = resolve;
    s.onerror = () => reject(new Error('the sign-in service cannot be reached'));
    document.head.append(s);
  });
}

const SIGNING_OUT = 'popcorn-signing-out';

/** Sets (or with null removes) a value kept while this tab is open; returns the one it had. */
function remember(key, value) {
  try {
    const had = sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
    return had;
  } catch {
    return null;
  }
}

/** This page: where Clerk returns after signing in, up or out. */
const start = `${window.location.origin}${window.location.pathname}${window.location.hash.startsWith('#/') ? window.location.hash : ''}`;
const here = () => start;

function redirects() {
  const url = here();
  return {
    signInForceRedirectUrl: url, signInFallbackRedirectUrl: url, signUpForceRedirectUrl: url,
    signUpFallbackRedirectUrl: url, forceRedirectUrl: url, fallbackRedirectUrl: url, afterSignOutUrl: url,
  };
}

/** The name shown as the owner of what a user makes. */
export function displayName(user) {
  if (!user) return '';
  const email = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
  return user.username || user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || email || user.id;
}

function gate(app, ...content) {
  mount(app, h('div', { class: 'auth-gate' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, h('div', { class: 'brand-name' }, 'Popcorn Genetic'),
        h('div', { class: 'brand-sub' }, 'Spatial transcriptomics analysis')),
      ...content)));
}

/**
 * Sign the user in. Resolves to { id, name, signOut } once signed in, to null when this server does not need it; while
 * nobody is signed in it shows the sign-in and never resolves (Clerk reloads the page after signing in).
 */
export async function signIn() {
  const app = document.getElementById('app');
  let cfg;
  try {
    cfg = await api('/api/auth');
  } catch {
    return null;   // an older server: no sign-in
  }
  if (!cfg || !cfg.required) return null;
  gate(app, h('div', { class: 'auth-wait' }, h('span', { class: 'spinner' }), 'Loading the sign-in…'));
  try {
    if (!cfg.clerk_js_url) throw new Error('the server names no sign-in service');
    await Promise.all([
      window.Clerk ? null : loadScript(cfg.clerk_js_url, cfg.publishable_key, 'data-clerk-js-script'),
      cfg.clerk_ui_url && !window.__internal_ClerkUICtor ? loadScript(cfg.clerk_ui_url, cfg.publishable_key, 'data-clerk-ui-script') : null,
    ]);
    if (!window.Clerk || typeof window.Clerk.load !== 'function') throw new Error('the sign-in service did not start');
    // Clerk Core 3: the sign-in and other components come from the UI script
    const ClerkUI = window.__internal_ClerkUICtor;
    // after signing in, up or out Clerk goes to "/" unless told otherwise; mounted in a larger site (/popcorn), that
    // is another application: come back here
    await window.Clerk.load({ ...(ClerkUI ? { ui: { ClerkUI } } : {}), ...redirects() });
  } catch (e) {
    gate(app, h('div', { class: 'banner danger' }, icon('alert', { size: 18 }),
      h('div', { class: 'banner-body' }, h('strong', null, 'Cannot sign in: '), `${e.message || e}. Reload the page to try again.`)));
    return new Promise(() => {});
  }
  const clerk = window.Clerk;
  if (!clerk.user) {
    remember(SIGNING_OUT, null);
    const box = h('div', { class: 'auth-signin' });
    gate(app, h('p', { class: 'muted' }, 'Sign in to see the projects and to work on your own. Everybody sees every project; only its owner changes it.'), box);
    // Clerk keeps the steps of the sign-in in the address hash, where this page keeps its routes (#/projects): it
    // would take those for a step of its own and show nothing. The hash is cleared while signing in; Clerk comes back
    // to the full address afterwards (redirects: taken when the page loaded).
    if (window.location.hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    clerk.mountSignIn(box, { ...redirects(), appearance: { variables: { colorPrimary: '#2f6fed' } } });
    clerk.addListener(({ user }) => { if (user) window.location.reload(); });
    return new Promise(() => {});
  }
  const user = { id: clerk.user.id, name: displayName(clerk.user) };
  setSession({ getToken: (opts) => (clerk.session ? clerk.session.getToken(opts) : Promise.resolve(null)), name: user.name });
  await sessionToken();
  setInterval(() => { sessionToken(); }, TOKEN_REFRESH_MS);
  let leaving = false;
  // Loads the page again, signed out (`step`: how; kept to see on the next load whether it worked). Without the address
  // hash: the page loads again even when only the hash differs.
  const reloadSignedOut = (step) => {
    if (leaving) return;
    leaving = true;
    remember(SIGNING_OUT, step);
    clearSession();
    window.location.replace(`${window.location.origin}${window.location.pathname}${window.location.search}`);
  };
  // ClerkJS ends the session from the browser, and the user can still be signed in afterwards: a request that did not
  // get through (Clerk counts a network error as done), or another sign-in kept by the browser for this host (on
  // localhost every port shares the cookies, also the website's). The server then ends every session of the user with
  // Clerk's Backend API (POST /api/auth/sign-out) and the page loads again; if even that leaves them signed in, it says so.
  const pending = remember(SIGNING_OUT, null);
  if (pending === 'browser' && cfg.ends_sessions) {
    gate(app, h('div', { class: 'auth-wait' }, h('span', { class: 'spinner' }), 'Signing out…'));
    try {
      await api('/api/auth/sign-out', { method: 'POST' });
      await Promise.race([clerk.signOut(async () => {}).catch(() => {}), sleep(SIGN_OUT_WAIT_MS)]);
      reloadSignedOut('server');
      return new Promise(() => {});
    } catch (e) {
      console.error('ending the sessions failed', e);
      toast(`You are still signed in as ${user.name}: ${e.message || e}`, 'warning', { timeout: 12000 });
    }
  } else if (pending) {
    toast(`You are still signed in as ${user.name}: signing out did not reach the sign-in service. Try again.`, 'warning',
      { timeout: 12000 });
  }
  clerk.addListener(({ user: now }) => {
    if (!now) reloadSignedOut('browser');
    else if (now.id !== user.id) window.location.reload();
  });
  // Signing out ends the Clerk session and loads the page again. Clerk's own redirect afterwards goes to this page with
  // its hash (#/projects): the browser changes only the hash, Clerk takes that for leaving the page and never says the
  // user signed out, and nothing happens. Given a callback instead, Clerk calls it in place of that redirect.
  // A sign-out that does not finish in a few seconds (the sign-in service unreachable) still forgets this page's
  // session and reloads; one that fails says why instead of reloading into the same signed-in page.
  user.signOut = async () => {
    if (leaving) return;
    const done = clerk.signOut(async () => { reloadSignedOut('browser'); });
    const late = new Promise((resolve) => setTimeout(() => resolve('late'), SIGN_OUT_WAIT_MS));
    try {
      if (await Promise.race([done, late]) === 'late') console.warn('signing out takes long: reloading anyway');
    } catch (e) {
      console.error('signing out failed', e);
      const why = (e && e.errors && e.errors[0] && (e.errors[0].longMessage || e.errors[0].message)) || e.message || e;
      toast(`Signing out failed: ${why}`, 'error');
      return;
    }
    reloadSignedOut('browser');
  };
  state.user = user;
  return user;
}

/** Whether `record` (a project, run or template from the server) may be changed by the signed-in user. */
export const canEdit = (record) => !record || record.can_edit !== false;

/** "you" or the owner's name, for a record with an owner; null without one. */
export function ownerText(record) {
  const o = record && record.owner;
  if (!o) return null;
  return state.user && o.id === state.user.id ? 'you' : (o.name || 'another user');
}

/** Whether `who` ({"id", "name"}, an owner or "changed_by") is the signed-in user. */
export const isMe = (who) => !!(who && state.user && who.id === state.user.id);

/** The name of a user as shown: "Asa AA (you)" for the signed-in user; null without one. */
export function userName(who) {
  if (!who || !who.id) return null;
  const name = who.name || 'another user';
  return isMe(who) ? `${name} (you)` : name;
}

/** "Changed by Bob, 5 minutes ago" for a record a signed-in user changed (its "changed_by"); null otherwise. */
export function changedText(record) {
  const who = record && record.changed_by;
  const name = userName(who);
  if (!name) return null;
  return who.at ? `Changed by ${name}, ${fmt.ago(who.at)}` : `Changed by ${name}`;
}
