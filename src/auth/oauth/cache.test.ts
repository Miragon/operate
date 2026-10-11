import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeRuntime, fileText } from '../../../test/support/fake-runtime.js';
import {
  cachedLogin,
  cacheText,
  oauthConfig,
  oauthDeps,
  TOKEN_DIR,
  TOKEN_FILE,
} from '../../../test/support/oauth.js';
import { OperateError } from '../../errors.js';
import type { FileSystem } from '../../runtime.js';
import {
  adoptLegacyLogins,
  cacheFileName,
  cachePath,
  clientAuthOf,
  isLockError,
  profileCachePath,
  readCache,
  removeCache,
  serializeCache,
  withCacheLock,
  writeCache,
} from './cache.js';
import { identityOf, sameIdentity } from './identity.js';
import type { CachedLogin } from './types.js';

const NOW = 1_700_000_000_000;

async function rejection(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

function failingFs(method: keyof FileSystem, code: string): FileSystem {
  const fail = () => Promise.reject(Object.assign(new Error(code), { code }));
  const fs = fakeRuntime({ files: { [TOKEN_FILE]: '{}' } }).fs;
  return { ...fs, [method]: fail };
}

const text = fc.string({ maxLength: 20 });
const optionalText = fc.option(text, { nil: null });
const optionalNumber = fc.option(fc.integer({ min: 0, max: 2 ** 45 }), { nil: null });
const logins: fc.Arbitrary<CachedLogin> = fc
  .record({
    version: fc.constant(1 as const),
    identity: fc.record({
      issuer: optionalText,
      tokenEndpoint: optionalText,
      clientId: text,
      audience: optionalText,
      scopes: fc.array(text, { maxLength: 4 }),
    }),
    endpoints: fc.record({
      token: text,
      revocation: optionalText,
      clientAuthMethod: fc.constantFrom('none', 'client_secret_basic', 'client_secret_post'),
    }),
    tokenType: fc.constant('Bearer'),
    accessToken: fc.string({ minLength: 1, maxLength: 40 }),
    expiresAt: optionalNumber,
    refreshToken: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
    refreshExpiresAt: optionalNumber,
    scope: optionalText,
    subject: optionalText,
    user: optionalText,
    loggedInAt: fc.integer({ min: 0, max: 2 ** 45 }),
    refreshedAt: optionalNumber,
    refreshRejected: fc.option(
      fc.record({ at: fc.integer({ min: 0, max: 2 ** 45 }), error: text }),
      {
        nil: undefined,
      },
    ),
  })
  .map((login) => {
    // an absent rejection is written without the key
    const { refreshRejected, ...rest } = login;
    return refreshRejected === undefined ? rest : login;
  });

describe('identityOf', () => {
  it('keys a login on issuer, explicit token endpoint, client, audience and sorted scopes', () => {
    expect(identityOf(oauthConfig({ scopes: ['openid', 'offline_access', 'openid'] }))).toEqual({
      issuer: 'https://login.example.com/realms/camunda',
      tokenEndpoint: null,
      clientId: 'operate-cli',
      audience: null,
      scopes: ['offline_access', 'openid'],
    });
    const explicit = oauthConfig({
      issuer: undefined,
      authorizationEndpoint: 'https://as/authorize',
      tokenEndpoint: 'https://as/token',
      audience: 'engine-rest',
    });
    expect(identityOf(explicit)).toMatchObject({
      issuer: null,
      tokenEndpoint: 'https://as/token',
      audience: 'engine-rest',
    });
  });

  it('compares every field', () => {
    const base = identityOf(oauthConfig());
    expect(sameIdentity(base, { ...base, scopes: [...base.scopes] })).toBe(true);
    for (const change of [
      { issuer: 'https://other' },
      { tokenEndpoint: 'https://as/token' },
      { clientId: 'other' },
      { audience: 'engine-rest' },
      { scopes: ['openid'] },
      { scopes: ['offline_access', 'openid', 'profile'] },
    ]) {
      expect(sameIdentity(base, { ...base, ...change }), JSON.stringify(change)).toBe(false);
    }
  });
});

describe('cacheFileName', () => {
  it('names the file after the profile, with a prefix against Windows device names', async () => {
    await expect(cacheFileName(oauthConfig({ profile: 'con' }))).resolves.toBe('profile-con.json');
  });

  it('hashes the identity without a profile, stable and independent of the scope order', async () => {
    const name = await cacheFileName(oauthConfig({ profile: undefined }));
    expect(name).toMatch(/^env-[0-9a-f]{32}\.json$/);
    await expect(
      cacheFileName(oauthConfig({ profile: undefined, scopes: ['offline_access', 'openid'] })),
    ).resolves.toBe(name);
    await expect(
      cacheFileName(oauthConfig({ profile: undefined, clientId: 'other' })),
    ).resolves.not.toBe(name);
  });

  it('resolves to a path in the token directory', async () => {
    await expect(cachePath(oauthConfig(), oauthDeps(fakeRuntime()))).resolves.toBe(TOKEN_FILE);
  });
});

describe('readCache and writeCache', () => {
  it('round-trips every valid login', async () => {
    await fc.assert(
      fc.asyncProperty(logins, async (login) => {
        const runtime = fakeRuntime();
        const deps = oauthDeps(runtime);
        await writeCache(TOKEN_FILE, login, deps);
        await expect(readCache(TOKEN_FILE, deps, 'p')).resolves.toEqual(login);
      }),
      { numRuns: 50 },
    );
  });

  it('writes the schema of design §16.5 with mode 0600 and a final newline', async () => {
    const runtime = fakeRuntime();
    const login = cachedLogin(NOW, {
      endpoints: { token: 't', revocation: null, clientAuthMethod: 'client_secret_post' },
    });
    await writeCache(TOKEN_FILE, login, oauthDeps(runtime));
    const stored = runtime.files.get(TOKEN_FILE);
    expect(stored?.mode).toBe(0o600);
    expect(new TextDecoder().decode(stored?.data)).toBe(cacheText(login));
    expect(serializeCache(login).endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(serializeCache(login)) as object)).toEqual([
      'version',
      'identity',
      'endpoints',
      'tokenType',
      'accessToken',
      'expiresAt',
      'refreshToken',
      'refreshExpiresAt',
      'scope',
      'subject',
      'user',
      'loggedInAt',
      'refreshedAt',
    ]);
  });

  it('always writes the client authentication method; a refusal only after one', () => {
    for (const clientAuthMethod of ['none', 'client_secret_basic', 'client_secret_post'] as const) {
      const login = cachedLogin(NOW, {
        endpoints: { token: 't', revocation: null, clientAuthMethod },
      });
      expect(JSON.parse(serializeCache(login))).toMatchObject({
        endpoints: { token: 't', revocation: null, clientAuthMethod },
      });
    }
    expect(serializeCache(cachedLogin(NOW))).not.toContain('refreshRejected');
    const rejected = cachedLogin(NOW, { refreshRejected: { at: NOW, error: 'invalid_grant: x' } });
    expect(Object.keys(JSON.parse(serializeCache(rejected)) as object).at(-1)).toBe(
      'refreshRejected',
    );
  });

  it('refreshes and revokes with the method of the login', () => {
    const withMethod = (clientAuthMethod: 'none' | 'client_secret_basic' | 'client_secret_post') =>
      clientAuthOf(
        cachedLogin(NOW, { endpoints: { token: 't', revocation: null, clientAuthMethod } }),
      );
    expect(withMethod('client_secret_post')).toBe('client_secret_post');
    expect(withMethod('client_secret_basic')).toBe('client_secret_basic');
    expect(withMethod('none')).toBe('client_secret_basic');
  });

  it('reads a missing file as no login', async () => {
    await expect(readCache(TOKEN_FILE, oauthDeps(fakeRuntime()), 'p')).resolves.toBeUndefined();
  });

  it.each([
    ['not JSON', 'not json {access-token-123'],
    ['an array', '[]'],
    ['version 2', cacheText({ ...cachedLogin(NOW), version: 2 as 1 })],
    ['a missing field', cacheText(cachedLogin(NOW)).replace('"user": "alice",', '')],
    ['a number access token', cacheText(cachedLogin(NOW)).replace('"cached-access"', '42')],
    ['an empty access token', cacheText(cachedLogin(NOW, { accessToken: '' }))],
    ['an empty refresh token', cacheText(cachedLogin(NOW, { refreshToken: '' }))],
    [
      'a string expiry',
      cacheText(cachedLogin(NOW)).replace(/"expiresAt": \d+/, '"expiresAt": "soon"'),
    ],
    ['scopes that are not strings', cacheText(cachedLogin(NOW)).replace('"offline_access",', '7,')],
    [
      'an unknown auth method',
      cacheText(
        cachedLogin(NOW, {
          endpoints: {
            token: 't',
            revocation: null,
            clientAuthMethod: 'x' as 'client_secret_post',
          },
        }),
      ),
    ],
    ['no identity', cacheText({ ...cachedLogin(NOW), identity: null as never })],
    [
      'no client authentication method',
      cacheText(cachedLogin(NOW)).replace(',\n    "clientAuthMethod": "none"', ''),
    ],
    [
      'a refusal without its error',
      cacheText(cachedLogin(NOW, { refreshRejected: { at: NOW } as never })),
    ],
  ])('reports %s as an unknown format, without quoting the content', async (_, content) => {
    const runtime = fakeRuntime({ files: { [TOKEN_FILE]: content } });
    const error = await rejection(readCache(TOKEN_FILE, oauthDeps(runtime), 'p'));
    expect(error.code).toBe('LOGIN_REQUIRED');
    expect(error.exitCode).toBe(4);
    expect(error.message).toBe(`The token cache ${TOKEN_FILE} has an unknown format`);
    expect(error.details.hint).toContain('operate auth login --profile p');
    expect(JSON.stringify(error.details)).not.toContain('access');
  });

  it('reports I/O errors as CONFIG naming the path and the code', async () => {
    const runtime = fakeRuntime({ files: { [TOKEN_FILE]: '{}' } });
    const readFails: FileSystem = {
      ...runtime.fs,
      readFile: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
    };
    const error = await rejection(readCache(TOKEN_FILE, { fs: readFails }, 'p'));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(`Cannot read token cache ${TOKEN_FILE} (EACCES)`);
    const write = await rejection(
      writeCache(TOKEN_FILE, cachedLogin(NOW), { fs: failingFs('writeFile', 'EROFS') }),
    );
    expect(write.message).toBe(`Cannot write token cache ${TOKEN_FILE} (EROFS)`);
    const remove = await rejection(removeCache(TOKEN_FILE, { fs: failingFs('remove', 'EPERM') }));
    expect(remove.message).toBe(`Cannot write token cache ${TOKEN_FILE} (EPERM)`);
  });

  it('removes the file and tells whether there was one', async () => {
    const runtime = fakeRuntime({ files: { [TOKEN_FILE]: '{}' } });
    const deps = oauthDeps(runtime);
    await expect(removeCache(TOKEN_FILE, deps)).resolves.toBe(true);
    await expect(removeCache(TOKEN_FILE, deps)).resolves.toBe(false);
  });
});

