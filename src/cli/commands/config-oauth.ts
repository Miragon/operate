/**
 * The OAuth part of `operate config set|delete` (design §16.2.2): the `--oauth-*` options, the
 * client secret from stdin, the notices on stderr after `config set` (also those of Basic auth)
 * and the removal of a deleted profile's token cache file, under the cache lock so that a
 * refresh in flight cannot write it back.
 */

import type { Command } from 'commander';
import { removeCache, withCacheLock } from '../../auth/oauth/cache.js';
import { replacedAuthorization, replacedFamily } from '../../config/auth-edit.js';
import { profileTokenFile, tokenDirectory, tokenPath } from '../../config/file.js';
import type { OAuthChanges } from '../../config/oauth-edit.js';
import { DEFAULT_TIMEOUT_MS, type Profile } from '../../config/types.js';
import { usageError } from '../../errors.js';
import { compact } from '../../util.js';
import type { CliContext } from '../context.js';
import { readStdinPassword, type StdinSecret } from '../stdin-password.js';

interface OAuthSetOptions {
  readonly oauthIssuer?: string;
  readonly oauthAuthorizationEndpoint?: string;
  readonly oauthTokenEndpoint?: string;
  readonly oauthClientId?: string;
  readonly oauthClientSecretEnv?: string;
  readonly oauthClientSecretStdin?: boolean;
  readonly oauthScopes?: string;
  readonly oauthAudience?: string;
  readonly oauthRedirectPort?: string;
}

const CLIENT_SECRET: StdinSecret = {
  flag: '--oauth-client-secret-stdin',
  noun: 'client secret',
  example: `printf '%s\\n' "$CLIENT_SECRET" | operate config set <profile> --oauth-client-secret-stdin`,
};

/** The `--oauth-*` options of `config set`, in help order. */
const OAUTH_OPTIONS: readonly (readonly [flags: string, description: string])[] = [
  ['--oauth-issuer <url>', 'OAuth issuer; the endpoints are discovered from it'],
  [
    '--oauth-authorization-endpoint <url>',
    'Authorization endpoint (with --oauth-token-endpoint, instead of discovery)',
  ],
  ['--oauth-token-endpoint <url>', 'Token endpoint (with --oauth-authorization-endpoint)'],
  ['--oauth-client-id <id>', 'OAuth client id'],
  [
    '--oauth-client-secret-env <VAR>',
    'Name of the environment variable that holds the client secret of a confidential client',
  ],
  [
    '--oauth-client-secret-stdin',
    'Store the client secret read from the first line of stdin (plain text; discouraged)',
  ],
  [
    '--oauth-scopes <scopes>',
    'Scopes separated by spaces or commas, default "openid offline_access"; \'\' for none',
  ],
  ['--oauth-audience <audience>', 'Audience parameter of the authorization request'],
  [
    '--oauth-redirect-port <port>',
    'Port of the login callback on 127.0.0.1, default 0 (any free port)',
  ],
];

export function addOAuthOptions(command: Command): Command {
  for (const [flags, description] of OAUTH_OPTIONS) command.option(flags, description);
  return command;
}

/** The OAuth changes of `config set`; `clientSecret` is what --oauth-client-secret-stdin read. */
export function oauthChanges(command: Command, clientSecret: string | undefined): OAuthChanges {
  const options = command.opts<OAuthSetOptions>();
  return compact({
    oauthIssuer: options.oauthIssuer,
    oauthAuthorizationEndpoint: options.oauthAuthorizationEndpoint,
    oauthTokenEndpoint: options.oauthTokenEndpoint,
    oauthClientId: options.oauthClientId,
    oauthClientSecretEnv: options.oauthClientSecretEnv,
    oauthClientSecret: clientSecret,
    oauthScopes: options.oauthScopes,
    oauthAudience: options.oauthAudience,
    oauthRedirectPort: options.oauthRedirectPort,
  });
}

