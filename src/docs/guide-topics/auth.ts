/** `operate guide auth`: Basic auth, bearer tokens, token commands and OAuth logins. */

import type { GuideTopic } from './topic.js';

export const AUTH_TOPIC: GuideTopic = {
  name: 'auth',
  summary: 'Basic auth, bearer tokens and token commands, OAuth logins, what to do on exit 4',
  text: `# operate guide auth: Basic auth, bearer tokens and OAuth

The auth type comes from \`--auth none|basic|oauth|bearer\`, \`OPERATE_AUTH\` or the profile; without
one, a username selects Basic auth and a token bearer auth. \`operate ping\` reports the auth in use,
\`operate config show\` every value with its source. Secrets are masked unless \`--show-secrets\`.

## Basic auth

The username comes from \`--auth-user\`, \`OPERATE_USERNAME\` or the profile, the password from
\`--auth-password-stdin\` (first line of stdin, never a flag), \`OPERATE_PASSWORD\` or the profile
(best as a variable name: \`--auth-password-env <VAR>\`). A username or \`--auth-password-stdin\`
selects Basic auth, \`--auth none\` or \`OPERATE_AUTH=none\` switch it off; missing values exit 3. A
401 hint says why no credentials were sent or which user the engine rejected.

\`\`\`sh
printf '%s\\n' "$CAMUNDA_PASSWORD" | operate ping --auth basic --auth-user demo --auth-password-stdin
operate config set prod --auth basic --auth-user demo --auth-password-env CAMUNDA_PASSWORD
\`\`\`

## Bearer tokens

Bearer tokens from elsewhere (SSO tooling, CI): \`OPERATE_TOKEN\`, \`--auth-token-stdin\` or a profile
(\`--auth-token-env <VAR>\`) select \`--auth bearer\` (add it if \`OPERATE_AUTH\` or the profile sets
another type); \`operate auth status\` shows its source and JWT expiry. It is never refreshed: on
exit 4 \`TOKEN_EXPIRED\` ask the user for a new token.

\`\`\`sh
operate config set ci --auth bearer --auth-token-env CI_ENGINE_TOKEN
\`\`\`

## Token commands

A token command prints the token on its first line: \`--auth-token-command <cmd>\`,
\`OPERATE_TOKEN_COMMAND\` or a profile (\`config set --auth-token-command\`). operate runs it when it
needs a token, reuses a JWT until shortly before it expires and runs it again once after a 401. A
failing command exits 4 with \`LOGIN_FAILED\` and the end of its stderr. \`operate auth status\` runs
it and shows the token's claims; \`operate auth logout\` drops the cached token.

\`\`\`sh
operate config set dev --auth bearer --auth-token-command './scripts/token.sh dev'
operate auth status --profile dev
\`\`\`

A token command of a project file (\`.operate.json\`) runs code from the repository, and a variable
it names for a secret (\`tokenEnv\`, \`passwordEnv\`, \`clientSecretEnv\`) goes to its engine: both
take effect only after a person reviewed the file and ran \`operate config trust\`, again after
every change. On the CONFIG error (exit 3) that says the file is not trusted, stop and ask the
user; never run \`operate config trust\` yourself.

## OAuth

OAuth (\`OPERATE_OAUTH_*\` or a profile): a person runs \`operate auth login --profile <name>\` once in
a terminal, then commands refresh the token. Never run \`auth login\` yourself. On exit 4 with
\`LOGIN_REQUIRED\`, stop and ask the user to run the command from the hint in a terminal, then retry.
\`UNAUTHORIZED\`/\`FORBIDDEN\` despite a login is a gateway (issuer, audience, clock) or permission
problem: do not ask for a new login, report message and hint. \`operate auth status\` (no network)
tells if the login is usable. Use only \`--config\` files you trust: profiles share logins by name.

\`\`\`sh
operate config set sso --auth oauth --oauth-issuer https://login.example.com/realms/camunda --oauth-client-id operate-cli
\`\`\`

## Other schemes

API keys and gateway specific headers go into request headers (\`-H\`, \`OPERATE_HEADERS\` or a
profile, see \`operate guide config\`). An \`Authorization\` header together with Basic auth, OAuth or
a bearer token is a configuration error (exit 3).
`,
};
