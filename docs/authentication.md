# Authentication

`operate` supports [HTTP Basic authentication](#basic-auth), [OAuth 2.0](#oauth) with the
authorization code flow and PKCE, for engines behind a gateway that checks tokens of Keycloak,
Microsoft Entra ID, Auth0 or another OpenID Connect provider, [bearer tokens](#bearer-tokens)
you get elsewhere (SSO tooling, a CI secret, `az`, `gcloud`) and [token commands](#token-commands)
that operate runs to fetch one. Other schemes go into [headers](#other-headers).

## Basic auth

Basic auth works e.g. with Camunda 7 Run with `camunda.bpm.run.auth.enabled=true`, CIB seven Run
additionally with `camunda.bpm.run.auth.authentication=basic` (its default `pseudo` lets every
request in), Operaton Run with `operaton.bpm.run.auth.enabled=true`, or a
`ProcessEngineAuthenticationFilter` or proxy in front of `/engine-rest`.

| Value    | Flag                    | Environment        | Profile (`auth` object)                     |
| -------- | ----------------------- | ------------------ | ------------------------------------------- |
| type     | `--auth <type>`         | `OPERATE_AUTH`     | `type`: `none` or `basic`                   |
| username | `--auth-user <name>`    | `OPERATE_USERNAME` | `username`                                  |
| password | `--auth-password-stdin` | `OPERATE_PASSWORD` | `passwordEnv` (variable name) or `password` |

- Each value is resolved on its own: flag > environment variable > profile. Without a type
  anywhere, a username or `--auth-password-stdin` selects `basic`; `--auth none` or
  `OPERATE_AUTH=none` switch Basic auth off even when the profile sets it.
- Credentials follow URL overrides: with `--url` or `OPERATE_URL` set, the credentials of the
  profile (and `OPERATE_USERNAME`/`OPERATE_PASSWORD`) go to that URL. Check `operate config show`
  when a shell has a leftover `OPERATE_URL`, and use `https://` beyond `localhost`: Basic auth sends
  the password readable to anyone on the path.
- The password is never a plain flag (shell history, process list). `--auth-password-stdin`
  reads the first line of stdin, so it cannot be combined with `--body -`. In a profile, prefer
  `passwordEnv`, the name of an environment variable that holds the password; a literal
  `password` is stored in plain text (the config file has mode `0600`, and `config set` warns).
  `config set` also warns, without repeating it, when the variable given to
  `--auth-password-env` is not set in its environment: pass the name, never the password. An
  unset name that is not in the usual upper-case form (`--auth-password-env s3cret_pw` instead of
  `CAMUNDA_PASSWORD`) is refused without being stored or repeated. Errors repeat the
  `passwordEnv` of a profile only in that form, and the profile that `config set|unset|use`
  print shows `***` for an unset name in another form (the same holds for
  `--oauth-client-secret-env` / `clientSecretEnv` and `--auth-token-env` / `tokenEnv`).
- Basic auth with a missing username or password fails with exit code 3 before any request is
  sent, naming where each value was looked up. Usernames must not contain `:` (RFC 7617), and
  neither value may contain control characters.
- `operate ping` reports `"auth": "basic"` and `"user"`. `config show` lists `auth`, `username`
  and `password` with their sources. The password and the `Authorization` header are masked
  (`***`, `Basic ***`) in `config show`, `--verbose` and `--dry-run` output, including the curl
  line, unless `--show-secrets` is given.
- An HTTP 401 (exit code 4) says whether operate sent no credentials and why (for example
  `OPERATE_AUTH=none`, or a password without a username), or which user the engine rejected and
  where the credentials came from.
- A mistyped password flag (`--auth-password=...`, a value after `--auth-password-stdin`) is a
  usage error that never repeats the value.

```sh
# per call: the password comes from stdin
printf '%s\n' "$CAMUNDA_PASSWORD" | operate ping --auth basic --auth-user demo --auth-password-stdin
# per shell or CI job: take the password from a secret, never type it into the command line
export OPERATE_USERNAME=demo OPERATE_PASSWORD="$CAMUNDA_PASSWORD"
# interactive shell: read it without echo and without shell history
read -rs OPERATE_PASSWORD && export OPERATE_PASSWORD
operate task list --assignee demo
# per profile: only the name of the variable is stored
operate config set staging --url https://staging.example.com/engine-rest --auth basic --auth-user demo --auth-password-env CAMUNDA_PASSWORD
```

## OAuth

A person logs in once with `operate auth login` in a terminal; every other command reads the
cached tokens, sends `Authorization: Bearer <token>` and refreshes the token on its own. No
command except `auth login` ever starts a login: without a usable login a command fails with
`LOGIN_REQUIRED` (exit code 4) and a hint naming the command a person runs, so agents never end up
waiting for a browser. Client credentials and the device flow are not supported.

Configure the profile (or the `OPERATE_OAUTH_*` variables), then log in:

```sh
operate config set sso --url https://camunda.example.com/engine-rest --auth oauth --oauth-issuer https://login.example.com/realms/camunda --oauth-client-id operate-cli --oauth-audience engine-rest
```

```text
$ operate auth login --profile sso
Logging in to https://login.example.com/realms/camunda as client operate-cli (profile "sso").
Open this URL in a browser to log in:
  https://login.example.com/realms/camunda/protocol/openid-connect/auth?response_type=code&client_id=operate-cli&redirect_uri=...
Opened the system browser.
Waiting up to 300 s for the login at http://127.0.0.1:53682/callback (Ctrl+C cancels).
Logged in as alice (profile "sso").
{"profile":"sso","issuer":"https://login.example.com/realms/camunda","clientId":"operate-cli","user":"alice","subject":"27c6dbd7-...","scopes":["openid","offline_access","profile","email"],"accessTokenExpiresAt":"2026-10-09T12:05:00.000Z","accessTokenValid":true,"refreshTokenExpiresAt":"2026-11-08T12:00:00.000Z","canRefresh":true,"loggedInAt":"2026-10-09T12:00:00.000Z","refreshedAt":null,"tokenCache":"/home/me/.config/operate/tokens/profile-sso.json"}

$ operate process-instance list --profile sso
```

| Value         | Environment                                                            | Profile (`auth` object) / `config set` option                                           |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| type          | `OPERATE_AUTH=oauth` (or `--auth oauth`)                               | `type: "oauth"` / `--auth oauth`; OAuth is never implied                                |
| issuer        | `OPERATE_OAUTH_ISSUER`                                                 | `issuer` / `--oauth-issuer <url>`; the endpoints come from OpenID Connect discovery     |
| endpoints     | `OPERATE_OAUTH_AUTHORIZATION_ENDPOINT`, `OPERATE_OAUTH_TOKEN_ENDPOINT` | `authorizationEndpoint`, `tokenEndpoint` (both or neither) / `--oauth-*-endpoint <url>` |
| client id     | `OPERATE_OAUTH_CLIENT_ID`                                              | `clientId` / `--oauth-client-id <id>`                                                   |
| client secret | `OPERATE_OAUTH_CLIENT_SECRET`                                          | `clientSecretEnv` (variable name) or `clientSecret` / `--oauth-client-secret-env <VAR>` |
| scopes        | `OPERATE_OAUTH_SCOPES` (spaces or commas)                              | `scopes` / `--oauth-scopes <scopes>`; default `openid offline_access`                   |
| audience      | `OPERATE_OAUTH_AUDIENCE`                                               | `audience` / `--oauth-audience <audience>` (sent as `audience` parameter, Auth0 style)  |
| redirect port | `OPERATE_OAUTH_REDIRECT_PORT`                                          | `redirectPort` / `--oauth-redirect-port <port>`; default 0 = any free port              |

- The issuer, or both endpoints, from the environment replace those of the profile as a group;
  every other value resolves on its own (environment > profile > default). URLs must use
  `https://` (`http://` only for `localhost`, `127.0.0.1` and `[::1]`). A public client (no
  secret) with PKCE is the normal case; `--oauth-client-secret-stdin` stores a literal secret
  (with a warning); a client secret given to `--oauth-client-secret-env` in place of the name of
  its variable is refused like a password (see Basic auth). OAuth together with an
  `Authorization` header, or with `--auth-password-stdin`, is a configuration error, and so is a
  missing issuer or client id.
- `operate auth login [--no-browser] [--login-timeout <ms>]` uses the authorization code flow
  with PKCE (`S256`) and a random `state`, and listens on `127.0.0.1` only while it waits for
  the redirect (RFC 8252). It prints the URL before it starts the system browser (`BROWSER`, else
  `open`, `xdg-open` with a display, or the Windows URL handler), so it also works over SSH:
  set a fixed `--oauth-redirect-port 8765`, forward it with `ssh -L 8765:127.0.0.1:8765 host` and
  open the URL in your local browser. A login always replaces the cached one.
- `operate auth status` shows user, scopes and the expiry of the access and refresh token without
  network access and exits with 4 (`LOGIN_REQUIRED`) when no command could run without a new
  login. Tokens are never printed. It reads only the cache: a session revoked at the server is
  noticed by the next command that refreshes, which records the refusal (`invalid_grant`) in the
  cache, so `auth status` and later commands then fail with `LOGIN_REQUIRED` at once.
- `operate auth logout` revokes the refresh token (when the server supports RFC 7009) and removes
  the cached login. An access token issued before stays valid until it expires at gateways that
  check tokens offline (JWT gateways such as Envoy); `logout` says until when. Without a
  revocation endpoint (explicit endpoints, or a provider whose discovery document lists none,
  such as Microsoft Entra ID) nothing is revoked and `logout` warns: end the session at the
  provider. A confidential client's login is revoked only with the client secret of the same
  issuer and client.
- Tokens are cached per profile in `$XDG_CONFIG_HOME/operate/tokens/profile-<name>.json` (default
  `~/.config/operate/tokens`, Windows `%APPDATA%\operate\tokens`; without a profile
  `env-<hash>.json`), written atomically with mode `0600` in a `0700` directory, never next to a
  config file named by `--config`. Upper-case letters of the profile name are percent-encoded
  (`Prod` → `profile-%50rod.json`), so profiles whose names differ only in case keep separate
  logins on case-insensitive file systems (macOS, Windows) too; a login that operate 0.5.0 or
  earlier cached as `profile-Prod.json` moves to the new name on first use. A login is kept for
  the issuer, client, audience and scopes it was made for; changing them needs a new login
  (`LOGIN_REQUIRED` names what differs and which `OPERATE_OAUTH_*` variable of the environment
  causes it).
- Refreshes happen 60 s before the access token expires (at most half its lifetime) and once
  after a 401; rotated refresh tokens are stored. Commands running in parallel share one refresh
  through a lock file, so a refresh token is never sent twice (Keycloak ends the session when one
  is reused). With strict rotation a refresh answer lost on the way (timeout, dropped connection)
  ends the login, too: run `auth login` again.
- The gateway must expect exactly the issuer operate logs in with: `http://localhost:8180/realms/x`
  and `http://127.0.0.1:8180/realms/x` are different issuers to a JWT gateway, and Keycloak issues
  tokens for the host name the browser and operate used. `UNAUTHORIZED` or `FORBIDDEN` after a
  successful login are gateway (issuer, audience, clock) or permission problems, not login
  problems; the hints say what to check, and a 403 never triggers a refresh.
- `--dry-run` shows the cached token as `Bearer ***` and notes on stderr when there is no usable
  login; `--verbose` traces token requests too (client credentials always masked) and says
  when a failed refresh falls back to the still valid token;
  `--show-secrets` reveals only the Bearer token. `operate ping` reports `"auth": "oauth"` and the
  user. `config show` lists the OAuth values with their sources (the client secret masked).

Security notes:

- Use `https://` for the engine URL: operate warns on stderr when it sends the access token over
  plain `http://` to a host other than `localhost`, `127.0.0.1` or `[::1]` (RFC 6750 §5.3).
- Treat a config file like your own: logins are cached per profile name, so a config file named
  by `--config` or `OPERATE_CONFIG` whose profile has your profile's name, issuer and client id
  uses your login and sends your token to its `url` (as `--url` does). Each value resolves on its
  own, so `OPERATE_OAUTH_CLIENT_SECRET` also goes to the token endpoint of whatever issuer the
  profile or `OPERATE_OAUTH_ISSUER` names. Point operate (and agents) only at config files and
  variables you trust.
- operate rejects a login response whose `iss` (RFC 9207) names another issuer, and requires
  `iss` when the provider advertises it. A provider that sends no `iss` (Microsoft Entra ID) gives
  no such mix-up protection: log in only to issuers you trust.

Client registration:

- **Keycloak**: a client with Client authentication off (public), Standard flow on, Direct access
  grants off, Valid redirect URIs `http://127.0.0.1/callback` (Keycloak accepts any port for
  loopback redirects) and, under Advanced, the PKCE method `S256`. Users need the
  `offline_access` role (part of the default roles) for refresh tokens that outlive the browser
  session. Keycloak ignores the `audience` parameter: add an Audience mapper to the client's
  dedicated scope so the access token carries the audience the gateway expects.
- **Microsoft Entra ID**: register a "Mobile and desktop applications" redirect URI
  `http://127.0.0.1/callback` (Entra ignores the port of loopback redirect URIs; the `http`
  loopback URI currently has to be added in the application manifest), issuer
  `https://login.microsoftonline.com/<tenant-id>/v2.0`, and request the API by scope, e.g.
  `--oauth-scopes 'openid offline_access api://<app-id>/.default'` instead of an audience.
- **Auth0**: the issuer is `https://<tenant>.auth0.com/` with the trailing slash (operate compares
  it with the discovery document exactly), the API identifier goes into `--oauth-audience`;
  register `http://127.0.0.1:8765/callback` with a fixed `--oauth-redirect-port 8765`.

## Bearer tokens

When you already get an access token elsewhere (company SSO tooling, a CI secret,
`az account get-access-token`, `gcloud auth print-access-token`, a token copied from another tool)
because the OAuth login of `operate auth login` is not possible or not wanted, `--auth bearer`
sends it as `Authorization: Bearer <token>` and does nothing else: no login, no refresh, no cache.

| Value | Flag                 | Environment     | Profile (`auth` object) / `config set` option                                            |
| ----- | -------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| type  | `--auth bearer`      | `OPERATE_AUTH`  | `type: "bearer"` / `--auth bearer`                                                       |
| token | `--auth-token-stdin` | `OPERATE_TOKEN` | `tokenEnv` (variable name) / `--auth-token-env <VAR>`, or `token` / `--auth-token-stdin` |

```sh
# Microsoft Entra ID: a token for the app registration of the API the engine's gateway expects
# (without --resource, az returns a token for Azure Resource Manager, whose audience a gateway rejects)
export OPERATE_TOKEN=$(az account get-access-token --resource api://<engine-api-app-id> --query accessToken -o tsv)
operate process-instance list
# Google Cloud
export OPERATE_TOKEN=$(gcloud auth print-access-token)
# CI job: the token is the secret CI_ENGINE_TOKEN; the profile stores only the variable name
operate config set ci --url https://camunda.example.com/engine-rest --auth bearer --auth-token-env CI_ENGINE_TOKEN
```

- The token comes from `--auth-token-stdin` (the first line of stdin, e.g.
  `gcloud auth print-access-token | operate task list --auth-token-stdin`; not together with
  `--body -` or `--auth-password-stdin`), else `OPERATE_TOKEN`, else the variable named by the
  profile's `tokenEnv` (it must be set), else the profile's `token`. It is never a plain flag.
- Without an auth type anywhere, `OPERATE_TOKEN` or `--auth-token-stdin` selects `bearer`, as a
  username selects `basic`; both at once is a configuration error asking for an explicit `--auth`.
  An explicit type always wins: `--auth none` switches the token off, and with `basic` or `oauth`
  (also the type a profile made by `config set` always stores) `OPERATE_TOKEN` is ignored:
  `config show` lists it as unused, and the hints of `LOGIN_REQUIRED`, 401/403 and configuration
  errors say to add `--auth bearer` or `OPERATE_AUTH=bearer`. A token never selects OAuth.
- A pasted `Bearer ` prefix and surrounding blanks are dropped; the rest must be an RFC 6750
  token (letters, digits, `-._~+/`, trailing `=`), otherwise exit 3 without repeating it. In a
  profile prefer `--auth-token-env <VAR>`; a token stored with `config set --auth-token-stdin` is
  plain text in the `0600` config file (`config set` warns), and an unset variable gets a warning
  that does not repeat its "name" (it may be the token itself). An unset name that is not in the
  usual upper-case form (`--auth-token-env "$CI_TOKEN"` instead of `CI_TOKEN`) is refused without
  being stored or repeated.
- JWTs: operate reads `exp`, `sub`, `preferred_username`, `iss` and `aud` without checking the
  signature (the engine or its gateway does). A JWT whose `exp` lies more than 30 s in the past
  fails before any request with `TOKEN_EXPIRED` (exit 4): fetch a new token. Opaque tokens are sent
  as they are.
- `operate auth status` shows where the token comes from and, for a JWT, subject, user, issuer,
  audience and expiry (exit 4 when it expired), also for a piped token (`--auth-token-stdin`;
  with a Basic or OAuth profile add `OPERATE_AUTH=bearer`, `auth` commands have no `--auth`); it
  never prints the token. `auth login` and `auth logout` do not apply: operate neither fetches nor
  stores such tokens (a [token command](#token-commands) lets operate fetch them).
- A 401 names the token's source and, for a JWT, the expiry, issuer and audience to check; a 403
  points to missing roles or scopes. operate never retries a rejected token.
- The token is masked as `Bearer ***` in `--dry-run`, curl, `--verbose` and `config show` unless
  `--show-secrets`; usage errors never repeat a word typed after `--auth bearer`,
  `--auth-token-stdin` or `operate auth` (`--auth bearer $TOKEN` is a mistake: `--auth` takes only
  the type). `operate ping` reports `"auth": "bearer"` and, for a JWT, `user` and
  `subject`. A bearer token together with an `Authorization` header is a configuration error, and
  operate warns when it sends the token over plain `http://` beyond `localhost`.

## Token commands

With short-lived tokens (a local Keycloak dev realm, corporate SSO tooling) someone has to fetch a
new token before nearly every call. A token command does it for operate: a command line that prints
a bearer token on the first line of its stdout. operate runs it when it needs a token.

| Value         | Flag                         | Environment             | Profile (`auth` object) / `config set` option |
| ------------- | ---------------------------- | ----------------------- | --------------------------------------------- |
| type          | `--auth bearer`              | `OPERATE_AUTH`          | `type: "bearer"` / `--auth bearer`            |
| token command | `--auth-token-command <cmd>` | `OPERATE_TOKEN_COMMAND` | `tokenCommand` / `--auth-token-command <cmd>` |

```sh
# a local Keycloak dev realm: the password grant of a test user (only for local test realms)
operate config set dev --url http://localhost:8080/engine-rest --auth bearer --auth-token-command './scripts/dev-token.sh'
operate auth status --profile dev
operate task list --profile dev
```

- The token sources in order: `--auth-token-stdin`, `--auth-token-command`, `OPERATE_TOKEN`,
  `OPERATE_TOKEN_COMMAND`, then the profile's `tokenEnv`, `tokenCommand` or `token` (one of them).
  Like `OPERATE_TOKEN`, `--auth-token-command` and `OPERATE_TOKEN_COMMAND` select bearer auth
  without an auth type; an explicit other type leaves them unused (`config show` says so).
- The shell runs the command (`sh -c`, `cmd.exe` on Windows) with stdin closed, so it must not
  wait for input; the request timeout (`--timeout`) bounds it. The first line of its stdout is the
  token (a leading `Bearer ` is dropped, the rest must be a token, not a JSON answer: use e.g.
  `jq -r .access_token`). A command of a project file runs in the directory of that file, every
  other one in the working directory.
- A JWT with `exp` is cached in the token directory (`command-<hash>.json`, mode `0600`, one per
  command line and directory it runs in) and reused, also by later and parallel commands, until
  60 s before it expires (at most half its lifetime), so a long `operate wait` keeps a valid token. An opaque token is fetched once per
  call. After a 401 operate runs the command once more and retries with the new token before it
  reports the error. A command that prints an expired JWT fails with `TOKEN_EXPIRED` (exit 4).
- A command that fails, times out or prints no token fails with `LOGIN_FAILED` (exit 4); the
  message quotes the end of its stderr. Error messages never show the token, nor the command line
  (`operate config show` and `operate auth status` print it): keep secrets out of the command line
  and let the command read them from a file or a variable.
- `operate auth status` runs the command (or uses its cached token) and shows the command, where
  it comes from and the claims of the token; `operate auth logout` removes the cached token.
  `--dry-run` runs it too and notes a failure instead of failing.

A token command in a [project file](configuration.md#project-file) runs code from the repository,
and a variable it names for a secret (`tokenEnv`, `passwordEnv`, `clientSecretEnv`) goes to the
engine URL the file names. operate therefore runs such a command and reads such a variable only
after a person reviewed the file and ran `operate config trust` in the repository, which records the
file with a hash of its content in `trusted.json` of the operate config directory (like direnv's
`allow`); `config trust` lists the commands and variables it allows. Any change of the file outside
`operate config ... --project` needs a new `operate config trust`; until then commands fail with a
CONFIG error (exit 3) that says so. `operate config untrust` withdraws the trust. Token commands and
variables of your own config file, of a file named with `--config` and of the environment need no
trust.

```sh
operate config set dev --project --url http://localhost:8080/engine-rest --auth bearer --auth-token-command './scripts/dev-token.sh'
operate config trust
```

Agents never run `operate config trust` themselves: on the CONFIG error about an untrusted project
file they ask the user to review the file and trust it.

## Other headers

Other schemes, such as API keys or gateway specific headers, are passed as headers: per call with
`-H`, in the environment with `OPERATE_HEADERS` (keeps the credential out of the command line and
shell history), or stored in a profile. A bearer token can still go into an `Authorization` header,
but [`--auth bearer`](#bearer-tokens) also checks its syntax and expiry and explains a 401. Headers
merge per name: profile, then `OPERATE_HEADERS`, then `-H`. An `Authorization` header together
with Basic auth, OAuth or a bearer token is a configuration error; in a profile, `config set` with
auth options replaces a stored `Authorization` header (with a notice on stderr), and `--auth none`
keeps the header and switches the auth off. `Authorization` and other secret headers (cookies,
names containing `token`, `secret`, `password`, `api-key`) are masked as `***` in dry-run, verbose
and config output unless `--show-secrets` is given.

```sh
export OPERATE_HEADERS='X-API-Key: k-7f3a...'
operate config set prod --header 'X-Tenant-Id: acme'
```
