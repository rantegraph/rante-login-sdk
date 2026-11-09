// Unit tests for the Rante Login SDK (node --test). They load the exact file that is published
// (sdk/rante-login.js) and drive it with small fake browser environments: no network, no real browser.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const SDK_PATH = path.join(__dirname, '..', 'rante-login.js');
const sdk = require(SDK_PATH);
const I = sdk.internals;
const CLIENT = '8D2B6E14-0A9F-4C37-B5E1-7F3A9C2D4E60';
const CLIENT_LC = CLIENT.toLowerCase();
const REDIRECT = 'https://shop.example.com/auth/rante/callback';
const ISSUER = 'https://login.rante.com/common/v2.0';

// ------------------------------------------------------------------------------------------------ fakes
function makeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    map: m
  };
}

class FakeEl {
  constructor(tag, ns) {
    this.tagName = tag; this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml'; this.children = []; this.attributes = {};
    this.listeners = {}; this.parentNode = null; this.className = ''; this.textContent = '';
    const props = {};
    this.style = { props, setProperty(k, v) { props[k] = v; } };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatchEvent(e) { (this.listeners[e.type] || []).forEach((f) => f(e)); return true; }
  attachShadow(init) { this.shadowRoot = new FakeShadow(this, init); return this.shadowRoot; }
  click() { this.dispatchEvent({ type: 'click', preventDefault() {} }); }
}
class FakeShadow extends FakeEl {
  constructor(host, init) { super('#shadow-root'); this.host = host; this.mode = init.mode; this.adoptedStyleSheets = []; }
}
class FakeSheet { replaceSync(css) { this.css = css; } }

function walk(el, out = []) {
  out.push(el);
  if (el.shadowRoot) walk(el.shadowRoot, out);
  el.children.forEach((c) => walk(c, out));
  return out;
}

function makeEnv(opts = {}) {
  const assigned = [];
  const cookieWrites = [];
  const jar = new Map();
  const replaced = [];
  const fetchCalls = [];
  const document = {
    get cookie() { return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(s) { cookieWrites.push(s); const kv = s.split(';')[0]; const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); },
    createElement: (t) => new FakeEl(t),
    createElementNS: (ns, t) => new FakeEl(t, ns)
  };
  const href = opts.href || 'https://shop.example.com/';
  const w = {
    document,
    location: { href, protocol: new URL(href).protocol, assign(u) { assigned.push(u); } },
    sessionStorage: opts.noStorage ? undefined : makeStorage(),
    crypto: opts.noSubtle ? { getRandomValues: (a) => webcrypto.getRandomValues(a) } : webcrypto,
    btoa, atob, TextDecoder, URL,
    navigator: opts.navigator || {},
    history: { state: { app: 1 }, replaceState(s, t, u) { replaced.push(u); } },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      if (!opts.tokenResponse) throw new Error('no fetch expected');
      const r = opts.tokenResponse(url, init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
    },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    CSSStyleSheet: opts.noSheet ? undefined : FakeSheet
  };
  if (opts.fedcm) w.IdentityCredential = function IdentityCredential() {};
  return { w, assigned, cookieWrites, jar, replaced, fetchCalls };
}

const b64u = (s) => Buffer.from(s).toString('base64url');
function jwt(claims) {
  return `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }))}.${b64u(JSON.stringify(claims))}.c2lnbmF0dXJl`;
}
function idToken(nonce, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt({ iss: ISSUER, sub: 'b7f1c2d4-1111-4222-8333-944455556666', aud: CLIENT_LC, azp: CLIENT_LC, nonce, iat: now, exp: now + 600,
    auth_time: now, ...extra });
}

// FedCM navigator: records requests; reads identity.mode as the browser's dictionary conversion does.
function fedcmNavigator(outcome, { activeMode = true, userActive = true } = {}) {
  const requests = [];
  return {
    requests,
    userActivation: { isActive: userActive },
    credentials: {
      get(req) {
        const identity = req && req.identity;
        if (activeMode && identity) void identity.mode;            // WebIDL reads members in order: context, mode, providers
        if (!identity || !identity.providers) return Promise.reject(new TypeError('providers is required'));
        requests.push(JSON.parse(JSON.stringify(req)));
        return outcome(req);
      }
    }
  };
}
const domError = (name, extra = {}) => Object.assign(new Error(name), { name }, extra);

function init(env, extra = {}) {
  const api = sdk.create(env.w);
  api.init({ clientId: CLIENT, redirectUri: REDIRECT, ...extra });
  return api;
}

// ------------------------------------------------------------------------------------------------ syntax / packaging
test('the published file is plain ES2019 (acorn, when a local copy exists)', (t) => {
  const acornPath = 'C:/src/azure-devops/Rante Workplace/node_modules/acorn';
  let acorn;
  try { acorn = require(acornPath); } catch { t.skip('no local acorn'); return; }
  const code = fs.readFileSync(SDK_PATH, 'utf8');
  assert.doesNotThrow(() => acorn.parse(code, { ecmaVersion: 2019, sourceType: 'script' }));
  assert.throws(() => acorn.parse('a?.b', { ecmaVersion: 2019 }), 'the check really refuses ES2020 syntax');
});

test('the file is ASCII with LF line endings and no BOM (stable SRI)', () => {
  const bytes = fs.readFileSync(SDK_PATH);
  assert.notEqual(bytes[0], 0xef);
  assert.equal(bytes.includes(0x0d), false, 'no CR');
  assert.equal(bytes.every((b) => b < 0x80), true, 'ASCII only');
});

test('in a browser it exposes only the public API on window.RanteLogin', () => {
  const env = makeEnv();
  const ctx = vm.createContext({ self: env.w });
  env.w.self = env.w;
  vm.runInContext(fs.readFileSync(SDK_PATH, 'utf8'), ctx);
  const api = env.w.RanteLogin;
  assert.ok(api, 'RanteLogin defined');
  assert.deepEqual(Object.keys(api).sort(), ['handleRedirect', 'init', 'renderButton', 'signIn', 'version']);
  assert.equal(api.version, '1.0.0');
  assert.ok(Object.isFrozen(api));
  assert.equal(ctx.module, undefined);
});

// ------------------------------------------------------------------------------------------------ PKCE and randomness
test('PKCE S256 matches RFC 7636 appendix B', async () => {
  const env = makeEnv();
  const bytes = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')));
  assert.equal(I.base64UrlFromBytes(bytes, btoa), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  // and the SDK's own pipeline: start a redirect, recompute the challenge from the stored verifier
  const api = init(env);
  await api.signIn({ mode: 'redirect' });
  const url = new URL(env.assigned[0]);
  const stored = JSON.parse(Array.from(env.w.sessionStorage.map.values())[0]);
  const expect = Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(stored.verifier, 'ascii'))).toString('base64url');
  assert.equal(url.searchParams.get('code_challenge'), expect);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('verifier, state and nonce are 32 random bytes as 64 lowercase hex (WAF-clean), all different', async () => {
  const env = makeEnv();
  const api = init(env);
  await api.signIn({ mode: 'redirect' });
  const url = new URL(env.assigned[0]);
  const state = url.searchParams.get('state'); const nonce = url.searchParams.get('nonce');
  const stored = JSON.parse(env.w.sessionStorage.getItem('rante-login:' + state));
  for (const v of [state, nonce, stored.verifier]) assert.match(v, /^[0-9a-f]{64}$/);
  assert.equal(new Set([state, nonce, stored.verifier]).size, 3);
  assert.equal(stored.nonce, nonce);
  assert.ok(stored.verifier.length >= 43 && stored.verifier.length <= 128, 'RFC 7636 length');
});

test('no Web Crypto digest (insecure context) refuses the redirect flow', async () => {
  const env = makeEnv({ noSubtle: true });
  const api = init(env);
  await assert.rejects(api.signIn({ mode: 'redirect' }), { code: 'insecure_context' });
  assert.equal(env.assigned.length, 0);
});

// ------------------------------------------------------------------------------------------------ init validation
test('init validates and normalises its options', () => {
  const env = makeEnv();
  const api = sdk.create(env.w);
  const cfg = api.init({ clientId: CLIENT, redirectUri: REDIRECT, scope: 'openid  email openid' });
  assert.deepEqual({ ...cfg }, { clientId: CLIENT_LC, redirectUri: REDIRECT, scope: 'openid email', mode: 'auto', serverSide: false });
  assert.ok(Object.isFrozen(cfg));
  const bad = [
    [{ clientId: 'shop', redirectUri: REDIRECT }, 'invalid_client_id'],
    [{ clientId: CLIENT }, 'invalid_redirect_uri'],
    [{ clientId: CLIENT, redirectUri: 'http://shop.example.com/cb' }, 'invalid_redirect_uri'],
    [{ clientId: CLIENT, redirectUri: 'https://shop.example.com/cb#x' }, 'invalid_redirect_uri'],
    [{ clientId: CLIENT, redirectUri: 'https://user:pw@shop.example.com/cb' }, 'invalid_redirect_uri'],
    [{ clientId: CLIENT, redirectUri: '/relative' }, 'invalid_redirect_uri'],
    [{ clientId: CLIENT, redirectUri: REDIRECT, scope: 'profile email' }, 'invalid_scope'],
    [{ clientId: CLIENT, redirectUri: REDIRECT, scope: 'openid offline_access' }, 'invalid_scope'],
    [{ clientId: CLIENT, redirectUri: REDIRECT, mode: 'popup' }, 'invalid_mode'],
    [{ clientId: CLIENT, redirectUri: REDIRECT, serverSide: 'yes' }, 'invalid_request']
  ];
  for (const [o, code] of bad) assert.throws(() => api.init(o), { code }, JSON.stringify(o));
  for (const ok of ['http://localhost:3000/callback', 'http://127.0.0.1:5173/cb', 'https://app.example.org:8443/cb?x=1']) {
    assert.equal(api.init({ clientId: CLIENT, redirectUri: ok }).redirectUri, ok);
  }
  assert.equal(api.init({ clientId: CLIENT, mode: 'fedcm' }).redirectUri, null, 'FedCM-only needs no redirect URI');
  assert.equal(api.init({ clientId: CLIENT, redirectUri: 'HTTPS://Shop.Example.com:8443/Auth/CB?Next=%2FHome' }).redirectUri,
    'https://shop.example.com:8443/Auth/CB?Next=%2FHome', 'scheme and host lower-cased as registered, the rest as written');
});

test('signIn before init is refused', async () => {
  const api = sdk.create(makeEnv().w);
  await assert.rejects(api.signIn(), { code: 'not_initialized' });
});

// ------------------------------------------------------------------------------------------------ URL building
test('authorize URL: exact endpoint, every required parameter, RFC 3986 encoding', () => {
  const url = I.buildAuthorizeUrl({ clientId: CLIENT_LC, redirectUri: 'https://shop.example.com/cb?provider=rante&x=a b',
    scope: 'openid profile email', state: 'a'.repeat(64), nonce: 'b'.repeat(64), codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    prompt: 'login consent', loginHint: "o'brien+tag@example.ie", maxAge: 0 });
  assert.ok(url.startsWith('https://login.rante.com/common/oauth2/v2.0/authorize?client_id=' + CLIENT_LC + '&response_type=code&'));
  assert.ok(url.includes('&scope=openid%20profile%20email&'));
  assert.ok(url.includes('redirect_uri=https%3A%2F%2Fshop.example.com%2Fcb%3Fprovider%3Drante%26x%3Da%20b'));
  const u = new URL(url);
  assert.deepEqual(Array.from(u.searchParams.keys()), ['client_id', 'response_type', 'redirect_uri', 'scope', 'state', 'nonce',
    'code_challenge', 'code_challenge_method', 'prompt', 'login_hint', 'max_age']);
  assert.equal(u.searchParams.get('login_hint'), "o'brien+tag@example.ie");
  assert.equal(u.searchParams.get('max_age'), '0');
  const minimal = new URL(I.buildAuthorizeUrl({ clientId: CLIENT_LC, redirectUri: REDIRECT, scope: 'openid', state: 's', nonce: 'n', codeChallenge: 'c' }));
  assert.equal(minimal.searchParams.has('prompt') || minimal.searchParams.has('login_hint') || minimal.searchParams.has('max_age'), false);
  assert.equal(minimal.searchParams.has('response_mode'), false);
});

test('prompt, nonce and maxAge are validated', async () => {
  assert.equal(I.normalizePrompt('select_account'), 'select_account');
  assert.equal(I.normalizePrompt(' login  consent '), 'login consent');
  assert.equal(I.normalizePrompt(''), null);
  assert.throws(() => I.normalizePrompt('none login'), { code: 'invalid_request' });
  assert.throws(() => I.normalizePrompt('create'), { code: 'invalid_request' });
  assert.throws(() => I.normalizeNonce('has space'), { code: 'invalid_request' });
  assert.throws(() => I.normalizeNonce('x'.repeat(257)), { code: 'invalid_request' });
  assert.equal(I.normalizeNonce('server-made_nonce.123'), 'server-made_nonce.123');
  const env = makeEnv(); const api = init(env);
  await assert.rejects(api.signIn({ mode: 'redirect', maxAge: -1 }), { code: 'invalid_request' });
  await assert.rejects(api.signIn({ mode: 'redirect', loginHint: 'x'.repeat(257) }), { code: 'invalid_request' });
  await api.signIn({ mode: 'redirect', nonce: 'site-nonce-1', prompt: 'login', loginHint: 'ada@example.com', maxAge: 300 });
  const u = new URL(env.assigned[0]);
  assert.equal(u.searchParams.get('nonce'), 'site-nonce-1');
  assert.equal(u.searchParams.get('prompt'), 'login');
  assert.equal(u.searchParams.get('login_hint'), 'ada@example.com');
  assert.equal(u.searchParams.get('max_age'), '300');
});

test('token request body: authorization_code, PKCE verifier, form-encoded', () => {
  const body = I.buildTokenRequestBody({ code: 'c'.repeat(64), redirectUri: 'http://localhost:3000/cb', clientId: CLIENT_LC, codeVerifier: 'v~._-' });
  const p = new URLSearchParams(body);
  assert.deepEqual(Object.fromEntries(p), { grant_type: 'authorization_code', code: 'c'.repeat(64), redirect_uri: 'http://localhost:3000/cb',
    client_id: CLIENT_LC, code_verifier: 'v~._-' });
});

// ------------------------------------------------------------------------------------------------ state / nonce storage
test('browser-only: the transaction lives in sessionStorage under rante-login:<state>, stale ones are purged', async () => {
  const env = makeEnv();
  env.w.sessionStorage.setItem('rante-login:old', JSON.stringify({ createdAt: Date.now() - 11 * 60 * 1000 }));
  env.w.sessionStorage.setItem('rante-login:junk', '{');
  env.w.sessionStorage.setItem('unrelated', 'kept');
  const api = init(env);
  await api.signIn({ mode: 'redirect' });
  const state = new URL(env.assigned[0]).searchParams.get('state');
  const keys = Array.from(env.w.sessionStorage.map.keys()).sort();
  assert.deepEqual(keys, ['rante-login:' + state, 'unrelated'].sort());
  const t = JSON.parse(env.w.sessionStorage.getItem('rante-login:' + state));
  assert.deepEqual(Object.keys(t).sort(), ['clientId', 'createdAt', 'nonce', 'redirectUri', 'scope', 'v', 'verifier']);
  assert.equal(t.clientId, CLIENT_LC); assert.equal(t.redirectUri, REDIRECT);
  assert.equal(env.cookieWrites.length, 0, 'no cookies in browser-only mode');
});

test('server-side: PKCE, state and nonce go to first-party cookies (Path=/, SameSite=Lax, Max-Age 600, Secure on https)', async () => {
  const env = makeEnv();
  const api = init(env, { serverSide: true });
  await api.signIn({ mode: 'redirect' });
  const u = new URL(env.assigned[0]);
  assert.equal(env.w.sessionStorage.length, 0);
  assert.deepEqual(env.cookieWrites.map((c) => c.split('=')[0]).sort(), ['rante_login_nonce', 'rante_login_pkce', 'rante_login_state']);
  for (const c of env.cookieWrites) assert.match(c, /^rante_login_[a-z]+=[0-9a-f]{64}; Path=\/; Max-Age=600; SameSite=Lax; Secure$/);
  assert.equal(env.jar.get('rante_login_state'), u.searchParams.get('state'));
  assert.equal(env.jar.get('rante_login_nonce'), u.searchParams.get('nonce'));
  const verifier = env.jar.get('rante_login_pkce');
  const challenge = Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(verifier))).toString('base64url');
  assert.equal(u.searchParams.get('code_challenge'), challenge);
  const local = makeEnv({ href: 'http://localhost:3000/' });
  await init(local, { serverSide: true, redirectUri: 'http://localhost:3000/cb' }).signIn({ mode: 'redirect' });
  for (const c of local.cookieWrites) assert.ok(!c.includes('Secure'), 'no Secure on http://localhost');
});

