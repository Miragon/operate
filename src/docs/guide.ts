/**
 * The usage guide for LLM agents, printed by `operate guide`. `skills/operate/SKILL.md` is a YAML
 * frontmatter followed by exactly this text, and every `operate` command line in its code blocks is
 * checked against the catalog; unit tests keep both true. Markdown, formatted with Prettier.
 */

import { DEFAULT_PAGE_SIZE } from '../catalog/rules.js';

export const GUIDE = `# operate: the Camunda 7 REST API from the command line

\`operate\` calls the REST API (\`/engine-rest\`) of Camunda 7 process engines: Operaton, CIB seven and
Camunda 7 CE/EE. Every REST operation is a command generated from the OpenAPI spec:
\`operate <group> <command> [path-args...] [options]\`; workflow commands such as \`operate inspect\`
combine several requests. It never prompts, prints JSON when stdout is not a terminal, reports
errors as one JSON line on stderr and uses stable exit codes.

## Setup

The REST API root defaults to \`http://localhost:8080/engine-rest\`. Set it once per shell or keep
it in a profile, then check the connection:

\`\`\`sh
export OPERATE_URL=http://localhost:8080/engine-rest
operate ping
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate config show --profile prod
operate config set local --url http://localhost:8080/engine-rest --default
\`\`\`

- \`operate ping\` prints \`{url, engine, reachable, version, engines, latencyMs, auth}\` (\`user\` too).
- Precedence for every setting: flag > environment variable > profile > default.
- Environment: \`OPERATE_URL\`, \`OPERATE_ENGINE\`, \`OPERATE_PROFILE\`, \`OPERATE_CONFIG\`,
  \`OPERATE_OUTPUT\`, \`OPERATE_TIMEOUT\`, \`OPERATE_READ_ONLY\`, \`OPERATE_AUTH\`, \`OPERATE_USERNAME\`,
  \`OPERATE_PASSWORD\`, \`OPERATE_OAUTH_*\`, \`OPERATE_HEADERS\`.
- \`--engine <name>\` addresses a named process engine (\`/engine/{name}/...\`); \`ping\` checks it.
- \`operate config path\` prints the config file location (\`--config <path>\` overrides it; a file
  named with \`--config\` or \`OPERATE_CONFIG\` must exist, \`config set\` creates it).
- \`config set\` stores \`--output\` in the profile and prints in the \`-o\` format; \`config show\`
  shows the values an operation command resolves (its own \`-o\` only formats the output).

## Discover, describe, preview, run

Never guess commands or flags. Look them up, preview writes, then run:

\`\`\`sh
operate commands
operate commands --search incident
operate describe process-definition start
operate process-definition start invoice --var amount=250 --dry-run
operate process-definition start invoice --var amount=250
\`\`\`

- \`operate commands\` lists the groups (and \`workflow\`); \`operate commands <group>\` the commands of
  a group with method, path, effect and summary; \`--search\` finds commands whose command, alias,
  operationId, summary or path contain every word (\`--search 'process instance'\`); \`--effect\`
  filters by \`read\`, \`write\`, \`delete\` or \`bulk\`.
- \`operate describe <group> <command>\` (or an operationId or workflow command) shows arguments,
  options, the request body schema, responses and examples (JSON when piped, text with \`-o table\`).
- \`operate <group> <command> --help\` shows the options; \`operate guide\` prints this guide.

## Workflow commands

Top-level commands that combine requests, so no id passes through you. They select an instance by
id, \`--business-key\` or \`--process-definition-key <key> --latest\`; \`next\` lists follow-ups:

- \`operate inspect\`: where an instance waits and why: wait states (also in called instances), root
  incidents with root cause, variables; finds ended instances; \`--history\` adds the timeline.
- \`operate wait\`: until the instance is idle, or \`--until ended|incident|task[:key]|activity:<id>\`;
  budget \`--wait-timeout\` (default 60s); \`--batch <id>\` waits for a batch.
- \`operate advance\`: completes what it waits for: user task, external task (locked first), message,
  signal, receive task, timer or job.
- \`operate retry\`: sets the retries behind open incidents (root causes only); \`--now\` executes jobs.
- \`operate deploy\`: deploys changed files and directories, reports the versions in effect.
- \`operate status\`: grouped incidents with root cause, overdue jobs, external task workers.

\`\`\`sh
operate deploy bpmn --start --business-key B-1 --var amount=250
operate inspect --business-key B-1
operate advance --business-key B-1 --var approved=true --wait
operate retry --business-key B-1 --now
operate wait --business-key B-1 --until ended
operate status
\`\`\`

- Use \`operate wait\` (or \`--wait\` of advance, retry, deploy) instead of \`sleep\` after asynchronous
  steps; it fails fast when an incident appears.
- \`advance\` needs \`--activity-id\` when the instance waits at several places; the error lists them.
- With \`--dry-run\`, \`advance\` and \`retry\` still send their reads (to plan) and preview the writes.
- Exit code 9 (\`INCIDENT\`, \`WAIT_TIMEOUT\`, \`JOB_FAILED\`, ...) still prints the view on stdout.

## Invocation conventions

- Path parameters are positional arguments in path order:
  \`operate process-instance get-variable <id> <var-name>\`.
- Query parameters and body properties are kebab-case flags: \`businessKey\` → \`--business-key\`.
- Booleans: \`--with-incident\` sends \`true\`, \`--no-with-incident\` sends \`false\`. Filters the engine
  only applies when true (\`--active\`, \`--unfinished\`, ...) have no \`--no-\` form.
- Arrays: comma separated or repeated, \`--process-instance-ids a,b --process-instance-ids c\`.
- Dates (date-time options and \`Date\` variables) accept \`2024-05-01\`, \`2024-05-01T10:00\`,
  \`2024-05-01T10:00:00Z\`, \`2024-05-01T10:00:00.000+02:00\` and the engine format
  \`2024-05-01T10:00:00.000+0200\`. Times without an offset are UTC.
- Variables: \`--var name=value\`, repeatable. Auto typing: \`true\`/\`false\` → Boolean, integers →
  Integer or Long, decimals → Double, \`null\` → Null, anything else → String. Force a type with
  \`name:Type=value\` (String, Integer, Short, Long, Double, Boolean, Date, Json, Xml, Null), e.g.
  \`--var zip:String=01234\`. Other variable maps have their own flags: \`--local-var\`,
  \`--correlation-key\`, \`--local-correlation-key\`, \`--triggered-scope-var\`.
- Single variable commands (\`process-instance set-variable\`, \`task-variable set\`, ...) take
  \`--value <raw>\` plus an optional \`--type <Type>\`.
- \`--body <json>\`, \`--body @file.json\` or \`--body -\` (stdin) is the base JSON body; flags are
  merged on top (flags win, \`--var\` entries win per name). Use it for nested structures. The final
  body is validated against the API schema before sending; \`--no-validate\` skips that.
- List commands with \`--max-results\` also take \`--all\`: fetch every page (page size
  \`--max-results\`, default ${DEFAULT_PAGE_SIZE}) and print one list.
- Global options work after the command: \`--url\`, \`--engine\`, \`--profile\`, \`--config\`,
  \`-o/--output\`, \`--fields\`, \`--pretty\`, \`--dry-run\`, \`-y/--yes\`, \`--read-only\`, \`--timeout\`,
  \`-H/--header\`, \`--auth\`, \`--auth-user\`, \`--auth-password-stdin\`, \`--verbose\`, \`--out-file\`,
  \`--show-secrets\`.

\`\`\`sh
operate process-definition start invoice --var 'order:Json={"id":42}' --var due:Date=2024-06-01
echo '{"businessKey":"INV-1003"}' | operate process-definition start invoice --body -
\`\`\`

## Output

- stdout carries exactly the engine response (workflow commands: their view): JSON, compact when
  piped, indented on a terminal or with \`--pretty\`, always ending with a newline.
- \`--fields id,name,variables.amount\` keeps only these properties (of every element of a list); a
  field that matches nothing gets a warning on stderr that lists the existing fields.
- \`-o table\` prints a table (\`--fields\` picks the columns, otherwise identifying columns come
  first); \`-o json\` forces JSON. Integers beyond 2^53 (\`Long\` variables) are kept exactly.
- XML commands (\`process-definition xml\`, ...) print the raw XML unless \`-o json\` or \`--fields\`.
  Text responses (\`job get-stacktrace\`, ...) print raw; binary ones need \`--out-file\` on a terminal.
- \`--out-file <path>\` writes the response body to the file exactly as received (projected with
  \`--fields\`) and prints \`{"outFile", "bytes", "contentType"}\`.
- No content (HTTP 204): stdout stays empty, stderr gets \`Done: <METHOD> <path> → 204 No Content\`,
  the path relative to the REST root (as \`operate api\` takes it).
- \`--verbose\` traces request and response on stderr (secret headers masked unless \`--show-secrets\`).

## Errors and exit codes

Errors are one JSON line on stderr (\`-o table\` prints readable text instead):

\`\`\`text
{"error":{"code":"NOT_FOUND","exitCode":5,"message":"HTTP 404 Not Found: ...","status":404,"engineType":"InvalidRequestException","hint":"...","request":{"method":"GET","url":"..."}}}
\`\`\`

| exit | meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 0    | success                                                                                                |
| 1    | internal error                                                                                         |
| 2    | usage error, invalid body (\`VALIDATION\`), \`READ_ONLY\`, \`CONFIRMATION_REQUIRED\`                         |
| 3    | configuration error, also an HTTP redirect (\`HTTP_REDIRECT\`, see below)                                |
| 4    | auth failed: 401, 403, \`LOGIN_REQUIRED\` (a person must log in), \`LOGIN_FAILED\`                         |
| 5    | not found (404)                                                                                        |
| 6    | other 4xx: the engine rejected the request, read \`engineMessage\`                                       |
| 7    | engine error (5xx)                                                                                     |
| 8    | network error or timeout                                                                               |
| 9    | expected state not reached: \`WAIT_TIMEOUT\`, \`INCIDENT\`, \`INSTANCE_ENDED\`, \`JOB_FAILED\`, \`CHECK_FAILED\` |

Read \`hint\` first: it names the fix (\`operate describe ...\`, \`--yes\`, \`--no-validate\`, the
accepted date forms, ...); for unknown names it starts with "Did you mean ...?". Redirects are never
followed: a 3xx answer is \`HTTP_REDIRECT\` (exit 3), fix \`--url\` (\`https\`, a login page). Camunda 7
engines report many rule violations as HTTP 500 (exit 7), e.g. a task that is already claimed:
read \`engineMessage\` and fix the cause instead of retrying.

## Safety

- \`--dry-run\` prints the request (\`method\`, \`url\`, \`headers\`, \`body\`, \`curl\`) without sending it.
  Use it before writes you are unsure about; it works in read-only mode too.
- Commands with effect \`delete\` or \`bulk\` (batches, query based updates, all versions of a key,
  \`operate retry --process-definition-key\` alone) refuse to run without \`--yes\` (exit 2,
  \`CONFIRMATION_REQUIRED\`). Add \`--yes\` only when the user asked for exactly that change.
- \`--read-only\`, \`OPERATE_READ_ONLY=1\` or a profile created with \`--read-only\` refuse every
  command whose effect is not \`read\` (exit 2, \`READ_ONLY\`). Use read-only profiles for production.

## Recipes

Deploy and start:

\`\`\`sh
operate deploy src/main/resources --start-key invoice --business-key INV-1001 --var amount=250
operate deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
operate process-definition start invoice --business-key INV-1001 --var amount=250
\`\`\`

Find instances and complete user tasks:

\`\`\`sh
operate process-instance list --process-definition-key invoice --business-key INV-1001
operate task list --process-instance-id $INSTANCE_ID --fields id,name,assignee
operate task claim $TASK_ID --user-id demo
operate task complete $TASK_ID --var approved=true
\`\`\`

Work on external tasks (the worker id must match the one that locked the task):

\`\`\`sh
operate external-task fetch-and-lock --worker-id worker-1 --max-tasks 5 --body '{"topics":[{"topicName":"send-invoice","lockDuration":60000}]}'
operate external-task complete $EXTERNAL_TASK_ID --worker-id worker-1 --var invoiceSent=true
\`\`\`

Incidents and retries. \`operate retry\` sets the retries of failed jobs and external tasks (root
causes only); \`incident resolve\` only resolves custom incidents:

\`\`\`sh
operate inspect $INSTANCE_ID --stacktrace
operate retry $INSTANCE_ID --now
operate retry --process-definition-key invoice --activity-id send-invoice --dry-run
operate incident list --process-instance-id $INSTANCE_ID --fields id,incidentType,activityId,incidentMessage
operate job set-retries $JOB_ID --retries 1
\`\`\`

Change running instances:

\`\`\`sh
operate process-instance modify $INSTANCE_ID --body '{"instructions":[{"type":"startBeforeActivity","activityId":"reviewInvoice"}]}' --dry-run
operate process-instance delete $INSTANCE_ID --yes
\`\`\`

Messages, signals, decisions and history:

\`\`\`sh
operate message correlate --message-name PaymentReceived --business-key INV-1001 --var paid=true
operate signal throw --name invoice-cancelled
operate decision-definition evaluate-by-key invoice-approval --var amount=250 --var category=travel
operate historic-activity-instance list --process-instance-id $INSTANCE_ID --sort-by startTime --sort-order asc
\`\`\`

Raw requests: \`operate api <METHOD> <path>\` sends a request relative to the REST root with the
same guards, output and errors (the effect is taken from the matching catalog operation):

\`\`\`sh
operate api GET /process-instance/count --query processDefinitionKey=invoice
operate api DELETE /process-instance/$INSTANCE_ID --yes
\`\`\`

## Authentication

Basic auth: the username comes from \`--auth-user\`, \`OPERATE_USERNAME\` or the profile, the password
from \`--auth-password-stdin\` (first line of stdin, never a flag), \`OPERATE_PASSWORD\` or the profile
(best as a variable name: \`--auth-password-env <VAR>\`). A username or \`--auth-password-stdin\`
selects Basic auth, \`--auth none\` or \`OPERATE_AUTH=none\` switch it off; missing values exit 3.
Other tokens go into a header (\`-H\`, \`OPERATE_HEADERS\`); secrets are masked unless \`--show-secrets\`.

OAuth (\`OPERATE_OAUTH_*\` or a profile): a person runs \`operate auth login --profile <name>\` once in
a terminal, then commands refresh the token. Never run \`auth login\` yourself. On exit 4 with
\`LOGIN_REQUIRED\`, stop and ask the user to run the command from the hint in a terminal, then retry.
\`UNAUTHORIZED\`/\`FORBIDDEN\` despite a login is a gateway (issuer, audience, clock) or permission
problem: do not ask for a new login, report message and hint. \`operate auth status\` (no network)
tells if the login is usable. Use only \`--config\` files you trust: profiles share logins by name.

\`\`\`sh
printf '%s\\n' "$CAMUNDA_PASSWORD" | operate ping --auth basic --auth-user demo --auth-password-stdin
operate config set prod --auth basic --auth-user demo --auth-password-env CAMUNDA_PASSWORD
operate config set sso --auth oauth --oauth-issuer https://login.example.com/realms/camunda --oauth-client-id operate-cli
\`\`\`
`;
