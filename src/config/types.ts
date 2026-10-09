/** Configuration model: config file, profiles and the resolved effective configuration. */

export const OUTPUT_FORMATS = ['json', 'table'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const AUTH_TYPES = ['none', 'basic', 'oauth'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/**
 * Auth settings of a profile as stored in the config file. Without `type`, a `username` selects
 * Basic auth; OAuth needs `type: "oauth"` (it is never implied). `passwordEnv` / `clientSecretEnv`
 * name environment variables holding the secret; a literal `password` / `clientSecret` is possible
 * but discouraged. A profile never mixes Basic auth and OAuth keys.
 */
export interface ProfileAuth {
  readonly type?: AuthType;
  readonly username?: string;
  readonly passwordEnv?: string;
  readonly password?: string;
  readonly issuer?: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly clientId?: string;
  readonly clientSecretEnv?: string;
  readonly clientSecret?: string;
  readonly scopes?: readonly string[];
  readonly audience?: string;
  readonly redirectPort?: number;
}

export const BASIC_AUTH_KEYS = [
  'username',
  'passwordEnv',
  'password',
] as const satisfies readonly (keyof ProfileAuth)[];

export const OAUTH_AUTH_KEYS = [
  'issuer',
  'authorizationEndpoint',
  'tokenEndpoint',
  'clientId',
  'clientSecretEnv',
  'clientSecret',
  'scopes',
  'audience',
  'redirectPort',
] as const satisfies readonly (keyof ProfileAuth)[];

/** Keys of a profile's auth object, in the order they are written to the config file. */
export const PROFILE_AUTH_KEYS = [
  'type',
  ...BASIC_AUTH_KEYS,
  ...OAUTH_AUTH_KEYS,
] as const satisfies readonly (keyof ProfileAuth)[];

/** Scopes requested when neither OPERATE_OAUTH_SCOPES nor the profile sets them. */
export const DEFAULT_OAUTH_SCOPES = ['openid', 'offline_access'] as const;

/** Basic auth credentials and where each value came from. */
export interface BasicAuthConfig {
  readonly type: 'basic';
  readonly username: string;
  readonly password: string;
  readonly sources: { readonly username: Source; readonly password: Source };
}

/**
 * OAuth 2.0 authorization code flow with PKCE (design §16). The issuer is discovered unless both
 * endpoints are configured; without a client secret the client is public.
 */
export interface OAuthConfig {
  readonly type: 'oauth';
  readonly issuer?: string;
  /** Both endpoints or neither. */
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly clientId: string;
  /** Absent: public client. */
  readonly clientSecret?: string;
  readonly scopes: readonly string[];
  readonly audience?: string;
  readonly redirectPort: number;
  /** The selected profile; it names the token cache file. */
  readonly profile?: string;
  readonly sources: {
    readonly endpoints: Source;
    readonly clientId: Source;
    readonly clientSecret?: Source;
    readonly scopes: Source;
    readonly audience?: Source;
    readonly redirectPort: Source;
  };
}

/**
 * No credentials. `off` says why when Basic auth or OAuth was switched off or a password is set
 * without a username (`Basic auth is switched off by OPERATE_AUTH=none`), for the hint of a 401.
 */
export interface NoAuthConfig {
  readonly type: 'none';
  readonly off?: string;
}

/** The resolved authentication: none, complete Basic auth credentials or OAuth settings. */
export type AuthConfig = NoAuthConfig | BasicAuthConfig | OAuthConfig;

export interface Profile {
  readonly url?: string;
  readonly engine?: string;
  readonly auth?: ProfileAuth;
  readonly output?: OutputFormat;
  readonly timeout?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly readOnly?: boolean;
}

/** Keys a profile may contain, in the order they are written to the config file. */
export const PROFILE_KEYS = [
  'url',
  'engine',
  'auth',
  'output',
  'timeout',
  'headers',
  'readOnly',
] as const satisfies readonly (keyof Profile)[];
export type ProfileKey = (typeof PROFILE_KEYS)[number];

/** The profile a command uses: none, or a profile of the config file with its name. */
export type SelectedProfile =
  | { readonly name?: undefined; readonly profile?: undefined }
  | { readonly name: string; readonly profile: Profile };

export interface ConfigFile {
  readonly defaultProfile?: string;
  readonly profiles: Readonly<Record<string, Profile>>;
}

/** Values given on the command line (raw strings, validated during resolution). */
export interface ConfigFlags {
  readonly url?: string;
  readonly engine?: string;
  readonly profile?: string;
  readonly output?: string;
  readonly timeout?: string;
  readonly headers?: readonly string[];
  readonly readOnly?: boolean;
  /** `--auth <type>` */
  readonly auth?: string;
  /** `--auth-user <name>` */
  readonly authUser?: string;
  /** The password read from stdin for `--auth-password-stdin`. */
  readonly authPassword?: string;
}

export type Source = 'flag' | 'env' | 'profile' | 'default';

export interface ResolvedConfig {
  readonly profile?: string;
  readonly url: string;
  readonly engine?: string;
  /** `sources.auth` is where the auth type came from; credentials carry their own sources. */
  readonly auth: AuthConfig;
  /** Undefined means: choose by terminal (table on a TTY, JSON otherwise). */
  readonly output?: OutputFormat;
  readonly timeoutMs: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly readOnly: boolean;
  readonly sources: Readonly<Record<ResolvedKey, Source>>;
}

type ResolvedKey = 'url' | 'engine' | 'auth' | 'output' | 'timeout' | 'headers' | 'readOnly';

export const DEFAULT_URL = 'http://localhost:8080/engine-rest';
export const DEFAULT_TIMEOUT_MS = 30_000;

export const ENV = {
  url: 'OPERATE_URL',
  engine: 'OPERATE_ENGINE',
  profile: 'OPERATE_PROFILE',
  config: 'OPERATE_CONFIG',
  output: 'OPERATE_OUTPUT',
  timeout: 'OPERATE_TIMEOUT',
  auth: 'OPERATE_AUTH',
  username: 'OPERATE_USERNAME',
  password: 'OPERATE_PASSWORD',
  oauthIssuer: 'OPERATE_OAUTH_ISSUER',
  oauthAuthorizationEndpoint: 'OPERATE_OAUTH_AUTHORIZATION_ENDPOINT',
  oauthTokenEndpoint: 'OPERATE_OAUTH_TOKEN_ENDPOINT',
  oauthClientId: 'OPERATE_OAUTH_CLIENT_ID',
  oauthClientSecret: 'OPERATE_OAUTH_CLIENT_SECRET',
  oauthScopes: 'OPERATE_OAUTH_SCOPES',
  oauthAudience: 'OPERATE_OAUTH_AUDIENCE',
  oauthRedirectPort: 'OPERATE_OAUTH_REDIRECT_PORT',
  headers: 'OPERATE_HEADERS',
  readOnly: 'OPERATE_READ_ONLY',
} as const;
