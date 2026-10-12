# Configuration

Every setting is resolved per value with the precedence **flag > environment variable > profile >
default**. `operate config show` prints the effective values and where each one comes from.

## Global options

These work on every API command, `api` and `ping`, after the command path
(`operate task list -o table`). They cover the target (`--url`, `--engine`, `--profile`,
`--config`), the output (`-o`, `--fields`, `--pretty`, `--out-file`, `--verbose`), the guards
(`--dry-run`, `--yes`, `--read-only`), requests (`--timeout`, `-H`) and authentication (`--auth`,
`--auth-user`, `--auth-password-stdin`, `--auth-token-stdin`, `--show-secrets`).

The help of every command lists them with their meaning and environment variable:
`operate ping --help`.

## Environment variables

| Variable            | Meaning                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `OPERATE_URL`       | REST API root                                                                         |
| `OPERATE_ENGINE`    | Named process engine                                                                  |
| `OPERATE_PROFILE`   | Profile to use instead of the default profile                                         |
| `OPERATE_CONFIG`    | Config file location; the file must exist                                             |
| `OPERATE_OUTPUT`    | `json` or `table`                                                                     |
| `OPERATE_TIMEOUT`   | Request timeout in milliseconds                                                       |
| `OPERATE_AUTH`      | Authentication type: `none`, `basic`, `oauth` or `bearer`                             |
| `OPERATE_USERNAME`  | Username for Basic auth                                                               |
| `OPERATE_PASSWORD`  | Password for Basic auth                                                               |
| `OPERATE_TOKEN`     | Bearer token obtained elsewhere, see [Bearer tokens](authentication.md#bearer-tokens) |
| `OPERATE_OAUTH_*`   | OAuth settings, see [OAuth](authentication.md#oauth)                                  |
| `OPERATE_HEADERS`   | Extra headers `Name: value`, one per line, e.g. an API key                            |
| `OPERATE_READ_ONLY` | `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off`; anything else is an error            |

## Config file

The config file is looked up in this order: `--config <path>`, `OPERATE_CONFIG`,
`$XDG_CONFIG_HOME/operate/config.json`, `~/.config/operate/config.json` (Windows:
`%APPDATA%\operate\config.json`). `operate config path` prints the location. A file named with
`--config` or `OPERATE_CONFIG` must exist (`operate config set` creates it), so a typo never drops a
profile and its read-only setting silently. `operate` validates every value before storing it and
writes the file atomically with mode `0600` (a new private file replaces the old one, so its content
is never readable under another mode); you can also edit it by hand:

```json
{
  "defaultProfile": "local",
  "profiles": {
    "local": {
      "url": "http://localhost:8080/engine-rest",
      "engine": "default",
      "auth": { "type": "none" },
      "output": "table",
      "timeout": 10000
    },
    "staging": {
      "url": "https://staging.example.com/engine-rest",
      "auth": { "type": "basic", "username": "demo", "passwordEnv": "CAMUNDA_PASSWORD" }
    },
    "prod": {
      "url": "https://camunda.example.com/engine-rest",
      "auth": {
        "type": "oauth",
        "issuer": "https://login.example.com/realms/camunda",
        "clientId": "operate-cli"
      },
      "readOnly": true
    },
    "ci": {
      "url": "https://camunda.example.com/engine-rest",
      "auth": { "type": "bearer", "tokenEnv": "CI_ENGINE_TOKEN" }
    }
  }
}
```

Profile keys: `url`, `engine`, `auth` (`type`, then either the Basic auth keys `username` and
`passwordEnv` or `password`, the OAuth keys `issuer`, `authorizationEndpoint`, `tokenEndpoint`,
`clientId`, `clientSecretEnv` or `clientSecret`, `scopes`, `audience`, `redirectPort`, or the
bearer token keys `tokenEnv` or `token`; see [Authentication](authentication.md)), `output`,
`timeout`, `headers`, `readOnly`. Profile names
use letters, digits, `.`, `_` and `-` and start with a letter or digit, also in a hand-written
file. URLs with credentials (`https://user:pass@host`) or a query string are rejected, and so are
header values with control characters and connection headers (`Connection`, `Transfer-Encoding`,
...).

## Profiles

```sh
operate config set local --url http://localhost:8080/engine-rest --default
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate config list
operate config show --profile prod
operate config use prod
operate ping --profile local
operate config unset prod readOnly
operate config delete prod
```

- `config set <profile>` creates or updates a profile; only the given values change, and the
  first profile becomes the default. `config unset <profile> <key...>` removes single settings,
  `config delete <profile>` the profile with its cached OAuth login (without revoking it). Every
  option and key: `operate config set --help`, `operate config unset --help`.
- `config use <profile>` makes a profile the default; `--profile` or `OPERATE_PROFILE` pick another
  one per call.
- `config show` accepts the global configuration flags, so you can see what a combination resolves
  to and where each value comes from. Its `-o` only formats the output.

The same in short form: `operate guide config`.
