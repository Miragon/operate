/**
 * `operate config set` changes of a profile's auth object (design §15, §16.2.2): the type, the
 * Basic auth username and password (stored as the name of an environment variable, recommended,
 * or literally) and the OAuth settings (oauth-edit.ts). Only given values change; a passwordEnv
 * replaces a stored password and the other way round. The options of one family (or its type)
 * drop the stored keys of the other one, and a profile never keeps credentials and an
 * Authorization header together (`settleAuthorization`).
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
import { hasOAuthKeys } from './oauth.js';
import { changedOAuthKeys, hasOAuthOptions, type OAuthChanges } from './oauth-edit.js';
import {
  type AuthType,
  BASIC_AUTH_KEYS,
  PROFILE_AUTH_KEYS,
  type Profile,
  type ProfileAuth,
} from './types.js';

export interface AuthChanges extends OAuthChanges {
  readonly auth?: string;
  readonly authUser?: string;
  readonly authPasswordEnv?: string;
  readonly authPassword?: string;
}

type Family = 'basic' | 'oauth';
type Secret = Pick<ProfileAuth, 'password' | 'passwordEnv'>;

const BASIC_OPTIONS = ['authUser', 'authPasswordEnv', 'authPassword'] as const;

function hasBasicOptions(changes: AuthChanges): boolean {
  return BASIC_OPTIONS.some((key) => changes[key] !== undefined);
}

/** True when any auth option (type, Basic auth or OAuth) was given. */
function hasAuthOptions(changes: AuthChanges): boolean {
  return changes.auth !== undefined || hasBasicOptions(changes) || hasOAuthOptions(changes);
}

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

function basicKeys(existing: ProfileAuth | undefined, changes: AuthChanges): Partial<ProfileAuth> {
  const { authUser } = changes;
  const username =
    authUser === undefined
      ? existing?.username
      : validateUsername(authUser.trim(), 'from --auth-user');
  return { ...compact({ username }), ...secretOf(existing, changes) };
}

/** Options of both families, or of the family the explicit type does not use: CONFIG. */
function checkFamilies(type: AuthType | undefined, basic: boolean, oauth: boolean): void {
  if (basic && oauth) {
    throw configError(
      'Basic auth options and OAuth options exclude each other',
      'A profile uses Basic auth (--auth basic --auth-user <name> --auth-password-env <VAR>) or OAuth (--auth oauth --oauth-issuer <url> --oauth-client-id <id>).',
    );
  }
  if (type === 'basic' && oauth) {
    throw configError('OAuth options need --auth oauth, not --auth basic');
  }
  if (type === 'oauth' && basic) {
    throw configError('Basic auth options need --auth basic, not --auth oauth');
  }
}

/**
 * The stored type: `--auth` if given; else OAuth options select oauth; else Basic auth options
 * switch a profile stored with type none or oauth to basic, which they are meant for.
 */
function typeOf(existing: ProfileAuth | undefined, changes: AuthChanges): AuthType | undefined {
  if (changes.auth !== undefined) return validateAuthType(changes.auth.trim());
  if (hasOAuthOptions(changes)) return 'oauth';
  const stored = existing?.type;
  return hasBasicOptions(changes) && (stored === 'none' || stored === 'oauth') ? 'basic' : stored;
}

/** The family the change is about; its keys stay, the other family's keys are dropped. */
function familyOf(type: AuthType | undefined, changes: AuthChanges): Family | undefined {
  if (hasOAuthOptions(changes)) return 'oauth';
  if (hasBasicOptions(changes)) return 'basic';
  return type === 'basic' || type === 'oauth' ? type : undefined;
}

/** The changed auth object of a profile, or undefined when no auth option was given. */
export function changedAuth(
  existing: ProfileAuth | undefined,
  changes: AuthChanges,
): ProfileAuth | undefined {
  if (!hasAuthOptions(changes)) return undefined;
  const type = typeOf(existing, changes);
  checkFamilies(
    changes.auth === undefined ? undefined : type,
    hasBasicOptions(changes),
    hasOAuthOptions(changes),
  );
  const family = familyOf(type, changes);
  const merged: ProfileAuth = {
    ...compact({ type }),
    ...(family === 'oauth' ? {} : basicKeys(existing, changes)),
    ...(family === 'basic' ? {} : changedOAuthKeys(existing, changes)),
  };
  return compact(Object.fromEntries(PROFILE_AUTH_KEYS.map((key) => [key, merged[key]])));
}

function hasBasicKeys(auth: ProfileAuth | undefined): boolean {
  return BASIC_AUTH_KEYS.some((key) => auth?.[key] !== undefined);
}

/**
 * The family whose settings `config set` removed (the other family replaced them), for the
 * notice on stderr; undefined when nothing was removed.
 */
export function replacedFamily(
  before: ProfileAuth | undefined,
  after: ProfileAuth | undefined,
): Family | undefined {
  if (hasBasicKeys(before) && !hasBasicKeys(after)) return 'basic';
  return hasOAuthKeys(before) && !hasOAuthKeys(after) ? 'oauth' : undefined;
}

/** True when a stored profile selects Basic auth: type basic, or a username without a type. */
export function usesBasicAuth(auth: ProfileAuth | undefined): boolean {
  return auth?.type === undefined ? auth?.username !== undefined : auth.type === 'basic';
}

/** True when a stored profile sends credentials: Basic auth or OAuth. */
export function usesCredentials(auth: ProfileAuth | undefined): boolean {
  return usesBasicAuth(auth) || auth?.type === 'oauth';
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
 * Credentials (Basic auth or OAuth) and an Authorization header in one profile would make every
 * command fail. Auth options given without an Authorization header replace a stored one (the
 * upgrade path from `Authorization: Basic ...` or bearer token headers; the CLI says so); every
 * other combination is a CONFIG error. `--auth none` keeps a header and the stored credentials.
 */
export function settleAuthorization(
  profile: Profile,
  changes: AuthChanges & { readonly headers?: readonly string[] },
  name: string,
): Profile {
  if (!usesCredentials(profile.auth) || !hasAuthorization(profile.headers ?? {})) return profile;
  if (hasAuthOptions(changes) && changes.headers?.some(isAuthorizationHeader) !== true) {
    return withoutAuthorization(profile);
  }
  const [family, type] =
    profile.auth?.type === 'oauth' ? ['OAuth', 'oauth'] : ['Basic auth', 'basic'];
  throw configError(
    `Profile "${name}" would have both ${family} and an Authorization header`,
    `Keep one: ${family} options replace a stored Authorization header (\`operate config set ${name} --auth ${type}\`); --auth none switches ${family} off and keeps the header (\`operate config set ${name} --auth none -H 'Authorization: ...'\`).`,
  );
}

/** True when `config set` removed the Authorization header of the profile (`settleAuthorization`). */
export function replacedAuthorization(before: Profile | undefined, after: Profile | undefined) {
  return hasAuthorization(before?.headers ?? {}) && !hasAuthorization(after?.headers ?? {});
}
