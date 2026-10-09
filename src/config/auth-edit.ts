/**
 * `operate config set` changes of a profile's auth object: the type, the username and the
 * password, stored as the name of an environment variable (recommended) or literally. Only given
 * values change; a passwordEnv replaces a stored password and the other way round. A profile never
 * keeps Basic auth and an Authorization header together (`settleAuthorization`).
 */

import { compact } from '../util.js';
import {
  validateAuthType,
  validatePassword,
  validatePasswordEnv,
  validateUsername,
} from './auth.js';
import { configError } from './config-error.js';
import { hasAuthorization } from './headers.js';
import { type AuthType, PROFILE_AUTH_KEYS, type Profile, type ProfileAuth } from './types.js';

export interface AuthChanges {
  readonly auth?: string;
  readonly authUser?: string;
  readonly authPasswordEnv?: string;
  readonly authPassword?: string;
}

type Secret = Pick<ProfileAuth, 'password' | 'passwordEnv'>;

const AUTH_OPTIONS = ['auth', 'authUser', 'authPasswordEnv', 'authPassword'] as const;

function secretOf(existing: ProfileAuth | undefined, changes: AuthChanges): Secret {
  const { authPasswordEnv, authPassword } = changes;
  if (authPasswordEnv !== undefined && authPassword !== undefined) {
    throw configError(
      '--auth-password-env and --auth-password-stdin exclude each other',
      'Store the name of the environment variable that holds the password (recommended), or the password itself.',
    );
  }
  if (authPasswordEnv !== undefined) return { passwordEnv: validatePasswordEnv(authPasswordEnv) };
  if (authPassword !== undefined) {
    return { password: validatePassword(authPassword, 'from --auth-password-stdin') };
  }
  return compact({ passwordEnv: existing?.passwordEnv, password: existing?.password });
}

/**
 * The stored type: `--auth` if given. Credentials given without `--auth` switch a profile stored
 * with type none to basic, which they are meant for (a type none would ignore them).
 */
function typeOf(existing: ProfileAuth | undefined, changes: AuthChanges): AuthType | undefined {
  if (changes.auth !== undefined) return validateAuthType(changes.auth.trim());
  return existing?.type === 'none' ? 'basic' : existing?.type;
}

/** The changed auth object of a profile, or undefined when no auth option was given. */
export function changedAuth(
  existing: ProfileAuth | undefined,
  changes: AuthChanges,
): ProfileAuth | undefined {
  if (AUTH_OPTIONS.every((key) => changes[key] === undefined)) return undefined;
  const { authUser } = changes;
  const username =
    authUser === undefined
      ? existing?.username
      : validateUsername(authUser.trim(), 'from --auth-user');
  const merged: ProfileAuth = {
    ...compact({ type: typeOf(existing, changes), username }),
    ...secretOf(existing, changes),
  };
  return compact(Object.fromEntries(PROFILE_AUTH_KEYS.map((key) => [key, merged[key]])));
}

/** True when a stored profile selects Basic auth: type basic, or a username without a type. */
export function usesBasicAuth(auth: ProfileAuth | undefined): boolean {
  return auth?.type === undefined ? auth?.username !== undefined : auth.type === 'basic';
}

function isAuthorizationHeader(header: string): boolean {
  return header.slice(0, header.indexOf(':')).trim().toLowerCase() === 'authorization';
}

function withoutAuthorization(profile: Profile): Profile {
  const headers = Object.entries(profile.headers ?? {}).filter(
    ([name]) => name.toLowerCase() !== 'authorization',
  );
  return compact({
    ...profile,
    headers: headers.length > 0 ? Object.fromEntries(headers) : undefined,
  });
}

/**
 * Basic auth and an Authorization header in one profile would make every command fail. Auth
 * options given without an Authorization header replace a stored one (the upgrade path from
 * `Authorization: Basic ...` profile headers; the CLI says so); every other combination is a
 * CONFIG error. `--auth none` keeps a header and the stored credentials.
 */
export function settleAuthorization(
  profile: Profile,
  changes: AuthChanges & { readonly headers?: readonly string[] },
  name: string,
): Profile {
  if (!usesBasicAuth(profile.auth) || !hasAuthorization(profile.headers ?? {})) return profile;
  const givenAuth = AUTH_OPTIONS.some((key) => changes[key] !== undefined);
  if (givenAuth && changes.headers?.some(isAuthorizationHeader) !== true) {
    return withoutAuthorization(profile);
  }
  throw configError(
    `Profile "${name}" would have both Basic auth and an Authorization header`,
    `Keep one: Basic auth options replace a stored Authorization header (\`operate config set ${name} --auth basic\`); --auth none switches Basic auth off and keeps the header (\`operate config set ${name} --auth none -H 'Authorization: ...'\`).`,
  );
}

/** True when `config set` removed the Authorization header of the profile (`settleAuthorization`). */
export function replacedAuthorization(before: Profile | undefined, after: Profile | undefined) {
  return hasAuthorization(before?.headers ?? {}) && !hasAuthorization(after?.headers ?? {});
}
