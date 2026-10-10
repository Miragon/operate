/**
 * Resolves a bearer token obtained outside operate (design §18). The token: `--auth-token-stdin` >
 * OPERATE_TOKEN > the variable named by the profile's auth.tokenEnv (only read when no higher
 * source has a token) > the profile's auth.token. Without an auth type anywhere, a token from the
 * flag or the environment selects bearer auth, like a username selects Basic auth. Pure; messages
 * never show a token.
 */

import { OperateError } from '../errors.js';
import { compact } from '../util.js';
import { isConventionalVariable, normalizeToken } from './bearer.js';
import { configError } from './config-error.js';
import type { Env } from './pick.js';
import {
  type AuthType,
  type BearerAuthConfig,
  type ConfigFlags,
  ENV,
  type ProfileAuth,
  type SelectedProfile,
  type Source,
  type UnusedToken,
} from './types.js';

export interface BearerContext {
  readonly flags: ConfigFlags;
  readonly env: Env;
  readonly selected: SelectedProfile;
  /** `operate auth` commands have no `--auth` option: hints suggest OPERATE_AUTH instead. */
  readonly authCommand?: boolean;
}

/** A token as found: not yet normalized; `origin` names the source, `variable` its variable. */
interface FoundToken {
  readonly value: string;
  readonly source: Source;
  readonly origin: string;
  readonly variable?: string;
}

const STDIN_FLAG = '--auth-token-stdin';

/** A token value: blank counts as unset. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** The token of `--auth-token-stdin` or OPERATE_TOKEN: these select bearer auth without a type. */
export function givenToken({ flags, env }: BearerContext): FoundToken | undefined {
  const fromFlag = present(flags.authToken);
  if (fromFlag !== undefined) return { value: fromFlag, source: 'flag', origin: STDIN_FLAG };
  const fromEnv = present(env[ENV.token]);
  return fromEnv === undefined
    ? undefined
    : { value: fromEnv, source: 'env', origin: ENV.token, variable: ENV.token };
}

/**
 * The error for an unset auth.tokenEnv variable. Its name is repeated only in the usual form: a
 * name like `ghp_...` may be the token itself, stored by mistake.
 */
function unsetVariable(variable: string, name: string) {
  const another = `name another variable with \`operate config set ${name} --auth-token-env <VAR>\``;
  if (isConventionalVariable(variable)) {
    return configError(
      `The token variable ${variable} (auth.tokenEnv of profile "${name}") is not set or empty`,
      `Export it, e.g. export ${variable}=<token>, or ${another}.`,
    );
  }
  return configError(
    `The token variable named by auth.tokenEnv of profile "${name}" is not set or empty`,
    `Its name is not in the usual upper-case form, so it is not repeated: it may be a token stored by mistake. Check auth.tokenEnv in the config file (\`operate config path\`), or ${another}.`,
  );
}

/** The variable named by auth.tokenEnv; it must be set. */
function tokenFromVariable(variable: string, name: string, env: Env): FoundToken {
  const value = present(env[variable]);
  if (value === undefined) throw unsetVariable(variable, name);
  return {
    value,
    source: 'profile',
    origin: `${variable} (auth.tokenEnv of profile "${name}")`,
    variable,
  };
}

function storedToken({ env, selected }: BearerContext): FoundToken | undefined {
  if (selected.profile === undefined) return undefined;
  const { name, profile } = selected;
  const auth: ProfileAuth = profile.auth ?? {};
  if (auth.tokenEnv !== undefined) return tokenFromVariable(auth.tokenEnv, name, env);
  const value = present(auth.token);
  return value === undefined
    ? undefined
    : { value, source: 'profile', origin: `auth.token of profile "${name}"` };
}

function missingToken(selectedBy: string, selected: SelectedProfile) {
  const profile =
    selected.profile === undefined
      ? 'a profile (none is selected)'
      : `the auth.tokenEnv and auth.token of profile "${selected.name}"`;
  const name = selected.name ?? '<profile>';
  return configError(
    'Bearer auth is selected but the token is missing',
    `Bearer auth was selected by ${selectedBy}. Looked up the token in ${STDIN_FLAG}, ${ENV.token} and ${profile}. Fetch a token with the tool that issues it (e.g. az account get-access-token, gcloud auth print-access-token) and export ${ENV.token}=<token>, pipe it into ${STDIN_FLAG}, or store the name of its variable with \`operate config set ${name} --auth bearer --auth-token-env <VAR>\`; --auth none switches bearer auth off.`,
  );
}

