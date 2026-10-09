/** Configuration model: config file, profiles and the resolved effective configuration. */

export const OUTPUT_FORMATS = ['json', 'table'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const AUTH_TYPES = ['none'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export interface AuthConfig {
  readonly type: AuthType;
}

export interface Profile {
  readonly url?: string;
  readonly engine?: string;
  readonly auth?: AuthConfig;
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
}

export type Source = 'flag' | 'env' | 'profile' | 'default';

export interface ResolvedConfig {
  readonly profile?: string;
  readonly url: string;
  readonly engine?: string;
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
  headers: 'OPERATE_HEADERS',
  readOnly: 'OPERATE_READ_ONLY',
} as const;
