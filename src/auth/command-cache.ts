/**
 * The cache of tokens a token command printed (design §23). A JWT with `exp` is kept in
 * `command-<hash>.json` of the token directory (mode 0600, written atomically) until shortly
 * before it expires, so later and parallel commands do not run the command again: a token is
 * reused until 60 s before its `exp`, at most half of its lifetime (short-lived dev realm tokens
 * of 60 s are reused for 30 s). The hash covers the command line and the directory it runs in (the
 * project file's, else the working directory, so `./token.sh` of two repositories never shares a
 * token), and the file repeats both: it only counts when they match. Opaque tokens and JWTs
 * without `exp` are never cached. A cache file that cannot be read or written is ignored: the
 * command runs again.
 */

import { normalizeToken } from '../config/bearer.js';
import type { TokenCommand } from '../config/types.js';
import { isRecord, sha256Hex } from '../util.js';
import { refreshMargin } from './oauth/expiry.js';
import type { OAuthDeps } from './oauth/types.js';

/** A token the command printed, with its expiry (epoch ms; null when unknown). */
export interface CommandToken {
  readonly token: string;
  readonly expiresAt: number | null;
  /** When the command printed it. */
  readonly fetchedAt: number;
}

/** The token directory, and the working directory that commands without their own one run in. */
export interface CommandCacheDeps extends Pick<OAuthDeps, 'fs' | 'tokenDir' | 'tokenPath'> {
  readonly cwd: string;
}

/** The directory the command runs in: the project file's, else the working directory. */
function directoryOf(command: TokenCommand, deps: CommandCacheDeps): string {
  return command.cwd ?? deps.cwd;
}

/** The cache file of a command: `command-<first 32 hex chars of SHA-256([line, dir])>.json`. */
export async function commandCachePath(
  command: TokenCommand,
  deps: CommandCacheDeps,
): Promise<string> {
  const hash = await sha256Hex(JSON.stringify([command.line, directoryOf(command, deps)]));
  return deps.tokenPath(`command-${hash.slice(0, 32)}.json`);
}

/** True while the token may still be sent without running the command again. */
export function isFresh(entry: CommandToken, now: number): boolean {
  const { expiresAt } = entry;
  return expiresAt === null || now < expiresAt - refreshMargin(expiresAt, entry.fetchedAt);
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

/** The JSON value of a cache file of exactly this command in `directory`, else undefined. */
function entryOf(
  text: string,
  command: TokenCommand,
  directory: string,
): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.version !== 1) return undefined;
  return value.command === command.line && value.cwd === directory ? value : undefined;
}

/** The cached token of exactly this command, else undefined (also for any unusable file). */
function parseEntry(
  text: string,
  command: TokenCommand,
  directory: string,
): CommandToken | undefined {
  const { token, expiresAt, fetchedAt } = entryOf(text, command, directory) ?? {};
  if (typeof token !== 'string' || !isFiniteNumber(expiresAt) || !isFiniteNumber(fetchedAt)) {
    return undefined;
  }
  try {
    return { token: normalizeToken(token, 'the token cache'), expiresAt, fetchedAt };
  } catch {
    return undefined;
  }
}

/** The cached token of the command, if a usable cache file exists. Never throws. */
export async function readCommandToken(
  path: string,
  command: TokenCommand,
  deps: CommandCacheDeps,
): Promise<CommandToken | undefined> {
  try {
    // a missing file fails to read like any other
    const text = new TextDecoder().decode(await deps.fs.readFile(path));
    return parseEntry(text, command, directoryOf(command, deps));
  } catch {
    return undefined;
  }
}

/**
 * Caches a token with a known expiry (atomically, 0600 in a 0700 directory); false when that is
 * not possible. Never throws: the token is still sent.
 */
export async function writeCommandToken(
  path: string,
  command: TokenCommand,
  entry: CommandToken,
  deps: CommandCacheDeps,
): Promise<boolean> {
  if (entry.expiresAt === null) return false;
  const value = {
    version: 1,
    command: command.line,
    cwd: directoryOf(command, deps),
    token: entry.token,
    expiresAt: entry.expiresAt,
    fetchedAt: entry.fetchedAt,
  };
  try {
    await deps.fs.mkdir(deps.tokenDir, { mode: 0o700 });
    await deps.fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