test('cookie helpers', () => {
  assert.equal(I.serializeCookie('a', 'b', 600, true), 'a=b; Path=/; Max-Age=600; SameSite=Lax; Secure');
  assert.equal(I.readCookie('x=1; rante_login_state=abc; y=2', 'rante_login_state'), 'abc');
  assert.equal(I.readCookie('xrante_login_state=abc', 'rante_login_state'), null);
  assert.equal(I.readCookie('', 'a'), null);
});

// ------------------------------------------------------------------------------------------------ handleRedirect
async function startedRedirect(extra) {
  const env = makeEnv(extra);
  const api = init(env);
  await api.signIn({ mode: 'redirect' });
  const authz = new URL(env.assigned[0]);
  return { env, api, state: authz.searchParams.get('state'), nonce: authz.searchParams.get('nonce') };
}

test('handleRedirect (browser-only) exchanges the code with PKCE and checks the ID token', async () => {
  let tokenBody;
  const s = await startedRedirect({
    tokenResponse: (url, init) => {
      tokenBody = Object.fromEntries(new URLSearchParams(init.body));
      return { status: 200, body: JSON.stringify({ access_token: 'at', token_type: 'Bearer', expires_in: 900, id_token: idToken(s.nonce), scope: 'openid profile email' }) };
    }
  });
  const stored = JSON.parse(s.env.w.sessionStorage.getItem('rante-login:' + s.state));
  const cb = `${REDIRECT}?keep=1&code=${'c'.repeat(64)}&state=${s.state}&iss=${encodeURIComponent(ISSUER)}#frag`;
  const result = await s.api.handleRedirect({ url: cb });
  assert.equal(result.flow, 'redirect'); assert.equal(result.accessToken, 'at'); assert.equal(result.expiresIn, 900);
  assert.equal(result.scope, 'openid profile email'); assert.equal(result.claims.nonce, s.nonce);
  const call = s.env.fetchCalls[0];
  assert.equal(call.url, 'https://login.rante.com/common/oauth2/v2.0/token');
  assert.equal(call.init.method, 'POST'); assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.redirect, 'error');
  assert.deepEqual(call.init.headers, { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
  assert.deepEqual(tokenBody, { grant_type: 'authorization_code', code: 'c'.repeat(64), redirect_uri: REDIRECT, client_id: CLIENT_LC,
    code_verifier: stored.verifier });
  assert.equal(s.env.w.sessionStorage.getItem('rante-login:' + s.state), null, 'single use');
  assert.deepEqual(s.env.replaced, ['/auth/rante/callback?keep=1#frag'], 'code, state and iss removed from the address bar');
  await assert.rejects(s.api.handleRedirect({ url: cb }), { code: 'state_mismatch' }, 'a replay is refused');
});

test('handleRedirect: not a Rante response -> null; other provider untouched', async () => {
  const s = await startedRedirect();
  assert.equal(await s.api.handleRedirect({ url: REDIRECT }), null);
  assert.equal(await s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=someone-else&iss=https%3A%2F%2Faccounts.example` }), null);
  assert.equal(s.env.replaced.length, 0);
});

test('handleRedirect: issuer checks (RFC 9207), unknown state from Rante, expired transaction', async () => {
  let s = await startedRedirect();
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=${s.state}` }), { code: 'issuer_missing' });
  s = await startedRedirect();
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=${s.state}&iss=https%3A%2F%2Fevil.example` }), { code: 'issuer_mismatch' });
  s = await startedRedirect();
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=forged&iss=${encodeURIComponent(ISSUER)}` }), { code: 'state_mismatch' });
  s = await startedRedirect();
  const key = 'rante-login:' + s.state;
  const t = JSON.parse(s.env.w.sessionStorage.getItem(key)); t.createdAt -= 11 * 60 * 1000;
  s.env.w.sessionStorage.setItem(key, JSON.stringify(t));
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=${s.state}&iss=${encodeURIComponent(ISSUER)}` }), { code: 'transaction_expired' });
});

test('handleRedirect: an error response is reported with its code and cleaned from the URL', async () => {
  const s = await startedRedirect();
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?error=access_denied&error_description=The%20person%20said%20no&state=${s.state}&iss=${encodeURIComponent(ISSUER)}` }),
    (e) => e.code === 'access_denied' && e.message === 'The person said no');
  assert.deepEqual(s.env.replaced, ['/auth/rante/callback']);
  assert.equal(s.env.fetchCalls.length, 0);
});

