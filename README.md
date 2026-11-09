# Rante Login SDK for websites

"Sign in with Rante" for your website, in one script:

- a sign-in button;
- the browser's own account dialog ([FedCM](https://www.w3.org/TR/fedcm/)) where the browser supports it;
- the standard OpenID Connect redirect flow (authorization code with PKCE) everywhere else.

The SDK is plain ES2019 with no dependencies and no build step. Rante serves it at an immutable, versioned URL with a
Subresource Integrity hash, and `rante-login.js` in this repository is byte for byte the file that is served.

## Before you start

1. Sign in to the Rante Portal and create a developer app at <https://portal.rante.com/dev/apps>.
2. Turn on Rante Login for the app.
3. Add your redirect URI (for example `https://shop.example.com/auth/rante/callback`) and your website's origin.
4. Choose which profile items your site asks for.
5. Copy the app's **Application (client) ID**.

## Quick start

```html
<script src="https://login.rante.com/sdk/v1/rante-login.js"
        integrity="sha384-2W12/NktCjRqFuXWiUtHr1yEtdrjBlCRWnJ+//FZMiqd1KRX/K+YMWLoMgF9R7wf"
        crossorigin="anonymous"></script>

<div id="rante-signin"></div>

<script>
  RanteLogin.init({
    clientId: '00000000-0000-0000-0000-000000000000', // your Application (client) ID
    redirectUri: 'https://shop.example.com/auth/rante/callback'
  });

  // On your sign-in page: the button.
  RanteLogin.renderButton(document.getElementById('rante-signin'), {
    onSignIn: function (result) {
      // FedCM sign-in finished on this page: send result.idToken to your server.
    },
    onError: function (error) {
      console.warn(error.code, error.message);
    }
  });

  // On your redirectUri page: finish a redirect sign-in.
  RanteLogin.handleRedirect().then(function (result) {
    if (result) {
      // result.idToken, result.accessToken, result.claims
    }
  });
</script>
```

The inline scripts are only for brevity. With a strict Content Security Policy, put these calls in your own script file.
The button itself needs no inline styles, because its styles are applied through a constructable stylesheet.

## How sign-in works

- **`mode: 'auto'` (the default).** In browsers that support FedCM (Chrome and Edge), a click on the button opens the
  browser's account dialog. The ID token comes back without leaving the page. In other browsers, the SDK redirects to
  login.rante.com and back to your `redirectUri`.
- **If the person closes the FedCM dialog**, the SDK reports `fedcm_dismissed`. The next sign-in on that page uses the
  redirect flow.
- **`mode: 'redirect'`** always redirects.
- **`mode: 'fedcm'`** only uses FedCM. It fails with `fedcm_unavailable` where FedCM isn't supported, and it doesn't
  need a `redirectUri`.

The first time someone signs in to your site, Rante Login shows a consent screen listing what your app asks for.
Optional items can be declined.

## Browser-only or server-side

**Browser-only (the default).** `handleRedirect()` exchanges the authorization code at the token endpoint itself, with
PKCE and no client secret. It keeps the sign-in transaction in `sessionStorage` for up to 10 minutes. It returns
`{ flow, idToken, accessToken, tokenType, expiresIn, scope, claims }`.

**Server-side (`serverSide: true`).** `handleRedirect()` only checks the response and returns
`{ flow: 'redirect', code, state, iss }`. The PKCE verifier, state and nonce are in first-party cookies
(`rante_login_pkce`, `rante_login_state` and `rante_login_nonce`; `SameSite=Lax`, 10 minutes). Your server then:

1. exchanges the code at the token endpoint, sending the `code_verifier` and authenticating as your app (for example
   with `private_key_jwt` and a key registered on the app);
2. validates the ID token (see below).

## Validate tokens on your server

Before returning an ID token, the SDK checks its `iss`, `aud`, `azp`, `nonce`, `exp`, `iat` and `sub`. It does **not**
check the signature. Before you trust who signed in, send the ID token to your server and verify it there:

- **Signature:** RS256, against the keys at `https://login.rante.com/common/discovery/v2.0/keys` (match the `kid`).
- **Claims:**
  - `iss` is `https://login.rante.com/common/v2.0`;
  - `aud` is your client ID;
  - `nonce` is the one you sent;
  - `exp` is in the future.

Any standard OpenID Connect library can do this from the discovery document.

`sub` is a pairwise identifier. It stays the same for your organization's apps and is different for other
organizations. An email address is only released when the person has verified it.

## Server-side SDKs

For `serverSide: true`, these SDKs finish the sign-in on your server. Each one:

- exchanges the code with `private_key_jwt` or PKCE alone;
- validates the ID token as described above;
- reads the cookies this SDK leaves.

Each comes with an example website and tests.

