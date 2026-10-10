/**
 * The OAuth part of `operate config set|delete` (design §16.2.2): the `--oauth-*` options, the
 * secrets `config set` reads from stdin, the notices on stderr after `config set` (also those of
 * Basic auth and bearer tokens) and the removal of a deleted profile's token cache file, under
 * the cache lock so that a refresh in flight cannot write it back.
 */

import type { Command } from 'commander';
import { removeCache, withCacheLock } from '../../auth/oauth/cache.js';
import {
  FAMILY_NAMES,
  replacedAuthorization,
  replacedFamily,
  SETTING_NAMES,
  settingsFamily,
  storedFamily,
} from '../../config/auth-edit.js';
import type { ProfileChanges } from '../../config/edit.js';
import { profileTokenFile, tokenDirectory, tokenPath } from '../../config/file.js';
import type { OAuthChanges } from '../../config/oauth-edit.js';
import type { Env } from '../../config/pick.js';
import { DEFAULT_TIMEOUT_MS, type Profile } from '../../config/types.js';
import { usageError } from '../../errors.js';
import { compact } from '../../util.js';
import type { CliContext } from '../context.js';
import { readStdinPassword, type StdinSecret } from '../stdin-password.js';
import { bearerWarnings, STORED_TOKEN } from './config-bearer.js';

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

/** The secrets `config set` read from stdin; each is stored literally. */
export interface SetSecrets {
  readonly password?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly token?: string | undefined;
}

/** The stdin options of `config set`, by the flag that reads them. */
const STDIN_OPTIONS = [
  ['authPasswordStdin', '--auth-password-stdin'],
  ['oauthClientSecretStdin', '--oauth-client-secret-stdin'],
  ['authTokenStdin', '--auth-token-stdin'],
] as const;

/**
 * The secrets `config set` reads from stdin: a Basic auth password, an OAuth client secret or a
 * bearer token; two of them would both read stdin.
 */
export async function readSetSecrets(command: Command, context: CliContext): Promise<SetSecrets> {
  const options = command.opts<Partial<Record<(typeof STDIN_OPTIONS)[number][0], boolean>>>();
  const given = STDIN_OPTIONS.filter(([key]) => options[key] === true).map(([, flag]) => flag);
  if (given.length > 1) {
    throw usageError(
      `${given.join(' and ')} both read stdin`,
      'A profile uses Basic auth, OAuth or a bearer token; give the option of one of them.',
    );
  }
  const { runtime } = context;
  const read = async (key: (typeof STDIN_OPTIONS)[number][0], secret?: StdinSecret) =>
    options[key] === true ? await readStdinPassword(runtime, secret) : undefined;
  return {
    password: await read('authPasswordStdin'),
    clientSecret: await read('oauthClientSecretStdin', CLIENT_SECRET),
    token: await read('authTokenStdin', STORED_TOKEN),
  };
}

/** What `config set` did that deserves a note on stderr. */
export interface SetOutcome {
  readonly name: string;
  readonly path: string;
  readonly before: Profile | undefined;
  readonly after: Profile | undefined;
  /** What was read from stdin (and stored literally). */
  readonly secrets: SetSecrets;
  /** The variable names given to the `--*-env` options. */
  readonly changes: Pick<
    ProfileChanges,
    'authPasswordEnv' | 'oauthClientSecretEnv' | 'authTokenEnv'
  >;
  readonly env: Env;
}

function familyNotice(outcome: SetOutcome): string | undefined {
  const replaced = replacedFamily(outcome.before?.auth, outcome.after?.auth);
  const by = settingsFamily(outcome.after?.auth);
  if (replaced === undefined || by === undefined) return undefined;
  const logout =
    replaced === 'oauth'
      ? ` \`operate auth logout --profile ${outcome.name}\` removes its login.`
      : '';
  return `Notice: removed the ${SETTING_NAMES[replaced]} settings of the profile; ${FAMILY_NAMES[by]} replaces them.${logout}`;
}

function headerNotice(outcome: SetOutcome): string | undefined {
  const family = storedFamily(outcome.after?.auth);
  if (family === undefined || !replacedAuthorization(outcome.before, outcome.after)) {
    return undefined;
  }
  return `Notice: removed the Authorization header of the profile; ${FAMILY_NAMES[family]} replaces it.`;
}

/** True when `variable` was given and names a variable without a non-blank value in `env`. */
function unsetVariable(env: Env, variable: string | undefined): boolean {
  return variable !== undefined && (env[variable.trim()] ?? '').trim() === '';
}

/**
 * Notes on stderr after `config set`. An unset variable is not named: given by mistake, the
 * "name" may be the secret itself.
 */
export function setNotices(outcome: SetOutcome): string[] {
  const { secrets, changes, env, path } = outcome;
  return [
    familyNotice(outcome),
    headerNotice(outcome),
    secrets.password !== undefined
      ? `Warning: the password is stored in plain text in ${path} (mode 0600). Prefer --auth-password-env <VAR>, which stores only the name of an environment variable.`
      : undefined,
    unsetVariable(env, changes.authPasswordEnv)
      ? 'Warning: the variable named by --auth-password-env is not set in this environment. Pass the name of a variable that holds the password (e.g. CAMUNDA_PASSWORD), never the password itself; commands read it when they run.'
      : undefined,
    secrets.clientSecret !== undefined
      ? `Warning: the client secret is stored in plain text in ${path} (mode 0600). Prefer --oauth-client-secret-env <VAR>.`
      : undefined,
    unsetVariable(env, changes.oauthClientSecretEnv)
      ? 'Warning: the variable named by --oauth-client-secret-env is not set in this environment. Pass the name of a variable that holds the client secret (e.g. OPERATE_CLIENT_SECRET), never the secret itself; commands read it when they run.'
      : undefined,
    ...bearerWarnings(path, secrets.token !== undefined, unsetVariable(env, changes.authTokenEnv)),
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