test('handleRedirect: token endpoint errors and bad ID tokens are refused', async () => {
  let s = await startedRedirect({ tokenResponse: () => ({ status: 400, body: JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }) }) });
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=${s.state}&iss=${encodeURIComponent(ISSUER)}` }), { code: 'invalid_grant', status: 400 });
  s = await startedRedirect({ tokenResponse: () => ({ status: 200, body: JSON.stringify({ id_token: idToken('other-nonce'), access_token: 'a' }) }) });
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=${s.state}&iss=${encodeURIComponent(ISSUER)}` }),
    (e) => e.code === 'invalid_id_token' && e.failedClaims.includes('nonce'));
  s = await startedRedirect({ tokenResponse: () => ({ status: 502, body: '<html>bad gateway</html>' }) });
  await assert.rejects(s.api.handleRedirect({ url: `${REDIRECT}?code=x&state=${s.state}&iss=${encodeURIComponent(ISSUER)}` }), { code: 'token_request_failed' });
});

test('handleRedirect (server-side) returns the code and state and leaves the PKCE cookies for the server', async () => {
  const env = makeEnv();
  const api = init(env, { serverSide: true });
  await api.signIn({ mode: 'redirect' });
  const state = env.jar.get('rante_login_state');
  const res = await api.handleRedirect({ url: `${REDIRECT}?code=${'d'.repeat(64)}&state=${state}&iss=${encodeURIComponent(ISSUER)}`, cleanUrl: false });
  assert.deepEqual(res, { flow: 'redirect', code: 'd'.repeat(64), state, iss: ISSUER });
  assert.ok(env.jar.get('rante_login_pkce'), 'verifier cookie kept');
  assert.equal(env.fetchCalls.length, 0, 'no exchange in the browser');
  assert.equal(env.replaced.length, 0);
  await assert.rejects(api.handleRedirect({ url: `${REDIRECT}?code=x&state=wrong&iss=${encodeURIComponent(ISSUER)}` }), { code: 'state_mismatch' });
});

