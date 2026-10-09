/**
 * Resolves the effective configuration. Precedence per value: flag > environment > profile > default.
 * Pure: the config file content and the environment are passed in. The validators are shared with
 * the config file parser and the `operate config` edit functions.
 */

import type { OperateError } from '../errors.js';
import { compact, mergeHeaders } from '../util.js';
import { configError } from './config-error.js';
import { parseEnvHeaders, parseHeaders } from './headers.js';
import {
  AUTH_TYPES,
  type AuthConfig,
  type ConfigFile,
  type ConfigFlags,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_URL,
  ENV,
  OUTPUT_FORMATS,
  type OutputFormat,
  type Profile,
  type ResolvedConfig,
  type Source,
} from './types.js';

type Env = Readonly<Record<string, string | undefined>>;

interface Picked<T> {
  readonly value: T | undefined;
  readonly source: Source;
}

/** Largest delay a Node.js timer supports (2^31 - 1 ms, about 24.8 days). */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** Planned auth types, tracked as GitHub issues. */
const AUTH_ISSUES = {
  basic: 'https://github.com/Miragon/operate/issues/1',
  oauth: 'https://github.com/Miragon/operate/issues/2',
} as const;

const TRUE_VALUES: readonly string[] = ['1', 'true', 'yes', 'on'];
const FALSE_VALUES: readonly string[] = ['0', 'false', 'no', 'off'];

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function pick<T>(flag: T | undefined, env: T | undefined, profile: T | undefined): Picked<T> {
  if (flag !== undefined) return { value: flag, source: 'flag' };
  if (env !== undefined) return { value: env, source: 'env' };
  if (profile !== undefined) return { value: profile, source: 'profile' };
  return { value: undefined, source: 'default' };
}

/** Where the name of the selected profile came from. */
export type ProfileOrigin = 'flag' | 'env' | 'default';

const ORIGIN_NOTES: Readonly<Record<ProfileOrigin, string>> = {
  flag: '',
  env: `It is selected by ${ENV.profile}. `,
  default:
    'It is the defaultProfile of the config file; choose another one with `operate config use <profile>`. ',
};

/** Error for a profile name that is not in the config file, with the known profiles as hint. */
export function missingProfileError(
  name: string,
  file: ConfigFile | undefined,
  origin: ProfileOrigin = 'flag',
): OperateError {
  const known = Object.keys(file?.profiles ?? {});
  const listed = known.length > 0 ? `Known profiles: ${known.join(', ')}. ` : '';
  return configError(
    `Profile "${name}" does not exist`,
    `${ORIGIN_NOTES[origin]}${listed}Create it with \`operate config set ${name} --url <url>\`.`,
  );
}

/** The profile stored under `name`; inherited object properties never count as profiles. */
export function findProfile(file: ConfigFile | undefined, name: string): Profile | undefined {
  return file !== undefined && Object.hasOwn(file.profiles, name) ? file.profiles[name] : undefined;
}

function profileName(
  flags: ConfigFlags,
  env: Env,
  file: ConfigFile | undefined,
): { name: string; origin: ProfileOrigin } | undefined {
  const flag = nonEmpty(flags.profile);
  if (flag !== undefined) return { name: flag, origin: 'flag' };
  const fromEnv = nonEmpty(env[ENV.profile]);
  if (fromEnv !== undefined) return { name: fromEnv, origin: 'env' };
  const fallback = nonEmpty(file?.defaultProfile);
  return fallback === undefined ? undefined : { name: fallback, origin: 'default' };
}

export function selectProfile(
  flags: ConfigFlags,
  env: Env,
  file: ConfigFile | undefined,
): { name?: string; profile?: Profile } {
  const selected = profileName(flags, env, file);
  if (selected === undefined) return {};
  const profile = findProfile(file, selected.name);
  if (profile === undefined) throw missingProfileError(selected.name, file, selected.origin);
  return { name: selected.name, profile };
}

/**
 * A rejected URL as error messages may show it: without query and fragment (tokens such as
 * `?access_token=`) and with everything before an `@` hidden, with or without `//` (a forgotten
 * scheme makes `user:password@host` parse as scheme `user:`).
 */
export function redactUrl(url: string): string {
  const [base = ''] = url.split(/[?#]/, 1);
  const suffix = base.length < url.length ? '?…' : '';
  const at = base.lastIndexOf('@');
  if (at < 0) return `${base}${suffix}`;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(base)?.[0] ?? '';
  return `${scheme}***${base.slice(at)}${suffix}`;
}

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw configError(`Invalid engine URL "${redactUrl(url)}"`, `Example: ${DEFAULT_URL}`);
  }
}

