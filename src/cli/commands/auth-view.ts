/**
 * What `operate auth login|status|logout` print (design §16.3). Pure. Never a token: only who is
 * logged in, for what, until when, and where the cache file is. Timestamps are ISO 8601 UTC.
 */

import { iso } from '../../auth/oauth/errors.js';
import { canRefresh, isExpired } from '../../auth/oauth/expiry.js';
import type { CachedLogin } from '../../auth/oauth/types.js';
import type { OAuthConfig } from '../../config/types.js';

export interface LoginView {
  readonly profile: string | null;
  /** The configured (and discovered) issuer. */
  readonly issuer: string | null;
  readonly clientId: string;
  /** `preferred_username`, else `email` of the ID token. */
  readonly user: string | null;
  /** `sub` of the ID token. */
  readonly subject: string | null;
  /** Granted (`scope` of the token response), else requested. */
  readonly scopes: readonly string[];
  /** null: unknown (no expires_in). */
  readonly accessTokenExpiresAt: string | null;
  /** now < expiresAt (no margin); true when the expiry is unknown. */
  readonly accessTokenValid: boolean;
  /** null: no refresh token, or no known expiry. */
  readonly refreshTokenExpiresAt: string | null;
  /** A refresh token that is not known to be expired. */
  readonly canRefresh: boolean;
  readonly loggedInAt: string;
  readonly refreshedAt: string | null;
  /** Absolute path of the cache file. */
  readonly tokenCache: string;
}

export interface LogoutView {
  readonly profile: string | null;
  readonly tokenCache: string;
  readonly removed: boolean;
  /** null: nothing to revoke or no revocation endpoint. */
  readonly revoked: boolean | null;
}

function isoOrNull(epochMs: number | null): string | null {
  return epochMs === null ? null : iso(epochMs);
}

export function loginView(
  login: CachedLogin,
  config: OAuthConfig,
  tokenCache: string,
  now: number,
): LoginView {
  const granted = login.scope?.split(/\s+/).filter((scope) => scope !== '');
  return {
    profile: config.profile ?? null,
    issuer: config.issuer ?? null,
    clientId: config.clientId,
    user: login.user,
    subject: login.subject,
    scopes: granted ?? [...config.scopes],
    accessTokenExpiresAt: isoOrNull(login.expiresAt),
    accessTokenValid: !isExpired(now, login.expiresAt),
    refreshTokenExpiresAt: login.refreshToken === null ? null : isoOrNull(login.refreshExpiresAt),
    canRefresh: canRefresh(login, now),
    loggedInAt: iso(login.loggedInAt),
    refreshedAt: isoOrNull(login.refreshedAt),
    tokenCache,
  };
}

/** Rows of the table format: KEY VALUE; lists space-joined, null empty. */
export function viewRows(view: LoginView | LogoutView): Record<string, unknown>[] {
  return Object.entries(view).map(([key, value]: [string, unknown]) => ({
    KEY: key,
    VALUE: Array.isArray(value) ? value.join(' ') : (value ?? ''),
  }));
}