// ------------------------------------------------------------------------------------------------ ID token checks
test('ID token claim checks', () => {
  const now = Math.floor(Date.now() / 1000);
  const base = { iss: ISSUER, sub: 's', aud: CLIENT_LC, nonce: 'n', exp: now + 600, iat: now };
  const ok = (c) => I.checkIdTokenClaims(c, { clientId: CLIENT_LC, nonce: 'n' }, now);
  assert.doesNotThrow(() => ok(base));
  assert.doesNotThrow(() => ok({ ...base, aud: [CLIENT_LC], azp: CLIENT_LC }));
  const failing = { iss: { iss: 'https://login.rante.com/{tenantid}/v2.0' }, aud: { aud: 'other' }, azp: { azp: 'other' },
    nonce: { nonce: 'x' }, exp: { exp: now - 1000 }, iat: { iat: now + 1000 }, sub: { sub: '' } };
  for (const [claim, patch] of Object.entries(failing)) {
    assert.throws(() => ok({ ...base, ...patch }), (e) => e.code === 'invalid_id_token' && e.failedClaims.includes(claim), claim);
  }
  assert.throws(() => ok({ ...base, aud: [CLIENT_LC, 'other'] }), (e) => e.failedClaims.includes('azp'), 'multiple audiences need azp');
  assert.throws(() => I.decodeJwtClaims('not-a-jwt', atob, TextDecoder), { code: 'invalid_id_token' });
  assert.equal(I.decodeJwtClaims(jwt({ name: 'Zoë Ünsal' }), atob, TextDecoder).name, 'Zoë Ünsal', 'UTF-8 claims');
});