describe('withCacheLock', () => {
  it('creates the token directory with mode 0700, then holds <file>.lock for timeout + 10 s', async () => {
    const runtime = fakeRuntime();
    const deps = oauthDeps(runtime, { timeoutMs: 5_000 });
    await expect(withCacheLock(TOKEN_FILE, deps, () => Promise.resolve('done'))).resolves.toBe(
      'done',
    );
    expect(runtime.dirModes.get(TOKEN_DIR)).toBe(0o700);
    expect(runtime.locks).toEqual([{ path: `${TOKEN_FILE}.lock`, holdMs: 15_000 }]);
  });

  it('passes errors of the action through unchanged', async () => {
    const failure = new Error('action failed');
    const deps = oauthDeps(fakeRuntime());
    await expect(withCacheLock(TOKEN_FILE, deps, () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(isLockError(failure)).toBe(false);
  });

  it('turns a lock that cannot be taken into a recognizable CONFIG error', async () => {
    const runtime = fakeRuntime({ lockTimeout: true });
    let ran = false;
    const error = await rejection(
      withCacheLock(TOKEN_FILE, oauthDeps(runtime), () => {
        ran = true;
        return Promise.resolve();
      }),
    );
    expect(ran).toBe(false);
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(`Cannot lock the token cache ${TOKEN_FILE}`);
    expect(error.details.hint).toBe(
      `Another operate process holds ${TOKEN_FILE}.lock. If no operate process is running, remove ${TOKEN_FILE}.lock; nothing was sent.`,
    );
    expect(isLockError(error)).toBe(true);
    expect(isLockError(new OperateError('CONFIG', 'other'))).toBe(false);
  });

  it('counts a lock that never ran the action as not taken', async () => {
    const deps = {
      ...oauthDeps(fakeRuntime()),
      withLock: <T>() => Promise.resolve(undefined as T),
    };
    expect(
      isLockError(await rejection(withCacheLock(TOKEN_FILE, deps, () => Promise.resolve(1)))),
    ).toBe(true);
  });

  it('reports a directory it cannot create as CONFIG', async () => {
    const deps = { ...oauthDeps(fakeRuntime()), fs: failingFs('mkdir', 'EACCES') };
    const error = await rejection(withCacheLock(TOKEN_FILE, deps, () => Promise.resolve()));
    expect(error.message).toBe(`Cannot write token cache ${TOKEN_FILE} (EACCES)`);
  });
});

describe('logins cached under the file names of operate 0.5.0', () => {
  const at = (fileName: string) => `${TOKEN_DIR}/${fileName}`;
  const login = (user: string) => cacheText(cachedLogin(NOW, { user }));
  const userOf = async (path: string, runtime: ReturnType<typeof fakeRuntime>) =>
    (await readCache(path, oauthDeps(runtime), undefined))?.user;

  it('moves the login of a profile with upper-case letters to its current file', async () => {
    const runtime = fakeRuntime({ files: { [at('profile-Prod.json')]: login('alice') } });
    const deps = oauthDeps(runtime, { timeoutMs: 5_000 });
    const path = await cachePath(oauthConfig({ profile: 'Prod' }), deps);
    expect(path).toBe(at('profile-%50rod.json'));
    expect(fileText(runtime, path)).toBe(login('alice'));
    expect(runtime.files.get(path)?.mode).toBe(0o600);
    expect(runtime.files.has(at('profile-Prod.json'))).toBe(false);
    // under the lock of the old file (operate 0.5.0 writes it under that one), then the new one
    expect(runtime.locks).toEqual([
      { path: `${at('profile-Prod.json')}.lock`, holdMs: 15_000 },
      { path: `${path}.lock`, holdMs: 15_000 },
    ]);
    await expect(userOf(path, runtime)).resolves.toBe('alice');
    // done once: the next command finds the current file
    await expect(cachePath(oauthConfig({ profile: 'Prod' }), deps)).resolves.toBe(path);
    expect(runtime.locks).toHaveLength(2);
  });

  it('leaves the files of names without upper-case letters as they are', async () => {
    const runtime = fakeRuntime({ files: { [at('profile-prod-eu.json')]: login('bob') } });
    const path = await cachePath(oauthConfig({ profile: 'prod-eu' }), oauthDeps(runtime));
    expect(path).toBe(at('profile-prod-eu.json'));
    expect(fileText(runtime, path)).toBe(login('bob'));
    expect(runtime.locks).toEqual([]);
  });

  it('keeps the logins of case variants apart where they had files of their own', async () => {
    // a case-sensitive file system (Linux): three profiles, three files
    const runtime = fakeRuntime({
      files: {
        [at('profile-prod.json')]: login('lower'),
        [at('profile-Prod.json')]: login('capital'),
        [at('profile-PROD.json')]: login('upper'),
        [at('profile-other.json')]: login('other'),
        [at('profile-Other.json')]: login('Other'),
      },
    });
    const deps = oauthDeps(runtime);
    // any of them moves all old files that a case-insensitive file system would confuse
    await expect(profileCachePath('prod', deps)).resolves.toBe(at('profile-prod.json'));
    expect([...runtime.files.keys()].sort()).toEqual(
      [
        at('profile-%50%52%4f%44.json'),
        at('profile-%50rod.json'),
        at('profile-Other.json'),
        at('profile-other.json'),
        at('profile-prod.json'),
      ].sort(),
    );
    await expect(userOf(at('profile-prod.json'), runtime)).resolves.toBe('lower');
    await expect(userOf(await profileCachePath('Prod', deps), runtime)).resolves.toBe('capital');
    await expect(userOf(await profileCachePath('PROD', deps), runtime)).resolves.toBe('upper');
    await expect(userOf(await profileCachePath('Other', deps), runtime)).resolves.toBe('Other');
  });

  it('never takes the file of a profile spelled in another case (case-insensitive file systems)', async () => {
    // macOS, Windows: profile "lower" created the shared file; "LOWER" must not take it
    const runtime = fakeRuntime({
      caseInsensitive: true,
      files: { [at('profile-lower.json')]: login('lower') },
    });
    const deps = oauthDeps(runtime);
    const upper = await profileCachePath('LOWER', deps);
    expect(upper).toBe(at('profile-%4c%4f%57%45%52.json'));
    await expect(readCache(upper, deps, 'LOWER')).resolves.toBeUndefined();
    expect(runtime.locks).toEqual([]);
    await expect(userOf(await profileCachePath('lower', deps), runtime)).resolves.toBe('lower');
  });

  it('gives an old file to the profile spelled like it, whichever case variant runs first', async () => {
    for (const first of ['lower', 'Lower', 'LOWER']) {
      // "LOWER" created the shared file: on a case-insensitive file system it also opens as
      // profile-lower.json, so "lower" would read it as its own login until it moves
      const runtime = fakeRuntime({
        caseInsensitive: true,
        files: { [at('profile-LOWER.json')]: login('upper') },
      });
      const deps = oauthDeps(runtime);
      await profileCachePath(first, deps);
      expect([...runtime.files.keys()], first).toEqual([at('profile-%4c%4f%57%45%52.json')]);
      await expect(readCache(at('profile-lower.json'), deps, 'lower')).resolves.toBeUndefined();
      await expect(userOf(await profileCachePath('LOWER', deps), runtime)).resolves.toBe('upper');
    }
  });

  it('keeps a current file and removes the old one', async () => {
    const runtime = fakeRuntime({
      files: {
        [at('profile-Prod.json')]: login('old'),
        [at('profile-%50rod.json')]: login('new'),
      },
    });
    const path = await cachePath(oauthConfig({ profile: 'Prod' }), oauthDeps(runtime));
    expect([...runtime.files.keys()]).toEqual([path]);
    await expect(userOf(path, runtime)).resolves.toBe('new');
  });

  it('does nothing when another process moved the file while this one waited for the lock', async () => {
    const runtime = fakeRuntime({ files: { [at('profile-Prod.json')]: login('alice') } });
    const deps = oauthDeps(runtime, {
      withLock: async (path, holdMs, action) => {
        // the other process: moved the login, then logged out
        runtime.files.delete(at('profile-Prod.json'));
        return runtime.withLock(path, holdMs, action);
      },
    });
    const path = await profileCachePath('Prod', deps);
    expect(runtime.files.size).toBe(0);
    await expect(readCache(path, deps, 'Prod')).resolves.toBeUndefined();
  });

  it('re-checks the exact spelling under the lock, never taking a file spelled in another case', async () => {
    // case-insensitive: while this process waited, another one moved the old file of "LOWER"
    // and "lower" logged in; profile-LOWER.json still opens, but as the login of "lower"
    const runtime = fakeRuntime({
      caseInsensitive: true,
      files: { [at('profile-LOWER.json')]: login('upper') },
    });
    let others = true;
    const deps = oauthDeps(runtime, {
      withLock: async (path, holdMs, action) => {
        if (others) {
          others = false;
          await runtime.fs.writeFile(at('profile-%4c%4f%57%45%52.json'), login('upper'));
          await runtime.fs.remove(at('profile-LOWER.json'));
          await runtime.fs.writeFile(at('profile-lower.json'), login('lower'));
        }
        return runtime.withLock(path, holdMs, action);
      },
    });
    await expect(runtime.fs.exists(at('profile-LOWER.json'))).resolves.toBe(true);
    await profileCachePath('lower', deps);
    expect([...runtime.files.keys()].sort()).toEqual([
      at('profile-%4c%4f%57%45%52.json'),
      at('profile-lower.json'),
    ]);
    await expect(userOf(at('profile-lower.json'), runtime)).resolves.toBe('lower');
    await expect(userOf(at('profile-%4c%4f%57%45%52.json'), runtime)).resolves.toBe('upper');
  });

  it('moves files only, never a directory of that name', async () => {
    const runtime = fakeRuntime({ dirs: [at('profile-Prod.json')] });
    await expect(profileCachePath('Prod', oauthDeps(runtime))).resolves.toBe(
      at('profile-%50rod.json'),
    );
    expect(runtime.locks).toEqual([]);
  });

  it('works without a token directory', async () => {
    const runtime = fakeRuntime();
    await expect(profileCachePath('Prod', oauthDeps(runtime))).resolves.toBe(
      at('profile-%50rod.json'),
    );
    expect(runtime.locks).toEqual([]);
  });

  it('reports a file it cannot move as CONFIG, naming both paths', async () => {
    const runtime = fakeRuntime({ files: { [at('profile-Prod.json')]: login('alice') } });
    const fs: FileSystem = {
      ...runtime.fs,
      writeFile: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
    };
    const error = await rejection(adoptLegacyLogins('Prod', { ...oauthDeps(runtime), fs }));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(
      `Cannot move the OAuth login cached in ${at('profile-Prod.json')} to ${at('profile-%50rod.json')} (EACCES)`,
    );
    expect(error.details.hint).toBe('Check the permissions of the token directory and its files.');
    expect(runtime.files.has(at('profile-Prod.json'))).toBe(true);
  });

  it('reports a lock that cannot be taken like every cache lock', async () => {
    const runtime = fakeRuntime({
      lockTimeout: true,
      files: { [at('profile-Prod.json')]: login('alice') },
    });
    const error = await rejection(profileCachePath('Prod', oauthDeps(runtime)));
    expect(isLockError(error)).toBe(true);
    expect(error.message).toBe(`Cannot lock the token cache ${at('profile-Prod.json')}`);
    expect(runtime.files.has(at('profile-Prod.json'))).toBe(true);
  });

  it('moves only old file names: never env- files, lock files or current names', async () => {
    const files = {
      [at('profile-%50rod.json')]: login('current'),
      [at('profile-Prod.json.lock')]: '{}',
      [at('env-0123456789abcdef0123456789abcdef.json')]: login('env'),
      [at('.profile-Prod.json.1a2b3c.tmp')]: login('tmp'),
    };
    const runtime = fakeRuntime({ files });
    await profileCachePath('Prod', oauthDeps(runtime));
    expect([...runtime.files.keys()].sort()).toEqual(Object.keys(files).sort());
  });
});
