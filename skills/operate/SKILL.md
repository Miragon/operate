---
name: operate
description: Inspect and operate Camunda 7, Operaton and CIB seven process engines through their REST API with the operate CLI (deployments, process instances, user tasks, external tasks, incidents, jobs, history, variables, decisions). Use it whenever a task needs to read or change the state of such an engine.
---

# operate: the Camunda 7 REST API from the command line

`operate` calls the REST API (`/engine-rest`) of Camunda 7 process engines: Operaton, CIB seven and
Camunda 7 CE/EE. Every REST operation is a command generated from the OpenAPI spec:
`operate <group> <command> [path-args...] [options]`. It never prompts, prints JSON when stdout is
not a terminal, reports errors as one JSON line on stderr and uses stable exit codes.

## Setup

The REST API root defaults to `http://localhost:8080/engine-rest`. Set it once per shell or keep
it in a profile, then check the connection:

```sh
export OPERATE_URL=http://localhost:8080/engine-rest
operate ping
operate config set local --url http://localhost:8080/engine-rest --default
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate ping --profile prod
operate config list
operate config show --profile prod
operate config use local
```

- `operate ping` prints `{url, engine, reachable, version, engines, latencyMs, auth}`, plus
  `user` with Basic auth and OAuth.
- Precedence for every setting: flag > environment variable > profile > default.
- Environment: `OPERATE_URL`, `OPERATE_ENGINE`, `OPERATE_PROFILE`, `OPERATE_CONFIG`,
  `OPERATE_OUTPUT`, `OPERATE_TIMEOUT`, `OPERATE_READ_ONLY`, `OPERATE_AUTH`, `OPERATE_USERNAME`,
  `OPERATE_PASSWORD`, `OPERATE_OAUTH_*`, `OPERATE_HEADERS`.
- `--engine <name>` addresses a named process engine (`/engine/{name}/...`); `ping` checks it.
- `operate config path` prints the config file location (`--config <path>` overrides it). A file
  named with `--config` or `OPERATE_CONFIG` must exist (`config set` creates it).
- `config set` stores `--output` in the profile and prints in the `-o` format; `config show`
  shows the values an operation command resolves (its own `-o` only formats the output).

## Workflow: discover, describe, preview, run

Never guess commands or flags. Look them up, preview writes, then run:

```sh
operate commands
operate commands process-instance
operate commands --search incident
operate commands --effect bulk
operate describe process-definition start
operate describe getProcessInstances
operate process-definition start invoice --var amount=250 --dry-run
operate process-definition start invoice --var amount=250
```

- `operate commands` lists the groups; `operate commands <group>` the commands of a group with
  method, path, effect and summary; `--search` finds commands whose command, alias, operationId,
  summary or path contain every word (`--search 'process instance'`); `--effect` filters by
  `read`, `write`, `delete` or `bulk`.
- `operate describe <group> <command>` (or `operate describe <operationId>`) shows arguments,
  options, the request body schema, responses and examples (JSON when piped, readable text on a
  terminal or with `-o table`).
- `operate <group> <command> --help` shows the options; `operate guide` prints this guide.

## Invocation conventions

- Path parameters are positional arguments in path order:
  `operate process-instance get-variable <id> <var-name>`.
- Query parameters and body properties are kebab-case flags: `businessKey` → `--business-key`.
- Booleans: `--with-incident` sends `true`, `--no-with-incident` sends `false`. Filters the engine
  only applies when true (`--active`, `--unfinished`, ...) have no `--no-` form.
- Arrays: comma separated or repeated, `--process-instance-ids a,b --process-instance-ids c`.
- Dates (date-time options and `Date` variables) accept `2024-05-01`, `2024-05-01T10:00`,
  `2024-05-01T10:00:00Z`, `2024-05-01T10:00:00.000+02:00` and the engine format
  `2024-05-01T10:00:00.000+0200`. Times without an offset are UTC.
- Variables: `--var name=value`, repeatable. Auto typing: `true`/`false` → Boolean, integers →
  Integer or Long, decimals → Double, `null` → Null, anything else → String. Force a type with
  `name:Type=value` (String, Integer, Short, Long, Double, Boolean, Date, Json, Xml, Null), e.g.
  `--var zip:String=01234`. Other variable maps have their own flags: `--local-var`,
  `--correlation-key`, `--local-correlation-key`, `--triggered-scope-var`.