// ------------------------------------------------------------------------------------------------ FedCM
test('FedCM request shape: active mode, one provider, configURL, clientId, nonce in params, no loginHint', () => {
  const req = I.buildFedCmRequest({ clientId: CLIENT_LC, nonce: 'n1', scope: 'openid email', context: 'continue' });
  assert.deepEqual(req, { identity: { mode: 'active', context: 'continue', providers: [{ configURL: 'https://login.rante.com/fedcm/config.json',
    clientId: CLIENT_LC, nonce: 'n1', params: { nonce: 'n1', scope: 'openid email' } }] } });
  assert.equal(I.buildFedCmRequest({ clientId: 'c', nonce: 'n', scope: 's' }).identity.context, 'signin');
});

test('signIn (auto) uses FedCM on a user gesture and returns the checked ID token', async () => {
  const nav = fedcmNavigator((req) => Promise.resolve({ token: idToken(req.identity.providers[0].params.nonce), isAutoSelected: false }));
  const env = makeEnv({ fedcm: true, navigator: nav });
  const api = init(env, { scope: 'openid profile' });
  const res = await api.signIn({ loginHint: 'ada@example.com' });
  assert.equal(res.flow, 'fedcm');
  assert.equal(nav.requests.length, 1);
  const p = nav.requests[0].identity.providers[0];
  assert.deepEqual(Object.keys(p).sort(), ['clientId', 'configURL', 'nonce', 'params']);
  assert.equal(p.nonce, p.params.nonce); assert.match(p.nonce, /^[0-9a-f]{64}$/);
  assert.equal(p.params.scope, 'openid profile');
  assert.equal(res.nonce, p.nonce); assert.equal(res.claims.aud, CLIENT_LC);
  assert.equal(env.assigned.length, 0, 'no navigation');
  assert.equal(env.cookieWrites.length, 0);
});

