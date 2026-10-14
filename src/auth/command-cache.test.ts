import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jwtWith, NOW_S, VALID_CLAIMS } from '../../test/support/bearer.js';
import { fakeRuntime, fileText } from '../../test/support/fake-runtime.js';
import { authDeps, TOKEN_DIR } from '../../test/support/oauth.js';
import type { TokenCommand } from '../config/types.js';
import type { FileSystem } from '../runtime.js';
import {
  type CommandToken,
  commandCachePath,
  isFresh,
  readCommandToken,
  writeCommandToken,
} from './command-cache.js';

const NOW = NOW_S * 1000;
const COMMAND: TokenCommand = { line: './token.sh dev', cwd: '/repo', trusted: true };
const JWT = jwtWith(VALID_CLAIMS);
const ENTRY: CommandToken = { token: JWT, expiresAt: NOW + 3_600_000, fetchedAt: NOW };

function deps(files: Record<string, string> = {}, cwd = '/work') {
  const runtime = fakeRuntime({ files, cwd });
  return { runtime, deps: authDeps(runtime) };
}

describe('commandCachePath', () => {
  it('is a file of the token directory named by a hash of the command and its directory', async () => {
    const { deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    expect(path).toMatch(new RegExp(`^${TOKEN_DIR}/command-[0-9a-f]{32}\\.json$`));
    expect(await commandCachePath({ ...COMMAND, trusted: false }, d)).toBe(path);
    expect(await commandCachePath({ line: COMMAND.line, trusted: true }, d)).not.toBe(path);
    expect(await commandCachePath({ ...COMMAND, line: './token.sh prod' }, d)).not.toBe(path);
    // no separator ambiguity between the line and the directory
    expect(await commandCachePath({ line: 'a', cwd: 'b c', trusted: true }, d)).not.toBe(
      await commandCachePath({ line: 'a b', cwd: 'c', trusted: true }, d),
    );
  });

  it('keys a command without its own directory on the working directory it runs in', async () => {
    const line = { line: './token.sh', trusted: true };
    const inA = await commandCachePath(line, deps({}, '/a').deps);
    expect(await commandCachePath(line, deps({}, '/b').deps)).not.toBe(inA);
    expect(await commandCachePath({ ...line, cwd: '/a' }, deps({}, '/b').deps)).toBe(inA);
  });
});

describe('isFresh', () => {
  it('keeps a token until 60 s before exp, at most half its lifetime', () => {
    expect(isFresh(ENTRY, NOW + 3_540_000 - 1)).toBe(true);
    expect(isFresh(ENTRY, NOW + 3_540_000)).toBe(false);
    const short = { token: JWT, expiresAt: NOW + 60_000, fetchedAt: NOW };
    expect(isFresh(short, NOW + 29_999)).toBe(true);
    expect(isFresh(short, NOW + 30_000)).toBe(false);
  });

  it('keeps a token without expiry (opaque) for the whole call', () => {
    expect(isFresh({ token: 'opaque', expiresAt: null, fetchedAt: NOW }, NOW + 1e9)).toBe(true);
  });

  it('is never fresh past exp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e7 }), fc.integer({ min: 0, max: 1e7 }), (a, b) => {
        const entry = { token: JWT, expiresAt: NOW + a, fetchedAt: NOW };
        expect(isFresh(entry, NOW + a + b)).toBe(false);
      }),
    );
  });
});

describe('writeCommandToken and readCommandToken', () => {
  it('writes a JWT with exp privately and reads it back only for the same command', async () => {
    const { runtime, deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    expect(await writeCommandToken(path, COMMAND, ENTRY, d)).toBe(true);
    expect(runtime.files.get(path)?.mode).toBe(0o600);
    expect(runtime.dirModes.get(TOKEN_DIR)).toBe(0o700);
    expect(JSON.parse(fileText(runtime, path) ?? '')).toEqual({
      version: 1,
      command: './token.sh dev',
      cwd: '/repo',
      token: JWT,
      expiresAt: ENTRY.expiresAt,
      fetchedAt: NOW,
    });
    expect(await readCommandToken(path, COMMAND, d)).toEqual(ENTRY);
    expect(await readCommandToken(path, { ...COMMAND, line: 'other' }, d)).toBeUndefined();
    expect(await readCommandToken(path, { line: COMMAND.line, trusted: true }, d)).toBeUndefined();
  });

  it('records the working directory of a command without its own one', async () => {
    const { runtime, deps: d } = deps({}, '/a');
    const command = { line: './token.sh', trusted: true };
    const path = await commandCachePath(command, d);
    expect(await writeCommandToken(path, command, ENTRY, d)).toBe(true);
    expect(JSON.parse(fileText(runtime, path) ?? '')).toMatchObject({ cwd: '/a' });
    expect(await readCommandToken(path, command, d)).toEqual(ENTRY);
    // the same file read from another working directory is not this command's
    expect(await readCommandToken(path, command, { ...d, cwd: '/b' })).toBeUndefined();
  });

  it('caches no token without expiry and never throws on a failing write', async () => {
    const { runtime, deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    const opaque = { token: 'opaque', expiresAt: null, fetchedAt: NOW };
    expect(await writeCommandToken(path, COMMAND, opaque, d)).toBe(false);
    expect(runtime.files.has(path)).toBe(false);
    const fs: FileSystem = { ...runtime.fs, writeFile: () => Promise.reject(new Error('EACCES')) };
    expect(await writeCommandToken(path, COMMAND, ENTRY, { ...d, fs })).toBe(false);
  });

  it('ignores a missing, unreadable or unusable cache file', async () => {
    const { runtime, deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    expect(await readCommandToken(path, COMMAND, d)).toBeUndefined();
    const fs: FileSystem = { ...runtime.fs, readFile: () => Promise.reject(new Error('EACCES')) };
    expect(await readCommandToken(path, COMMAND, { ...d, fs })).toBeUndefined();
    const valid = { version: 1, command: COMMAND.line, cwd: '/repo', token: JWT };
    for (const content of [
      '{',
      '[]',
      JSON.stringify({ ...valid, version: 2, expiresAt: 1, fetchedAt: 1 }),
      JSON.stringify({ ...valid, expiresAt: 1 }),
      JSON.stringify({ ...valid, expiresAt: 'soon', fetchedAt: 1 }),
      JSON.stringify({ ...valid, expiresAt: 1, fetchedAt: null }),
      JSON.stringify({ ...valid, token: 7, expiresAt: 1, fetchedAt: 1 }),
      JSON.stringify({ ...valid, token: 'not a token', expiresAt: 1, fetchedAt: 1 }),
    ]) {
      runtime.files.set(path, { data: new TextEncoder().encode(content) });
      expect(await readCommandToken(path, COMMAND, d), content).toBeUndefined();
    }
    runtime.files.set(path, {
      data: new TextEncoder().encode(JSON.stringify({ ...valid, expiresAt: 5, fetchedAt: 4 })),
    });
    expect(await readCommandToken(path, COMMAND, d)).toEqual({
      token: JWT,
      expiresAt: 5,
      fetchedAt: 4,
    });
  });
});
