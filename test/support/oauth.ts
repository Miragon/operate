/**
 * OAuth fixtures for unit tests: resolved configurations, the dependencies of the OAuth modules
 * on a fake runtime, cached logins and the paths of the token cache.
 */

import type { CachedLogin, LoginDeps, OAuthDeps } from '../../src/auth/oauth/types.js';
import type { OAuthConfig } from '../../src/config/types.js';
import type { TraceEvent } from '../../src/http/types.js';
import { ISSUER } from './fake-idp.js';
import type { FakeRuntime } from './fake-runtime.js';

/** The token directory of the fake runtime's home on Linux. */
export const TOKEN_DIR = '/home/tester/.config/operate/tokens';
export const TOKEN_FILE = `${TOKEN_DIR}/profile-p.json`;
export const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;
export const REVOCATION_ENDPOINT = `${ISSUER}/protocol/openid-connect/revoke`;

/** Changes of the default configuration; undefined removes a property. */
export type OAuthOverrides = { readonly [K in keyof OAuthConfig]?: OAuthConfig[K] | undefined };

export function oauthConfig(overrides: OAuthOverrides = {}): OAuthConfig {
  const merged = {
    type: 'oauth',
    issuer: ISSUER,
    clientId: 'operate-cli',
    scopes: ['openid', 'offline_access'],
    redirectPort: 0,
    profile: 'p',
    sources: {
      endpoints: 'profile',
      clientId: 'profile',
      scopes: 'default',
      redirectPort: 'default',
    },
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as OAuthConfig;
}

export function oauthDeps(
  runtime: FakeRuntime,
  overrides: Partial<OAuthDeps> & { readonly events?: TraceEvent[] } = {},
): OAuthDeps {
  const { events, ...rest } = overrides;
  return {
    fetch: runtime.fetch,
    fs: runtime.fs,
    now: () => runtime.now(),
    withLock: (path, holdMs, action) => runtime.withLock(path, holdMs, action),
    tokenDir: TOKEN_DIR,
    tokenPath: (fileName) => `${TOKEN_DIR}/${fileName}`,
    timeoutMs: 30_000,
    ...(events === undefined ? {} : { trace: (event: TraceEvent) => events.push(event) }),
    ...rest,
  };
}

export function loginDeps(runtime: FakeRuntime, overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    ...oauthDeps(runtime),
    randomBytes: (length) => runtime.randomBytes(length),
    listenLoopback: (port, handler) => runtime.listenLoopback(port, handler),
    openBrowser: (url) => runtime.openBrowser(url),
    sleep: (ms) => runtime.sleep(ms),
    stderr: runtime.stderr,
    ...overrides,
  };
}

/** A cached login of `operate-cli` for profile p, received at `now` with a 300 s token. */
export function cachedLogin(now: number, overrides: Partial<CachedLogin> = {}): CachedLogin {
  return {
    version: 1,
    identity: {
      issuer: ISSUER,
      tokenEndpoint: null,
      clientId: 'operate-cli',
      audience: null,
      scopes: ['offline_access', 'openid'],
    },
    endpoints: { token: TOKEN_ENDPOINT, revocation: REVOCATION_ENDPOINT, clientAuthMethod: 'none' },
    tokenType: 'Bearer',
    accessToken: 'cached-access',
    expiresAt: now + 300_000,
    refreshToken: 'cached-refresh',
    refreshExpiresAt: now + 1_800_000,
    scope: 'openid offline_access',
    subject: 'user-1',
    user: 'alice',
    loggedInAt: now,
    refreshedAt: null,
    ...overrides,
  };
}

/** The file content of a cached login, as operate writes it. */
export function cacheText(login: CachedLogin): string {
  return `${JSON.stringify(login, null, 2)}\n`;
}

/** A config file whose default profile p uses OAuth (public client `operate-cli`). */
export function oauthProfiles(auth: Readonly<Record<string, unknown>> = {}, profile = {}): string {
  return JSON.stringify({
    defaultProfile: 'p',
    profiles: {
      p: { auth: { type: 'oauth', issuer: ISSUER, clientId: 'operate-cli', ...auth }, ...profile },
    },
  });
}