test('signIn (FedCM, server-side) uses the site nonce and leaves it in the nonce cookie', async () => {
  const nav = fedcmNavigator((req) => Promise.resolve({ token: idToken(req.identity.providers[0].nonce) }));
  const env = makeEnv({ fedcm: true, navigator: nav });
  const api = init(env, { serverSide: true });
  const res = await api.signIn({ nonce: 'server-issued-nonce' });
  assert.equal(nav.requests[0].identity.providers[0].params.nonce, 'server-issued-nonce');
  assert.equal(env.jar.get('rante_login_nonce'), 'server-issued-nonce');
  assert.equal(res.idToken.split('.').length, 3);
});

test('FedCM token with the wrong nonce is refused (no fallback)', async () => {
  const nav = fedcmNavigator(() => Promise.resolve({ token: idToken('replayed') }));
  const env = makeEnv({ fedcm: true, navigator: nav });
  await assert.rejects(init(env).signIn(), { code: 'invalid_id_token' });
  assert.equal(env.assigned.length, 0);
});

test('fallback to the redirect flow: no FedCM, no active mode, no user activation, FedCM disabled, IdP error', async () => {
  const cases = [
    ['no IdentityCredential', makeEnv({ navigator: fedcmNavigator(() => Promise.reject(new Error('unused'))) })],
    ['no active mode', makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(new Error('unused')), { activeMode: false }) })],
    ['no user activation', makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(new Error('unused')), { userActive: false }) })],
    ['NotAllowedError', makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(domError('NotAllowedError'))) })],
    ['IdP server_error', makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(domError('IdentityCredentialError', { error: 'server_error', url: 'https://login.rante.com/rante-login/error?code=server_error' }))) })],
    ['IdP code (Chrome <= 142)', makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(domError('IdentityCredentialError', { code: 'unauthorized_client' }))) })]
  ];
  for (const [name, env] of cases) {
    const res = await init(env).signIn();
    assert.deepEqual(res, { flow: 'redirect', redirecting: true }, name);
    assert.equal(env.assigned.length, 1, name);
    assert.ok(env.assigned[0].startsWith('https://login.rante.com/common/oauth2/v2.0/authorize?'), name);
  }
});

