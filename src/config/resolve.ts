/**
 * Resolves the effective configuration. Precedence per value: flag > environment > profile > default.
 * Pure: the config file content and the environment are passed in. The validators are shared with
 * the config file parser and the `operate config` edit functions.
 */

import type { OperateError } from '../errors.js';
import { compact } from '../util.js';
import { configError } from './config-error.js';
import { redactUrl } from './redact.js';
import { resolveHeaders } from './headers.js';
import { type Env, nonEmpty, pick } from './pick.js';
import { authorizationConflict, resolveAuth } from './resolve-auth.js';
import {
  type ConfigFile,
  type ConfigFlags,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_URL,
  ENV,
  OUTPUT_FORMATS,
  type OutputFormat,
  type Profile,
  type ResolvedConfig,
  type SelectedProfile,
} from './types.js';

/** Largest delay a Node.js timer supports (2^31 - 1 ms, about 24.8 days). */
export const MAX_TIMEOUT_MS = 2_147_483_647;

const TRUE_VALUES: readonly string[] = ['1', 'true', 'yes', 'on'];
const FALSE_VALUES: readonly string[] = ['0', 'false', 'no', 'off'];

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
): SelectedProfile {
  const selected = profileName(flags, env, file);
  if (selected === undefined) return {};
  const profile = findProfile(file, selected.name);
  if (profile === undefined) throw missingProfileError(selected.name, file, selected.origin);
  return { name: selected.name, profile };
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
      'Remove the user info from the URL and use Basic auth: --auth basic --auth-user <name> with the password from --auth-password-stdin or OPERATE_PASSWORD.',
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

function pickAll(flags: ConfigFlags, env: Env, profile: Profile | undefined) {
  return {
    url: pick(nonEmpty(flags.url), nonEmpty(env[ENV.url]), profile?.url),
    engine: pick(nonEmpty(flags.engine), nonEmpty(env[ENV.engine]), profile?.engine),
    output: pick(nonEmpty(flags.output), nonEmpty(env[ENV.output]), profile?.output),
    timeout: pick<string | number>(flags.timeout, nonEmpty(env[ENV.timeout]), profile?.timeout),
    readOnly: pick(flags.readOnly, parseReadOnly(env[ENV.readOnly]), profile?.readOnly),
    headers: resolveHeaders(flags, env, profile),
  };
}

/** How the configuration is used: `authCommand` for `operate auth login|status|logout`. */
export interface ResolveOptions {
  readonly authCommand?: boolean;
}

export function resolveConfig(
  flags: ConfigFlags,
  env: Env,
  file: ConfigFile | undefined,
  options: ResolveOptions = {},
): ResolvedConfig {
  const selected = selectProfile(flags, env, file);
  const { url, engine, output, timeout, readOnly, headers } = pickAll(flags, env, selected.profile);
  const values = {
    ...compact({
      profile: selected.name,
      engine: engine.value === undefined ? undefined : validateEngine(engine.value),
      output: output.value === undefined ? undefined : validateOutput(output.value),
    }),
    url: validateUrl(url.value ?? DEFAULT_URL),
    timeoutMs: timeout.value === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(timeout.value),
    headers: headers.value,
    readOnly: readOnly.value ?? false,
  };
  const auth = resolveAuth(flags, env, selected);
  const conflict = authorizationConflict(
    auth.auth,
    headers.authorization,
    selected.name,
    options.authCommand,
  );
  if (conflict !== undefined) throw conflict;
  return {
    ...values,
    auth: auth.auth,
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
