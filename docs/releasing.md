# Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please) and npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers): nobody bumps versions by hand and
no npm token exists.

1. Pull requests are squash merged and their title becomes the commit message on `main`, so the
   title must follow [Conventional Commits](https://www.conventionalcommits.org):
   `<type>[(<scope>)][!]: <description>`. The `PR Title` workflow checks it.
2. Every push to `main` makes the `Release` workflow open or update the release pull request
   `chore(main): release <version>`. It bumps the version in `package.json`, `package-lock.json`,
   `skills/operate/.claude-plugin/plugin.json` (the Claude Code plugin) and
   `.release-please-manifest.json` and adds the new section to `CHANGELOG.md`.
3. Merging the release pull request (once its CI, including the integration tests, is green) tags
   `v<version>` and creates the GitHub release. The same workflow run checks out the tag, runs
   `npm run check`, builds and packs the package and publishes it to npm with OIDC and provenance.
   Prerelease versions get the `next` dist-tag, all others `latest`.
4. In the same run, the standalone bundle is built once and smoke tested; five native runners
   (Linux x64 and arm64, macOS Intel and Apple silicon, Windows x64) turn it into executables and
   smoke test each one. They are attached to the GitHub release with `SHA256SUMS` and a build
   provenance attestation. After the npm publish, the container image is pushed to
   `ghcr.io/miragon/operate` (`<version>`, `<major>.<minor>`, `latest`; prereleases only
   `<version>`) with SBOM, provenance and an attestation.

| Commit type                                       | Changelog            | Version bump                    |
| ------------------------------------------------- | -------------------- | ------------------------------- |
| `feat`                                            | Features             | minor                           |
| `fix`, `revert`, `docs`                           | one section per type | patch                           |
| `!` after the type or a `BREAKING CHANGE:` footer | Breaking Changes     | minor below 1.0, major from 1.0 |
| `refactor`, `test`, `build`, `ci`, `chore`        | hidden               | no release on their own         |

Dependabot titles its pull requests `chore(deps):` or `chore(deps-dev):`, so a dependency update
starts no release on its own and ships with the next one. A `Release-As: <version>` footer in a squash
commit message forces the next version. If publishing fails after the release was created
because of a setting (npm, environment, repository visibility, package permissions), fix it and
re-run the failed jobs of the Release run; a version that is already on npm is skipped, release
assets are replaced and image tags pushed again. A defect in the tagged code needs
a fix and a new release instead. The one-time settings `bootstrap-sha` and `initial-version`,
which shaped the first release (0.1.0), are gone from `release-please-config.json`: since `v0.1.0`
exists, release-please takes the current version from `.release-please-manifest.json` and starts
each changelog section at the last release tag.

## One-time setup

In this order, by a maintainer with admin rights on the repository and an owner of the npm
organization `miragon` with 2FA:

1. **Repository** (Settings → General): the repository is public. The Release workflow refuses to
   publish from a private one: provenance needs a public source repository, and the CLI hints and
   the README link to its issues. Under Pull Requests allow squash merging only, with the default
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
5. **Rules** (optional): require pull requests on `main` with the check `validate-pr-title` and
   the `check`, `integration`, `standalone executable (linux-x64)` and `container image` jobs of
   CI. Not the `mutation` and `mutation score` jobs: on pull requests they only inform, and pull
   requests without a mutation baseline of `main` and the release pull request skip them.
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
10. **Container image** (once, right after the first release that pushes it): the Release
    workflow pushes `ghcr.io/miragon/operate` with `GITHUB_TOKEN` (`packages: write`). That links
    the new package to this repository, but GHCR creates it private, so `docker pull` needs a
    login until an organization owner makes it public: Organization → Packages → `operate` →
    Package settings → Danger Zone → Change visibility → Public (this cannot be undone). The
    organization settings (Packages → Package creation) must allow public packages. If the
    organization turned off access inheritance, add `Miragon/operate` with the role Write under
    Package settings → Manage Actions access, and re-run the failed `image` job.
11. **Release assets and attestations** need no setting: every job declares its permissions
    (`contents: write` for the upload, `id-token: write` and `attestations: write` for the
    attestations), and artifact attestations are available for public repositories on every
    plan. Keep "immutable releases" off (Settings → General → Releases): release-please publishes
    the release before the binaries exist, and an immutable release refuses later assets. If the
    organization or repository allows only selected actions, allow GitHub's own and
    `docker/login-action`, `docker/setup-buildx-action`, `docker/metadata-action` and
    `docker/build-push-action`.

Without the placeholder, the npm owner can instead publish 0.1.0 by hand (`npm publish` from the
release pull request branch) before merging the release pull request; the workflow then skips
0.1.0, which has no provenance, and steps 7 and 9 follow right before the next release.