test('no fallback when the person cancels: AbortError, access_denied, and a dismissed dialog (then redirect next time)', async () => {
  let env = makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(domError('AbortError'))) });
  await assert.rejects(init(env).signIn(), { code: 'aborted' });
  env = makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(domError('IdentityCredentialError', { error: 'access_denied' }))) });
  await assert.rejects(init(env).signIn(), { code: 'access_denied' });
  assert.equal(env.assigned.length, 0);
  const nav = fedcmNavigator(() => Promise.reject(domError('NetworkError')));
  env = makeEnv({ fedcm: true, navigator: nav });
  const api = init(env);
  await assert.rejects(api.signIn(), (e) => e.code === 'fedcm_dismissed' && e.fallback === 'redirect');
  assert.equal(env.assigned.length, 0, 'no surprise navigation after a dismissal');
  const again = await api.signIn();
  assert.equal(again.flow, 'redirect');
  assert.equal(nav.requests.length, 1, 'the second attempt skipped FedCM');
});

test('mode fedcm never redirects; mode redirect never calls FedCM', async () => {
  let env = makeEnv({ navigator: {} });
  await assert.rejects(init(env, { mode: 'fedcm' }).signIn(), { code: 'fedcm_unavailable' });
  env = makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(domError('NetworkError'))) });
  await assert.rejects(init(env, { mode: 'fedcm' }).signIn(), { code: 'fedcm_dismissed' });
  env = makeEnv({ fedcm: true, navigator: fedcmNavigator(() => Promise.reject(domError('IdentityCredentialError', { error: 'invalid_request' }))) });
  await assert.rejects(init(env, { mode: 'fedcm' }).signIn(), (e) => e.code === 'fedcm_failed' && e.idpCode === 'invalid_request');
  assert.equal(env.assigned.length, 0);
  const nav = fedcmNavigator(() => Promise.reject(new Error('must not be called')));
  env = makeEnv({ fedcm: true, navigator: nav });
  await init(env, { mode: 'redirect' }).signIn();
  assert.equal(nav.requests.length, 0);
});

test('only one sign-in at a time', async () => {
  let release;
  const nav = fedcmNavigator((req) => new Promise((r) => { release = () => r({ token: idToken(req.identity.providers[0].nonce) }); }));
  const api = init(makeEnv({ fedcm: true, navigator: nav }));
  const first = api.signIn();
  await assert.rejects(api.signIn(), { code: 'busy' });
  await new Promise((r) => setImmediate(r));
  release();
  assert.equal((await first).flow, 'fedcm');
  await assert.rejects(api.signIn({ mode: 'weird' }), { code: 'invalid_mode' });
});

test('active-mode feature detection reads identity.mode without sending a real request', () => {
  const calls = [];
  const yes = { credentials: { get(req) { calls.push(1); void req.identity.mode; return Promise.reject(new TypeError('x')); } } };
  const no = { credentials: { get() { return Promise.reject(new TypeError('x')); } } };
  const throws = { credentials: { get() { throw new TypeError('sync'); } } };
  assert.equal(I.supportsActiveMode(yes), true);
  assert.equal(I.supportsActiveMode(no), false);
  assert.equal(I.supportsActiveMode(throws), false);
  assert.equal(calls.length, 1);
});

