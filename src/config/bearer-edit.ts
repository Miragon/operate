/**
 * `operate config set|unset` changes of a profile's bearer token (design §18, §23): the name of
 * the variable that holds the token (recommended), the command that prints it, or the token
 * itself, read from stdin. Each replaces the others; `config unset <profile> token` (or
 * `tokenEnv`, `tokenCommand`) removes the token in any form.
 */

import { compact } from '../util.js';
import { normalizeToken, validateTokenCommand } from './bearer.js';
import { configError } from './config-error.js';
import type { BEARER_AUTH_KEYS, ProfileAuth } from './types.js';
import { TOKEN_VARIABLE, validateVariableName } from './variable.js';

export interface BearerChanges {
  /** Name of the variable holding the token; replaces a stored token. */
  readonly authTokenEnv?: string;
  /** Literal token from stdin (discouraged: stored in plain text); replaces a stored tokenEnv. */
  readonly authToken?: string;
  /** Command line that prints the token; replaces a stored token or tokenEnv. */
  readonly authTokenCommand?: string;
}

type BearerKey = (typeof BEARER_AUTH_KEYS)[number];

/** True when a bearer token option was given. */
export function hasBearerOptions(changes: BearerChanges): boolean {
  return (
    changes.authTokenEnv !== undefined ||
    changes.authToken !== undefined ||
    changes.authTokenCommand !== undefined
  );
}

const OPTION_NAMES = {
  authTokenEnv: '--auth-token-env',
  authToken: '--auth-token-stdin',
  authTokenCommand: '--auth-token-command',
} as const;

/** The bearer keys of the changed auth object: stored values, replaced by the given option. */
export function changedBearerKeys(
  existing: ProfileAuth | undefined,
  changes: BearerChanges,
): Pick<ProfileAuth, BearerKey> {
  const { authTokenEnv, authToken, authTokenCommand } = changes;
  const given = (Object.keys(OPTION_NAMES) as (keyof typeof OPTION_NAMES)[]).filter(
    (key) => changes[key] !== undefined,
  );
  if (given.length > 1) {
    throw configError(
      `${given.map((key) => OPTION_NAMES[key]).join(' and ')} exclude each other`,
      'Store the name of the environment variable that holds the token (recommended), the command that prints it, or the token itself.',
    );
  }
  if (authTokenEnv !== undefined) {
    return { tokenEnv: validateVariableName(authTokenEnv, TOKEN_VARIABLE) };
  }
  if (authTokenCommand !== undefined) {
    return { tokenCommand: validateTokenCommand(authTokenCommand, '--auth-token-command') };
  }
  if (authToken !== undefined) return { token: normalizeToken(authToken, '--auth-token-stdin') };
  return compact({
    tokenEnv: existing?.tokenEnv,
    token: existing?.token,
    tokenCommand: existing?.tokenCommand,
  });
}

/** The key names of `config unset` for the bearer token, for help texts and hints. */
export const BEARER_UNSET_KEYS: readonly BearerKey[] = ['token', 'tokenEnv', 'tokenCommand'];

/** The auth keys a bearer key name of `config unset` removes (`auth.` prefix allowed), if any. */
export function bearerUnsetKeys(key: string): readonly BearerKey[] | undefined {
  const bare = key.startsWith('auth.') ? key.slice('auth.'.length) : key;
  return (BEARER_UNSET_KEYS as readonly string[]).includes(bare) ? BEARER_UNSET_KEYS : undefined;
}