/** The secrets `config set` reads from stdin: a Basic auth password or an OAuth client secret. */
export async function readSetSecrets(command: Command, context: CliContext) {
  const { authPasswordStdin, oauthClientSecretStdin } = command.opts<
    OAuthSetOptions & { readonly authPasswordStdin?: boolean }
  >();
  if (authPasswordStdin === true && oauthClientSecretStdin === true) {
    throw usageError(
      '--auth-password-stdin and --oauth-client-secret-stdin both read stdin',
      'A profile uses Basic auth or OAuth; give the option of one of them.',
    );
  }
  const { runtime } = context;
  return {
    password: authPasswordStdin === true ? await readStdinPassword(runtime) : undefined,
    clientSecret:
      oauthClientSecretStdin === true ? await readStdinPassword(runtime, CLIENT_SECRET) : undefined,
  };
}

/** What `config set` did that deserves a note on stderr. */
export interface SetOutcome {
  readonly name: string;
  readonly path: string;
  readonly before: Profile | undefined;
  readonly after: Profile | undefined;
  /** A literal password was stored. */
  readonly storedPassword: boolean;
  /** The variable named by --auth-password-env is not set in this environment. */
  readonly unsetVariable: boolean;
  /** A literal client secret was stored. */
  readonly storedClientSecret: boolean;
  /** The variable named by --oauth-client-secret-env is not set in this environment. */
  readonly unsetSecretVariable: boolean;
}

function familyNotice(outcome: SetOutcome): string | undefined {
  const replaced = replacedFamily(outcome.before?.auth, outcome.after?.auth);
  if (replaced === 'basic') {
    return 'Notice: removed the Basic auth settings of the profile; OAuth replaces them.';
  }
  return replaced === 'oauth'
    ? `Notice: removed the OAuth settings of the profile; Basic auth replaces them. \`operate auth logout --profile ${outcome.name}\` removes its login.`
    : undefined;
}

function headerNotice(outcome: SetOutcome): string | undefined {
  if (!replacedAuthorization(outcome.before, outcome.after)) return undefined;
  const family = outcome.after?.auth?.type === 'oauth' ? 'OAuth' : 'Basic auth';
  return `Notice: removed the Authorization header of the profile; ${family} replaces it.`;
}

/**
 * Notes on stderr after `config set`. An unset variable is not named: given by mistake, the
 * "name" may be the secret itself.
 */
export function setNotices(outcome: SetOutcome): string[] {
  return [
    familyNotice(outcome),
    headerNotice(outcome),
    outcome.storedPassword
      ? `Warning: the password is stored in plain text in ${outcome.path} (mode 0600). Prefer --auth-password-env <VAR>, which stores only the name of an environment variable.`
      : undefined,
    outcome.unsetVariable
      ? 'Warning: the variable named by --auth-password-env is not set in this environment. Pass the name of a variable that holds the password (e.g. CAMUNDA_PASSWORD), never the password itself; commands read it when they run.'
      : undefined,
    outcome.storedClientSecret
      ? `Warning: the client secret is stored in plain text in ${outcome.path} (mode 0600). Prefer --oauth-client-secret-env <VAR>.`
      : undefined,
    outcome.unsetSecretVariable
      ? 'Warning: the variable named by --oauth-client-secret-env is not set in this environment. Pass the name of a variable that holds the client secret (e.g. OPERATE_CLIENT_SECRET), never the secret itself; commands read it when they run.'
      : undefined,
    outcome.after?.auth?.type === 'oauth'
      ? `Next: run \`operate auth login --profile ${outcome.name}\` in a terminal to log in.`
      : undefined,
  ].filter((notice) => notice !== undefined);
}

/**
 * `config delete`: removes the token cache file of the profile, if any, holding the cache lock.
 * The login is not revoked (`operate auth logout` does that).
 */
export async function removeLogin(name: string, context: CliContext): Promise<void> {
  const { runtime } = context;
  const tokenDir = tokenDirectory(runtime.env, runtime);
  const path = tokenPath(tokenDir, profileTokenFile(name), runtime.platform);
  if (!(await runtime.fs.exists(path))) return;
  const deps = {
    fs: runtime.fs,
    tokenDir,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    withLock: <T>(lock: string, holdMs: number, action: () => Promise<T>) =>
      runtime.withLock(lock, holdMs, action),
  };
  if (await withCacheLock(path, deps, () => removeCache(path, deps))) {
    runtime.stderr.write(
      `Removed the OAuth login of profile "${name}" (${path}); it was not revoked.\n`,
    );
  }
}