test('FedCM error classification', () => {
  assert.equal(I.classifyFedCmError(domError('AbortError')).kind, 'aborted');
  assert.equal(I.classifyFedCmError(domError('NetworkError')).kind, 'dismissed');
  assert.equal(I.classifyFedCmError(domError('NotAllowedError')).kind, 'unavailable');
  assert.equal(I.classifyFedCmError(domError('IdentityCredentialError', { error: 'access_denied' })).kind, 'denied');
  assert.equal(I.classifyFedCmError(domError('IdentityCredentialError', { code: 'temporarily_unavailable' })).idpCode, 'temporarily_unavailable');
  assert.equal(I.classifyFedCmError(new Error('?')).kind, 'failed');
});

// ------------------------------------------------------------------------------------------------ the button
function renderInto(env, api, options) {
  const container = new FakeEl('div');
  const handle = api.renderButton(container, options);
  return { container, handle, nodes: walk(container) };
}

test('button: shadow DOM, real <button>, accessible name, decorative logo, CSP-safe styling', () => {
  const env = makeEnv();
  const api = init(env);
  const { container, handle, nodes } = renderInto(env, api, { theme: 'dark', size: 'medium', text: 'continue', shape: 'pill' });
  assert.equal(container.children[0], handle.element);
  assert.equal(handle.element.tagName, 'span');
  assert.equal(handle.element.getAttribute('data-rante-login-button'), '1.0.0');
  const shadow = handle.element.shadowRoot;
  assert.equal(shadow.mode, 'open');
  assert.equal(shadow.adoptedStyleSheets.length, 1);
  assert.ok(shadow.adoptedStyleSheets[0].css.includes('.rl-dark{'));
  const button = handle.button;
  assert.equal(button.tagName, 'button'); assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.className, 'rl-btn rl-dark rl-medium rl-pill');
  assert.equal(button.getAttribute('part'), 'button');
  const label = button.children.find((c) => c.className === 'rl-label');
  assert.equal(label.textContent, 'Continue with Rante');
  const svg = button.children.find((c) => c.tagName === 'svg');
  assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.getAttribute('focusable'), 'false');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  for (const n of nodes) {
    assert.equal(n.getAttribute && n.getAttribute('style'), null, 'no style attribute (CSP style-src)');
    assert.notEqual(n.tagName, 'style', 'no <style> element');
    assert.notEqual(n.tagName, 'script');
    assert.deepEqual(n.style ? n.style.props : {}, {}, 'no inline CSSOM styles when the stylesheet is adopted');
  }
  handle.remove();
  assert.equal(container.children.length, 0);
});

test('button: unknown options fall back to defaults; without constructable stylesheets, CSSOM properties only', () => {
  const env = makeEnv({ noSheet: true });
  const api = init(env);
  const { handle } = renderInto(env, api, { theme: '<script>', size: 'huge', text: 'Buy now', shape: 'blob' });
  assert.equal(handle.button.className, 'rl-btn rl-light rl-large');
  assert.equal(handle.button.children[1].textContent, 'Sign in with Rante');
  assert.equal(handle.element.shadowRoot.adoptedStyleSheets.length, 0);
  assert.equal(handle.button.style.props.background, '#ffffff');
  assert.equal(handle.button.getAttribute('style'), null);
  for (const t of ['light', 'dark', 'outline']) {
    const h = renderInto(env, api, { theme: t }).handle;
    assert.ok(h.button.className.includes('rl-' + t));
  }
  assert.throws(() => api.renderButton(null), { code: 'invalid_element' });
});

test('button click: FedCM result to onSignIn and an event; busy state while signing in; errors to onError', async () => {
  let release;
  const nav = fedcmNavigator((req) => new Promise((r) => { release = () => r({ token: idToken(req.identity.providers[0].nonce) }); }));
  const env = makeEnv({ fedcm: true, navigator: nav });
  const api = init(env);
  const results = []; const events = [];
  const { handle } = renderInto(env, api, { text: 'signup', onSignIn: (r) => results.push(r) });
  handle.element.addEventListener('rantelogin:signin', (e) => events.push(e));
  handle.button.click();
  assert.equal(handle.button.getAttribute('aria-busy'), 'true');
  assert.equal(handle.button.getAttribute('aria-disabled'), 'true');
  handle.button.click();                                   // ignored while busy
  await new Promise((r) => setImmediate(r));
  assert.equal(nav.requests.length, 1);
  assert.equal(nav.requests[0].identity.context, 'signup', 'the button text picks the FedCM context');
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(results.length, 1); assert.equal(results[0].flow, 'fedcm');
  assert.equal(events.length, 1); assert.equal(events[0].bubbles, true); assert.equal(events[0].composed, true);
  assert.equal(handle.button.getAttribute('aria-busy'), null);
  const errors = [];
  const env2 = makeEnv();
  const api2 = sdk.create(env2.w);                          // not initialised
  const h2 = renderInto(env2, api2, { onError: (e) => errors.push(e) }).handle;
  h2.button.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(errors[0].code, 'not_initialized');
});
