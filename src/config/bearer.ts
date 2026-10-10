/**
 * Validation of bearer tokens obtained outside operate (design §18): the token itself (a pasted
 * `Bearer ` prefix is dropped, the rest must be an RFC 6750 b64token), the name of the variable
 * that holds it, and the bearer rules for a profile's auth object in the config file. Messages
 * name where a value came from and never repeat a token.
 */

import { isRecord } from '../util.js';
import { configError } from './config-error.js';
import type { Env } from './pick.js';
import { CONTROL, ENV_NAME, isNonEmptyString } from './syntax.js';
import {
  AUTH_TYPES,
  BASIC_AUTH_KEYS,
  BEARER_AUTH_KEYS,
  OAUTH_AUTH_KEYS,
  type ProfileAuth,
} from './types.js';

/** RFC 6750 §2.1 b64token: the only syntax a Bearer credential may have. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;
/** A pasted header value: `Bearer <token>` (any case), or the bare word. */
const BEARER_PREFIX = /^bearer(?:\s+|$)/i;

const TOKEN_HINT =
  'A bearer token consists of letters, digits and - . _ ~ + / (optionally ending with =), e.g. a JWT. Pass the token alone (a leading "Bearer " is fine), not a whole header line, a JSON answer or several lines.';

/**
 * The token as sent: surrounding blanks and a leading `Bearer ` (case-insensitive) removed. A
 * token that is empty or not a b64token is a CONFIG error naming `origin` (`OPERATE_TOKEN`),
 * never the token.
 */
export function normalizeToken(raw: string, origin: string): string {
  const token = raw.trim().replace(BEARER_PREFIX, '').trim();
  if (token === '') {
    throw configError(
      `The bearer token from ${origin} is empty`,
      'Set the token itself, e.g. export OPERATE_TOKEN=<token> or pipe it into --auth-token-stdin.',
    );
  }
  if (!B64TOKEN.test(token)) {
    const what = CONTROL.test(token)
      ? 'contains line breaks or control characters'
      : 'has characters a bearer token cannot have';
    throw configError(`The bearer token from ${origin} ${what} (RFC 6750)`, TOKEN_HINT);
  }
  return token;
}

/**
 * Checks the name of the variable that holds the token. An invalid name is not repeated: it may
 * be the token itself, given by mistake.
 */
export function validateTokenEnv(name: string): string {
  const trimmed = name.trim();
  if (!ENV_NAME.test(trimmed)) {
    throw configError(
      'Invalid --auth-token-env: expected the name of an environment variable',
      'Use letters, digits and "_", not starting with a digit, e.g. --auth-token-env CI_ENGINE_TOKEN; the variable holds the token.',
    );
  }
  return trimmed;
}

/** A variable name as people write them: upper case letters, digits and "_", at most 64. */
const CONVENTIONAL_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
/** Longest word between "_" of a conventional name; longer runs look like a random token. */
const MAX_WORD = 24;

/**
 * True for a variable name in the usual form. Opaque tokens that are valid variable names
 * (GitHub's `ghp_...`, long alphanumeric reference tokens) are not, so messages never repeat them.
 */
export function isConventionalVariable(name: string): boolean {
  return CONVENTIONAL_NAME.test(name) && name.split('_').every((word) => word.length <= MAX_WORD);
}

/**
 * `config set --auth-token-env <name>`: a valid name, and one that is either set now or in the
 * usual form. An unset name in another form is most likely the token itself (`--auth-token-env
 * $CI_TOKEN`): refused before anything is stored, without repeating it.
 */
export function checkTokenEnv(name: string, env: Env): string {
  const variable = validateTokenEnv(name);
  if (isConventionalVariable(variable) || (env[variable] ?? '').trim() !== '') return variable;
  throw configError(
    '--auth-token-env names a variable that is not set and does not look like a variable name: it may be the token itself, so it is neither stored nor repeated',
    'Pass the name of the variable that holds the token, not its value: --auth-token-env CI_ENGINE_TOKEN, not --auth-token-env "$CI_ENGINE_TOKEN". A name in another form (lower case, very long) is accepted once the variable is set.',
  );
}

type Check = readonly [check: (value: unknown) => boolean, expected: string];

/** Shape checks of the bearer keys in the config file (the token syntax is checked on use). */
export const BEARER_CHECKS: Readonly<Record<(typeof BEARER_AUTH_KEYS)[number], Check>> = {
  tokenEnv: [
    (value) => typeof value === 'string' && ENV_NAME.test(value),
    'the name of an environment variable, e.g. CI_ENGINE_TOKEN',
  ],
  token: [isNonEmptyString, 'a non-empty string'],
};

function keysOf(value: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => Object.hasOwn(value, key));
}

/** Bearer keys next to Basic auth or OAuth keys: one profile uses one kind of credentials. */
export function bearerMixProblem(name: string, value: Record<string, unknown>) {
  const bearer = keysOf(value, BEARER_AUTH_KEYS);
  if (bearer.length === 0) return undefined;
  const basic = keysOf(value, BASIC_AUTH_KEYS);
  const [family, others] =
    basic.length > 0 ? ['Basic auth', basic] : ['OAuth', keysOf(value, OAUTH_AUTH_KEYS)];
  return others.length === 0
    ? undefined
    : `profile "${name}" mixes bearer token keys (${bearer.join(', ')}) and ${family} keys (${others.join(', ')}); keep one`;
}

/**
 * The bearer rules for the auth object of profile `name` (after the shape checks and the mix
 * check): bearer keys need type bearer or none (a stored token never implies a type), and one
 * token source. Never quotes values.
 */
export function bearerProfileProblem(name: string, value: Record<string, unknown>) {
  const bearer = keysOf(value, BEARER_AUTH_KEYS);
  const { type } = value;
  const known = (AUTH_TYPES as readonly unknown[]).includes(type);
  // unknown types are reported by resolution, which names the supported ones
  if (bearer.length > 0 && type !== 'bearer' && type !== 'none' && (known || type === undefined)) {
    const actual = type === undefined ? 'is not set' : `is ${type as string}`;
    return `profile "${name}" has bearer token keys (${bearer.join(', ')}) but its auth.type ${actual}; set "type": "bearer"`;
  }
  return bearer.length > 1
    ? `profile "${name}" sets both auth.token and auth.tokenEnv; keep one (tokenEnv is recommended)`
    : undefined;
}

/** True when the stored auth object has a bearer token setting. */
export function hasBearerKeys(auth: ProfileAuth | undefined): boolean {
  return isRecord(auth) && BEARER_AUTH_KEYS.some((key) => Object.hasOwn(auth, key));
}
