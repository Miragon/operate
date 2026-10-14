import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeRuntime, fileText } from '../../test/support/fake-runtime.js';
import { OperateError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import {
  contentHash,
  isTrusted,
  parseTrustStore,
  readTrustStore,
  trustStorePath,
  withTrust,
  writeTrustStore,
} from './trust.js';

const STORE = '/home/me/.config/operate/trusted.json';
const HASH = 'a'.repeat(64);

async function failure(action: () => Promise<unknown>): Promise<OperateError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof OperateError) return error;
    throw error;
  }
  throw new Error('expected an OperateError');
}

describe('trustStorePath', () => {
  it('lies in the operate config directory', () => {
    expect(trustStorePath({}, { homedir: '/home/me', platform: 'linux' })).toBe(STORE);
    expect(trustStorePath({ XDG_CONFIG_HOME: '/xdg' }, { homedir: '/h', platform: 'linux' })).toBe(
      '/xdg/operate/trusted.json',
    );
    expect(
      trustStorePath({ APPDATA: 'D:\\Roaming' }, { homedir: 'C:\\h', platform: 'win32' }),
    ).toBe('D:\\Roaming\\operate\\trusted.json');
  });
});

describe('contentHash', () => {
  it('is the SHA-256 of the bytes in hex', async () => {
    expect(await contentHash(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('parseTrustStore', () => {
  it('reads the files and their hashes', () => {
    const text = JSON.stringify({ files: { '/r/.operate.json': HASH } });
    expect(parseTrustStore(text, STORE)).toEqual({ files: { '/r/.operate.json': HASH } });
    expect(parseTrustStore('{"files":{}}', STORE)).toEqual({ files: {} });
  });

  it.each([
    '{',
    '[]',
    '{}',
    '{"files":[]}',
    '{"files":{"/r":"short"}}',
    `{"files":{"/r":1}}`,
    `{"files":{"/r":["${HASH}"]}}`,
    `{"files":{"/r":"x${HASH}"}}`,
    `{"files":{"/r":"${HASH}x"}}`,
    `{"files":{"/r":"${HASH.toUpperCase()}"}}`,
  ])('refuses %s with a CONFIG error that never quotes the content', (text) => {
    let error: unknown;
    try {
      parseTrustStore(text, STORE);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(OperateError);
    expect((error as OperateError).message).toBe(`Invalid trust store ${STORE}`);
    expect((error as OperateError).details.hint).toContain('Remove the file');
  });
});

describe('readTrustStore and writeTrustStore', () => {
  it('trusts nothing without a file, and reads back what it wrote (0600)', async () => {
    const runtime = fakeRuntime();
    expect(await readTrustStore(runtime.fs, STORE)).toEqual({ files: {} });
    await writeTrustStore(runtime.fs, STORE, { files: { '/r/.operate.json': HASH } });
    expect(runtime.files.get(STORE)?.mode).toBe(0o600);
    expect(runtime.dirs.has('/home/me/.config/operate')).toBe(true);
    expect(fileText(runtime, STORE)).toBe(
      `${JSON.stringify({ files: { '/r/.operate.json': HASH } }, null, 2)}\n`,
    );
    expect(await readTrustStore(runtime.fs, STORE)).toEqual({
      files: { '/r/.operate.json': HASH },
    });
  });

  it('reports read and write failures with their reason', async () => {
    const runtime = fakeRuntime({ dirs: [STORE] });
    const read = await failure(() => readTrustStore(runtime.fs, STORE));
    expect(read.message).toBe(`Cannot read trust store ${STORE} (EISDIR)`);
    const write = await failure(() => writeTrustStore(runtime.fs, STORE, { files: {} }));
    expect(write.message).toBe(`Cannot write trust store ${STORE} (EISDIR)`);
    expect(write.details.hint).toContain('operate config directory');
    const broken: FileSystem = {
      ...runtime.fs,
      exists: () => Promise.reject(new Error('gone')),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection
      mkdir: () => Promise.reject('odd'),
    };
    expect((await failure(() => readTrustStore(broken, STORE))).message).toBe(
      `Cannot read trust store ${STORE} (gone)`,
    );
    expect((await failure(() => writeTrustStore(broken, STORE, { files: {} }))).message).toBe(
      `Cannot write trust store ${STORE} (odd)`,
    );
  });
});

describe('isTrusted and withTrust', () => {
  it('trusts a path only with the hash of the content that was trusted', () => {
    const store = withTrust({ files: {} }, '/r/.operate.json', HASH);
    expect(isTrusted(store, '/r/.operate.json', HASH)).toBe(true);
    expect(isTrusted(store, '/r/.operate.json', 'b'.repeat(64))).toBe(false);
    expect(isTrusted(store, '/other/.operate.json', HASH)).toBe(false);
    // inherited properties never count
    expect(isTrusted(store, 'toString', HASH)).toBe(false);
  });

  it('replaces the hash of a path and removes it, keeping the others', () => {
    const store = { files: { '/a': HASH, '/b': HASH } };
    expect(withTrust(store, '/a', 'c'.repeat(64))).toStrictEqual({
      files: { '/b': HASH, '/a': 'c'.repeat(64) },
    });
    expect(withTrust(store, '/a', undefined)).toStrictEqual({ files: { '/b': HASH } });
    expect(store).toEqual({ files: { '/a': HASH, '/b': HASH } });
  });

  it('trusts exactly what withTrust recorded last', () => {
    const path = fc.constantFrom('/a', '/b', '/c');
    const hash = fc.option(fc.constantFrom(HASH, 'd'.repeat(64)), { nil: undefined });
    fc.assert(
      fc.property(fc.array(fc.tuple(path, hash)), (steps) => {
        const store = steps.reduce(
          (current, [file, value]) => withTrust(current, file, value),
          parseTrustStore('{"files":{}}', STORE),
        );
        for (const file of ['/a', '/b', '/c']) {
          const last = steps.filter(([candidate]) => candidate === file).at(-1)?.[1];
          expect(isTrusted(store, file, HASH)).toBe(last === HASH);
        }
      }),
    );
  });
});
