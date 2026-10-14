/** Configuration model: config file, profiles and the resolved effective configuration. */

export const OUTPUT_FORMATS = ['json', 'table'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const AUTH_TYPES = ['none', 'basic', 'oauth', 'bearer'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/**
 * Auth settings of a profile as stored in the config file. Without `type`, a `username` selects
 * Basic auth; OAuth needs `type: "oauth"` (it is never implied), a stored bearer token `type:
 * "bearer"`. `passwordEnv` / `clientSecretEnv` / `tokenEnv` name environment variables holding the
 * secret; a literal `password` / `clientSecret` / `token` is possible but discouraged.
 * `tokenCommand` is a command line that prints a bearer token (design §23). A profile never mixes
 * the keys of Basic auth, OAuth and bearer tokens.
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
  readonly tokenEnv?: string;
  readonly token?: string;
  readonly tokenCommand?: string;
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

/**
 * Keys of a stored bearer token (design §18, §23): the name of its variable, the token itself, or
 * the command that prints it.
 */
export const BEARER_AUTH_KEYS = [
  'tokenEnv',
  'token',
  'tokenCommand',
] as const satisfies readonly (keyof ProfileAuth)[];

/** Keys of a profile's auth object, in the order they are written to the config file. */
export const PROFILE_AUTH_KEYS = [
  'type',
  ...BASIC_AUTH_KEYS,
  ...OAUTH_AUTH_KEYS,
  ...BEARER_AUTH_KEYS,
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
 * A command line that prints a bearer token (design §23): `--auth-token-command`,
 * OPERATE_TOKEN_COMMAND or auth.tokenCommand. operate runs it when it needs a token.
 */
export interface TokenCommand {
  /** The command line, run by the shell. */
  readonly line: string;
  /** The directory it runs in: the project file's directory; else the current one. */
  readonly cwd?: string;
  /** The project file it comes from: it runs only while that file is trusted. */
  readonly projectFile?: string;
  /** False for a command of a project file that `operate config trust` does not cover. */
  readonly trusted: boolean;
}

/**
 * A bearer token obtained outside operate (design §18): sent as `Authorization: Bearer <token>`.
 * A token given as such is never refreshed and never stored; a token command (design §23) is run
 * again when its token expires or is rejected.
 */
interface BearerBase {
  readonly type: 'bearer';
  readonly source: Source;
  /**
   * Where the token came from, for messages: `--auth-token-stdin`, `OPERATE_TOKEN`, `CI_TOKEN
   * (auth.tokenEnv of profile "p")`, `auth.token of profile "p"`, `OPERATE_TOKEN_COMMAND` or
   * `auth.tokenCommand of profile "p"`.
   */
  readonly origin: string;
  /** The variable that holds the token (OPERATE_TOKEN or the profile's tokenEnv), if any. */
  readonly variable?: string;
  /** The selected profile. */
  readonly profile?: string;
}

/** A bearer token given as such. */
export interface StaticBearerConfig extends BearerBase {
  /** Without a leading "Bearer " and surrounding blanks; an RFC 6750 b64token. */
  readonly token: string;
  readonly command?: undefined;
}

/** A bearer token that a command prints. */
export interface CommandBearerConfig extends BearerBase {
  readonly command: TokenCommand;
  readonly token?: undefined;
}

export type BearerAuthConfig = StaticBearerConfig | CommandBearerConfig;

/**
 * No credentials. `off` says why when Basic auth or OAuth was switched off or a password is set
 * without a username (`Basic auth is switched off by OPERATE_AUTH=none`), for the hint of a 401.
 */
export interface NoAuthConfig {
  readonly type: 'none';
  readonly off?: string;
}

/** The resolved authentication: none, Basic auth credentials, OAuth settings or a bearer token. */
export type AuthConfig = NoAuthConfig | BasicAuthConfig | OAuthConfig | BearerAuthConfig;

/**
 * A bearer token given by OPERATE_TOKEN or `--auth-token-stdin`, or a token command of
 * OPERATE_TOKEN_COMMAND or `--auth-token-command` (`command`), that the resolved auth type does
 * not use (an explicit none, basic or oauth); `config show` reports it. Never validated.
 */
export interface UnusedToken {
  readonly value: string;
  /** `value` is a command line. */
  readonly command?: boolean;
  readonly source: Source;
  /** `Basic auth is selected by --auth basic`, `bearer auth is switched off by --auth none`. */
  readonly reason: string;
}

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

/**
 * The profile a command uses: none, or a profile of the config file with its name and, when it
 * comes from there, the project file.
 */
export type SelectedProfile =
  | { readonly name?: undefined; readonly profile?: undefined; readonly project?: undefined }
  | { readonly name: string; readonly profile: Profile; readonly project?: ProjectSource };

export interface ConfigFile {
  readonly defaultProfile?: string;
  readonly profiles: Readonly<Record<string, Profile>>;
}

/** A project file (`.operate.json`, design §22) whose profiles a command uses. */
export interface ProjectSource {
  readonly path: string;
  /** Its directory: the token commands of its profiles run there. */
  readonly directory: string;
  /**
   * `operate config trust` covers its current content, so its token commands may run and the
   * variables it names for secrets may be read; only looked up for a file with such settings
   * (false otherwise).
   */
  readonly trusted: boolean;
}

/**
 * The profiles a command sees (design §22): the config file named by `--config` or
 * OPERATE_CONFIG, else the project file merged with the user's config file (the user's profile
 * wins on a name clash, the project's defaultProfile wins). Never written to a file.
 */
export interface LoadedConfig extends ConfigFile {
  readonly project?: {
    readonly source: ProjectSource;
    /** The profiles that come from the project file (the user's file does not override them). */
    readonly profiles: readonly string[];
    /** True when `defaultProfile` is the project file's. */
    readonly defaultProfile: boolean;
  };
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
  /** The bearer token read from stdin for `--auth-token-stdin`. */
  readonly authToken?: string;
  /** `--auth-token-command <cmd>` */
  readonly authTokenCommand?: string;
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
  /** A bearer token that is set but not used by the resolved auth type. */
  readonly unusedToken?: UnusedToken;
  /** The project file the selected profile comes from. */
  readonly project?: ProjectSource;
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
  token: 'OPERATE_TOKEN',
  tokenCommand: 'OPERATE_TOKEN_COMMAND',
  headers: 'OPERATE_HEADERS',
  readOnly: 'OPERATE_READ_ONLY',
} as const;
