# Installation

Three ways, the same CLI: the npm package (Node.js >= 22.12), a standalone executable for
servers and machines without Node.js, or the container image.

## npm

```sh
npm install -g @miragon/operate
operate --version
```

Or run it without installing:

```sh
npx @miragon/operate --help
```

## Standalone executable

Every [GitHub release](https://github.com/Miragon/operate/releases) after 0.5.0 has a single file
per platform that needs no Node.js (it embeds Node.js 24 as a
[single executable application](https://nodejs.org/api/single-executable-applications.html)),
plus `SHA256SUMS`:

| Platform              | File                      | Requires                                                 |
| --------------------- | ------------------------- | -------------------------------------------------------- |
| Linux x64             | `operate-linux-x64`       | glibc >= 2.28 (Debian 10, Ubuntu 20.04, RHEL 8 or newer) |
| Linux arm64           | `operate-linux-arm64`     | glibc >= 2.28                                            |
| macOS (Apple silicon) | `operate-macos-arm64`     | macOS 13.5 or newer                                      |
| macOS (Intel)         | `operate-macos-x64`       | macOS 13.5 or newer                                      |
| Windows x64           | `operate-windows-x64.exe` | Windows 10 or Server 2016 or newer                       |

Alpine and other musl based systems: use the container image or the npm package.

Linux (on macOS take `operate-macos-arm64` or `operate-macos-x64`; `shasum -a 256 --check
--ignore-missing SHA256SUMS` checks it there):

```sh
base=https://github.com/Miragon/operate/releases/latest/download
curl -fL -O "$base/operate-linux-x64" -O "$base/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
sudo install -m 0755 operate-linux-x64 /usr/local/bin/operate
operate --version
```

`latest/download` follows the newest release; `download/v<version>/<file>` pins one. The
binaries are built and attested by the Release workflow of this repository; with the GitHub CLI,
`gh attestation verify operate-linux-x64 --repo Miragon/operate` checks that a file came from it.

- **macOS Gatekeeper.** The macOS binaries are signed ad hoc, not notarized. Files downloaded
  with `curl` run as they are; a file downloaded with a browser is quarantined and blocked
  ("Apple could not verify ..."). Remove the quarantine flag of that one file with
  `xattr -d com.apple.quarantine operate-macos-arm64`, or allow it once under System Settings →
  Privacy & Security.
- **Windows.** Download `operate-windows-x64.exe` and compare
  `(Get-FileHash operate-windows-x64.exe).Hash` in PowerShell with its line in `SHA256SUMS`. The
  file is not Authenticode signed, so SmartScreen may warn on the first start of a downloaded copy.
- **Certificates and proxies.** The embedded Node.js reads the usual variables: an internal CA
  with `NODE_EXTRA_CA_CERTS=/path/ca.pem` or the system store with `NODE_USE_SYSTEM_CA=1`, an HTTP
  proxy with `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` / `NO_PROXY`. The same holds for the
  container image.
- `operate auth login` (OAuth) works on a server over SSH, see [OAuth](authentication.md#oauth).

## Container image

`ghcr.io/miragon/operate` for `linux/amd64` and `linux/arm64`, from the first release after 0.5.0
on, tagged `<version>`, `<major>.<minor>` and `latest`. It runs the CLI on
[distroless](https://github.com/GoogleContainerTools/distroless) Node.js 24 as a non-root user
(uid 65532), without a shell. Arguments after the image name go to `operate`; without `-t`
stdout is no terminal, so the output is JSON.

```sh
docker run --rm ghcr.io/miragon/operate --version

# An engine on the Docker host: Docker Desktop resolves host.docker.internal by itself, on Linux
# --add-host maps it to the host
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e OPERATE_URL=http://host.docker.internal:8080/engine-rest \
  ghcr.io/miragon/operate ping

# Credentials from the calling shell: -e NAME without a value passes the variable on, so the
# secret appears neither in the command line nor in the shell history
export OPERATE_URL=https://engine.example.com/engine-rest OPERATE_USERNAME=demo
read -rs OPERATE_PASSWORD && export OPERATE_PASSWORD
docker run --rm -e OPERATE_URL -e OPERATE_USERNAME -e OPERATE_PASSWORD \
  ghcr.io/miragon/operate process-instance list --max-results 10
docker run --rm -e OPERATE_URL -e OPERATE_TOKEN ghcr.io/miragon/operate task list

# Files of the current directory (deployments, --out-file): mount it at /work, the working
# directory of the image, and run as your own user so written files belong to you
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -e OPERATE_URL \
  ghcr.io/miragon/operate deployment create invoice.bpmn

# Profiles of your config file (mode 0600, hence --user), stdin with -i, tables with -t
docker run --rm -it --user "$(id -u):$(id -g)" -v "$HOME/.config/operate:/config:ro" \
  -e OPERATE_CONFIG=/config/config.json ghcr.io/miragon/operate --profile prod status
```

`operate auth login` listens on `127.0.0.1` inside the container, which a browser outside cannot
reach: in containers use Basic auth or a bearer token (`OPERATE_TOKEN`). Each image carries an
SBOM and SLSA provenance (`docker buildx imagetools inspect ghcr.io/miragon/operate:<version>
--format '{{ json .SBOM }}'`), and `gh attestation verify oci://ghcr.io/miragon/operate:<version>
--repo Miragon/operate` verifies where it was built.

## Compatibility

`operate` targets the Camunda 7 REST API as implemented by:

| Engine    | Tested in CI with                         |
| --------- | ----------------------------------------- |
| Operaton  | `operaton/operaton:2.1.5`                 |
| CIB seven | `cibseven/cibseven:run-2.2.0`             |
| Camunda 7 | `camunda/camunda-bpm-platform:run-7.24.0` |

Commands for features an engine does not offer fail with the engine's error. Property names that
differ between the engines are both accepted (`operatonFormRef` for Operaton, `camundaFormRef` for
Camunda 7 and CIB seven). Camunda 8 is not supported (it has a different API).

## Shell completion

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
