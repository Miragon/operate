/**
 * Resolves the authentication (design §15). Type: `--auth` > OPERATE_AUTH > the profile's
 * auth.type; without a type anywhere, a username from any source or `--auth-password-stdin`
 * selects Basic auth, otherwise none. Username: `--auth-user` > OPERATE_USERNAME > the profile's auth.username. Password:
 * `--auth-password-stdin` > OPERATE_PASSWORD > the variable named by the profile's auth.passwordEnv
 * > the profile's auth.password. Basic auth needs both values; errors never show a secret.
 */

import type { OperateError } from '../errors.js';
import { validateAuthType, validatePassword, validateUsername } from './auth.js';
import { configError } from './config-error.js';
import { type Env, nonEmpty, pick } from './pick.js';
import {
  type AuthConfig,
  type AuthType,
  type ConfigFlags,
  ENV,
  type NoAuthConfig,
  type ProfileAuth,
  type SelectedProfile,
  type Source,
} from './types.js';

interface Context {
  readonly flags: ConfigFlags;
  readonly env: Env;
  readonly selected: SelectedProfile;
}

/** A value, its source and where exactly it came from, for messages (which never show values). */
interface Found<T> {
  readonly value: T;
  readonly source: Source;
  readonly label: string;
}

export interface ResolvedAuth {
  readonly auth: AuthConfig;
  /** Where the type came from; for a type implied by a username, the username's source. */
  readonly source: Source;
}

type Credential = 'username' | 'password';

/** A password value: blank counts as unset, other values are kept exactly (spaces included). */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

function found<T>(value: T | undefined, source: Source, label: string): Found<T> | undefined {
  return value === undefined ? undefined : { value, source, label };
}

/** A value of the selected profile's auth object; `label` gets the profile name. */
function fromProfile<T>(
  selected: SelectedProfile,
  read: (auth: ProfileAuth) => T | undefined,
  label: (profile: string) => string,
): Found<T> | undefined {
  if (selected.profile === undefined) return undefined;
  return found(read(selected.profile.auth ?? {}), 'profile', label(`profile "${selected.name}"`));
}

/** The variable named by auth.passwordEnv; it must be set (never quoted in errors). */
function passwordFromEnv(variable: string, name: string, env: Env): string {
  const value = present(env[variable]);
  if (value !== undefined) return value;
  throw configError(
    `The password variable ${variable} (auth.passwordEnv of profile "${name}") is not set or empty`,
    `Export it, e.g. export ${variable}=<password>, or name another variable with \`operate config set ${name} --auth-password-env <VAR>\`.`,
  );
}

/** The password of the profile: from the variable it names, else stored literally. */
function storedPassword({ env, selected }: Context): Found<string> | undefined {
  if (selected.profile === undefined) return undefined;
  const { name, profile } = selected;
  const variable = profile.auth?.passwordEnv;
  if (variable === undefined) {
    return found(present(profile.auth?.password), 'profile', `auth.password of profile "${name}"`);
  }
  const label = `from ${variable}, auth.passwordEnv of profile "${name}"`;
  return { value: passwordFromEnv(variable, name, env), source: 'profile', label };
}

/** Where the type was set (`--auth none`, `OPERATE_AUTH=basic`, ...), for messages. */
function typeLabel(source: Source, type: AuthType, profile: string | undefined): string {
  if (source === 'flag') return `--auth ${type}`;
  if (source === 'env') return `${ENV.auth}=${type}`;
  return `the auth.type of profile "${profile ?? ''}"`;
}

/** The explicit type; its label says where it was set. */
function pickType({ flags, env, selected }: Context): Found<AuthType> | undefined {
  const picked = pick(nonEmpty(flags.auth), nonEmpty(env[ENV.auth]), selected.profile?.auth?.type);
  if (picked.value === undefined) return undefined;
  const value = validateAuthType(picked.value);
  return { value, source: picked.source, label: typeLabel(picked.source, value, selected.name) };
}

function pickUsername({ flags, env, selected }: Context): Found<string> | undefined {
  return (
    found(nonEmpty(flags.authUser), 'flag', 'from --auth-user') ??
    found(nonEmpty(env[ENV.username]), 'env', `from ${ENV.username}`) ??
    fromProfile(
      selected,
      (auth) => nonEmpty(auth.username),
      (profile) => `auth.username of ${profile}`,
    )
  );
}

function pickPassword(context: Context): Found<string> | undefined {
  const { flags, env } = context;
  return (
    found(present(flags.authPassword), 'flag', 'from --auth-password-stdin') ??
    found(present(env[ENV.password]), 'env', `from ${ENV.password}`) ??
    storedPassword(context)
  );
}

