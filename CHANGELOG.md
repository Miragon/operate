# Changelog

## [0.7.0](https://github.com/Miragon/operate/compare/v0.6.0...v0.7.0) (2026-10-14)


### ⚠ BREAKING CHANGES

* `--auth-token-command`, `auth.tokenCommand` (also `config set --auth-token-command`) and `operate config trust|untrust` are removed: export OPERATE_TOKEN_COMMAND instead. A config file with auth.tokenCommand and a project file with a credential or a variable named for one (tokenEnv, passwordEnv, clientSecretEnv) are refused.

### Features

* take the token command only from OPERATE_TOKEN_COMMAND and drop project file trust ([#32](https://github.com/Miragon/operate/issues/32)) ([6e6a88c](https://github.com/Miragon/operate/commit/6e6a88c1655d7df4c43e266e196deaa1620b87cc))

## [0.6.0](https://github.com/Miragon/operate/compare/v0.5.0...v0.6.0) (2026-10-14)


### Features

* fetch bearer tokens with a command and share profiles in a project file ([#30](https://github.com/Miragon/operate/issues/30)) ([7094f70](https://github.com/Miragon/operate/commit/7094f7066d844adeffa8038769a67f6d43975eb6)), closes [#28](https://github.com/Miragon/operate/issues/28) [#29](https://github.com/Miragon/operate/issues/29)
* publish standalone binaries and a container image ([#21](https://github.com/Miragon/operate/issues/21)) ([796f1d9](https://github.com/Miragon/operate/commit/796f1d91726e17017c958273a08221b3f807ad9e))
* split the agent guide into topics ([#23](https://github.com/Miragon/operate/issues/23)) ([b057b76](https://github.com/Miragon/operate/commit/b057b765bfe42ad685478ba3d82fd9937e7b5ea5))


### Bug Fixes

* guard secret-looking env names and case-colliding token caches ([#19](https://github.com/Miragon/operate/issues/19)) ([ce6e665](https://github.com/Miragon/operate/commit/ce6e665aa4812685e555cb6ce04aa1295aa00e21))
* make wait and --wait reliable when the process tree changes during a poll ([#22](https://github.com/Miragon/operate/issues/22)) ([157d2e3](https://github.com/Miragon/operate/commit/157d2e33ff7754d1cb22d16d78dac140ba9a8b2d))


### Documentation

* shorten the README, move the reference to docs/ and add community files ([#27](https://github.com/Miragon/operate/issues/27)) ([f7f538e](https://github.com/Miragon/operate/commit/f7f538e1970171aafd5269672e849c4b49fdd8fe))

## [0.5.0](https://github.com/Miragon/operate/compare/v0.4.0...v0.5.0) (2026-10-11)


### Features

* add bearer token authentication ([77e000d](https://github.com/Miragon/operate/commit/77e000da0ec8d9c45a7a44990eb73417c827be93))
* add bearer token authentication ([990c707](https://github.com/Miragon/operate/commit/990c70743b5dccec69543f3b3d7454180bda4ca4))
* add Claude Code plugin marketplace with the operate plugin ([85a67ea](https://github.com/Miragon/operate/commit/85a67ea0014d405f5c1f2c39812e4fe2a468edb0))
* add Claude Code plugin marketplace with the operate plugin ([6c4b7a8](https://github.com/Miragon/operate/commit/6c4b7a893cfbbf651f23215fe610b9e8e5c7a707))


### Documentation

* restore the config show example in the agent guide ([95c258e](https://github.com/Miragon/operate/commit/95c258e79aedc22dda97b1f094c996323c066f71))
* restore the config show example in the agent guide ([3112a9e](https://github.com/Miragon/operate/commit/3112a9ebf04cb7dd4de0b7667eb53ec1fad5f0f7))

## [0.4.0](https://github.com/Miragon/operate/compare/v0.3.0...v0.4.0) (2026-10-10)


### Features

* add workflow commands and shell completion ([8a5a05b](https://github.com/Miragon/operate/commit/8a5a05b1a6b676b852624272385497d45d454f96))

## [0.3.0](https://github.com/Miragon/operate/compare/v0.2.0...v0.3.0) (2026-10-10)


### Features

* add OAuth 2.0 authorization code flow with PKCE ([88e466b](https://github.com/Miragon/operate/commit/88e466b2d4de4229c1a48b69d421dea6bb0048d2))
* add OAuth 2.0 authorization code flow with PKCE ([69f34b7](https://github.com/Miragon/operate/commit/69f34b7ffb5089e4b07a28eb816c1d6c89bd0838)), closes [#2](https://github.com/Miragon/operate/issues/2)

## [0.2.0](https://github.com/Miragon/operate/compare/v0.1.0...v0.2.0) (2026-10-09)


### Features

* add HTTP Basic authentication ([f9f2c11](https://github.com/Miragon/operate/commit/f9f2c1187315a47a0037c77de7f5ffeece5dd5cc))
* add HTTP Basic authentication ([39f9bf9](https://github.com/Miragon/operate/commit/39f9bf9f0be7305ae81dcf7b374cf6babf9ee9bb)), closes [#1](https://github.com/Miragon/operate/issues/1)

## 0.1.0 (2026-10-09)


### Features

* operate CLI for the Camunda 7 REST API ([079a275](https://github.com/Miragon/operate/commit/079a275d03f20dbf623a7ae1cdb34cb135265a04))
