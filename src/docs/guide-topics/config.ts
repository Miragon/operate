/** `operate guide config`: profiles, the environment, named engines and headers. */

import type { GuideTopic } from './topic.js';

export const CONFIG_TOPIC: GuideTopic = {
  name: 'config',
  summary: 'Profiles, config file, environment variables, named engines, headers, timeouts',
  text: `# operate guide config: profiles, environment and engines

Every setting is resolved on its own: flag > environment variable > profile > default.
\`operate config show\` prints the values an operation command resolves and where each one comes
from.

## Profiles

\`\`\`sh
operate config set local --url http://localhost:8080/engine-rest --default
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate config list
operate config show --profile prod
operate config use local
operate ping --profile prod
operate config unset prod readOnly
operate config delete prod
\`\`\`

- \`config set <profile>\` creates or updates a profile; only the given values change. The first
  profile becomes the default; \`config use\` makes another one the default, \`--profile\` or
  \`OPERATE_PROFILE\` pick one per call.
- \`config set\` stores \`--output\` in the profile and prints in the \`-o\` format; \`config show\`
  shows the values an operation command resolves (its own \`-o\` only formats the output).
- \`config unset <profile> <key...>\` removes settings (\`url\`, \`engine\`, \`auth\`, \`output\`,
  \`timeout\`, \`headers\`, \`readOnly\`, ...); \`config delete\` removes the profile.
- \`operate config path\` prints the config file location (\`--config <path>\` overrides it; a file
  named with \`--config\` or \`OPERATE_CONFIG\` must exist, \`config set\` creates it).
- Use read-only profiles (\`--read-only\`) for production engines: they refuse every command whose
  effect is not \`read\`. Use only \`--config\` files you trust.

## Environment

- Variables: \`OPERATE_URL\`, \`OPERATE_ENGINE\`, \`OPERATE_PROFILE\`, \`OPERATE_CONFIG\`,
  \`OPERATE_OUTPUT\`, \`OPERATE_TIMEOUT\`, \`OPERATE_READ_ONLY\`, \`OPERATE_AUTH\`, \`OPERATE_USERNAME\`,
  \`OPERATE_PASSWORD\`, \`OPERATE_TOKEN\`, \`OPERATE_OAUTH_*\`, \`OPERATE_HEADERS\`.
- Each value is resolved on its own, so with \`--url\` or \`OPERATE_URL\` set the credentials of the
  profile go to that URL: check \`operate config show\` when a shell has a leftover \`OPERATE_URL\`.

## Engines, headers and timeouts

- \`--engine <name>\` addresses a named process engine (\`/engine/{name}/...\`); \`ping\` checks it.
- \`-H 'Name: value'\` (repeatable), \`OPERATE_HEADERS\` (one per line) or the headers of a profile
  (\`config set --header\`) add request headers such as an API key; they merge per name: profile,
  then \`OPERATE_HEADERS\`, then \`-H\`. Secret headers are masked unless \`--show-secrets\`.
- \`--timeout <ms>\` bounds every request (default 30000, \`OPERATE_TIMEOUT\`).

\`\`\`sh
operate ping --engine default
operate config set prod --url https://camunda.example.com/engine-rest --header 'X-Tenant-Id: acme'
operate process-instance list --profile local --timeout 10000 -H 'X-Request-Id: 42'
\`\`\`
`,
};