| Language | Repository |
|---|---|
| Node.js | [rante-login-sdk-node](https://github.com/rantegraph/rante-login-sdk-node) |
| Python | [rante-login-sdk-python](https://github.com/rantegraph/rante-login-sdk-python) |
| .NET | [rante-login-sdk-dotnet](https://github.com/rantegraph/rante-login-sdk-dotnet) |
| Java | [rante-login-sdk-java](https://github.com/rantegraph/rante-login-sdk-java) |
| Go | [rante-login-sdk-go](https://github.com/rantegraph/rante-login-sdk-go) |
| PHP | [rante-login-sdk-php](https://github.com/rantegraph/rante-login-sdk-php) |

## Endpoints

| | URL |
|---|---|
| Issuer | `https://login.rante.com/common/v2.0` |
| Discovery | `https://login.rante.com/common/v2.0/.well-known/openid-configuration` |
| Signing keys (JWKS) | `https://login.rante.com/common/discovery/v2.0/keys` |
| Authorize | `https://login.rante.com/common/oauth2/v2.0/authorize` |
| Token | `https://login.rante.com/common/oauth2/v2.0/token` |
| Userinfo | `https://login.rante.com/common/oidc/v2.0/userinfo` |

## API

### `RanteLogin.init(options)`

| Option | Description |
|---|---|
| `clientId` | Required. Your app's Application (client) ID (a GUID). |
| `redirectUri` | Exactly as registered. It must be `https`, or `http://localhost` / `http://127.0.0.1` during development, with no fragment. Required unless `mode` is `'fedcm'`. |
| `scope` | Space-separated, and it must include `openid`. Supported: `openid`, `profile`, `email`, `phone`, `address`, `rante.organization`. Default: `'openid profile email'`. |
| `mode` | `'auto'` (default), `'redirect'` or `'fedcm'`. |
| `serverSide` | `true` to finish sign-in on your server. Default: `false`. |

### `RanteLogin.renderButton(element, options)`

Adds a "Sign in with Rante" button to `element` and returns `{ element, button, remove() }`.

| Option | Description |
|---|---|
| `theme` | `'light'` (default), `'dark'` or `'outline'`. |
| `size` | `'small'`, `'medium'` or `'large'` (default). |
| `shape` | `'rectangular'` (default) or `'pill'`. |
| `text` | `'signin'` (default), `'continue'` or `'signup'` (also `'signin_with'`, `'continue_with'`, `'signup_with'`). |
| `onSignIn(result)` | Called after a FedCM sign-in. A redirect sign-in finishes on your `redirectUri` page instead. |
| `onError(error)` | Called with a `RanteLoginError`. |
| `nonce`, `loginHint`, `prompt`, `maxAge`, `context` | Passed on to `signIn`. |

The button also dispatches bubbling `rantelogin:signin` and `rantelogin:error` events.

Don't also call `RanteLogin.signIn()` from your own click handler on the same button. The button already calls it, and
a second call fails with `busy`.

### `RanteLogin.signIn(options)`

Starts a sign-in from your own UI; call it from a click handler. It returns a promise:

- **FedCM:** resolves with `{ flow: 'fedcm', idToken, nonce, claims }`.
- **Redirect:** the page navigates to login.rante.com.

| Option | Description |
|---|---|
| `nonce` | Your own nonce, for example one issued by your server. Default: a random one. |
| `loginHint` | Suggested account, up to 256 characters. |
| `prompt` | `'none'`, `'login'`, `'consent'` or `'select_account'`. |
| `maxAge` | Maximum authentication age, in seconds. |
| `mode` | Overrides the `init` mode for this sign-in. |
| `context` | FedCM dialog wording: `'signin'`, `'signup'`, `'use'` or `'continue'`. |

### `RanteLogin.handleRedirect(options)`

Call it on your `redirectUri` page. It resolves with `null` when the URL carries no sign-in response.

| Option | Description |
|---|---|
| `url` | Default: `location.href`. |
| `cleanUrl` | Default `true`: removes `code`, `state`, `iss` and the other response parameters from the address bar. |

### Errors

Promises reject, and `init` and `renderButton` throw, an `Error` whose `name` is `RanteLoginError`. Its `code` is one of
the following, or an OAuth error returned by Rante Login (for example `access_denied` when the person cancels consent).

| Group | Codes |
|---|---|
| Configuration | `invalid_client_id`, `invalid_redirect_uri`, `invalid_scope`, `invalid_mode`, `invalid_request`, `invalid_element`, `not_initialized` |
| Sign-in | `busy`, `aborted`, `access_denied`, `fedcm_unavailable`, `fedcm_dismissed`, `fedcm_failed` |
| Redirect response | `state_mismatch`, `transaction_expired`, `issuer_mismatch`, `issuer_missing`, `configuration_changed` |
| Tokens | `token_request_failed`, `invalid_id_token` |
| Browser | `storage_unavailable`, `insecure_context`, `unsupported_browser` |

## Versioning and integrity

The file served at a given URL never changes. A changed SDK is published at a new versioned path with a new integrity
hash, listed in [CHANGELOG.md](CHANGELOG.md) and tagged in this repository.

To check that this repository matches what Rante serves:

```sh
node tools/sri.js   # prints the integrity of rante-login.js in this repository
curl -s https://login.rante.com/sdk/v1/rante-login.js | openssl dgst -sha384 -binary | openssl base64 -A
```

Both must give `2W12/NktCjRqFuXWiUtHr1yEtdrjBlCRWnJ+//FZMiqd1KRX/K+YMWLoMgF9R7wf` for version 1.0.0.

## Development

```sh
npm test   # node --test (Node 18 or later); there's nothing to install
```

## License

[MIT](LICENSE)