- Single variable commands (`process-instance set-variable`, `task-variable set`, ...) take
  `--value <raw>` plus an optional `--type <Type>`.
- `--body <json>`, `--body @file.json` or `--body -` (stdin) is the base JSON body; flags are
  merged on top (flags win, `--var` entries win per name). Use it for nested structures such as
  start instructions, topics or sorting.
- The final body is validated against the API schema before sending; `--no-validate` skips that.
- List commands with `--max-results` also take `--all`: fetch every page (page size
  `--max-results`, default 500) and print one list.
- Global options work after the command: `--url`, `--engine`, `--profile`, `--config`,
  `-o/--output`, `--fields`, `--pretty`, `--dry-run`, `-y/--yes`, `--read-only`, `--timeout`,
  `-H/--header`, `--auth`, `--auth-user`, `--auth-password-stdin`, `--verbose`, `--out-file`,
  `--show-secrets`.

```sh
operate process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false
operate process-definition start invoice --var 'order:Json={"id":42}' --var due:Date=2024-06-01
operate process-definition start invoice --body @start.json --business-key INV-1002
echo '{"businessKey":"INV-1003"}' | operate process-definition start invoice --body -
```

## Output

- stdout carries exactly the engine response: JSON, compact when piped, indented on a terminal or
  with `--pretty`, always ending with a newline.
- `--fields id,name,variables.amount` keeps only these properties (of every element of a list); a
  field that matches nothing gets a warning on stderr that lists the existing fields.
- `-o table` prints a table (`--fields` picks the columns, otherwise identifying columns such as
  `id`, `key`, `name` come first); `-o json` forces JSON. Count responses print as a plain number
  in table format.
- Integers beyond 2^53 (`Long` variables) are kept exactly, in responses and in `--body`.
- XML commands (`process-definition xml`, `decision-definition xml`, ...) print the raw XML unless
  `-o json` or `--fields` is given.
- Text responses (`job get-stacktrace`, ...) print raw. Binary responses (diagrams, files) need
  `--out-file <path>` on a terminal.
- `--out-file <path>` writes the response body to the file exactly as received (projected with
  `--fields`) and prints `{"outFile", "bytes", "contentType"}`.
- No content (HTTP 204): stdout stays empty, stderr gets `Done: <METHOD> <path> → 204 No Content`,
  the path relative to the REST root (as `operate api` takes it).
- `--verbose` traces request and response on stderr (secret headers masked unless `--show-secrets`).

## Errors and exit codes

Errors are one JSON line on stderr (`-o table` prints readable text instead):

```text
{"error":{"code":"NOT_FOUND","exitCode":5,"message":"HTTP 404 Not Found: ...","status":404,"engineType":"InvalidRequestException","hint":"...","request":{"method":"GET","url":"..."}}}
```

| exit | meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| 0    | success                                                                        |
| 1    | internal error                                                                 |
| 2    | usage error, invalid body (`VALIDATION`), `READ_ONLY`, `CONFIRMATION_REQUIRED` |
| 3    | configuration error, also an HTTP redirect (`HTTP_REDIRECT`, see below)        |
| 4    | auth failed: 401, 403, `LOGIN_REQUIRED` (a person must log in), `LOGIN_FAILED` |
| 5    | not found (404)                                                                |
| 6    | other 4xx: the engine rejected the request, read `engineMessage`               |
| 7    | engine error (5xx)                                                             |
| 8    | network error or timeout                                                       |

Read `hint` first: it names the fix (`operate describe ...`, `--yes`, `--no-validate`, the
accepted date forms, ...); for unknown names it starts with "Did you mean ...?". Redirects are never
followed: a 3xx answer is `HTTP_REDIRECT` (exit 3), fix `--url` (`https`, a login page).

Camunda 7 engines report many rule violations as HTTP 500 (exit 7), e.g. a task that is already
claimed or a deployment that still has instances: read `engineMessage` and fix the cause instead
of retrying.

## Safety

- `--dry-run` prints the request (`method`, `url`, `headers`, `body`, `curl`) without sending it.
  Use it before writes you are unsure about; it works in read-only mode too.
