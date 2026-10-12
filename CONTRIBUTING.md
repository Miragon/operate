# Contributing

Thanks for your interest in `@miragon/operate`! Contributions of all kinds are welcome: bug
reports, ideas for commands, docs and code.

## Getting started

```sh
git clone https://github.com/Miragon/operate.git
cd operate
npm ci
npx tsx src/bin/operate.ts --help
```

This is a single-package TypeScript CLI, bundled with [tsdown](https://tsdown.dev/) and tested
with [Vitest](https://vitest.dev/). It requires Node.js 24 (`.nvmrc`; the package supports

> = 22.12) and Docker or Podman for the integration tests.

## Scripts (the quality gate)

| Script                        | What it does                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `npm run build`               | Bundle `dist/operate.js` with tsdown                                               |
| `npm run build:standalone`    | Bundle `build/standalone/operate.cjs` with every dependency inlined                |
| `npm run build:exe`           | Standalone executable of this platform in `build/bin` (after `build:standalone`)   |
| `npm run generate`            | Regenerate `src/generated/catalog.json` from the spec (`generate:check` for drift) |
| `npm run check`               | Every fast gate: typecheck, lint, format, architecture, knip, catalog, coverage    |
| `npm test`                    | Unit and property tests (vitest)                                                   |
| `npm run test:coverage`       | Unit tests with v8 coverage thresholds                                             |
| `npm run test:mutation`       | Incremental StrykerJS run on the logic layers (`-- --force` re-tests every mutant) |
| `npm run test:mutation:score` | Break threshold over the CI mutation shards (`--informational`: report only)       |
| `npm run test:integration`    | Build, then run the Testcontainers tests against real engines                      |
| `npm run demo`                | Redraw the README demo (`docs/assets/demo.gif`)                                    |

`npm run check` is what a change has to pass; CI runs it on every pull request, together with the
integration tests and the packaging jobs.

`test:integration` starts each engine with Testcontainers and runs the built CLI against it. It
runs all engines, each three times: the scenario suite without authentication, the Basic auth
suite (`*-auth.it.test.ts`) against a second container with authentication enabled, and the
workflow suite (`*-workflow.it.test.ts`) that drives the workflow commands through a process with
a call activity, an external task, a message, a timer, a failing asynchronous job and a receive
task. The OAuth suite (`oauth.it.test.ts`) runs once, against the first selected engine behind
Keycloak and an Envoy JWT gateway. `OPERATE_IT_ENGINES=operaton,camunda` selects a comma separated
subset (`operaton`, `cibseven`, `camunda`), and `OPERATE_IT_SKIP_PACK=1` skips the packed-tarball
smoke test (`npm pack`, install, run). `OPERATE_IT_BINARY=<path>` runs the suites against a
standalone executable instead of `dist/operate.js`.

`npm run demo` runs the built CLI against a fresh engine at `OPERATE_URL` and needs
[gifski](https://gif.ski/) on your PATH and network access for the Geist fonts.

## How the package is laid out

- `src/`: the CLI in layers, from `src/bin` (entry point) and `src/cli` (commander wiring) down to
  the pure layers. `src/docs` is the source of `operate guide`, `operate describe` and `--help`.
- `src/generated/catalog.json`: the command surface, generated from the OpenAPI spec in `spec/`.
- `scripts/`: catalog generator, standalone executable build, packaging smoke test, demo.
- `test/`: fakes for the unit tests and the Testcontainers integration tests.
- `docs/`: the reference the README links to.
- `skills/operate/`: the Claude Code plugin with its skill, command and evals.

The layers and their rules, the catalog generation, the packaging and the quality gates are
described in [docs/development.md](docs/development.md).

## Ground rules

- **Conventional Commits.** Pull requests are squash merged and their title becomes the commit
  message on `main`, so the title follows
  [Conventional Commits](https://www.conventionalcommits.org/) with one of the types `feat`, `fix`,
  `chore`, `docs`, `refactor`, `ci`, `build`, `test`, `revert`. Releases and the changelog are
  generated from them via [release-please](https://github.com/googleapis/release-please), so a
  `feat` or `fix` title is what users read in the release notes.
- **Documentation moves with the code.** A change to a command, an option or an output also
  changes the guide in `src/docs/` and the matching page in `docs/`.
- **Documented commands are tested.** The unit tests run every `operate` line of a ` ```sh ` block
  in the README and in `docs/` against a fake engine. Write such blocks without a `$` prompt, and
  put transcripts with output into ` ```text ` blocks.
- **The catalog is generated.** Do not edit `src/generated/catalog.json` by hand; change the spec
  patches or the generator and run `npm run generate`.

## Before opening a PR

```sh
npm run check
npm run test:integration
```

## The release flow

Releases are automated with release-please:

1. Merge PRs with Conventional-Commit titles into `main`.
2. release-please opens (and keeps updating) a release PR that bumps the version and
   `CHANGELOG.md` from the accumulated commits.
3. Merging that release PR tags the release and triggers the publish jobs, which publish to npm
   using OIDC trusted publishing, attach the standalone executables to the GitHub release and
   push the container image. No manual `npm publish` and no `NPM_TOKEN` are involved.

The details are in [docs/releasing.md](docs/releasing.md).

## Reporting bugs

Use the GitHub issue templates. The exact command and the error line it printed on stderr are by
far the fastest path to a fix; `--dry-run` and `--verbose` show the request without your secrets.
