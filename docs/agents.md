# Using operate from AI agents

`operate` is designed to be driven by coding agents. Everything an agent needs is in the CLI
itself:

- `operate guide` prints a concise Markdown usage guide: setup, discover, describe, preview and
  run, the workflow commands, conventions, output, exit codes, safety, and an index of topics.
  `operate guide <topic>` prints the details of one topic when the task needs them (`workflow`,
  `input`, `output`, `config`, `auth`, `recipes`); `operate guide --list` lists them (JSON when
  piped). Point your agent at it, e.g. in `AGENTS.md` or `CLAUDE.md`: "Run `operate guide` before
  using `operate`."
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
- With OAuth, a person logs in once with `operate auth login`; agents never do. One login serves
  every OAuth profile of the repository (in all its worktrees) that stores the same issuer, client,
  audience and scopes. A command that needs a new login fails with `LOGIN_REQUIRED` (exit 4) and
  the hint names the command to run in a terminal and where; `operate auth status` tells an agent
  whether the login is usable.
- A bearer token from elsewhere (`OPERATE_TOKEN`) is never refreshed by operate: on
  `TOKEN_EXPIRED` (exit 4) the agent asks for a new token. A token command
  (`OPERATE_TOKEN_COMMAND`, e.g. in the `env` of the repository's `.claude/settings.json`, with an
  absolute path or no path) fetches short-lived tokens instead, so agent command lines stay short
  and can be pre-approved.
- A repository can ship its engines as profiles in a project file (`.operate.json`), so an agent
  session needs no setup and a bare `operate status` reaches the repository's engine. A project
  file names engines, never credentials, so it can neither run code nor send a secret of its
  choice, and it only gets the OAuth logins made for its own repository's profiles.

A typical agent workflow is discover, describe, preview, run, with a topic of the guide when the
task needs more:

```sh
operate commands --search 'process instance'
operate describe process-definition start
operate process-definition start invoice --var amount=250 --dry-run
operate process-definition start invoice --var amount=250
operate guide auth
```

The guide is split for progressive disclosure: the core stays short enough to load on every use,
and each topic is fetched only when a task needs it. Every `operate` command line in the core and
in every topic is checked against the catalog and run in the CLI by the unit tests, so the guide
cannot drift from the commands.

## Claude Code plugin

This repository is also a Claude Code plugin marketplace, `miragon`, with one plugin, `operate`.
Add the marketplace once and install the plugin in a Claude Code session:

```text
/plugin marketplace add Miragon/operate
/plugin install operate@miragon
```

From a shell, `claude plugin marketplace add Miragon/operate` and
`claude plugin install operate@miragon` do the same. The plugin contains:

- The skill `operate`, the text of `operate guide` (the core guide with its topic index; Claude
  runs `operate guide <topic>` for the details). Claude Code loads it whenever a task needs to
  read or change the state of a Camunda 7, Operaton or CIB seven engine; `/operate` (or
  `/operate:operate`) loads it by hand.
- The command `/operate:status [options]`: Claude runs `operate status` (read-only) and
  summarizes incidents by root cause, overdue jobs, external task workers and the next commands.
  It changes nothing. Only the bare `operate status` and `operate ping` run without a permission
  prompt: with options Claude Code asks first, because a pre-approved `--url` would send your
  credentials to another host.

The CLI is not part of the plugin: install it with `npm install -g @miragon/operate`, otherwise
the skill has Claude run `npx -y @miragon/operate` in its place. The plugin version is the npm
version, and release-please bumps both. Claude Code does not update plugins from third-party
marketplaces on its own: after a release, refresh the marketplace and then update the plugin
(`claude plugin update` alone does not see the new version), or turn on auto-update for `miragon`
under **Marketplaces** in `/plugin`:

```sh
claude plugin marketplace update miragon
claude plugin update operate@miragon
```

If you copied `SKILL.md` into a skills directory before (see below), remove that copy, for
example with `rm -r ~/.claude/skills/operate`: with both, Claude Code lists the skill twice
(`operate` and `operate:operate`), one of them outdated, and `/operate` is the copy.

The plugin lives in
[`skills/operate`](https://github.com/Miragon/operate/tree/main/skills/operate) (manifest in
`.claude-plugin/plugin.json`, command in `commands/`, evals in `evals/`);
[`.claude-plugin/marketplace.json`](https://github.com/Miragon/operate/blob/main/.claude-plugin/marketplace.json)
at the repository root lists it. Adding the marketplace makes a shallow clone of the repository,
and installing the plugin copies only the skill directory and installs no npm dependencies. The
npm package ships the same directory without the evals, so
`claude --plugin-dir "$(npm root -g)/@miragon/operate/skills/operate"` loads the plugin of the
installed version for one session.

## Claude Code skill without the plugin

[`skills/operate/SKILL.md`](https://github.com/Miragon/operate/blob/main/skills/operate/SKILL.md)
is the guide packaged as a Claude Code skill (YAML frontmatter plus the text of `operate guide`,
the core guide; the topics come from `operate guide <topic>` of the installed CLI); it ships with
the npm package and is the skill of the plugin. To use it without the plugin (not in addition to
it), install it for all your projects or for one project:

```sh
mkdir -p ~/.claude/skills/operate
cp "$(npm root -g)/@miragon/operate/skills/operate/SKILL.md" ~/.claude/skills/operate/

mkdir -p .claude/skills/operate
curl -fsSL https://raw.githubusercontent.com/Miragon/operate/main/skills/operate/SKILL.md -o .claude/skills/operate/SKILL.md
```

Claude Code then loads it whenever a task needs to read or change the state of a Camunda 7,
Operaton or CIB seven engine.
