/**
 * The errors of the OAuth flow (design §16.9). LOGIN_REQUIRED (exit 4) means a person must run
 * `operate auth login` in a terminal; agents cannot log in themselves, so the hint says who does
 * what. LOGIN_FAILED (exit 4) is a login that did not complete.
 */

import type { OAuthConfig } from '../../config/types.js';
import { OperateError } from '../../errors.js';
import { canRefresh, isExpired } from './expiry.js';
import { identityDifferences } from './identity.js';
import type { CachedLogin, LoginIdentity } from './types.js';

/** Whose login it is in messages: `profile "p"`, or the configuration from the environment. */
export function owner(profile: string | undefined): string {
  return profile === undefined ? 'the environment configuration' : `profile "${profile}"`;
}

/** `(profile "p")`, or `(no profile)`, for the lines of `operate auth login`. */
export function profileNote(profile: string | undefined): string {
  return profile === undefined ? '(no profile)' : `(profile "${profile}")`;
}

/** The command a person runs to log in. */
export function loginCommand(profile: string | undefined): string {
  return profile === undefined ? 'operate auth login' : `operate auth login --profile ${profile}`;
}

/**
 * The hint of every LOGIN_REQUIRED error. Without a profile the person needs OPERATE_AUTH=oauth
 * too: `auth login` has no `--auth` option, so an agent's `--auth oauth` does not carry over.
 */
export function loginHint(profile: string | undefined): string {
  const settings =
    profile === undefined ? ' with OPERATE_AUTH=oauth and the same OPERATE_OAUTH_* settings' : '';
  return `Run \`${loginCommand(profile)}\` in a terminal${settings}: a person logs in once in the browser, operate refreshes the token afterwards. Agents cannot log in themselves.`;
}

/** LOGIN_REQUIRED with the login hint, after an optional explanation. */
export function loginRequired(message: string, profile: string | undefined, why?: string) {
  const hint = why === undefined ? loginHint(profile) : `${why} ${loginHint(profile)}`;
  return new OperateError('LOGIN_REQUIRED', message, { hint });
}

export function loginFailed(message: string, hint: string): OperateError {
  return new OperateError('LOGIN_FAILED', message, { hint });
}

export function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function notLoggedIn(profile: string | undefined): OperateError {
  return loginRequired(`Not logged in: ${owner(profile)} has no OAuth login`, profile);
}

/**
 * LOGIN_REQUIRED for a cached login of another identity: the message names the fields that
 * differ, the hint the OPERATE_OAUTH_* variables that changed them (the person's terminal must
 * set them too, or the agent must drop them), else that the settings changed since the login.
 */
export function otherIdentity(stored: LoginIdentity, config: OAuthConfig): OperateError {
  const differences = identityDifferences(stored, config);
  const details = differences.map((difference) => difference.text).join('; ');
  const variables = differences.flatMap((difference) =>
    difference.variable === undefined ? [] : [difference.variable],
  );
  const why =
    variables.length === 0
      ? 'The login was made with other settings (the profile changed since, or OPERATE_OAUTH_* variables were set where the login ran).'
      : `${variables.join(', ')} of this environment ${variables.length > 1 ? 'make' : 'makes'} the difference: run the login below with the same ${variables.length > 1 ? 'values' : 'value'}, or unset ${variables.length > 1 ? 'them' : 'it'} here.`;
  return loginRequired(
    `The OAuth login of ${owner(config.profile)} was made for another issuer, client, audience or scopes: ${details}`,
    config.profile,
    why,
  );
}

export function unknownFormat(path: string, profile: string | undefined): OperateError {
  return loginRequired(`The token cache ${path} has an unknown format`, profile);
}

export function removedWhileRunning(profile: string | undefined): OperateError {
  return loginRequired(
    `The OAuth login of ${owner(profile)} was removed while this command ran`,
    profile,
    'A logout or `operate config delete` removed it.',
  );
}

/** Why the authorization server refuses a refresh token with `invalid_grant`. */
export const REFRESH_REJECTED =
  'The session expired, was revoked, or the refresh token was replayed.';

/**
 * LOGIN_REQUIRED for a login operate cannot refresh: the authorization server refused its
 * refresh token before, it has none, or an expired one.
 */
export function cannotRefresh(login: CachedLogin, now: number, profile: string | undefined) {
  const rejected = login.refreshRejected;
  if (rejected !== undefined) {
    return loginRequired(
      `The authorization server rejected the refresh token of ${owner(profile)} at ${iso(rejected.at)} (${rejected.error})`,
      profile,
      REFRESH_REJECTED,
    );
  }
  if (login.refreshToken === null) {
    return loginRequired(
      `The access token of ${owner(profile)} expired at ${iso(login.expiresAt ?? now)} and there is no refresh token`,
      profile,
      'Request the offline_access scope or allow refresh tokens for the client, so that operate can refresh the token.',
    );
  }
  return loginRequired(
    `The OAuth login of ${owner(profile)} expired at ${iso(login.refreshExpiresAt ?? now)}`,
    profile,
  );
}

/**
 * Throws LOGIN_REQUIRED when no command could run with the login without a person: the
 * authorization server refused its refresh token (recorded only once the access token was due
 * for a refresh or rejected), or the access token expired and there is no usable refresh token.
 */
export function checkUsable(login: CachedLogin, now: number, profile: string | undefined): void {
  const expired = isExpired(now, login.expiresAt) && !canRefresh(login, now);
  if (login.refreshRejected !== undefined || expired) throw cannotRefresh(login, now, profile);
}
