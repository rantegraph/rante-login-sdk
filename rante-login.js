/*! Rante Login SDK 1.0.0 - https://login.rante.com/sdk/v1/rante-login.js - "Sign in with Rante" for websites.
 * Plain ES2019, no dependencies, no build step. Immutable once published: a changed SDK gets a new versioned path and
 * a new SRI hash. Contract: Rante Identity Platform Auth/docs/rante-login-contract-20261108.md (section 7, SDK).
 *   RanteLogin.init({ clientId, redirectUri, scope, mode, serverSide })
 *   RanteLogin.renderButton(element, { theme, size, text, shape, onSignIn, onError, nonce, loginHint, prompt })
 *   RanteLogin.signIn({ nonce, loginHint, prompt, maxAge, mode, context })
 *   RanteLogin.handleRedirect({ url, cleanUrl })
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root && root.document && !root.RanteLogin) {
    root.RanteLogin = api.create(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var ORIGIN = 'https://login.rante.com';
  var ISSUER = ORIGIN + '/common/v2.0';
  var AUTHORIZE_ENDPOINT = ORIGIN + '/common/oauth2/v2.0/authorize';
  var TOKEN_ENDPOINT = ORIGIN + '/common/oauth2/v2.0/token';
  var FEDCM_CONFIG_URL = ORIGIN + '/fedcm/config.json';
  var STORAGE_PREFIX = 'rante-login:';
  var TRANSACTION_TTL_MS = 10 * 60 * 1000;
  var COOKIE_MAX_AGE = 600;
  var COOKIE_PKCE = 'rante_login_pkce';
  var COOKIE_STATE = 'rante_login_state';
  var COOKIE_NONCE = 'rante_login_nonce';
  var CLOCK_SKEW_SECONDS = 120;
  var GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  var SCOPES = ['openid', 'profile', 'email', 'phone', 'address', 'rante.organization'];
  var PROMPTS = ['none', 'login', 'consent', 'select_account'];
  var MODES = ['auto', 'redirect', 'fedcm'];
  var CONTEXTS = ['signin', 'signup', 'use', 'continue'];
  var THEMES = ['light', 'dark', 'outline'];
  var SIZES = ['small', 'medium', 'large'];
  var SHAPES = ['rectangular', 'pill'];
  var TEXTS = {
    signin: 'Sign in with Rante',
    signin_with: 'Sign in with Rante',
    continue: 'Continue with Rante',
    continue_with: 'Continue with Rante',
    signup: 'Sign up with Rante',
    signup_with: 'Sign up with Rante'
  };
  var TEXT_CONTEXT = { signin: 'signin', signin_with: 'signin', continue: 'continue', continue_with: 'continue',
    signup: 'signup', signup_with: 'signup' };
  // Redirect-response parameters removed from the address bar once handled (RFC 6749 4.1.2, RFC 9207).
  var RESPONSE_PARAMS = ['code', 'state', 'iss', 'error', 'error_description', 'error_uri', 'session_state'];

  // Button styles: constructable stylesheet adopted by the shadow root (not subject to CSP style-src, no inline
  // <style> or style attributes). Colours meet WCAG AA contrast; forced-colors mode uses system colours.
  var BUTTON_CSS = [
    ':host{display:inline-block;vertical-align:middle;line-height:normal}',
    '.rl-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:10px;margin:0;',
    'padding:0 14px;border:1px solid transparent;border-radius:4px;cursor:pointer;white-space:nowrap;',
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-weight:600;',
    'letter-spacing:.01em;text-decoration:none;user-select:none;-webkit-user-select:none;',
    'transition:background-color .15s ease,box-shadow .15s ease}',
    '.rl-btn:focus{outline:none}',
    '.rl-btn:focus-visible{outline:2px solid #214d84;outline-offset:2px}',
    '.rl-dark:focus-visible{outline-color:#d9eaff}',
    '.rl-small{height:32px;font-size:13px;padding:0 12px;gap:8px}',
    '.rl-medium{height:36px;font-size:14px}',
    '.rl-large{height:40px;font-size:14px}',
    '.rl-pill{border-radius:999px}',
    '.rl-light{background:#ffffff;color:#1f1f1f;border-color:#c4c7cc}',
    '.rl-light:hover{background:#f3f6fa;box-shadow:0 1px 2px rgba(0,0,0,.18)}',
    '.rl-dark{background:#14171c;color:#f1f3f4;border-color:#5f6670}',
    '.rl-dark:hover{background:#232830;box-shadow:0 1px 2px rgba(0,0,0,.4)}',
    '.rl-outline{background:transparent;color:#214d84;border-color:#285fa3}',
    '.rl-outline:hover{background:#eef5ff}',
    '.rl-btn[aria-busy="true"]{cursor:progress;opacity:.72}',
    '.rl-logo{flex:none;display:block}',
    '.rl-small .rl-logo{width:18px;height:18px}',
    '.rl-medium .rl-logo,.rl-large .rl-logo{width:20px;height:20px}',
    '.rl-label{display:block}',
    '@media (prefers-reduced-motion:reduce){.rl-btn{transition:none}}',
    '@media (forced-colors:active){.rl-btn{background:ButtonFace;color:ButtonText;border-color:ButtonText}',
    '.rl-btn:focus-visible{outline-color:Highlight}}'
  ].join('');
  // The same essentials as CSSOM properties, for browsers without constructable stylesheets (CSP-safe: CSSOM writes
  // are not inline style attributes).
  var FALLBACK_STYLE = {
    base: { 'box-sizing': 'border-box', display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center',
      gap: '10px', margin: '0', padding: '0 14px', 'border-width': '1px', 'border-style': 'solid', 'border-radius': '4px',
      cursor: 'pointer', 'white-space': 'nowrap', 'font-weight': '600',
      'font-family': 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' },
    small: { height: '32px', 'font-size': '13px', padding: '0 12px' },
    medium: { height: '36px', 'font-size': '14px' },
    large: { height: '40px', 'font-size': '14px' },
    light: { background: '#ffffff', color: '#1f1f1f', 'border-color': '#c4c7cc' },
    dark: { background: '#14171c', color: '#f1f3f4', 'border-color': '#5f6670' },
    outline: { background: 'transparent', color: '#214d84', 'border-color': '#285fa3' }
  };

  function RanteLoginError(code, message, details) {
    var e = new Error(message || code);
    e.name = 'RanteLoginError';
    e.code = code;
    if (details) {
      Object.keys(details).forEach(function (k) { e[k] = details[k]; });
    }
    return e;
  }

  // ------------------------------------------------------------------------------------------------ pure helpers
  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return out;
  }

  function base64UrlFromBytes(bytes, btoaFn) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoaFn(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecodeToString(segment, atobFn, TextDecoderCtor) {
    var b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atobFn(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (TextDecoderCtor) return new TextDecoderCtor('utf-8').decode(bytes);
    var pct = '';
    for (var j = 0; j < bytes.length; j++) pct += '%' + (bytes[j] < 16 ? '0' : '') + bytes[j].toString(16);
    return decodeURIComponent(pct);
  }

  function isPrintableAscii(s, min, max) {
    return typeof s === 'string' && s.length >= min && s.length <= max && /^[\x21-\x7e]+$/.test(s);
  }

  function parseUrl(value, URLCtor) {
    try { return new URLCtor(value); } catch (e) { return null; }
  }

  function isLoopbackHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  function normalizeScope(scope) {
    if (scope === undefined || scope === null) scope = 'openid profile email';
    if (typeof scope !== 'string') throw RanteLoginError('invalid_scope', 'scope must be a space-separated string.');
    var parts = scope.split(/\s+/).filter(Boolean);
    var seen = {};
    var out = [];
    parts.forEach(function (p) {
      if (SCOPES.indexOf(p) < 0) throw RanteLoginError('invalid_scope', 'Unsupported scope: ' + p + '.');
      if (!seen[p]) { seen[p] = true; out.push(p); }
    });
    if (!seen.openid) throw RanteLoginError('invalid_scope', 'scope must include openid.');
    return out.join(' ');
  }

  function normalizePrompt(prompt) {
    if (prompt === undefined || prompt === null || prompt === '') return null;
    if (typeof prompt !== 'string') throw RanteLoginError('invalid_request', 'prompt must be a string.');
    var parts = prompt.split(/\s+/).filter(Boolean);
    parts.forEach(function (p) {
      if (PROMPTS.indexOf(p) < 0) throw RanteLoginError('invalid_request', 'Unsupported prompt: ' + p + '.');
    });
    if (parts.indexOf('none') >= 0 && parts.length > 1) {
      throw RanteLoginError('invalid_request', 'prompt=none cannot be combined with other values.');
    }
    return parts.join(' ');
  }

  function normalizeNonce(nonce) {
    if (nonce === undefined || nonce === null) return null;
    if (!isPrintableAscii(nonce, 1, 256)) {
      throw RanteLoginError('invalid_request', 'nonce must be 1 to 256 printable ASCII characters without spaces.');
    }
    return nonce;
  }

  // The authorize request (contract 6.3): code + PKCE S256, state and nonce always.
  function buildAuthorizeUrl(p) {
    var pairs = [
      ['client_id', p.clientId],
      ['response_type', 'code'],
      ['redirect_uri', p.redirectUri],
      ['scope', p.scope],
      ['state', p.state],
      ['nonce', p.nonce],
      ['code_challenge', p.codeChallenge],
      ['code_challenge_method', 'S256']
    ];
    if (p.prompt) pairs.push(['prompt', p.prompt]);
    if (p.loginHint) pairs.push(['login_hint', p.loginHint]);
    if (p.maxAge !== undefined && p.maxAge !== null) pairs.push(['max_age', String(p.maxAge)]);
    return AUTHORIZE_ENDPOINT + '?' + pairs.map(function (kv) {
      return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]);
    }).join('&');
  }

  function buildTokenRequestBody(p) {
    return [
      ['grant_type', 'authorization_code'],
      ['code', p.code],
      ['redirect_uri', p.redirectUri],
      ['client_id', p.clientId],
      ['code_verifier', p.codeVerifier]
    ].map(function (kv) { return encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]); }).join('&');
  }

  // FedCM request (contract 7; W3C FedCM): one provider, active mode, the nonce at the top level (Chrome before 132)
  // and in params (current FedCM). No loginHint: the accounts endpoint publishes no login_hints, so a hint would
  // filter every account out.
  function buildFedCmRequest(p) {
    return {
      identity: {
        mode: 'active',
        context: p.context || 'signin',
        providers: [{
          configURL: FEDCM_CONFIG_URL,
          clientId: p.clientId,
          nonce: p.nonce,
          params: { nonce: p.nonce, scope: p.scope }
        }]
      }
    };
  }

  function decodeJwtClaims(token, atobFn, TextDecoderCtor) {
    if (typeof token !== 'string') throw RanteLoginError('invalid_id_token', 'The ID token is not a string.');
    var parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) throw RanteLoginError('invalid_id_token', 'The ID token is not a JWT.');
    try {
      var claims = JSON.parse(base64UrlDecodeToString(parts[1], atobFn, TextDecoderCtor));
      if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('not an object');
      return claims;
    } catch (e) {
      throw RanteLoginError('invalid_id_token', 'The ID token payload is not JSON.');
    }
  }

  // The claim checks a browser can make (signature validation belongs on the website's server, with the JWKS).
  function checkIdTokenClaims(claims, expect, nowSeconds) {
    var problems = [];
    if (claims.iss !== ISSUER) problems.push('iss');
    var aud = claims.aud;
    if (!(aud === expect.clientId || (Array.isArray(aud) && aud.indexOf(expect.clientId) >= 0))) problems.push('aud');
    if (claims.azp !== undefined && claims.azp !== expect.clientId) problems.push('azp');
    if (Array.isArray(aud) && aud.length > 1 && claims.azp === undefined) problems.push('azp');
    if (claims.nonce !== expect.nonce) problems.push('nonce');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) problems.push('exp');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) problems.push('iat');
    if (typeof claims.sub !== 'string' || !claims.sub) problems.push('sub');
    if (problems.length) {
      throw RanteLoginError('invalid_id_token', 'The ID token failed the checks: ' + problems.join(', ') + '.',
        { failedClaims: problems });
    }
    return claims;
  }

  // Which FedCM failures fall back to the redirect flow. Browsers report a dismissed dialog and most failures with the
  // same NetworkError (deliberately, for privacy), so a NetworkError counts as "dismissed": no navigation now, and the
  // next sign-in in this page uses the redirect flow.
  function classifyFedCmError(err) {
    var name = err && err.name;
    var idpCode = err && (typeof err.error === 'string' ? err.error : (name === 'IdentityCredentialError' ? err.code : undefined));
    if (name === 'AbortError') return { kind: 'aborted' };
    if (name === 'IdentityCredentialError' || (idpCode && name !== 'NetworkError')) {
      if (idpCode === 'access_denied') return { kind: 'denied', idpCode: idpCode };
      return { kind: 'idp_error', idpCode: idpCode || null, url: (err && err.url) || null };
    }
    if (name === 'NetworkError') return { kind: 'dismissed' };
    if (name === 'NotAllowedError' || name === 'NotSupportedError' || name === 'SecurityError' || name === 'TypeError' ||
      name === 'InvalidStateError') {
      return { kind: 'unavailable', name: name };
    }
    return { kind: 'failed', name: name || null };
  }

  function serializeCookie(name, value, maxAge, secure) {
    return name + '=' + value + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + (secure ? '; Secure' : '');
  }

  function readCookie(cookieString, name) {
    var parts = (cookieString || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+/, '');
      if (p.indexOf(name + '=') === 0) return p.substring(name.length + 1);
    }
    return null;
  }

  function supportsActiveMode(nav) {
    // Chrome's recommended probe: the browser reads identity.mode while it converts the request, even though this
    // request (no providers) is refused at once without any UI.
    var supported = false;
    try {
      var probe = nav.credentials.get({
        identity: Object.defineProperty({}, 'mode', { enumerable: true, get: function () { supported = true; return 'active'; } })
      });
      if (probe && typeof probe.catch === 'function') probe.catch(function () { /* expected */ });
    } catch (e) { /* older browsers throw synchronously */ }
    return supported;
  }

  // --------------------------------------------------------------------------------------------------- instance
  function create(win) {
    var w = win;
    var config = null;
    var inFlight = false;
    var fedCmDismissed = false;
    var activeModeSupport = null;
    var sharedSheet = null;

    function now() { return Date.now(); }

    function cryptoApi() {
      var c = w.crypto;
      if (!c || typeof c.getRandomValues !== 'function') {
        throw RanteLoginError('unsupported_browser', 'This browser has no Web Crypto random number generator.');
      }
      return c;
    }

    function randomHex(byteCount) {
      var bytes = new Uint8Array(byteCount);
      cryptoApi().getRandomValues(bytes);
      return toHex(bytes);
    }

    function s256(verifier) {
      var c = cryptoApi();
      if (!c.subtle || typeof c.subtle.digest !== 'function') {
        return Promise.reject(RanteLoginError('insecure_context',
          'PKCE needs Web Crypto (crypto.subtle), which browsers offer only on https pages and localhost.'));
      }
      var data = new Uint8Array(verifier.length);
      for (var i = 0; i < verifier.length; i++) data[i] = verifier.charCodeAt(i) & 0x7f;
      return Promise.resolve(c.subtle.digest('SHA-256', data)).then(function (buf) {
        return base64UrlFromBytes(new Uint8Array(buf), w.btoa.bind(w));
      });
    }

    function requireConfig() {
      if (!config) throw RanteLoginError('not_initialized', 'Call RanteLogin.init({ clientId, redirectUri }) first.');
      return config;
    }

    function init(options) {
      var o = options || {};
      if (typeof o.clientId !== 'string' || !GUID.test(o.clientId)) {
        throw RanteLoginError('invalid_client_id', 'clientId must be the application (client) ID GUID from the Rante Portal.');
      }
      var mode = o.mode === undefined ? 'auto' : o.mode;
      if (MODES.indexOf(mode) < 0) throw RanteLoginError('invalid_mode', 'mode must be auto, redirect or fedcm.');
      var redirectUri = null;
      if (o.redirectUri !== undefined && o.redirectUri !== null) {
        if (typeof o.redirectUri !== 'string') throw RanteLoginError('invalid_redirect_uri', 'redirectUri must be a string.');
        var u = parseUrl(o.redirectUri, w.URL);
        var ok = u && !u.username && !u.password && !u.hash && o.redirectUri.indexOf('#') < 0 && !/[\s*]/.test(o.redirectUri) &&
          o.redirectUri.length <= 512 && (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname)));
        if (!ok) {
          throw RanteLoginError('invalid_redirect_uri',
            'redirectUri must be an absolute https URL (or http://localhost / http://127.0.0.1) without a fragment, exactly as registered.');
        }
        // Registered redirect URIs are stored with the scheme and host lower-cased and the rest as written (contract
        // 3.1), and authorize matches them exactly: send the same form.
        redirectUri = o.redirectUri.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/, function (m) { return m.toLowerCase(); });
      } else if (mode !== 'fedcm') {
        throw RanteLoginError('invalid_redirect_uri', 'redirectUri is required unless mode is fedcm.');
      }
      if (o.serverSide !== undefined && typeof o.serverSide !== 'boolean') {
        throw RanteLoginError('invalid_request', 'serverSide must be true or false.');
      }
      config = Object.freeze({
        clientId: o.clientId.toLowerCase(),
        redirectUri: redirectUri,
        scope: normalizeScope(o.scope),
        mode: mode,
        serverSide: o.serverSide === true
      });
      return config;
    }

    function storage() {
      try {
        var s = w.sessionStorage;
        if (!s) throw new Error('none');
        return s;
      } catch (e) {
        throw RanteLoginError('storage_unavailable', 'Rante Login needs sessionStorage for browser-only sign-in.');
      }
    }

    function purgeStale(s) {
      var keys = [];
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i);
        if (k && k.indexOf(STORAGE_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        var keep = false;
        try {
          var t = JSON.parse(s.getItem(k));
          keep = !!t && typeof t.createdAt === 'number' && now() - t.createdAt < TRANSACTION_TTL_MS;
        } catch (e) { keep = false; }
        if (!keep) s.removeItem(k);
      });
    }

    function isSecurePage() {
      return !!(w.location && w.location.protocol === 'https:');
    }

    function setCookie(name, value) {
      w.document.cookie = serializeCookie(name, value, COOKIE_MAX_AGE, isSecurePage());
    }

    function hasUserActivation() {
      var n = w.navigator;
      if (n && n.userActivation && typeof n.userActivation.isActive === 'boolean') return n.userActivation.isActive;
      return true;
    }

    function fedCmAvailable() {
      var n = w.navigator;
      if (!n || !n.credentials || typeof n.credentials.get !== 'function' || typeof w.IdentityCredential === 'undefined') {
        return false;
      }
      if (activeModeSupport === null) activeModeSupport = supportsActiveMode(n);
      return activeModeSupport;
    }

    function startRedirect(cfg, opts) {
      if (!cfg.redirectUri) {
        return Promise.reject(RanteLoginError('invalid_redirect_uri', 'The redirect flow needs a redirectUri.'));
      }
      var state;
      var nonce;
      var verifier;
      var prompt;
      try {
        state = randomHex(32);
        nonce = normalizeNonce(opts.nonce) || randomHex(32);
        verifier = randomHex(32);
        prompt = normalizePrompt(opts.prompt);
        if (opts.loginHint !== undefined && opts.loginHint !== null &&
          (typeof opts.loginHint !== 'string' || opts.loginHint.length > 256)) {
          throw RanteLoginError('invalid_request', 'loginHint must be a string of at most 256 characters.');
        }
        if (opts.maxAge !== undefined && opts.maxAge !== null && !(typeof opts.maxAge === 'number' && opts.maxAge >= 0 &&
          Math.floor(opts.maxAge) === opts.maxAge)) {
          throw RanteLoginError('invalid_request', 'maxAge must be a whole number of seconds.');
        }
      } catch (e) {
        return Promise.reject(e);
      }
      return s256(verifier).then(function (challenge) {
        if (cfg.serverSide) {
          setCookie(COOKIE_PKCE, verifier);
          setCookie(COOKIE_STATE, state);
          setCookie(COOKIE_NONCE, nonce);
        } else {
          var s = storage();
          purgeStale(s);
          s.setItem(STORAGE_PREFIX + state, JSON.stringify({
            v: 1, verifier: verifier, nonce: nonce, clientId: cfg.clientId, redirectUri: cfg.redirectUri,
            scope: cfg.scope, createdAt: now()
          }));
        }
        var url = buildAuthorizeUrl({
          clientId: cfg.clientId, redirectUri: cfg.redirectUri, scope: cfg.scope, state: state, nonce: nonce,
          codeChallenge: challenge, prompt: prompt, loginHint: opts.loginHint || null, maxAge: opts.maxAge
        });
        w.location.assign(url);
        return { flow: 'redirect', redirecting: true };
      });
    }

    function startFedCm(cfg, opts) {
      var nonce;
      try {
        nonce = normalizeNonce(opts.nonce) || randomHex(32);
        if (opts.context !== undefined && CONTEXTS.indexOf(opts.context) < 0) {
          throw RanteLoginError('invalid_request', 'context must be signin, signup, use or continue.');
        }
      } catch (e) {
        return Promise.reject(e);
      }
      var request = buildFedCmRequest({ clientId: cfg.clientId, nonce: nonce, scope: cfg.scope, context: opts.context });
      if (cfg.serverSide) setCookie(COOKIE_NONCE, nonce);
      return w.navigator.credentials.get(request).then(function (credential) {
        var token = credential && credential.token;
        var claims = checkIdTokenClaims(decodeJwtClaims(token, w.atob.bind(w), w.TextDecoder),
          { clientId: cfg.clientId, nonce: nonce }, Math.floor(now() / 1000));
        return { flow: 'fedcm', idToken: token, nonce: nonce, claims: claims };
      });
    }

    function signIn(options) {
      var opts = options || {};
      var cfg;
      try {
        cfg = requireConfig();
      } catch (e) {
        return Promise.reject(e);
      }
      var mode = opts.mode === undefined ? cfg.mode : opts.mode;
      if (MODES.indexOf(mode) < 0) return Promise.reject(RanteLoginError('invalid_mode', 'mode must be auto, redirect or fedcm.'));
      if (inFlight) return Promise.reject(RanteLoginError('busy', 'A sign-in is already in progress.'));
      inFlight = true;
      var done = function (v) { inFlight = false; return v; };
      var fail = function (e) { inFlight = false; throw e; };
      var useFedCm = mode === 'fedcm' || (mode === 'auto' && !fedCmDismissed && fedCmAvailable() && hasUserActivation());
      if (mode === 'fedcm' && !fedCmAvailable()) {
        return Promise.reject(RanteLoginError('fedcm_unavailable', 'This browser does not support FedCM sign-in.')).catch(fail);
      }
      if (!useFedCm) return startRedirect(cfg, opts).then(done, fail);
      return startFedCm(cfg, opts).then(done, function (err) {
        if (err && err.name === 'RanteLoginError') return fail(err);
        var c = classifyFedCmError(err);
        if (c.kind === 'aborted') return fail(RanteLoginError('aborted', 'The sign-in was aborted.', { cause: err }));
        if (c.kind === 'denied') return fail(RanteLoginError('access_denied', 'The person did not allow the sign-in.', { cause: err }));
        if (mode === 'fedcm') {
          return fail(RanteLoginError(c.kind === 'dismissed' ? 'fedcm_dismissed' : 'fedcm_failed',
            'FedCM sign-in did not complete.', { cause: err, idpCode: c.idpCode || null, idpUrl: c.url || null }));
        }
        if (c.kind === 'dismissed') {
          fedCmDismissed = true;
          return fail(RanteLoginError('fedcm_dismissed',
            'The browser sign-in dialog closed without signing in. Signing in again uses the Rante Login page.',
            { cause: err, fallback: 'redirect' }));
        }
        return startRedirect(cfg, opts).then(done, fail);
      });
    }

    function cleanAddressBar(url) {
      if (!w.history || typeof w.history.replaceState !== 'function') return;
      var u = new w.URL(url.toString());
      RESPONSE_PARAMS.forEach(function (k) { u.searchParams.delete(k); });
      var search = u.searchParams.toString();
      w.history.replaceState(w.history.state, '', u.pathname + (search ? '?' + search : '') + u.hash);
    }

    function handleRedirect(options) {
      var opts = options || {};
      var cfg;
      var url;
      try {
        cfg = requireConfig();
        url = new w.URL(opts.url || w.location.href);
      } catch (e) {
        return Promise.reject(e);
      }
      var p = url.searchParams;
      var code = p.get('code');
      var state = p.get('state');
      var error = p.get('error');
      var iss = p.get('iss');
      if (!code && !error) return Promise.resolve(null);
      var clean = opts.cleanUrl !== false;
      var transaction = null;
      var key = state ? STORAGE_PREFIX + state : null;
      if (cfg.serverSide) {
        var expected = readCookie(w.document.cookie, COOKIE_STATE);
        if (!(state && expected && state === expected)) {
          if (iss === ISSUER) {
            if (clean) cleanAddressBar(url);
            return Promise.reject(RanteLoginError('state_mismatch', 'The sign-in response does not belong to this browser session.'));
          }
          return Promise.resolve(null);
        }
      } else {
        var s;
        try { s = storage(); } catch (e) { return Promise.reject(e); }
        var raw = key ? s.getItem(key) : null;
        if (raw) {
          s.removeItem(key);
          try { transaction = JSON.parse(raw); } catch (e) { transaction = null; }
        }
        if (!transaction) {
          if (iss === ISSUER) {
            if (clean) cleanAddressBar(url);
            return Promise.reject(RanteLoginError('state_mismatch',
              'The sign-in response does not match a sign-in started in this tab (or it was already used).'));
          }
          return Promise.resolve(null);
        }
        if (now() - transaction.createdAt > TRANSACTION_TTL_MS) {
          if (clean) cleanAddressBar(url);
          return Promise.reject(RanteLoginError('transaction_expired', 'The sign-in took too long. Please try again.'));
        }
      }
      if (clean) cleanAddressBar(url);
      if (iss !== ISSUER) {
        return Promise.reject(RanteLoginError(iss ? 'issuer_mismatch' : 'issuer_missing',
          'The sign-in response did not come from Rante Login.'));
      }
      if (error) {
        return Promise.reject(RanteLoginError(error, p.get('error_description') || error, { state: state }));
      }
      if (cfg.serverSide) {
        return Promise.resolve({ flow: 'redirect', code: code, state: state, iss: iss });
      }
      if (transaction.clientId !== cfg.clientId || transaction.redirectUri !== cfg.redirectUri) {
        return Promise.reject(RanteLoginError('configuration_changed', 'The sign-in started with a different clientId or redirectUri.'));
      }
      var body = buildTokenRequestBody({ code: code, redirectUri: transaction.redirectUri, clientId: transaction.clientId,
        codeVerifier: transaction.verifier });
      return w.fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      }).then(function (response) {
        return response.text().then(function (text) {
          var json = null;
          try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
          if (!response.ok || !json || typeof json !== 'object') {
            throw RanteLoginError((json && json.error) || 'token_request_failed',
              (json && json.error_description) || ('The token endpoint answered ' + response.status + '.'),
              { status: response.status });
          }
          var claims = checkIdTokenClaims(decodeJwtClaims(json.id_token, w.atob.bind(w), w.TextDecoder),
            { clientId: transaction.clientId, nonce: transaction.nonce }, Math.floor(now() / 1000));
          return {
            flow: 'redirect',
            idToken: json.id_token,
            accessToken: json.access_token,
            tokenType: json.token_type,
            expiresIn: json.expires_in,
            scope: json.scope,
            claims: claims
          };
        });
      });
    }

    // -------------------------------------------------------------------------------------------- the button
    function styleSheet(doc) {
      var Sheet = w.CSSStyleSheet;
      if (!Sheet || !Sheet.prototype || typeof Sheet.prototype.replaceSync !== 'function') return null;
      if (!sharedSheet) {
        try {
          sharedSheet = new Sheet();
          sharedSheet.replaceSync(BUTTON_CSS);
        } catch (e) {
          sharedSheet = null;
        }
      }
      return sharedSheet;
    }

    function applyFallbackStyle(el, theme, size, shape) {
      var set = function (map) {
        Object.keys(map).forEach(function (k) { el.style.setProperty(k, map[k]); });
      };
      set(FALLBACK_STYLE.base);
      set(FALLBACK_STYLE[size]);
      set(FALLBACK_STYLE[theme]);
      if (shape === 'pill') el.style.setProperty('border-radius', '999px');
    }

    function createLogo(doc) {
      var ns = 'http://www.w3.org/2000/svg';
      var svg = doc.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'rl-logo');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      var rect = doc.createElementNS(ns, 'rect');
      rect.setAttribute('width', '24');
      rect.setAttribute('height', '24');
      rect.setAttribute('rx', '5');
      rect.setAttribute('fill', '#285fa3');
      var glyph = doc.createElementNS(ns, 'path');
      glyph.setAttribute('d', 'M8.5 18.5v-13h4.75a3.75 3.75 0 0 1 0 7.5H8.5M12.75 13l4.25 5.5');
      glyph.setAttribute('fill', 'none');
      glyph.setAttribute('stroke', '#ffffff');
      glyph.setAttribute('stroke-width', '2.2');
      glyph.setAttribute('stroke-linecap', 'round');
      glyph.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(rect);
      svg.appendChild(glyph);
      return svg;
    }

    function pick(value, allowed, fallback) {
      return allowed.indexOf(value) >= 0 ? value : fallback;
    }

    function emit(target, type, detail) {
      if (typeof w.CustomEvent !== 'function' || !target || typeof target.dispatchEvent !== 'function') return;
      target.dispatchEvent(new w.CustomEvent(type, { detail: detail, bubbles: true, composed: true }));
    }

    function renderButton(element, options) {
      var o = options || {};
      var doc = w.document;
      if (!element || typeof element.appendChild !== 'function') {
        throw RanteLoginError('invalid_element', 'renderButton needs a container element.');
      }
      var theme = pick(o.theme, THEMES, 'light');
      var size = pick(o.size, SIZES, 'large');
      var shape = pick(o.shape, SHAPES, 'rectangular');
      var textKey = Object.prototype.hasOwnProperty.call(TEXTS, o.text) ? o.text : 'signin';
      var host = doc.createElement('span');
      host.setAttribute('data-rante-login-button', VERSION);
      var root = typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : host;
      var sheet = root !== host ? styleSheet(doc) : null;
      if (sheet && 'adoptedStyleSheets' in root) root.adoptedStyleSheets = [sheet];
      var button = doc.createElement('button');
      button.setAttribute('type', 'button');
      button.setAttribute('part', 'button');
      button.className = 'rl-btn rl-' + theme + ' rl-' + size + (shape === 'pill' ? ' rl-pill' : '');
      if (!sheet) applyFallbackStyle(button, theme, size, shape);
      var label = doc.createElement('span');
      label.className = 'rl-label';
      label.textContent = TEXTS[textKey];
      button.appendChild(createLogo(doc));
      button.appendChild(label);
      root.appendChild(button);
      var busy = false;
      var setBusy = function (on) {
        busy = on;
        if (on) {
          button.setAttribute('aria-busy', 'true');
          button.setAttribute('aria-disabled', 'true');
        } else {
          button.removeAttribute('aria-busy');
          button.removeAttribute('aria-disabled');
        }
      };
      button.addEventListener('click', function (event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (busy) return;
        setBusy(true);
        var context = o.context || TEXT_CONTEXT[textKey];
        signIn({ nonce: o.nonce, loginHint: o.loginHint, prompt: o.prompt, maxAge: o.maxAge, context: context })
          .then(function (result) {
            setBusy(false);
            if (result && result.flow === 'fedcm') {
              if (typeof o.onSignIn === 'function') o.onSignIn(result);
              emit(host, 'rantelogin:signin', result);
            }
          }, function (error) {
            setBusy(false);
            if (typeof o.onError === 'function') o.onError(error);
            emit(host, 'rantelogin:error', error);
          });
      });
      element.appendChild(host);
      return {
        element: host,
        button: button,
        remove: function () {
          if (host.parentNode) host.parentNode.removeChild(host);
        }
      };
    }

    return Object.freeze({
      version: VERSION,
      init: init,
      signIn: signIn,
      handleRedirect: handleRedirect,
      renderButton: renderButton
    });
  }

  return {
    version: VERSION,
    create: create,
    internals: {
      ISSUER: ISSUER,
      AUTHORIZE_ENDPOINT: AUTHORIZE_ENDPOINT,
      TOKEN_ENDPOINT: TOKEN_ENDPOINT,
      FEDCM_CONFIG_URL: FEDCM_CONFIG_URL,
      BUTTON_CSS: BUTTON_CSS,
      toHex: toHex,
      base64UrlFromBytes: base64UrlFromBytes,
      base64UrlDecodeToString: base64UrlDecodeToString,
      normalizeScope: normalizeScope,
      normalizePrompt: normalizePrompt,
      normalizeNonce: normalizeNonce,
      buildAuthorizeUrl: buildAuthorizeUrl,
      buildTokenRequestBody: buildTokenRequestBody,
      buildFedCmRequest: buildFedCmRequest,
      decodeJwtClaims: decodeJwtClaims,
      checkIdTokenClaims: checkIdTokenClaims,
      classifyFedCmError: classifyFedCmError,
      serializeCookie: serializeCookie,
      readCookie: readCookie,
      supportsActiveMode: supportsActiveMode
    }
  };
});
