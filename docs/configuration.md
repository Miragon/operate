# Configuration

Every setting is resolved per value with the precedence **flag > environment variable > profile >
default**. `operate config show` prints the effective values and where each one comes from.
Profiles live in your config file and, for a repository, in its [project file](#project-file).

## Global options

These work on every API command, `api` and `ping`, after the command path
(`operate task list -o table`). They cover the target (`--url`, `--engine`, `--profile`,
`--config`), the output (`-o`, `--fields`, `--pretty`, `--out-file`, `--verbose`), the guards
(`--dry-run`, `--yes`, `--read-only`), requests (`--timeout`, `-H`) and authentication (`--auth`,
`--auth-user`, `--auth-password-stdin`, `--auth-token-stdin`, `--show-secrets`).

The help of every command lists them with their meaning and environment variable:
`operate ping --help`.

## Environment variables

| Variable                | Meaning                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `OPERATE_URL`           | REST API root                                                                              |
| `OPERATE_ENGINE`        | Named process engine                                                                       |
| `OPERATE_PROFILE`       | Profile to use instead of the default profile                                              |
| `OPERATE_CONFIG`        | Config file location; the file must exist, and no project file is used                     |
| `OPERATE_OUTPUT`        | `json` or `table`                                                                          |
| `OPERATE_TIMEOUT`       | Request timeout in milliseconds                                                            |
| `OPERATE_AUTH`          | Authentication type: `none`, `basic`, `oauth` or `bearer`                                  |
| `OPERATE_USERNAME`      | Username for Basic auth                                                                    |
| `OPERATE_PASSWORD`      | Password for Basic auth                                                                    |
| `OPERATE_TOKEN`         | Bearer token obtained elsewhere, see [Bearer tokens](authentication.md#bearer-tokens)      |
| `OPERATE_TOKEN_COMMAND` | Command that prints a bearer token, see [Token commands](authentication.md#token-commands) |
| `OPERATE_OAUTH_*`       | OAuth settings, see [OAuth](authentication.md#oauth)                                       |
| `OPERATE_HEADERS`       | Extra headers `Name: value`, one per line, e.g. an API key                                 |
| `OPERATE_READ_ONLY`     | `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off`; anything else is an error                 |

## Config file

The config file is looked up in this order: `--config <path>`, `OPERATE_CONFIG`,
`$XDG_CONFIG_HOME/operate/config.json`, `~/.config/operate/config.json` (Windows:
`%APPDATA%\operate\config.json`). `operate config path` prints the location. A file named with
`--config` or `OPERATE_CONFIG` must exist (`operate config set` creates it), so a typo never drops a
profile and its read-only setting silently. Such a file is the only one a command reads; otherwise
the profiles of a [project file](#project-file) join those of your config file. `operate` validates every value before storing it and
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

## Project file

A repository can ship its profiles, so that neither developers nor agent sessions need a setup
step: a project file `.operate.json` with the same format as the config file. operate looks it up
from the working directory upwards and stops at the repository root (the directory with `.git`),
before your home directory and at the file system root; the nearest file wins. A file named with
`--config` or `OPERATE_CONFIG` turns the lookup off.

```json
{
  "defaultProfile": "orders",
  "profiles": {
    "orders": {
      "url": "http://localhost:8112/engine-rest/orders",
      "auth": { "type": "bearer" }
    },
    "billing": {
      "url": "http://localhost:8113/engine-rest/billing",
      "auth": { "type": "bearer" }
    }
  }
}
```

- The profiles of the project file join those of your config file. On a name clash your own
  profile wins as a whole (none of the project's settings of that profile apply), so you can
  override one locally. The project's `defaultProfile` must be one of its own profiles and wins
  over yours inside the repository, so a bare `operate status` (and the plugin's `/operate:status`)
  goes to the repository's engine; `--profile` and `OPERATE_PROFILE` still choose another one. It
  never selects a profile of yours: when your file has a profile of the same name, your own
  `defaultProfile` applies.
- A project file is shared, so it names engines, never credentials: a `password`, `clientSecret`
  or `token`, the variables `passwordEnv`, `clientSecretEnv` or `tokenEnv` and secret headers
  (`Authorization`, cookies, names with `token`, `secret`, `password`, `api-key`) are refused, both
  in the file and by `config set --project` (`config unset ... --project` removes them). The
  credentials come from the environment (`OPERATE_TOKEN`,
  [`OPERATE_TOKEN_COMMAND`](authentication.md#token-commands), `OPERATE_PASSWORD`,
  `OPERATE_OAUTH_CLIENT_SECRET`), an OAuth login (`operate auth login --profile <profile>`) or a
  profile of the same name in your own config file. So a project file can neither run code through
  operate nor send a variable of its choice to the URL it names.
- `operate config set|unset|use|delete --project` write the project file (a new one goes to the
  repository root, outside a repository to the working directory) with mode `0644`; without
  `--project` they write your config file. `config set` notes when a profile of yours now
  overrides one of the project file, `config use` when the project's default wins.
- `operate config list` shows the `scope` of each profile (`user` or `project`), `operate config
show` the project file in effect and the file the selected profile comes from, and
  `operate config path --project` the project file in effect (or where `config set --project`
  creates one).

```sh
operate config set orders --project --url http://localhost:8112/engine-rest/orders --default
operate config list
operate config path --project
```

Still, treat a project file like code: it decides where commands send your credentials from the
environment (`OPERATE_TOKEN`, the token of `OPERATE_TOKEN_COMMAND`, `OPERATE_PASSWORD`) and the
OAuth login of its profiles.

The same in short form: `operate guide config`.