- Commands with effect `delete` or `bulk` (batches, query based updates, all versions of a key)
  refuse to run without `--yes` (exit 2, `CONFIRMATION_REQUIRED`). Add `--yes` only when the user
  asked for exactly that change.
- `--read-only`, `OPERATE_READ_ONLY=1` or a profile created with `--read-only` refuse every
  command whose effect is not `read` (exit 2, `READ_ONLY`). Use read-only profiles for production.
- Every command shows its effect in `operate commands` and `operate describe`.

## Recipes

Deploy and start:

```sh
operate deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
operate deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
operate process-definition list --key invoice --latest-version
operate process-definition start invoice --business-key INV-1001 --var amount=250
```

Find instances and complete user tasks:

```sh
operate process-instance list --process-definition-key invoice --business-key INV-1001
operate process-instance get-variables $INSTANCE_ID
operate process-instance get-activity-instance-tree $INSTANCE_ID
operate task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
operate task claim $TASK_ID --user-id demo
operate task complete $TASK_ID --var approved=true
```

Work on external tasks (the worker id must match the one that locked the task):

```sh
operate external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
operate external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
operate external-task handle-failure $EXTERNAL_TASK_ID --worker-id worker-1 --error-message 'SMTP timeout' --retries 2 --retry-timeout 60000
```

Incidents and retries. Failed job and external task incidents disappear when retries are set
again; `incident resolve` only resolves custom incidents:

```sh
operate incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
operate job list --process-instance-id $INSTANCE_ID --with-exception
operate job get-stacktrace $JOB_ID
operate job set-retries $JOB_ID --retries 1
operate external-task set-retries $EXTERNAL_TASK_ID --retries 1
```

Change running instances:

```sh
operate process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
operate process-instance set-variable $INSTANCE_ID dueDate --value 2024-06-01T12:00 --type Date
operate process-instance suspend $INSTANCE_ID
operate process-instance delete $INSTANCE_ID --yes
```

Messages, signals and decisions:

```sh
operate message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
operate signal throw --name invoice-cancelled
operate decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
```

History:

```sh
operate historic-process-instance list --process-definition-key invoice --finished --started-after 2024-05-01
operate historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
```

Raw requests: `operate api <METHOD> <path>` sends a request relative to the REST root with the
same guards, output and errors (the effect is taken from the matching catalog operation):

```sh
operate api GET /process-instance/count --query processDefinitionKey=invoice
operate api POST /process-instance --body '{"processDefinitionKey":"invoice","withIncident":true}'
operate api DELETE /process-instance/$INSTANCE_ID --yes
```

## Authentication

Basic auth: the username comes from `--auth-user`, `OPERATE_USERNAME` or the profile, the password
from `--auth-password-stdin` (first line of stdin, never a flag), `OPERATE_PASSWORD` or the profile
(best as a variable name: `--auth-password-env <VAR>`). A username or `--auth-password-stdin`
selects Basic auth, `--auth none` or `OPERATE_AUTH=none` switch it off. Missing values: exit 3. A
401 hint says why no credentials were sent or which user was rejected; other tokens go into a
header (`-H`, `OPERATE_HEADERS`). Secrets and tokens are masked unless `--show-secrets`.

OAuth (`OPERATE_OAUTH_*` or a profile): a person runs `operate auth login --profile <name>` once in
a terminal, then commands refresh the token. Never run `auth login` yourself. On exit 4 with
`LOGIN_REQUIRED`, stop and ask the user to run the command from the hint in a terminal, then retry.
`UNAUTHORIZED`/`FORBIDDEN` despite a login is a gateway (issuer, audience, clock) or permission
problem: do not ask for a new login, report message and hint. `operate auth status` (no network)
tells if the login is usable. Use only `--config` files you trust: profiles share logins by name.

```sh
printf '%s\n' "$CAMUNDA_PASSWORD" | operate ping --auth basic --auth-user demo --auth-password-stdin
operate config set prod --auth basic --auth-user demo --auth-password-env CAMUNDA_PASSWORD
operate config set sso --auth oauth --oauth-issuer https://login.example.com/realms/camunda --oauth-client-id operate-cli
```
