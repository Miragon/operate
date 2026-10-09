/**
 * Validation of the auth settings (design §15, §16): the auth type, Basic auth usernames and
 * passwords (RFC 7617: no control characters, no ":" in the username), the name of a password
 * variable and the auth object of a profile in the config file (the OAuth rules live in oauth.ts).
 * Messages never repeat a username or password.
 */

import { isRecord } from '../util.js';
import { configError } from './config-error.js';
import { OAUTH_CHECKS, oauthProfileProblem } from './oauth.js';
import { CONTROL, ENV_NAME, isNonEmptyString } from './syntax.js';
import { AUTH_TYPES, type AuthType, PROFILE_AUTH_KEYS, type ProfileAuth } from './types.js';

const CONTROL_HINT =
  'Remove line breaks, tabs, NUL and other control characters; Basic auth (RFC 7617) does not allow them.';

export function validateAuthType(type: string): AuthType {
  const known = AUTH_TYPES.find((candidate) => candidate === type);
  if (known === undefined) {
    throw configError(`Unsupported auth type "${type}"`, `Supported: ${AUTH_TYPES.join(', ')}.`);
  }
  return known;
}

/** Checks a Basic auth username; `label` says where it came from (`from --auth-user`). */
export function validateUsername(username: string, label: string): string {
  if (username.trim() === '') {
    throw configError(`The username (${label}) must not be empty`, 'Example: --auth-user demo');
  }
  if (username.includes(':')) {
    throw configError(
      `The username (${label}) must not contain ":"`,
      'Basic auth (RFC 7617) separates the username from the password with ":"; only the password may contain it.',
    );
  }
  if (CONTROL.test(username)) {
    throw configError(`The username (${label}) must not contain control characters`, CONTROL_HINT);
  }
  return username;
}

/** Checks a Basic auth password; `label` says where it came from. Never repeats the value. */
export function validatePassword(password: string, label: string): string {
  if (CONTROL.test(password)) {
    throw configError(
      `The password (${label}) must not contain control characters (line breaks, NUL, tab, ...)`,
      CONTROL_HINT,
    );
  }
  return password;
}

/**
 * Checks the name of the environment variable that holds the password. An invalid name is not
 * repeated: it may be the password itself, given by mistake.
 */
export function validatePasswordEnv(name: string): string {
  const trimmed = name.trim();
  if (!ENV_NAME.test(trimmed)) {
    throw configError(
      'Invalid --auth-password-env: expected the name of an environment variable',
      'Use letters, digits and "_", not starting with a digit, e.g. --auth-password-env CAMUNDA_PASSWORD.',
    );
  }
  return trimmed;
}

type Check = readonly [check: (value: unknown) => boolean, expected: string];

const AUTH_CHECKS: Readonly<Record<keyof ProfileAuth, Check>> = {
  type: [
    (value) => typeof value === 'string',
    `${AUTH_TYPES.slice(0, -1).join(', ')} or ${AUTH_TYPES.at(-1) ?? ''}`,
  ],
  username: [isNonEmptyString, 'a non-empty string'],
  passwordEnv: [
    (value) => typeof value === 'string' && ENV_NAME.test(value),
    'the name of an environment variable, e.g. CAMUNDA_PASSWORD',
  ],
  password: [isNonEmptyString, 'a non-empty string'],
  ...OAUTH_CHECKS,
};

const AUTH_EXAMPLE = '{"type": "basic", "username": "demo", "passwordEnv": "CAMUNDA_PASSWORD"}';

/**
 * Why the auth object of profile `name` in the config file is invalid, or undefined. The type is
 * only checked to be a string here; resolution names the supported types. Never quotes values.
 * Values the environment may complete (an OAuth type without issuer or client id) are valid.
 */
export function profileAuthProblem(name: string, value: unknown): string | undefined {
  if (!isRecord(value)) return `profile "${name}" has an invalid auth (expected ${AUTH_EXAMPLE})`;
  const allowed: readonly string[] = PROFILE_AUTH_KEYS;
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return `unknown key(s) ${unknown.join(', ')} in the auth of profile "${name}" (allowed: ${allowed.join(', ')})`;
  }
  const invalid = PROFILE_AUTH_KEYS.find(
    (key) => Object.hasOwn(value, key) && !AUTH_CHECKS[key][0](value[key]),
  );
  if (invalid !== undefined) {
    return `profile "${name}" has an invalid auth.${invalid} (expected ${AUTH_CHECKS[invalid][1]})`;
  }
  return Object.hasOwn(value, 'password') && Object.hasOwn(value, 'passwordEnv')
    ? `profile "${name}" sets both auth.password and auth.passwordEnv; keep one (passwordEnv is recommended)`
    : oauthProfileProblem(name, value);
}