/** Checks the REST API root URL and removes surrounding blanks and trailing slashes. */
export function validateUrl(url: string): string {
  const trimmed = url.trim();
  const parsed = parseUrl(trimmed);
  // checked first, because the other messages repeat the URL and must never show credentials
  if (parsed.username !== '' || parsed.password !== '') {
    throw configError(
      'Engine URL must not contain credentials',
      `Remove the user info from the URL. Basic auth is planned, see ${AUTH_ISSUES.basic}.`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw configError(
      `Engine URL must start with http:// or https://, got "${redactUrl(trimmed)}"`,
      `Example: ${DEFAULT_URL}`,
    );
  }
  if (/[?#]/.test(trimmed)) {
    throw configError(
      `Engine URL must not contain a query string or fragment, got "${redactUrl(trimmed)}"`,
      `Pass credentials as a header (-H, ${ENV.headers}) instead. Example URL: ${DEFAULT_URL}`,
    );
  }
  return trimmed.replace(/\/+$/, '');
}

/** True for a usable engine name: not blank, not "." or ".." (they would leave /engine/{name}). */
export function isEngineName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== '.' && trimmed !== '..';
}

/** Checks a process engine name and trims it. */
export function validateEngine(engine: string): string {
  const trimmed = engine.trim();
  if (trimmed === '') {
    throw configError(
      'Engine name must not be empty',
      'Remove it with `operate config unset <profile> engine` to use the default engine.',
    );
  }
  if (!isEngineName(trimmed)) {
    throw configError(
      `Invalid process engine name "${trimmed}"`,
      'Use the name of a process engine as listed by `operate ping`, e.g. default; omit it for the default engine.',
    );
  }
  return trimmed;
}

export function validateOutput(output: string): OutputFormat {
  const format = OUTPUT_FORMATS.find((candidate) => candidate === output);
  if (format === undefined) {
    throw configError(
      `Unknown output format "${output}"`,
      `Use one of: ${OUTPUT_FORMATS.join(', ')}`,
    );
  }
  return format;
}

/** True for a timeout a Node.js timer can handle: a whole number of ms in 1..MAX_TIMEOUT_MS. */
export function isTimeout(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS
  );
}

export function parseTimeout(value: string | number): number {
  const timeout = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!isTimeout(timeout)) {
    throw configError(
      `Timeout must be a positive number of milliseconds, got "${value}"`,
      `Use a whole number between 1 and ${MAX_TIMEOUT_MS}, e.g. 60000 for one minute.`,
    );
  }
  return timeout;
}

export function validateAuth(type: string): AuthConfig {
  const known = AUTH_TYPES.find((candidate) => candidate === type);
  if (known === undefined) {
    throw configError(
      `Unsupported auth type "${type}"`,
      `Supported: ${AUTH_TYPES.join(', ')}. Basic auth (${AUTH_ISSUES.basic}) and OAuth authorization code (${AUTH_ISSUES.oauth}) are planned.`,
    );
  }
  return { type: known };
}

/** Parses OPERATE_READ_ONLY. Blank means unset; unknown values fail instead of silently disabling. */
export function parseReadOnly(value: string | undefined): boolean | undefined {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (normalized === undefined) return undefined;
  if (TRUE_VALUES.includes(normalized)) return true;
  if (FALSE_VALUES.includes(normalized)) return false;
  throw configError(
    `Invalid ${ENV.readOnly} value "${normalized}"`,
    `Use one of: ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')}.`,
  );
}

/** The most specific source that contributed headers. */
function headerSource(...layers: readonly (readonly [Source, object])[]): Source {
  return layers.find(([, headers]) => Object.keys(headers).length > 0)?.[0] ?? 'default';
}

/** Headers merge per name: profile, then OPERATE_HEADERS, then -H flags (later wins). */
function resolveHeaders(flags: ConfigFlags, env: Env, profile: Profile | undefined) {
  const fromFlags = parseHeaders(flags.headers ?? []);
  const fromEnv = parseEnvHeaders(env[ENV.headers]);
  const fromProfile = profile?.headers ?? {};
  return {
    value: mergeHeaders(fromProfile, fromEnv, fromFlags),
    source: headerSource(['flag', fromFlags], ['env', fromEnv], ['profile', fromProfile]),
  };
}

function pickAll(flags: ConfigFlags, env: Env, profile: Profile | undefined) {
  return {
    url: pick(nonEmpty(flags.url), nonEmpty(env[ENV.url]), profile?.url),
    engine: pick(nonEmpty(flags.engine), nonEmpty(env[ENV.engine]), profile?.engine),
    output: pick(nonEmpty(flags.output), nonEmpty(env[ENV.output]), profile?.output),
    timeout: pick<string | number>(flags.timeout, nonEmpty(env[ENV.timeout]), profile?.timeout),
    auth: pick(undefined, nonEmpty(env[ENV.auth]), profile?.auth?.type),
    readOnly: pick(flags.readOnly, parseReadOnly(env[ENV.readOnly]), profile?.readOnly),
    headers: resolveHeaders(flags, env, profile),
  };
}

export function resolveConfig(
  flags: ConfigFlags,
  env: Env,
  file: ConfigFile | undefined,
): ResolvedConfig {
  const { name, profile } = selectProfile(flags, env, file);
  const picked = pickAll(flags, env, profile);
  const { url, engine, output, timeout, auth, readOnly, headers } = picked;
  return {
    ...compact({
      profile: name,
      engine: engine.value === undefined ? undefined : validateEngine(engine.value),
      output: output.value === undefined ? undefined : validateOutput(output.value),
    }),
    url: validateUrl(url.value ?? DEFAULT_URL),
    auth: validateAuth(auth.value ?? 'none'),
    timeoutMs: timeout.value === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(timeout.value),
    headers: headers.value,
    readOnly: readOnly.value ?? false,
    sources: {
      url: url.source,
      engine: engine.source,
      auth: auth.source,
      output: output.source,
      timeout: timeout.source,
      headers: headers.source,
      readOnly: readOnly.source,
    },
  };
}
