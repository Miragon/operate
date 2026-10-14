/**
 * Trust in project files (design §23). A token command of a project file runs code from the
 * repository, and a variable it names for a secret goes to the engine URL it names, so both take
 * effect only once a person ran `operate config trust` for the current content of that file, like
 * direnv's `allow`. The trust store `trusted.json` in the operate config directory maps the path
 * of each trusted project file to the SHA-256 of the content that was trusted: any change of the
 * file needs a new `operate config trust`. Profiles, URLs and the other settings of a project file
 * need no trust; only its token commands and secret variables do (TRUST_KEYS of project.ts).
 */

import { dirname } from 'node:path';
import type { OperateError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import { isRecord, sha256Hex } from '../util.js';
import { configError } from './config-error.js';
import { type Location, operateDirectory, pathModule } from './file.js';
import type { Env } from './pick.js';

/** The trusted project files: path → SHA-256 (hex) of the trusted content. */
export interface TrustStore {
  readonly files: Readonly<Record<string, string>>;
}

const EMPTY: TrustStore = { files: {} };

const SHA256 = /^[0-9a-f]{64}$/;

/** `trusted.json` in the operate config directory (never next to a project file). */
export function trustStorePath(env: Env, location: Location): string {
  return pathModule(location.platform).join(operateDirectory(env, location), 'trusted.json');
}

/** The SHA-256 (hex) of a project file's content, as the trust store records it. */
export function contentHash(content: Uint8Array): Promise<string> {
  return sha256Hex(content);
}

function invalid(path: string): OperateError {
  return configError(
    `Invalid trust store ${path}`,
    'Remove the file; `operate config trust` in a repository creates it again for the project file you trust.',
  );
}

/** The trust store of `text`; CONFIG for anything that is not one (never quoted). */
export function parseTrustStore(text: string, path: string): TrustStore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid(path);
  }
  const files = isRecord(parsed) ? parsed.files : undefined;
  if (
    !isRecord(files) ||
    !Object.values(files).every((hash) => typeof hash === 'string' && SHA256.test(hash))
  ) {
    throw invalid(path);
  }
  return { files: files as Record<string, string> };
}

/** `EACCES`, `EISDIR`, ... of a file system error, else its message. */
function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

function ioError(action: 'read' | 'write', path: string, error: unknown): OperateError {
  return configError(
    `Cannot ${action} trust store ${path} (${reasonOf(error)})`,
    'Check the permissions of the operate config directory (`operate config path` shows it).',
  );
}

/** Reads the trust store; a missing file trusts nothing. */
export async function readTrustStore(fs: FileSystem, path: string): Promise<TrustStore> {
  let data: Uint8Array;
  try {
    if (!(await fs.exists(path))) return EMPTY;
    data = await fs.readFile(path);
  } catch (error) {
    throw ioError('read', path, error);
  }
  return parseTrustStore(new TextDecoder().decode(data), path);
}

/** Writes the trust store with mode 0600. */
export async function writeTrustStore(
  fs: FileSystem,
  path: string,
  store: TrustStore,
): Promise<void> {
  try {
    await fs.mkdir(dirname(path));
    await fs.writeFile(path, `${JSON.stringify({ files: store.files }, null, 2)}\n`, {
      mode: 0o600,
    });
  } catch (error) {
    throw ioError('write', path, error);
  }
}

/** True when the store trusts the project file at `path` with exactly this content. */
export function isTrusted(store: TrustStore, path: string, hash: string): boolean {
  return Object.hasOwn(store.files, path) && store.files[path] === hash;
}

/** The store trusting `path` with the content `hash`, or no longer trusting it (undefined). */
export function withTrust(store: TrustStore, path: string, hash: string | undefined): TrustStore {
  const files = Object.entries(store.files).filter(([candidate]) => candidate !== path);
  return { files: Object.fromEntries(hash === undefined ? files : [...files, [path, hash]]) };
}
