# operate is now Pulse CLI

operate moved into the [Pulse](https://github.com/Miragon/pulse) monorepo and ships there as Pulse
CLI, the command `pulse-cli`, from 0.22.0 on. This repository is archived and read-only: it keeps
operate's code, and its releases and changelog up to 0.10.0.

- Source: [Miragon/pulse, `apps/cli`](https://github.com/Miragon/pulse/tree/main/apps/cli)
- Docs: [miragon.github.io/pulse/cli](https://miragon.github.io/pulse/cli/)
- Issues: [Miragon/pulse/issues](https://github.com/Miragon/pulse/issues)

## Old and new names

| What               | operate (up to 0.10.0)                                 | Pulse CLI                                            |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------- |
| npm package        | `@miragon/operate`                                     | `@miragon/pulse-cli`                                 |
| Homebrew formula   | `miragon/tap/operate`                                  | `miragon/tap/pulse-cli`                              |
| Command            | `operate`                                              | `pulse-cli`                                          |
| Container image    | `ghcr.io/miragon/operate`                              | `ghcr.io/miragon/pulse-cli`                          |
| Docs               | https://miragon.github.io/operate/                     | https://miragon.github.io/pulse/cli/                 |
| Variables          | `OPERATE_URL`, `OPERATE_TOKEN` and the rest            | `PULSE_CLI_URL`, `PULSE_CLI_TOKEN` and so on         |
| Project file       | `.operate.json`                                        | `.pulse-cli.json`                                    |
| Config directory   | `~/.config/operate`, `%APPDATA%\operate`               | `~/.config/pulse-cli`, `%APPDATA%\pulse-cli`         |
| Claude Code plugin | `operate@miragon` from the marketplace Miragon/operate | `pulse-cli@pulse` from the marketplace Miragon/pulse |
| Source             | Miragon/operate                                        | Miragon/pulse, `apps/cli`                            |
| Issues             | Miragon/operate/issues                                 | Miragon/pulse/issues                                 |

## Moving over

- npm: `npm install -g @miragon/pulse-cli`. `@miragon/operate` stays installable with its own
  `operate` command, but gets no new releases.
- Homebrew: `brew upgrade` moves an installed `miragon/tap/operate` to `miragon/tap/pulse-cli`.
  The formula keeps `operate` as a link to `pulse-cli`, which warns when it starts under that
  name.
- Claude Code:

  ```text
  /plugin uninstall operate@miragon
  /plugin marketplace add Miragon/pulse
  /plugin install pulse-cli@pulse
  ```

  If you copied the skill into `~/.claude/skills/operate` or `.claude/skills/operate`, remove
  that copy. More in [Using Pulse CLI from AI agents](https://miragon.github.io/pulse/cli/agents).

Until the first release after 2027-01-31, pulse-cli still reads operate's names and prints one
warning per run that lists each one in use: the `OPERATE_` variables while no `PULSE_CLI_`
variable is set, `~/.config/operate/config.json` while `~/.config/pulse-cli/config.json` is
missing, `.operate.json` in a directory without `.pulse-cli.json`, and the `operate` link of the
Homebrew formula. Logins and cached tokens stay behind: run `pulse-cli auth login` once. The
details are in
[Renamed from operate](https://miragon.github.io/pulse/cli/installation#renamed-from-operate).

The old docs addresses lead to the same page under https://miragon.github.io/pulse/cli/.

## License

[MIT](LICENSE) © Miragon GmbH
