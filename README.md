# operate

[![CI](https://github.com/Miragon/operate/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/operate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@miragon/operate)](https://www.npmjs.com/package/@miragon/operate)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`operate` is a command line interface for the Camunda 7 REST API (`/engine-rest`). It works with
[Operaton](https://operaton.org), [CIB seven](https://cibseven.org) and Camunda 7 CE/EE. It is built
for coding agents first (Claude Code, Codex, ...), then for humans in a terminal and for shell
scripts and CI jobs: it never prompts, prints JSON when stdout is not a terminal, reports errors as
one JSON line on stderr and uses stable exit codes.

- **The whole REST API.** Every GET, POST, PUT and DELETE operation is a command generated from the
  OpenAPI spec: 396 commands in 52 groups, from `deployment create` to
  `historic-job-log get-stacktrace`. The OPTIONS operations (HATEOAS link discovery) are reachable
  with `operate api OPTIONS <path>`.
- **JSON for agents and scripts, tables for humans.** Output format follows the terminal, with
  `--fields` projection, `-o table` and `--pretty`.
- **Guard rails.** `--dry-run` prints the request and a `curl` line, `delete` and `bulk` commands
  need `--yes`, and read-only mode (flag, environment or profile) refuses every change.
- **Comfort commands.** `inspect`, `wait`, `advance`, `retry`, `deploy` and `status` combine
  several requests for the everyday questions: where does this instance wait and why, wait until
  it is idle instead of `sleep`, complete what it waits for, retry its incidents, deploy and
  start, triage the engine. Shell completion for bash, zsh and fish.
- **Self-describing.** `operate commands`, `operate describe` and `operate guide` tell an agent
  which commands exist, what they accept and how to use them, so it never has to guess.
- **Typed input.** Process variables with auto typing (`--var amount=250`), lenient date-time
  input, client side body validation with "did you mean" hints, multipart uploads and pagination.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Comfort commands](#comfort-commands)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [Command structure](#command-structure)
- [Output](#output)
- [Errors and exit codes](#errors-and-exit-codes)
- [Safety](#safety)
- [Using operate from AI agents](#using-operate-from-ai-agents)
- [Recipes](#recipes)
- [Compatibility](#compatibility)
- [Development](#development)
- [License](#license)

## Installation

Requires Node.js >= 22.12.

```sh
npm install -g @miragon/operate
operate --version
```

Or run it without installing:

```sh
npx @miragon/operate --help
```

## Quick start

Start an engine; its REST API is served at `http://localhost:8080/engine-rest` after a few
seconds:

```sh
docker run -d --name engine -p 8080:8080 operaton/operaton:2.1.5
# or camunda/camunda-bpm-platform:run-7.24.0, or cibseven/cibseven:run-2.2.0
```

Check the connection. `http://localhost:8080/engine-rest` is the default, so no configuration is
needed:

```sh
operate ping --pretty
```

```json
{
  "url": "http://localhost:8080/engine-rest",
  "engine": null,
  "reachable": true,
  "version": "2.1.5",
  "engines": ["default"],
  "latencyMs": 21,
  "auth": "none"
}
```

Create a small process with one user task:

```sh
cat > order.bpmn <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="https://example.com/order">
  <bpmn:process id="order" name="Order" isExecutable="true" camunda:historyTimeToLive="30">
    <bpmn:startEvent id="received" />
    <bpmn:sequenceFlow id="f1" sourceRef="received" targetRef="review" />
    <bpmn:userTask id="review" name="Review order" camunda:candidateGroups="sales" />
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="done" />
    <bpmn:endEvent id="done" />
  </bpmn:process>
</bpmn:definitions>
EOF
```

Deploy it, start an instance, and work on the task:

```sh
operate deployment create order.bpmn --deployment-name order
operate process-definition start order --business-key ORD-1001 --var amount=250
operate task list --process-definition-key order --fields id,name,created -o table
```

```text
id                                    name          created
4e3d858c-c35f-11f1-80fb-aa0e0285a34c  Review order  2026-10-08T21:29:12.716+0000
```

```sh
TASK_ID=$(operate task list --process-definition-key order --fields id | jq -r '.[0].id')
operate task complete "$TASK_ID" --var approved=true
```

```text
Done: POST /task/4e3d858c-c35f-11f1-80fb-aa0e0285a34c/complete → 204 No Content
```

```sh
operate historic-process-instance list --process-definition-key order --finished --fields id,businessKey,state -o table
```

```text
id                                    businessKey  state
4e3d5e77-c35f-11f1-80fb-aa0e0285a34c  ORD-1001     COMPLETED
```

Where next: `operate commands` lists the API groups, `operate describe <group> <command>` explains
a command and `operate guide` prints the usage guide.

## Comfort commands

### Workflow commands

The generated commands map the REST API one to one. Six top-level workflow commands combine
several requests for the questions a developer, an operator or an agent asks most. They select a
process instance by id, `--business-key` or `--process-definition-key <key> --latest`, print views
built by operate (JSON with a documented key order, `-o table` prints sections) whose `next` lists
ready-to-run follow-ups, and follow the same guards as every other command:

| Command           | Effect                              | What it does                                                                                                                                                                                                      |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operate inspect` | read                                | Where an instance waits and why: wait states across its called instances, open root incidents with their root cause, called instances, variables; ended instances from the history, `--history` adds the timeline |
| `operate wait`    | read (write with `--execute-jobs`)  | Waits until the instance is idle, or `--until ended`, `incident`, `task[:<key>]`, `activity:<id>`; fails fast on incidents; `--batch <id>` waits for a batch                                                      |
| `operate advance` | write                               | Completes what the instance waits for: user task, external task (locked first), message, signal, receive task, timer or asynchronous job                                                                          |
| `operate retry`   | write (bulk for a whole definition) | Sets the retries behind open incidents (propagated ones replaced by their root cause); `--now` executes the jobs and reports a job that failed again with its root cause                                          |
| `operate deploy`  | write                               | Deploys files and directories with a stable deployment name and source, so unchanged files are skipped; reports the versions in effect; `--start` / `--start-key` starts an instance                              |
| `operate status`  | read                                | Engine triage: grouped root incidents with root cause, overdue jobs, external task workers, failed batches; each finding names the next command, `--fail-on` fails CI                                             |

The development loop, without a single id passed around:

```sh
operate deploy bpmn --start --business-key B-1 --var amount=250
operate inspect --business-key B-1
operate advance --business-key B-1 --var approved=true --wait
operate retry --business-key B-1 --now
operate wait --business-key B-1 --until ended
operate status
```

```text
$ operate inspect --business-key WF-1 -o table
Process instance  adff9abe-c3e6-11f1-aa2b-66e6c1afd69e
State             ACTIVE
Definition        workflow-parent v1
Business key      WF-1
Started           2026-10-09T13:38:15.430+0000

Waiting at:
ACTIVITY  KIND      ID                                    DETAIL   INSTANCE
approve   userTask  adffc1d7-c3e6-11f1-aa2b-66e6c1afd69e  Approve  adffc1d4-c3e6-11f1-aa2b-66e6c1afd69e

Called instances:
ID                                    KEY             VERSION  STATE   PARENT
adffc1d4-c3e6-11f1-aa2b-66e6c1afd69e  workflow-child  1        ACTIVE  adff9abe-c3e6-11f1-aa2b-66e6c1afd69e

Variables:
NAME         VALUE  TYPE
failBooking  true

Next:
  operate advance adff9abe-c3e6-11f1-aa2b-66e6c1afd69e
```

- **Waiting** replaces `sleep` and poll loops: `operate wait` (and `--wait` / `--until` of
  advance, retry and deploy) polls after 0, 250, 500 and 1000 ms, then every 2 s, until the
  condition holds. `--wait-timeout <duration>` (`500ms`, `30s`, `2m`, `1h`; default `60s`) is the
  budget; `--timeout` stays the per-request timeout. An incident ends the wait at once
  (`--no-fail-on-incident` keeps waiting), and so does a job that failed for good, which would
  otherwise look idle. `wait`, `advance` and `retry` look up the ids of `--until activity:<id>`
  and `task:<key>` in the BPMN of the instance first, so a typo fails at once with the close
  names instead of waiting the whole budget. On a terminal one stderr line says that it waits.
- **Exit code 9**: every request succeeded, but the process did not reach the expected state:
  `WAIT_TIMEOUT`, `INCIDENT`, `INSTANCE_ENDED`, `JOB_FAILED` (a job executed by operate failed
  again) or `CHECK_FAILED` (`status --fail-on`). The command still prints its view on stdout; the
  error with its `data` goes to stderr.
- **`--dry-run`**: inspect, wait and status send nothing and preview their first requests;
  advance and retry send their reads (to plan) and preview the writes, each with a `summary`;
  deploy previews the multipart request.
- **Guards**: inspect, wait and status work in read-only mode; advance, deploy, retry and
  `wait --execute-jobs` are writes; `retry --process-definition-key` alone is a bulk operation that
  needs `--yes`.
- `advance` needs `--activity-id` when the instance waits at several places; the error lists them
  with ready commands. External tasks are locked as worker `operate` (`--worker-id`) first.
- `operate commands workflow` lists the workflow commands, and `operate describe inspect`
  describes one with the requests it may send.

More examples:

```sh
operate wait --business-key B-1 --until task --until ended --wait-timeout 2m
operate deploy src/main/resources --start-key invoice --business-key B-2
operate advance --business-key B-2 --activity-id approve --var approved=true --dry-run
operate retry --process-definition-key invoice --activity-id book --dry-run
operate status --process-definition-key invoice --fail-on critical
operate wait --batch $BATCH_ID
```

### Shell completion

`operate completion <bash|zsh|fish>` prints a completion script. It completes commands (also
`auth login|status|logout`), groups, options and their fixed values (enum values, output formats,
auth types, `--until` conditions, profile names of the config file) and falls back to file
completion for paths. It never contacts the engine, so ids and definition keys are not completed.

```sh
eval "$(operate completion bash)"
mkdir -p ~/.zfunc && operate completion zsh > ~/.zfunc/_operate
operate completion fish > ~/.config/fish/completions/operate.fish
```

Put the bash line into `~/.bashrc`; it works on every bash, also the 3.2 of macOS, where
`source <(...)` registers nothing. For zsh add `fpath=(~/.zfunc $fpath)` to `~/.zshrc` before
`compinit`.

## Configuration

Every setting is resolved per value with the precedence **flag > environment variable > profile >
default**. `operate config show` prints the effective values and where each one comes from.

### Global options

These work on every API command, `api` and `ping`, after the command path
(`operate task list -o table`):

| Option                  | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `--url <url>`           | REST API root, default `http://localhost:8080/engine-rest`                     |
| `--engine <name>`       | Named process engine, adds `/engine/<name>` to the path                        |
| `--profile <name>`      | Profile of the config file                                                     |
| `--config <path>`       | Config file location                                                           |
| `-o, --output <format>` | `json` or `table`; default: `table` on a terminal, else `json`                 |
| `--fields <list>`       | Comma separated fields to keep, e.g. `id,name,variables.amount`; table columns |
| `--pretty`              | Indent JSON output (default on a terminal)                                     |
| `--dry-run`             | Print the request instead of sending it                                        |
| `-y, --yes`             | Confirm `delete` and `bulk` operations                                         |
| `--read-only`           | Refuse every operation that is not a read                                      |
| `--timeout <ms>`        | Request timeout in milliseconds, default 30000                                 |
| `-H, --header <header>` | Extra request header `Name: value`; repeatable                                 |
| `--auth <type>`         | `none`, `basic` or `oauth`; a username alone selects `basic`                   |
| `--auth-user <name>`    | Username for Basic auth                                                        |
| `--auth-password-stdin` | Read the Basic auth password from the first line of stdin                      |
| `--verbose`             | Trace requests and responses on stderr                                         |
| `--out-file <path>`     | Write the response body to a file                                              |
| `--show-secrets`        | Do not mask secret headers and passwords in dry-run, verbose and config output |

### Environment variables

| Variable            | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `OPERATE_URL`       | REST API root                                                              |
| `OPERATE_ENGINE`    | Named process engine                                                       |
| `OPERATE_PROFILE`   | Profile to use instead of the default profile                              |
| `OPERATE_CONFIG`    | Config file location; the file must exist                                  |
| `OPERATE_OUTPUT`    | `json` or `table`                                                          |
| `OPERATE_TIMEOUT`   | Request timeout in milliseconds                                            |
| `OPERATE_AUTH`      | Authentication type: `none`, `basic` or `oauth`                            |
| `OPERATE_USERNAME`  | Username for Basic auth                                                    |
| `OPERATE_PASSWORD`  | Password for Basic auth                                                    |
| `OPERATE_OAUTH_*`   | OAuth settings, see [OAuth](#oauth)                                        |
| `OPERATE_HEADERS`   | Extra headers `Name: value`, one per line, e.g. a token                    |
| `OPERATE_READ_ONLY` | `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off`; anything else is an error |

### Config file

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
    }
  }
}
```

Profile keys: `url`, `engine`, `auth` (`type`, then either the Basic auth keys `username` and
`passwordEnv` or `password`, or the OAuth keys `issuer`, `authorizationEndpoint`, `tokenEndpoint`,
`clientId`, `clientSecretEnv` or `clientSecret`, `scopes`, `audience`, `redirectPort`; see
[Authentication](#authentication)), `output`, `timeout`, `headers`, `readOnly`. Profile names
use letters, digits, `.`, `_` and `-` and start with a letter or digit, also in a hand-written
file. URLs with credentials (`https://user:pass@host`) or a query string are rejected, and so are
header values with control characters and connection headers (`Connection`, `Transfer-Encoding`,
...).

### Profiles

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

- `config set <profile>` creates or updates a profile; only the given values change
  (`--url`, `--engine`, `--auth`, `--auth-user`, `--auth-password-env`, `--auth-password-stdin`,
  the `--oauth-*` options of [OAuth](#oauth), `--output`, `--timeout`, `-H/--header`,
  `--read-only`, `--no-read-only`, `--default`). The
  first profile becomes the default. Here `--output` is the output format stored in the profile;
  `-o <format>` chooses how the profile is printed, as `-o/--output` does for every other config
  command. `config unset <profile> auth` removes all auth settings; `config unset <profile>
audience` (also `issuer`, `endpoints`, `clientId`, `clientSecret`, `scopes`, `redirectPort`)
  removes a single OAuth setting. `config delete <profile>` also removes the cached OAuth login of
  the profile (without revoking it).
- `config use <profile>` makes a profile the default; `--profile` or `OPERATE_PROFILE` pick another
  one per call.
- `config show` accepts the global configuration flags, so you can see what a combination resolves
  to. Its `-o` only formats the output: the `output` row shows what an operation command resolves
  without it (`OPERATE_OUTPUT`, the profile or the default):

```text
$ operate config show --profile prod -o table
Config file: /home/me/.config/operate/config.json
Profile: prod

KEY                    VALUE                                     SOURCE
url                    https://camunda.example.com/engine-rest   profile
engine                                                           default
auth                   oauth                                     profile
username                                                         default
password                                                         default
issuer                 https://login.example.com/realms/camunda  profile
authorizationEndpoint                                            default
tokenEndpoint                                                    default
clientId               operate-cli                               profile
clientSecret                                                     default
scopes                 openid offline_access                     default
audience                                                         default
redirectPort           0                                         default
output                                                           default
timeout                30000                                     default
headers                {}                                        default
readOnly               true                                      profile
```

## Authentication

`operate` supports [HTTP Basic authentication](#basic-auth) and [OAuth 2.0](#oauth) with the
authorization code flow and PKCE, for engines behind a gateway that checks tokens of Keycloak,
Microsoft Entra ID, Auth0 or another OpenID Connect provider. Other schemes go into
[headers](#tokens-in-headers).

### Basic auth

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
  `--auth-password-env` is not set in its environment: pass the name, never the password.
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

### OAuth

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
  (with a warning). OAuth together with an `Authorization` header, or with
  `--auth-password-stdin`, is a configuration error, and so is a missing issuer or client id.
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
  config file named by `--config`. A login is kept for the issuer, client, audience and scopes it
  was made for; changing them needs a new login (`LOGIN_REQUIRED` names what differs and which
  `OPERATE_OAUTH_*` variable of the environment causes it).
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

### Tokens in headers

Other schemes, such as bearer tokens from elsewhere, are passed as headers: per call with `-H`, in the
environment with `OPERATE_HEADERS` (keeps the credential out of the command line and shell
history), or stored in a profile. Headers merge per name: profile, then `OPERATE_HEADERS`, then
`-H`. An `Authorization` header together with Basic auth or OAuth is a configuration error; in a
profile, `config set` with auth options replaces a stored `Authorization` header (with a notice on
stderr), and `--auth none` keeps the header and switches the auth off. `Authorization`
and other secret headers (cookies, names containing `token`, `secret`, `password`, `api-key`) are
masked as `***` in dry-run, verbose and config output unless `--show-secrets` is given.

```sh
export OPERATE_HEADERS='Authorization: Bearer eyJhbGciOi...'
operate config set prod --header 'Authorization: Bearer eyJhbGciOi...'
```

## Command structure

```text
operate <group> <command> [path-args...] [options] [global options]
operate commands [group] [--search <text>] [--effect <effect>]
operate describe <group> [command]  |  operate describe <operationId>
operate api <METHOD> <path> [--query key=value]... [--body <json|@file|->]
operate ping
operate guide
operate config path | show | list | set | unset | use | delete
```

### Names

- **Group**: the kebab-case OpenAPI tag (`process-instance`, `historic-task-instance`, ...).
- **Command**: the operationId without the tag noun: `getProcessInstances` →
  `process-instance list`, `startProcessInstanceByKey` → `process-definition start`. The
  kebab-case operationId is always an alias (`operate task get-tasks` = `operate task list`), and
  `operate describe getTasks` works too. Collections are `list`, single resources `get <id>`;
  every command has a summary that is unique in its group (`operate commands <group>`).
- **Effect**: every command is a `read`, `write`, `delete` or `bulk` operation. `operate commands`
  and `operate describe` show it; it drives the [safety](#safety) checks.

### Arguments and options

- **Path parameters** are positional arguments in path order:
  `operate process-instance get-variable <id> <var-name>`.
- **Query parameters and body properties** are kebab-case flags: `businessKey` →
  `--business-key`. Integers, numbers and enums are validated before sending.
- **Booleans**: `--with-incident` sends `true`, `--no-with-incident` sends `false`. Filters the
  engine only applies when true (`--active`, `--unfinished`, ...) have no `--no-` form, and
  parameters whose name starts with "no" are a single flag (`job list --no-retries-left`).
- **Arrays** are comma separated or repeated:
  `--process-instance-ids a,b --process-instance-ids c` → `["a","b","c"]`.

### Variables

Variable maps are repeatable `--var name=value` flags. Values are auto typed:

| Input           | Type                                         |
| --------------- | -------------------------------------------- |
| `true`, `false` | `Boolean`                                    |
| integer         | `Integer`, or `Long` outside the int32 range |
| decimal         | `Double`                                     |
| `null`          | `Null`                                       |
| anything else   | `String`                                     |

Force a type with `name:Type=value`, where `Type` is one of `String`, `Integer`, `Short`, `Long`,
`Double`, `Boolean`, `Date`, `Json`, `Xml`, `Null`. `Date` values accept the
[date-time forms](#date-time-values).

```sh
operate process-definition start invoice --var amount=250 --var zip:String=01234 --var due:Date=2024-06-01T12:00+02:00 --var 'order:Json={"id":42}' --dry-run
```

sends

```json
{
  "variables": {
    "amount": { "value": 250, "type": "Integer" },
    "zip": { "value": "01234", "type": "String" },
    "due": { "value": "2024-06-01T12:00:00.000+0200", "type": "Date" },
    "order": { "value": "{\"id\":42}", "type": "Json" }
  }
}
```

Other variable maps have their own flags with the same syntax: `--local-var`, `--correlation-key`,
`--local-correlation-key`, `--triggered-scope-var`. Commands that set a single variable
(`process-instance set-variable`, `task-variable set`, ...) take `--value <raw>` plus an optional
`--type <Type>`; without `--type` the value is auto typed like `--var`. Integers beyond 2^53
(`Long` values up to 9223372036854775807) are sent and printed exactly.

```sh
operate process-instance set-variable $INSTANCE_ID amount --value 300
operate process-instance set-variable $INSTANCE_ID dueDate --value 2024-06-01T12:00 --type Date
```

### Request bodies

- `--body <json>`, `--body @file.json` or `--body -` (stdin) is the base JSON body. Flags are
  merged on top: field flags override properties, `--var` entries win per variable name. Use it
  for nested structures such as start instructions, topics or sorting.
- The final body is validated against the API schema before it is sent; `--no-validate` skips the
  check (e.g. for engine extensions the spec does not know):

```text
$ operate process-definition start invoice --body '{"businesKey":"INV-1"}'
{"error":{"code":"VALIDATION","exitCode":2,"message":"Invalid request body: $: unknown property \"businesKey\", did you mean \"businessKey\"?","hint":"Run `operate describe process-definition start` to see the body schema, or pass --no-validate to skip this check.","data":[{"path":"$","message":"unknown property \"businesKey\", did you mean \"businessKey\"?"}]}}
```

```sh
operate process-definition start invoice --body @start.json --business-key INV-1002
echo '{"businessKey":"INV-1003"}' | operate process-definition start invoice --body -
```

### Files (multipart)

- `deployment create` takes the resource files as arguments. The resource name is the file name,
  or the path relative to `--base-dir <dir>`:

```sh
operate deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
operate deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
```

- Binary and file variables upload a file with `--data <path>`:

```sh
operate process-instance set-variable-binary $INSTANCE_ID contract --data contract.pdf --value-type File
operate process-instance get-variable-binary $INSTANCE_ID contract --out-file contract.pdf
```

### Pagination

List commands with `--max-results` also take `--all`: `operate` fetches page after page
(page size `--max-results`, default 500, starting at `--first-result`) and prints one list.

```sh
operate process-instance list --process-definition-key invoice --all --fields id,businessKey
```

### Date-time values

Options shown as `<date-time>` in `--help` and `Date` variables accept several forms and are
converted to the engine format `yyyy-MM-dd'T'HH:mm:ss.SSSZ`. Times without an offset are UTC;
invalid dates (`2024-02-30`) are usage errors. This includes the date filters of `task list` and
`task count` (`--due-date`, `--created-after`, `--follow-up-before`, ...), which the OpenAPI spec
does not mark as dates; their `...-expression` variants take an expression and stay unchanged.

| Input                          | Sent                           |
| ------------------------------ | ------------------------------ |
| `2024-05-01`                   | `2024-05-01T00:00:00.000+0000` |
| `2024-05-01T10:00`             | `2024-05-01T10:00:00.000+0000` |
| `2024-05-01T10:00:00Z`         | `2024-05-01T10:00:00.000+0000` |
| `2024-05-01T10:00:00.5+02:00`  | `2024-05-01T10:00:00.500+0200` |
| `2024-05-01T10:00:00.000+0200` | unchanged                      |

## Output

- **Format**: JSON when stdout is not a terminal, a table on a terminal. `-o json|table`,
  `OPERATE_OUTPUT` or the profile setting override it.
- **JSON** is exactly the engine response: compact when piped, indented on a terminal or with
  `--pretty`, always ending with a newline.
- **`--fields id,name,variables.amount`** keeps only these properties (of every element of a
  list); in table format they are the columns. A field that matches nothing gets a warning on
  stderr listing the existing fields. Count responses print a plain number as a table.
- **Tables** without `--fields` show the identifying columns first (`id`, `key`, `name`,
  `version`, `businessKey`, `incidentType`, ...) and drop trailing columns to fit the terminal
  (120 characters when piped).
- **XML commands** (`process-definition xml`, `decision-definition xml`, ...) print the raw XML
  unless `-o json` or `--fields` is given.
- **Text responses** (`job get-stacktrace`, ...) print raw. **Binary responses** (diagrams,
  files, binary variables) print raw bytes when piped and need `--out-file` on a terminal.
- **`--out-file <path>`** writes the response body to a file exactly as received (projected with
  `--fields`; XML commands write the XML) and prints a summary:
  `{"outFile":"/tmp/order.xml","bytes":644,"contentType":"application/xml"}`.
- **Terminals** never receive raw control characters from response data: escape sequences in text
  responses are replaced by `�` on a terminal, pipes and files get the bytes unchanged.
- **No content** (HTTP 204): stdout stays empty, stderr gets
  `Done: <METHOD> <path> → 204 No Content`; the path is relative to the REST root (with the
  query), as `operate api` takes it: `Done: POST /task/<id>/complete → 204 No Content`.
- **`--dry-run`** prints the request instead of sending it; `-o table` prints only the `curl`
  command line:

```text
$ operate process-definition start invoice --var amount=250 --dry-run
{"method":"POST","url":"http://localhost:8080/engine-rest/process-definition/key/invoice/start","headers":{"Accept":"application/json","Content-Type":"application/json"},"body":{"variables":{"amount":{"value":250,"type":"Integer"}}},"curl":"curl -X POST 'http://localhost:8080/engine-rest/process-definition/key/invoice/start' -H 'Accept: application/json' -H 'Content-Type: application/json' --data-raw '{\"variables\":{\"amount\":{\"value\":250,\"type\":\"Integer\"}}}'"}

$ operate task list --assignee demo --dry-run -o table
curl 'http://localhost:8080/engine-rest/task?assignee=demo' -H 'Accept: application/json'
```

- **`--verbose`** traces the request and response on stderr (secret headers masked):

```text
$ operate process-definition list --key order --fields id,key,version --verbose
> GET http://localhost:8080/engine-rest/process-definition?key=order
> Accept: application/json
< 200 OK (22 ms, 349 bytes)
[{"id":"order:1:4e24cd66-c35f-11f1-80fb-aa0e0285a34c","key":"order","version":1}]
```

## Errors and exit codes

Errors go to stderr as one JSON line (`-o table` or a terminal prints readable text). `hint`
names the fix (for unknown commands, options and body properties it starts with "Did you mean
...?"); `engineMessage` carries the engine's own explanation, also when the engine answers with
plain text (such as JSON deserialization errors).

```text
$ operate process-instance get abc
{"error":{"code":"NOT_FOUND","exitCode":5,"message":"HTTP 404 Not Found: Process instance with id abc does not exist","status":404,"engineType":"InvalidRequestException","engineMessage":"Process instance with id abc does not exist","hint":"Check the id or key. List the existing ones with `operate process-instance list`.","request":{"method":"GET","url":"http://localhost:8080/engine-rest/process-instance/abc"}}}

$ operate process-instance get abc -o table
Error: HTTP 404 Not Found: Process instance with id abc does not exist
  Engine: InvalidRequestException
  Request: GET http://localhost:8080/engine-rest/process-instance/abc
  Hint: Check the id or key. List the existing ones with `operate process-instance list`.
```

Fields: `code`, `exitCode`, `message`, and when available `status`, `engineType`,
`engineMessage`, `engineCode`, `hint`, `request` (`method`, `url`) and `data` (e.g. the list of
validation problems).

| Exit | Meaning                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------- |
| 0    | success                                                                                                                    |
| 1    | internal error                                                                                                             |
| 2    | usage error, invalid body (`VALIDATION`), `READ_ONLY`, `CONFIRMATION_REQUIRED`                                             |
| 3    | configuration error, also an HTTP redirect (`HTTP_REDIRECT`)                                                               |
| 4    | 401, 403, `LOGIN_REQUIRED` (a person must log in), `LOGIN_FAILED`                                                          |
| 5    | not found (404)                                                                                                            |
| 6    | other 4xx: the engine rejected the request                                                                                 |
| 7    | engine error (5xx)                                                                                                         |
| 8    | network error or timeout                                                                                                   |
| 9    | expected state not reached (workflow commands): `WAIT_TIMEOUT`, `INCIDENT`, `INSTANCE_ENDED`, `JOB_FAILED`, `CHECK_FAILED` |

Camunda 7 engines report many rule violations as HTTP 500 (exit 7), e.g. a task that is already
completed or a deployment that still has running instances. Read `engineMessage` and fix the cause
instead of retrying. A query value the engine cannot read (`maxResults=abc`) comes back as 404
`QueryParamException`; `operate` reports it as exit 6, not as a missing resource.

`operate` never follows redirects: a write redirected to a login page must not look successful,
and credential headers must not travel to another host. A 3xx answer is the error `HTTP_REDIRECT`
naming the target; point `--url` at the REST API root itself (e.g. `https://`).

## Safety

- **`--dry-run`** prints the request without sending it. It works in read-only mode too.
- **`--yes`**: commands with effect `delete` (delete a resource, resolve an incident) or `bulk`
  (batches, query based updates, all versions of a key) refuse to run without it:

```text
$ operate process-instance delete abc
{"error":{"code":"CONFIRMATION_REQUIRED","exitCode":2,"message":"`operate process-instance delete` is a delete operation and needs confirmation","hint":"Re-run with --yes to confirm, or --dry-run to preview."}}
```

- **Read-only mode**: `--read-only`, `OPERATE_READ_ONLY=1` or a profile created with `--read-only`
  refuse every command whose effect is not `read` (exit 2, `READ_ONLY`). Use read-only profiles for
  production engines:

```sh
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate process-instance list --profile prod --with-incident
```

- `operate commands --effect delete` and `operate commands --effect bulk` list the guarded
  commands.
- `operate api` normalizes the path before it checks the effect and sends the request
  (`/process-instance/./delete/` is `/process-instance/delete`, a bulk operation that needs `--yes`);
  paths with `#` or `;` are refused.

## Using operate from AI agents

`operate` is designed to be driven by coding agents. Everything an agent needs is in the CLI
itself:

- `operate guide` prints a concise Markdown usage guide (workflow, conventions, output, exit codes,
  safety, recipes). Point your agent at it, e.g. in `AGENTS.md` or `CLAUDE.md`: "Run
  `operate guide` before using `operate`."
- `operate commands`, `operate commands <group>` and `operate commands --search <words>` list
  commands with method, path, effect and summary.
- `operate describe <group> <command>` returns arguments, options, the request body schema,
  responses and examples as JSON (readable text on a terminal or with `-o table`).
- `--dry-run` previews a write before it is sent.
- `operate api <METHOD> <path>` sends a raw request relative to the REST root with the same
  guards, output and errors, for anything the agent prefers to write by hand.
- The workflow commands (`inspect`, `wait`, `advance`, `retry`, `deploy`, `status`) drive a
  process instance without passing ids around; `operate wait` replaces `sleep`, and exit code 9
  says that the process did not reach the expected state.
- With OAuth, a person logs in once with `operate auth login`; agents never do. A command that
  needs a new login fails with `LOGIN_REQUIRED` (exit 4) and the hint names the command to run in
  a terminal; `operate auth status` tells an agent whether the login is usable.

A typical agent workflow is discover, describe, preview, run:

```sh
operate commands --search 'process instance'
operate describe process-definition start
operate process-definition start invoice --var amount=250 --dry-run
operate process-definition start invoice --var amount=250
```

### Claude Code skill

[`skills/operate/SKILL.md`](skills/operate/SKILL.md) is the guide packaged as a Claude Code
skill (YAML frontmatter plus the text of `operate guide`); it ships with the npm package.
Install it for all your projects or for one project:

```sh
mkdir -p ~/.claude/skills/operate
cp "$(npm root -g)/@miragon/operate/skills/operate/SKILL.md" ~/.claude/skills/operate/

mkdir -p .claude/skills/operate
curl -fsSL https://raw.githubusercontent.com/Miragon/operate/main/skills/operate/SKILL.md -o .claude/skills/operate/SKILL.md
```

Claude Code then loads it whenever a task needs to read or change the state of a Camunda 7,
Operaton or CIB seven engine.

## Recipes

The recipes use the variables `$INSTANCE_ID`, `$TASK_ID`, ... for ids from earlier commands.

### Deploy

`operate deploy` sends only what changed and reports the versions in effect; `deployment create`
is the raw operation.

```sh
operate deploy src/main/resources
operate deploy invoice.bpmn invoice-approval.dmn --start --business-key INV-1001 --var amount=250 --wait
operate deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
operate deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
operate process-definition list --key invoice --latest-version
operate process-definition xml invoice
```

### Start with variables

```sh
operate process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false
operate process-definition start invoice --var 'order:Json={"id":42}' --var due:Date=2024-06-01
operate process-instance list --process-definition-key invoice --business-key INV-1001
operate process-instance get-variables $INSTANCE_ID
```

### Find and complete user tasks

```sh
operate task list --candidate-group accounting --unassigned
operate task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
operate task claim $TASK_ID --user-id demo
operate task complete $TASK_ID --var approved=true
```

### External task worker

The worker id must match the one that locked the task.

```sh
operate external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
operate external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
operate external-task handle-failure $EXTERNAL_TASK_ID --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000
operate external-task handle-bpmn-error $EXTERNAL_TASK_ID --worker-id worker-1 --error-code INVALID_ADDRESS
```

### Incidents and job retries

Failed job and external task incidents disappear when retries are set again: `operate retry`
does it for the root causes behind the incidents, and `--now` executes the jobs at once.
`incident resolve` only resolves custom incidents.

```sh
operate inspect $INSTANCE_ID --stacktrace
operate retry $INSTANCE_ID --now
operate retry --incident $INCIDENT_ID
operate incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
operate job list --process-instance-id $INSTANCE_ID --with-exception
operate job get-stacktrace $JOB_ID
operate job set-retries $JOB_ID --retries 1
operate external-task set-retries $EXTERNAL_TASK_ID --retries 1
operate incident set-annotation $INCIDENT_ID --annotation 'Mail server fixed'
```

### Change running instances

```sh
operate process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
operate process-instance suspend $INSTANCE_ID
operate process-instance activate $INSTANCE_ID
operate process-instance delete $INSTANCE_ID --yes
```

### History

```sh
operate historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01
operate historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
operate historic-variable-instance list --process-instance-id $INSTANCE_ID
```

### Messages and signals

```sh
operate message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
operate message correlate --message-name PaymentReceived --correlation-key orderId=A-17 --result-enabled
operate signal throw --name invoice-cancelled
```

### Decisions

```sh
operate decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
operate decision-definition list --key invoice-approval --latest-version
```

### Raw requests

```sh
operate api GET /process-instance/count --query processDefinitionKey=invoice
operate api POST /process-instance --body '{"processDefinitionKey":"invoice","withIncident":true}'
operate api DELETE /process-instance/$INSTANCE_ID --yes
```

## Compatibility

`operate` targets the Camunda 7 REST API as implemented by:

| Engine    | Tested in CI with                         |
| --------- | ----------------------------------------- |
| Operaton  | `operaton/operaton:2.1.5`                 |
| CIB seven | `cibseven/cibseven:run-2.2.0`             |
| Camunda 7 | `camunda/camunda-bpm-platform:run-7.24.0` |

The integration tests start each engine with Testcontainers and run the built CLI against it,
once as the image ships and once with HTTP Basic authentication enabled for the REST API.
Commands for features an engine does not offer fail with the engine's error. Property names that
differ between the engines are both accepted (`operatonFormRef` for Operaton, `camundaFormRef` for
Camunda 7 and CIB seven). Camunda 8 is not supported (it has a different API).

## Development

Requires Node.js 24 (`.nvmrc`; the package supports >= 22.12) and Docker for the integration
tests.

```sh
npm ci
npx tsx src/bin/operate.ts --help
```

| Script                     | What it does                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `npm run build`            | Bundle `dist/operate.js` with tsdown                                               |
| `npm run generate`         | Regenerate `src/generated/catalog.json` from the spec (`generate:check` for drift) |
| `npm run check`            | Every fast gate: typecheck, lint, format, architecture, knip, catalog, coverage    |
| `npm test`                 | Unit and property tests (vitest)                                                   |
| `npm run test:coverage`    | Unit tests with v8 coverage thresholds                                             |
| `npm run test:mutation`    | Mutation testing with StrykerJS                                                    |
| `npm run test:integration` | Build, then run the Testcontainers tests against real engines                      |

`test:integration` runs all engines, each three times: the scenario suite without authentication,
the Basic auth suite (`*-auth.it.test.ts`) against a second container with authentication enabled,
and the workflow suite (`*-workflow.it.test.ts`) that drives the workflow commands through a
process with a call activity, an external task, a message, a timer, a failing asynchronous job and
a receive task. The OAuth suite (`oauth.it.test.ts`) runs once, against the first selected engine
behind Keycloak and an Envoy JWT gateway.
`OPERATE_IT_ENGINES=operaton,camunda` selects a comma separated subset (`operaton`, `cibseven`,
`camunda`), and `OPERATE_IT_SKIP_PACK=1` skips the packed-tarball smoke test (`npm pack`,
install, run).

### Catalog generation

The command surface is data, not hand-written code:

1. `spec/operaton-rest-api.json` is the vendored OpenAPI spec of the Camunda 7 / Operaton REST API.
2. `spec/patches.json` corrects it with RFC 6902 JSON patches (each with a `test` guard and a
   `reason`).
3. `npm run generate` (`scripts/generate-catalog.ts`, `scripts/catalog/*`) turns it into
   `src/generated/catalog.json`: operations with group, command name, aliases, effect, parameters,
   body and response descriptions, plus the referenced schemas. Naming overrides live in
   `scripts/catalog/overrides.ts`, summaries in `scripts/catalog/summaries.ts`, effects in
   `scripts/catalog/effects.ts`. The generator fails on unresolvable `$ref`s, unknown HTTP methods
   and command names or summaries that are not unique in their group.
4. The catalog is committed; `npm run generate:check` (part of `npm run check`) fails when it is
   out of date.

At runtime the same catalog drives command registration, help, `describe`, input building and
body validation, so help, docs and behavior cannot drift apart. Unit tests also run every command
line of the guide and this README and every example against the CLI, and parse every query flag
of every operation through the real program.

### Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please) and npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers): nobody bumps versions by hand and
no npm token exists.

1. Pull requests are squash merged and their title becomes the commit message on `main`, so the
   title must follow [Conventional Commits](https://www.conventionalcommits.org):
   `<type>[(<scope>)][!]: <description>`. The `PR title` workflow checks it.
2. Every push to `main` makes the `Release` workflow open or update the release pull request
   `chore(main): release <version>`. It bumps the version in `package.json`, `package-lock.json`
   and `.release-please-manifest.json` and adds the new section to `CHANGELOG.md`.
3. Merging the release pull request (once its CI, including the integration tests, is green) tags
   `v<version>` and creates the GitHub release. The same workflow run checks out the tag, runs
   `npm run check`, builds and packs the package and publishes it to npm with OIDC and provenance.
   Prerelease versions get the `next` dist-tag, all others `latest`.

| Commit type                                         | Changelog            | Version bump                    |
| --------------------------------------------------- | -------------------- | ------------------------------- |
| `feat`                                              | Features             | minor                           |
| `fix`, `perf`, `revert`, `deps`, `docs`             | one section per type | patch                           |
| `!` after the type or a `BREAKING CHANGE:` footer   | Breaking Changes     | minor below 1.0, major from 1.0 |
| `refactor`, `test`, `build`, `ci`, `style`, `chore` | hidden               | no release on their own         |

Dependabot titles its pull requests `deps:` for runtime dependencies, `chore(deps-dev):` for
development dependencies and `ci:` for actions. A `Release-As: <version>` footer in a squash
commit message forces the next version. If publishing fails after the release was created
because of a setting (npm, environment, repository visibility), fix it and re-run the failed jobs
of the Release run; a version that is already on npm is skipped. A defect in the tagged code needs
a fix and a new release instead. The one-time settings `bootstrap-sha` and `initial-version`,
which shaped the first release (0.1.0), are gone from `release-please-config.json`: since `v0.1.0`
exists, release-please takes the current version from `.release-please-manifest.json` and starts
each changelog section at the last release tag.

#### One-time setup

In this order, by a maintainer with admin rights on the repository and an owner of the npm
organization `miragon` with 2FA:

1. **Repository** (Settings → General): the repository is public. The Release workflow refuses to
   publish from a private one: provenance needs a public source repository, and the CLI hints and
   this README link to its issues. Under Pull Requests allow squash merging only, with the default
   commit message "Pull request title": merge commits repeat the title in their body and list each
   change twice in the changelog, and "Default message" uses the commit message instead of the
   checked title for one-commit pull requests.
2. **Workflow permissions** (Settings → Actions → General): enable "Allow GitHub Actions to create
   and approve pull requests", which release-please needs when it runs with `GITHUB_TOKEN`.
3. **Release token** (optional, recommended): CI runs on pull requests opened with `GITHUB_TOKEN`
   only after a maintainer approves them. With one of these, CI runs on the release pull request
   by itself and step 2 is not needed:
   - a GitHub App (preferred) with the repository permissions Contents and Pull requests set to
     read and write. Its Client ID goes into the Actions variable `RELEASE_PLEASE_APP_CLIENT_ID`,
     a private key into the secret `RELEASE_PLEASE_APP_PRIVATE_KEY`. The Miragon organization
     provides both for its app `miragon-release-please`, so nothing is needed for this repository;
   - or a fine-grained personal access token for `Miragon/operate` with the same permissions, as
     the secret `RELEASE_PLEASE_TOKEN` (renew it before it expires).
4. **Environment** (Settings → Environments): create `npm` before the first release (the first run
   would create it without protection), allow deployments from the branch `main` only and
   optionally add required reviewers. The publish job runs in it.
5. **Rules** (optional): require pull requests on `main` with the check `conventional commits` and
   the `check` and `integration` jobs of CI.
6. **Create the package on npm.** A trusted publisher can only be added to an existing package, and
   OIDC cannot create one. Publish a placeholder once, from a clean checkout of `main`:

   ```sh
   npm ci
   npm login
   npm version 0.0.0-bootstrap.0 --no-git-tag-version
   npm publish --access public --tag bootstrap
   git checkout -- package.json package-lock.json
   ```

7. **Trusted publisher** (npmjs.com → `@miragon/operate` → Settings → Trusted publishing → GitHub
   Actions): organization `Miragon`, repository `operate`, workflow filename `release.yml`,
   environment `npm`, allowed action `npm publish` (without it, a new configuration allows only
   `npm stage publish`). The values are case sensitive and must match the workflow. A new
   configuration expires unless a publish through it succeeds within 48 hours, so continue with
   step 8 right away. The npm CLI (>= 11.15) can create it, too:

   ```sh
   npm trust github @miragon/operate --repo Miragon/operate --file release.yml --env npm --allow-publish
   ```

8. **First release**: merge the release pull request `chore(main): release 0.1.0`. The Release
   workflow tags `v0.1.0` and publishes 0.1.0 with provenance (npmjs.com shows the provenance
   badge). Then retire the placeholder:

   ```sh
   npm dist-tag rm @miragon/operate bootstrap
   npm deprecate @miragon/operate@0.0.0-bootstrap.0 "Placeholder, install 0.1.0 or later"
   ```

9. **Lock npm down** (package Settings → Publishing access): "Require two-factor authentication and
   disallow tokens"; trusted publishing keeps working. Delete the `NPM_TOKEN` repository secret if
   it exists and revoke npm write tokens that are no longer needed.

Without the placeholder, the npm owner can instead publish 0.1.0 by hand (`npm publish` from the
release pull request branch) before merging the release pull request; the workflow then skips
0.1.0, which has no provenance, and steps 7 and 9 follow right before the next release.

### Architecture

```text
src/bin/        entry point and the Node runtime (I/O, timers, loopback server, browser, lock file)
src/cli/        commander wiring and the utility commands; the only layer that imports commander
src/operation/  input building, variables, dates, guards, request building, execution, pagination
src/workflow/   the workflow commands: engine access, instance views, waiting, plans (pure)
src/docs/       commands, describe, examples, workflow docs, completion and the agent guide (pure)
src/catalog/    catalog access, schema helpers, body validation (pure)
src/config/     config resolution and profile editing (pure), file store
src/auth/       auth providers (none, basic, OAuth with token cache, refresh and login; pure)
src/http/       fetch based HTTP client and error mapping
src/output/     JSON, tables, field projection, errors, secret masking (pure)
scripts/        catalog generator
test/           fakes for unit tests, Testcontainers integration tests
```

dependency-cruiser enforces the layering: no cycles or orphans, only `src/bin` imports `src/cli`,
only `src/cli` imports commander and `src/workflow`, the pure layers import no Node builtins, `http`
does not depend on `config`, `cli` or `operation`, `config` does not depend on `auth`, `workflow`
does not depend on `cli`, `config`, `auth` or `bin`, only `operate auth login` can reach the
interactive login (loopback server, browser), and the generated catalog is only read through
`src/catalog/catalog.ts`.

### Quality gates

- **TypeScript** strict, **ESLint** with typescript-eslint `strictTypeChecked` and size budgets
  (complexity 10, 300 lines per file, 60 lines per function, 20 statements, depth 3, 4
  parameters), **Prettier**.
- **dependency-cruiser** for the architecture rules, **knip** for unused files, exports and
  dependencies.
- **vitest** with v8 coverage thresholds: at least 90 % of lines, statements and functions and
  85 % of branches.
- **fast-check** property tests for naming, patches, variable parsing, dates, query building,
  projection, table width, config and auth precedence, the Basic auth header, PKCE, token expiry,
  the token cache, body validation and secret masking (also of every OAuth token and secret).
- **StrykerJS** mutation testing (break threshold 65 %) on `main`, weekly and on demand.
- **Testcontainers** integration tests against the three engines, with and without Basic auth,
  behind a Keycloak and Envoy JWT gateway for OAuth, through the workflow commands, plus a
  packed-tarball smoke test, on every pull request.

## License

[MIT](LICENSE) © Miragon GmbH