/** The sources looked up for a value, for the error about missing credentials. */
function lookedUp(credential: Credential, selected: SelectedProfile): string {
  const flag = credential === 'username' ? '--auth-user' : '--auth-password-stdin';
  const keys = credential === 'username' ? 'auth.username' : 'auth.passwordEnv or auth.password';
  const profile =
    selected.profile === undefined
      ? 'a profile (none is selected)'
      : `the ${keys} of profile "${selected.name}"`;
  return `the ${credential} in ${flag}, ${ENV[credential]} and ${profile}`;
}

function missingError(missing: readonly Credential[], selectedBy: string, context: Context) {
  const values = missing.map((credential) => `the ${credential}`).join(' and ');
  const places = missing.map((credential) => lookedUp(credential, context.selected));
  return configError(
    `Basic auth is selected but ${values} ${missing.length > 1 ? 'are' : 'is'} missing`,
    `Basic auth was selected by ${selectedBy}. Looked up ${places.join('; ')}. Pipe the password into --auth-password-stdin, set ${ENV.username} and ${ENV.password}, or store them with \`operate config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>\`; --auth none switches Basic auth off.`,
  );
}

function basicAuth(
  username: Found<string> | undefined,
  selectedBy: string,
  context: Context,
): AuthConfig {
  const password = pickPassword(context);
  if (username === undefined || password === undefined) {
    const missing = (['username', 'password'] as const).filter(
      (credential) => (credential === 'username' ? username : password) === undefined,
    );
    throw missingError(missing, selectedBy, context);
  }
  return {
    type: 'basic',
    username: validateUsername(username.value, username.label),
    password: validatePassword(password.value, password.label),
    sources: { username: username.source, password: password.source },
  };
}

/**
 * Basic auth selected without a type: by a username (from any source), else by
 * `--auth-password-stdin`, which reads stdin for nothing else. The label names the source.
 */
function impliedType(
  username: Found<string> | undefined,
  flags: ConfigFlags,
): Found<AuthType> | undefined {
  if (username !== undefined) {
    const label = `a username (${username.label}) without an auth type`;
    return { value: 'basic', source: username.source, label };
  }
  return present(flags.authPassword) === undefined
    ? undefined
    : { value: 'basic', source: 'flag', label: '--auth-password-stdin without an auth type' };
}

/** Where a password is set that nothing uses (no username, no type); never reads a variable. */
function unusedPassword({ env, selected }: Context): string | undefined {
  if (present(env[ENV.password]) !== undefined) return `from ${ENV.password}`;
  if (selected.profile === undefined) return undefined;
  const { name, profile } = selected;
  if (profile.auth?.passwordEnv !== undefined) return `auth.passwordEnv of profile "${name}"`;
  return profile.auth?.password === undefined ? undefined : `auth.password of profile "${name}"`;
}

/** No credentials, and why when that may surprise: an explicit none, or an unused password. */
function withoutAuth(type: Found<AuthType> | undefined, context: Context): NoAuthConfig {
  if (type !== undefined) {
    return { type: 'none', off: `Basic auth is switched off by ${type.label}` };
  }
  const password = unusedPassword(context);
  return password === undefined
    ? { type: 'none' }
    : { type: 'none', off: `a password is set (${password}), but no username` };
}

export function resolveAuth(flags: ConfigFlags, env: Env, selected: SelectedProfile): ResolvedAuth {
  const context: Context = { flags, env, selected };
  const username = pickUsername(context);
  const type = pickType(context) ?? impliedType(username, flags);
  if (type?.value !== 'basic') {
    return { auth: withoutAuth(type, context), source: type?.source ?? 'default' };
  }
  return { auth: basicAuth(username, type.label, context), source: type.source };
}

function headerOrigin(source: Source, profile: string | undefined): string {
  if (source === 'flag') return 'given with -H/--header';
  if (source === 'env') return `from ${ENV.headers}`;
  const name = profile ?? '<profile>';
  return `from the headers of profile "${name}"; \`operate config unset ${name} headers\` removes them`;
}

/**
 * Basic auth and an explicit Authorization header (`-H`, OPERATE_HEADERS, profile headers) would
 * fight over the same header: a CONFIG error asks to drop one.
 */
export function authorizationConflict(
  auth: AuthConfig,
  authorization: Source | undefined,
  profile: string | undefined,
): OperateError | undefined {
  if (auth.type !== 'basic' || authorization === undefined) return undefined;
  return configError(
    'Basic auth and an Authorization header are both configured',
    `Drop one: remove the Authorization header (${headerOrigin(authorization, profile)}), or switch Basic auth off with --auth none, ${ENV.auth}=none or \`operate config unset ${profile ?? '<profile>'} auth\`.`,
  );
}
