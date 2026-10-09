/** Location, parsing, validation and persistence of the config file. */

import { dirname, posix, win32 } from 'node:path';
import { OperateError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import { isRecord } from '../util.js';
import { jsonErrorPosition } from './json-position.js';
import { configError } from './config-error.js';
import { isHeaderName, isHeaderValue } from './headers.js';
import { MAX_TIMEOUT_MS, isEngineName, isTimeout } from './resolve.js';
import {
  type ConfigFile,
  ENV,
  OUTPUT_FORMATS,
  PROFILE_KEYS,
  type Profile,
  type ProfileKey,
} from './types.js';

type Env = Readonly<Record<string, string | undefined>>;

const ROOT_KEYS: readonly string[] = ['$schema', 'defaultProfile', 'profiles'];

function given(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** An environment directory is only used when it is an absolute path (XDG Base Directory spec). */
function absoluteDir(value: string | undefined, path: typeof posix): string | undefined {
  return value !== undefined && path.isAbsolute(value) ? value : undefined;
}

/** The config file named by `--config` or OPERATE_CONFIG, if any (else the default location). */
export function explicitConfigPath(env: Env, flag?: string): string | undefined {
  return given(flag) ?? given(env[ENV.config]);
}

/**
 * Config file location: `--config` > OPERATE_CONFIG > $XDG_CONFIG_HOME/operate/config.json >
 * ~/.config/operate/config.json; on Windows %APPDATA%\operate\config.json.
 */
export function configFilePath(
  env: Env,
  location: { readonly homedir: string; readonly platform: string },
  explicit?: string,
): string {
  const chosen = explicitConfigPath(env, explicit);
  if (chosen !== undefined) return chosen;
  if (location.platform === 'win32') {
    const appData =
      absoluteDir(env.APPDATA, win32) ?? win32.join(location.homedir, 'AppData', 'Roaming');
    return win32.join(appData, 'operate', 'config.json');
  }
  const configHome =
    absoluteDir(env.XDG_CONFIG_HOME, posix) ?? posix.join(location.homedir, '.config');
  return posix.join(configHome, 'operate', 'config.json');
}

function fail(path: string, problem: string): never {
  throw configError(
    `Invalid config file ${path}: ${problem}`,
    'Fix the file or recreate it with `operate config set`.',
  );
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(path, `unknown key(s) ${unknown.join(', ')} in ${where} (allowed: ${allowed.join(', ')})`);
  }
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function isHeaderMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([name, entry]) => isHeaderName(name) && typeof entry === 'string' && isHeaderValue(entry),
    )
  );
}

type Check = readonly [check: (value: unknown) => boolean, expected: string];

const PROFILE_CHECKS: Readonly<Record<ProfileKey, Check>> = {
  url: [isNonEmptyString, 'a URL such as http://localhost:8080/engine-rest'],
  engine: [isEngineName, 'a process engine name, not "." or ".."'],
  auth: [
    (value) => isRecord(value) && typeof value.type === 'string',
    'an object like {"type": "none"}',
  ],
  output: [
    (value) => OUTPUT_FORMATS.some((format) => format === value),
    OUTPUT_FORMATS.join(' or '),
  ],
  timeout: [isTimeout, `a whole number of milliseconds between 1 and ${MAX_TIMEOUT_MS}`],
  headers: [
    isHeaderMap,
    'an object mapping header names (not Connection, Content-Length, Expect, Keep-Alive, Transfer-Encoding or Upgrade) to ISO-8859-1 (Latin-1) string values without control characters',
  ],
  readOnly: [(value) => typeof value === 'boolean', 'true or false'],
};

function validateProfile(name: string, value: unknown, path: string): Profile {
  if (!isRecord(value)) fail(path, `profile "${name}" must be an object`);
  checkKeys(value, PROFILE_KEYS, `profile "${name}"`, path);
  for (const key of PROFILE_KEYS) {
    const [check, expected] = PROFILE_CHECKS[key];
    if (Object.hasOwn(value, key) && !check(value[key])) {
      fail(path, `profile "${name}" has an invalid ${key} (expected ${expected})`);
    }
  }
  return value;
}

/**
 * "not valid JSON (line 3, column 14)". Never the parser message: V8 quotes the text around the
 * error, which may be a stored credential.
 */
function syntaxProblem(text: string): string {
  const position = jsonErrorPosition(text);
  return position === undefined
    ? 'not valid JSON'
    : `not valid JSON (line ${position.line}, column ${position.column})`;
}

export function parseConfigFile(text: string, path: string): ConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(path, syntaxProblem(text));
  }
  if (!isRecord(parsed)) fail(path, 'expected a JSON object');
  checkKeys(parsed, ROOT_KEYS, 'the root object', path);
  const { defaultProfile, profiles = {} } = parsed;
  if (defaultProfile !== undefined && typeof defaultProfile !== 'string') {
    fail(path, 'defaultProfile must be a string');
  }
  if (!isRecord(profiles)) fail(path, 'profiles must be an object');
  return {
    ...(defaultProfile === undefined ? {} : { defaultProfile }),
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([name, profile]) => [
        name,
        validateProfile(name, profile, path),
      ]),
    ),
  };
}

/** `EACCES`, `EISDIR`, ... of a file system error, else its message. */
function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

function ioError(action: 'read' | 'write', path: string, error: unknown) {
  return configError(
    `Cannot ${action} config file ${path} (${reasonOf(error)})`,
    `Check the path and its permissions, or choose another file with --config or ${ENV.config}.`,
  );
}

/**
 * Reads and validates the config file. A missing file means "no profiles", unless `required` (the
 * user named the file with --config or OPERATE_CONFIG: a typo must not silently drop the
 * profile, its headers and its read-only guard).
 */
export async function readConfigFile(
  fs: FileSystem,
  path: string,
  required = false,
): Promise<ConfigFile | undefined> {
  let data: Uint8Array;
  try {
    if (!(await fs.exists(path))) {
      if (!required) return undefined;
      throw configError(
        `Config file ${path} does not exist`,
        `Create it with \`operate config set <profile> --url <url> --config ${path}\`, or fix the path of --config or ${ENV.config}.`,
      );
    }
    data = await fs.readFile(path);
  } catch (error) {
    throw error instanceof OperateError ? error : ioError('read', path, error);
  }
  return parseConfigFile(new TextDecoder().decode(data), path);
}

/** Writes the file with mode 0600 (it may contain credentials in headers). */
export async function writeConfigFile(
  fs: FileSystem,
  path: string,
  config: ConfigFile,
): Promise<void> {
  try {
    await fs.mkdir(dirname(path));
    await fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    throw ioError('write', path, error);
  }
}