/** `--auth-password-stdin` with bearer auth: stdin would be read for nothing. */
function refuseStdinPassword(flags: ConfigFlags, selectedBy: string): void {
  if (present(flags.authPassword) === undefined) return;
  throw configError(
    `--auth-password-stdin reads a Basic auth password, but bearer auth is selected by ${selectedBy}`,
    `Drop --auth-password-stdin: bearer auth sends a token (${STDIN_FLAG} or ${ENV.token}), no password.`,
  );
}

/** The bearer token; `selectedBy` names what selected bearer auth (`--auth bearer`). */
export function resolveBearer(context: BearerContext, selectedBy: string): BearerAuthConfig {
  refuseStdinPassword(context.flags, selectedBy);
  const found = givenToken(context) ?? storedToken(context);
  if (found === undefined) throw missingToken(selectedBy, context.selected);
  return {
    type: 'bearer',
    token: normalizeToken(found.value, found.origin),
    source: found.source,
    origin: found.origin,
    ...compact({ variable: found.variable, profile: context.selected.name }),
  };
}

const FAMILY: Readonly<Record<Exclude<AuthType, 'bearer'>, string>> = {
  none: 'none',
  basic: 'Basic auth',
  oauth: 'OAuth',
};

/**
 * A token of `--auth-token-stdin` or OPERATE_TOKEN next to an explicit type that does not use it.
 * The environment variable is ignored (and reported by `config show`); `--auth-token-stdin`,
 * which reads stdin for nothing, is a CONFIG error unless the type is none (switched off).
 */
export function unusedToken(
  context: BearerContext,
  type: Exclude<AuthType, 'bearer'>,
  typeLabel: string,
): UnusedToken | undefined {
  const token = givenToken(context);
  if (token === undefined) return undefined;
  if (token.source === 'flag' && type !== 'none') {
    const select = context.authCommand === true ? `${ENV.auth}=bearer` : '--auth bearer';
    throw configError(
      `${STDIN_FLAG} reads a bearer token, but ${FAMILY[type]} is selected by ${typeLabel}`,
      `Drop ${STDIN_FLAG}, or select bearer auth with ${select}.`,
    );
  }
  const reason =
    type === 'none'
      ? `bearer auth is switched off by ${typeLabel}`
      : `${FAMILY[type]} is selected by ${typeLabel}`;
  return { value: token.value, source: token.source, reason };
}

/**
 * Basic auth and bearer auth both selected without a type (a username or
 * `--auth-password-stdin`, and a token): CONFIG, the user must choose.
 */
export function inferenceConflict(basicBy: string, token: FoundToken) {
  return configError(
    'Both Basic auth and a bearer token are configured, but no auth type says which one to use',
    `${basicBy} selects Basic auth, a bearer token (from ${token.origin}) selects bearer auth. Choose one explicitly: --auth basic or --auth bearer (also OPERATE_AUTH or the auth.type of the profile), or unset the other.`,
  );
}

/**
 * `A bearer token is set (from OPERATE_TOKEN) but not used: <reason>; send it with --auth bearer
 * or OPERATE_AUTH=bearer.`, for hints of failures the type that won causes (also LOGIN_REQUIRED
 * and 401 answers, src/auth/note.ts).
 */
export function unusedTokenNote(unused: UnusedToken, authCommand?: boolean): string {
  const origin = unused.source === 'flag' ? STDIN_FLAG : ENV.token;
  const select = authCommand === true ? 'use it with' : 'send it with --auth bearer or';
  return `A bearer token is set (from ${origin}) but not used: ${unused.reason}; ${select} ${ENV.auth}=bearer.`;
}

/**
 * Runs `resolve`; a CONFIG error of it (a Basic profile's password variable is not set, OAuth
 * settings are missing, ...) also carries `note` (`unusedTokenNote`), so a user who exported
 * OPERATE_TOKEN next to a profile with another type is not left guessing.
 */
export function mentioningUnused<T>(note: string | undefined, resolve: () => T): T {
  try {
    return resolve();
  } catch (error) {
    if (note === undefined || !(error instanceof OperateError) || error.code !== 'CONFIG') {
      throw error;
    }
    const { hint } = error.details;
    throw new OperateError('CONFIG', error.message, {
      ...error.details,
      hint: hint === undefined ? note : `${hint} ${note}`,
    });
  }
}
