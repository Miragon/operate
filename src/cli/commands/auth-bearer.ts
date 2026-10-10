/**
 * `operate auth status|login|logout` with a bearer token obtained elsewhere (design §18). `auth
 * status` shows what operate can tell about the token without sending it: where it comes from
 * and, for a JWT, subject, issuer, audience and expiry (no signature check); an expired JWT exits
 * with TOKEN_EXPIRED (exit 4) after the view. `auth login` and `auth logout` do not apply: operate
 * never fetches, refreshes or stores such a token. Never prints the token.
 */

import { tokenExpired } from '../../auth/bearer.js';
import { isExpired, type JwtClaims, jwtClaims } from '../../auth/jwt.js';
import { type Env, nonEmpty } from '../../config/pick.js';
import { type BearerAuthConfig, ENV, type Source } from '../../config/types.js';
import { type OperateError, usageError } from '../../errors.js';

export interface BearerStatusView {
  readonly type: 'bearer';
  readonly profile: string | null;
  /** flag, env or profile. */
  readonly source: Source;
  /** `OPERATE_TOKEN`, `CI_TOKEN (auth.tokenEnv of profile "p")`, ... */
  readonly origin: string;
  readonly format: 'jwt' | 'opaque';
  /** `sub` of a JWT. */
  readonly subject: string | null;
  /** `preferred_username` of a JWT. */
  readonly user: string | null;
  readonly issuer: string | null;
  readonly audience: readonly string[];
  /** `exp` of a JWT; null for opaque tokens and JWTs without `exp`. */
  readonly expiresAt: string | null;
  /** `exp` lies more than 30 s in the past; false when unknown. */
  readonly expired: boolean;
}

/** What the view shows of an opaque token: nothing but its source. */
const OPAQUE: JwtClaims = {
  expiresAt: null,
  subject: null,
  user: null,
  issuer: null,
  audience: [],
};

export function bearerStatusView(config: BearerAuthConfig, now: number): BearerStatusView {
  const claims = jwtClaims(config.token);
  const { subject, user, issuer, audience, expiresAt } = claims ?? OPAQUE;
  return {
    type: 'bearer',
    profile: config.profile ?? null,
    source: config.source,
    origin: config.origin,
    format: claims === undefined ? 'opaque' : 'jwt',
    subject,
    user,
    issuer,
    audience,
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    expired: isExpired({ expiresAt }, now),
  };
}

/** TOKEN_EXPIRED for a JWT whose `exp` lies more than 30 s in the past, else undefined. */
export function expiredError(config: BearerAuthConfig, now: number): OperateError | undefined {
  const expiresAt = jwtClaims(config.token)?.expiresAt ?? null;
  return expiresAt !== null && isExpired({ expiresAt }, now)
    ? tokenExpired(config, expiresAt)
    : undefined;
}

/** What selected bearer auth for an `auth` command, which has no `--auth` option. */
export interface BearerSelection {
  readonly profile: string | undefined;
  /** Where the type came from (`ResolvedConfig.sources.auth`). */
  readonly source: Source;
  readonly env: Env;
}

type Selector = 'profile' | 'type variable' | 'token';

/** The profile's auth.type, OPERATE_AUTH=bearer, or a token without any type (inferred). */
function selectorOf({ source, env }: BearerSelection): Selector {
  if (source === 'profile') return 'profile';
  return source === 'env' && nonEmpty(env[ENV.auth]) !== undefined ? 'type variable' : 'token';
}

function selectedBy(selector: Selector, selection: BearerSelection): string {
  if (selector === 'profile') return `the auth.type of profile "${selection.profile ?? ''}"`;
  if (selector === 'type variable') return `${ENV.auth}=bearer`;
  const from = selection.source === 'flag' ? '--auth-token-stdin' : ENV.token;
  return `a token from ${from} without an auth type`;
}

/** The settings that apply once OPERATE_AUTH is unset. */
function settingsOf(profile: string | undefined): string {
  return profile === undefined ? 'the configuration' : `profile "${profile}"`;
}

const OAUTH_SETUP = (name: string) =>
  `operate config set ${name} --auth oauth --oauth-issuer <url> --oauth-client-id <id>`;

/** How `auth login` gets to an OAuth login, by what selected bearer auth. */
function loginWay(selector: Selector, selection: BearerSelection): string {
  const name = selection.profile ?? '<profile>';
  if (selector === 'type variable') {
    return `To log in with OAuth instead, unset ${ENV.auth} so that the auth settings of ${settingsOf(selection.profile)} apply.`;
  }
  const unset = selector === 'token' ? `unset ${ENV.token} and configure OAuth: ` : '';
  return `For an OAuth login run by operate: ${unset}${OAUTH_SETUP(name)}.`;
}

/** How `auth logout` stops bearer auth; `config unset` only where the profile selects it. */
function logoutWay(selector: Selector, selection: BearerSelection): string {
  if (selector === 'profile') {
    return `\`operate config unset ${selection.profile ?? '<profile>'} auth\` removes that setting`;
  }
  return selector === 'type variable'
    ? `unset ${ENV.auth} to use the auth settings of ${settingsOf(selection.profile)}`
    : `unset ${ENV.token} to stop sending it`;
}

/**
 * `auth login` or `auth logout` with a bearer token: USAGE, operate manages no such token. The
 * hint names what selected bearer auth (the profile, OPERATE_AUTH, a token without a type), so it
 * never suggests removing the OAuth settings of a profile that OPERATE_AUTH=bearer overrides.
 */
export function bearerNotManaged(command: string, selection: BearerSelection): OperateError {
  const selector = selectorOf(selection);
  const by = `bearer auth is selected by ${selectedBy(selector, selection)}`;
  const hint =
    command === 'logout'
      ? `operate stores no bearer token, so there is nothing to log out (${by}); ${logoutWay(selector, selection)}. The token stays valid at the engine until it expires; revoke it with the tool that issued it.`
      : `${capitalized(by)}: operate sends a token from elsewhere (company SSO tooling, a CI secret, az account get-access-token, gcloud auth print-access-token) as it is and never logs in, refreshes or stores it. Fetch a new token with that tool and set ${ENV.token} (or the variable named by the profile's tokenEnv); \`operate auth status\` shows its expiry. ${loginWay(selector, selection)}`;
  return usageError(`operate auth ${command} does not apply to bearer tokens`, hint);
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
