# operate

[![npm version](https://img.shields.io/npm/v/@miragon/operate.svg)](https://www.npmjs.com/package/@miragon/operate)
[![CI](https://github.com/Miragon/operate/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/operate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A command line tool that lets an AI agent (or a human at a shell) run and repair processes on a
Camunda 7 engine: [Operaton](https://operaton.org), [CIB seven](https://cibseven.org) and
Camunda 7. It says **what should happen** to a process, and the CLI talks to the REST API.

![One operate advance command completes the task an order process waits at](docs/assets/demo.gif)

## Why

A language model writes its answer token by token, so the time and the cost of a task grow with
the text it has to produce. Driving a process engine through its REST API is a lot of text: one
request to find the instance, one to see where it waits, one to act, one to check the result, and
each answer has to be read to build the next request. An agent that works this way is slow, and
every id it copies is a chance to hit the wrong instance.

operate turns this around: the agent names the process and what should happen to it, in one short
command, and the CLI sends the requests. What you get:

- **Fast, because the agent writes little.** One short command replaces a chain of requests.
- **Cheap to read.** Answers contain what the next step needs, not everything the engine knows.
- **No guessing.** The CLI lists its own commands and explains each one, so an agent looks things
  up instead of inventing them.
- **Safe on real engines.** Every change can be previewed, deleting needs an explicit yes, and an
  engine can be marked as look-only.
- **The whole engine.** Everything the REST API offers is available, for the cases the short
  commands do not cover.
- **Made for scripts too.** It never asks questions, and both its answers and its errors are
  easy for a program to read.

## Install

Requires Node.js 22.12+, or use the standalone executable or the container image (see below).

```sh
npm install -g @miragon/operate
operate guide
```

## Quick start

Start an engine, then deploy a process, start an instance and complete its first task.
`order.bpmn` is any process with a user task; the [walk-through](docs/quick-start.md) has one.

```sh
docker run -d --name engine -p 8080:8080 operaton/operaton:2.1.5
operate ping
operate deploy order.bpmn --start --business-key ORD-1001 --var amount=250
operate advance --business-key ORD-1001 --var approved=true
```

```text
Advanced  review (userTask) via POST /task/74ef8d30-c652-11f1-ac07-4a8ec87eee1e/complete

Process instance  74ef661b-c652-11f1-ac07-4a8ec87eee1e
State             COMPLETED
Definition        order v1 (Order)
Business key      ORD-1001
Started           2026-10-12T15:34:47.666+0000
Ended             2026-10-12T15:34:47.916+0000

Variables:
NAME      VALUE  TYPE
amount    250
approved  true
```

On a terminal the answer is a table, as above; an agent or a script gets JSON.

## Commands

| Task                        | Commands                                                      |
| --------------------------- | ------------------------------------------------------------- |
| See where an instance waits | `inspect`, `wait`                                             |
| Move an instance on         | `advance`, `retry`                                            |
| Deploy and start            | `deploy`                                                      |
| Check the engine            | `status`, `ping`                                              |
| Call any REST operation     | `<group> <command>`, e.g. `task list`; `api` for raw requests |
| Ask the CLI itself          | `guide`, `commands`, `describe`, `--help`                     |
| Set up engines and logins   | `config`, `auth`, `completion`                                |

Details: [workflow commands](docs/workflow-commands.md),
[command structure](docs/commands.md), [recipes](docs/recipes.md).

## AI agents and the Claude Code plugin

Everything an agent needs is in the CLI: `operate guide` prints the usage guide, and one line in
`AGENTS.md` or `CLAUDE.md` ("Run `operate guide` before using `operate`") is enough. This
repository is also a Claude Code plugin marketplace whose skill makes Claude use the CLI whenever
a task touches an engine.

```text
/plugin marketplace add Miragon/operate
/plugin install operate@miragon
```

Details: [using operate from AI agents](docs/agents.md).

## Engines

operate works with Operaton, CIB seven and Camunda 7, and is tested against all three on every
change. Camunda 8 is not supported: it has a different API.

Details: [compatibility](docs/installation.md#compatibility).

## Without Node.js

Every release also has a standalone executable for Linux, macOS and Windows, and a container
image, `ghcr.io/miragon/operate`.

Details: [installation](docs/installation.md).

## Documentation

- [Installation](docs/installation.md): npm, standalone executable, container image, shell completion
- [Quick start](docs/quick-start.md): one process from an empty engine to a finished instance
- [Workflow commands](docs/workflow-commands.md): inspect, wait, advance, retry, deploy, status
- [Command structure](docs/commands.md): names, arguments, variables, request bodies, files, dates
- [Output and errors](docs/output-and-errors.md): formats, previews, error fields, exit codes
- [Configuration](docs/configuration.md): options, environment variables, config file, profiles
- [Authentication](docs/authentication.md): Basic auth, OAuth logins, bearer tokens, other headers
- [Safety](docs/safety.md): previews, confirmation, read-only mode
- [Recipes](docs/recipes.md): command lines for everyday tasks
- [Using operate from AI agents](docs/agents.md): the guide, the Claude Code plugin and skill
- [Development](docs/development.md) and [releasing](docs/releasing.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bugs and ideas go to the
[issues](https://github.com/Miragon/operate/issues).

## License

[MIT](LICENSE) © Miragon GmbH
