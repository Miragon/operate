/**
 * The bearer token part of `operate config set` (design §18): `--auth-token-env <VAR>`
 * (recommended: only the name of the variable is stored) and `--auth-token-stdin` (the token
 * itself, in plain text in the 0600 file), and the warnings after storing them.
 */

import type { Command } from 'commander';
import { checkTokenEnv } from '../../config/bearer.js';
import type { BearerChanges } from '../../config/bearer-edit.js';
import type { Env } from '../../config/pick.js';
import { compact } from '../../util.js';
import type { StdinSecret } from '../stdin-password.js';

/** `config set --auth-token-stdin` stores what it reads. */
export const STORED_TOKEN: StdinSecret = {
  flag: '--auth-token-stdin',
  noun: 'token',
  example: `printf '%s\\n' "$TOKEN" | operate config set <profile> --auth bearer --auth-token-stdin`,
};

export function addBearerOptions(command: Command): Command {
  return command
    .option(
      '--auth-token-env <VAR>',
      'Name of the environment variable that holds the bearer token (recommended)',
    )
    .option(
      '--auth-token-stdin',
      'Store the bearer token read from the first line of stdin (plain text in the file; discouraged)',
    );
}

/**
 * The bearer changes of `config set`; `token` is what --auth-token-stdin read. A variable name
 * that is unset and unusual is refused first (it may be the token, see `checkTokenEnv`).
 */
export function bearerChanges(
  command: Command,
  token: string | undefined,
  env: Env,
): BearerChanges {
  const { authTokenEnv } = command.opts<{ readonly authTokenEnv?: string }>();
  if (authTokenEnv !== undefined) checkTokenEnv(authTokenEnv, env);
  return compact({ authTokenEnv, authToken: token });
}

/**
 * Warnings after storing a token: a literal one is plain text in the file; an unset variable is
 * not named (given by mistake, the "name" may be the token itself).
 */
export function bearerWarnings(path: string, stored: boolean, unsetVariable: boolean): string[] {
  return [
    stored
      ? `Warning: the bearer token is stored in plain text in ${path} (mode 0600). Prefer --auth-token-env <VAR>, which stores only the name of an environment variable.`
      : undefined,
    unsetVariable
      ? 'Warning: the variable named by --auth-token-env is not set in this environment. Pass the name of a variable that holds the token (e.g. CI_ENGINE_TOKEN), never the token itself; commands read it when they run.'
      : undefined,
  ].filter((warning) => warning !== undefined);
}
