import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import {
  type ProfileChanges,
  deleteProfile,
  listProfiles,
  setProfile,
  showConfig,
  unsetProfileKeys,
  useProfile,
  validateProfileName,
} from './edit.js';
import { parseConfigFile } from './file.js';
import { resolveConfig } from './resolve.js';
import type { ConfigFile } from './types.js';

function failure(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    if (error instanceof OperateError) return error;
    throw error;
  }
  throw new Error('expected an OperateError');
}

const TWO: ConfigFile = {
  defaultProfile: 'dev',
  profiles: {
    dev: { url: 'http://localhost:8080/engine-rest', readOnly: false },
    prod: {
      url: 'https://prod/engine-rest',
      engine: 'main',
      auth: { type: 'none' },
      output: 'json',
      timeout: 5000,
      headers: { 'X-Tenant': 'acme' },
      readOnly: true,
    },
  },
};

function frozen(config: ConfigFile): ConfigFile {
  return structuredClone(config);
}

describe('validateProfileName', () => {
  it.each(['a', 'dev', 'prod-eu', 'Prod_2', '1st', 'a.b', 'x-._'])('accepts %j', (name) => {
    expect(validateProfileName(name)).toBe(name);
  });

  it.each(['', '-dev', '.dev', '_dev', 'my profile', 'a/b', 'dév', '__proto__'])(
    'rejects %j',
    (name) => {
      const error = failure(() => validateProfileName(name));
      expect(error.code).toBe('CONFIG');
      expect(error.message).toBe(`Invalid profile name "${name}"`);
      expect(error.details.hint).toBe(
        'Use letters, digits, ".", "_" and "-", starting with a letter or digit, e.g. "local" or "prod-eu".',
      );
    },
  );
});

describe('setProfile', () => {
  it('creates the file with the first profile as default', () => {
    expect(setProfile(undefined, 'local', { url: 'http://localhost:8080/engine-rest/' })).toEqual({
      defaultProfile: 'local',
      profiles: { local: { url: 'http://localhost:8080/engine-rest' } },
    });
  });

  it('makes the first profile of an empty file the default even when it is empty', () => {
    expect(setProfile({ profiles: {} }, 'a', {})).toEqual({
      defaultProfile: 'a',
      profiles: { a: {} },
    });
  });

  it('does not change the default when adding a further profile', () => {
    const result = setProfile(TWO, 'qa', { engine: 'qa' });
    expect(result.defaultProfile).toBe('dev');
    expect(result.profiles.qa).toEqual({ engine: 'qa' });
    expect(Object.keys(result.profiles)).toEqual(['dev', 'prod', 'qa']);
  });

  it('keeps a file without default without default when adding a profile', () => {
    const result = setProfile({ profiles: { a: {} } }, 'b', {});
    expect(result).toEqual({ profiles: { a: {}, b: {} } });
    expect(result).not.toHaveProperty('defaultProfile');
  });

  it('makes the profile the default on request', () => {
    expect(setProfile(TWO, 'prod', { makeDefault: true }).defaultProfile).toBe('prod');
    expect(setProfile(TWO, 'qa', { makeDefault: true }).defaultProfile).toBe('qa');
    expect(setProfile(TWO, 'qa', { makeDefault: false }).defaultProfile).toBe('dev');
  });

  it('changes only the given keys', () => {
    const result = setProfile(TWO, 'prod', { timeout: '9000', readOnly: false });
    expect(result.profiles.prod).toEqual({ ...TWO.profiles.prod, timeout: 9000, readOnly: false });
    expect(result.profiles.dev).toEqual(TWO.profiles.dev);
  });

  it('validates and normalizes every value', () => {
    const changes: ProfileChanges = {
      url: ' https://camunda.example.com/engine-rest/ ',
      engine: ' tenant1 ',
      auth: 'none',
      output: 'table',
      timeout: 1500,
      headers: ['X-A: 1'],
      readOnly: true,
    };
    expect(setProfile(undefined, 'x', changes).profiles.x).toEqual({
      url: 'https://camunda.example.com/engine-rest',
      engine: 'tenant1',
      auth: { type: 'none' },
      output: 'table',
      timeout: 1500,
      headers: { 'X-A': '1' },
      readOnly: true,
    });
  });

  it('writes the profile keys in canonical order', () => {
    const result = setProfile({ profiles: { a: { readOnly: true } } }, 'a', {
      headers: ['A: b'],
      url: 'http://x',
      timeout: 1,
    });
    expect(Object.keys(result.profiles.a ?? {})).toEqual(['url', 'timeout', 'headers', 'readOnly']);
  });

  it('merges headers into the existing ones, case-insensitively', () => {
    const result = setProfile(TWO, 'prod', { headers: ['x-tenant: other', 'X-New: 1'] });
    expect(result.profiles.prod?.headers).toEqual({ 'x-tenant': 'other', 'X-New': '1' });
  });

  it('keeps existing headers for an empty header list and adds none to a profile without', () => {
    expect(setProfile(TWO, 'prod', { headers: [] }).profiles.prod?.headers).toEqual({
      'X-Tenant': 'acme',
    });
    expect(setProfile(TWO, 'dev', { headers: [] }).profiles.dev).not.toHaveProperty('headers');
  });

  it.each([
    [{ url: 'ftp://x' }, 'Engine URL must start with http:// or https://, got "ftp://x"'],
    [{ engine: '  ' }, 'Engine name must not be empty'],
    [{ engine: '..' }, 'Invalid process engine name ".."'],
    [
      { headers: ['Connection: close'] },
      'Header "Connection" cannot be set: the HTTP client manages it',
    ],
    [{ auth: 'basic' }, 'Unsupported auth type "basic"'],
    [{ output: 'yaml' }, 'Unknown output format "yaml"'],
    [{ timeout: '0' }, 'Timeout must be a positive number of milliseconds, got "0"'],
    [{ headers: ['nope'] }, 'Invalid header: expected "Name: value"'],
  ] as const)('rejects %j', (changes, message) => {
    const error = failure(() => setProfile(TWO, 'prod', changes));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(message);
  });

  it('suggests unset for an empty engine', () => {
    expect(failure(() => setProfile(TWO, 'prod', { engine: '' })).details.hint).toBe(
      'Remove it with `operate config unset <profile> engine` to use the default engine.',
    );
  });

  it('rejects invalid profile names', () => {
    expect(failure(() => setProfile(undefined, 'my profile', {})).message).toBe(
      'Invalid profile name "my profile"',
    );
  });

  it('does not modify its input', () => {
    const input = frozen(TWO);
    setProfile(input, 'prod', { url: 'http://new', headers: ['A: b'], makeDefault: true });
    setProfile(input, 'new', {});
    expect(input).toEqual(TWO);
  });

  it('creates profiles that survive a write and parse round trip', () => {
    const changes = fc.record(
      {
        url: fc.constantFrom('http://localhost:8080/engine-rest/', 'https://x.example/rest'),
        engine: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        auth: fc.constant('none'),
        output: fc.constantFrom('json', 'table'),
        timeout: fc.oneof(fc.integer({ min: 1, max: 600000 }), fc.integer({ min: 1 }).map(String)),
        headers: fc.array(
          fc
            .tuple(fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,10}$/), fc.string({ maxLength: 10 }))
            .map(([name, value]) => `${name}: ${value.replace(/[\r\n\0]/g, '')}`),
          { maxLength: 3 },
        ),
        readOnly: fc.boolean(),
        makeDefault: fc.boolean(),
      },
      { requiredKeys: [] },
    );
    const name = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,10}$/);
    fc.assert(
      fc.property(fc.array(fc.tuple(name, changes), { minLength: 1, maxLength: 4 }), (steps) => {
        let config: ConfigFile | undefined;
        for (const [profileName, change] of steps) {
          config = setProfile(config, profileName, change);
          expect(parseConfigFile(JSON.stringify(config), 'config.json')).toEqual(config);
        }
      }),
    );
  });
});

describe('unsetProfileKeys', () => {
  it('removes the given keys', () => {
    const result = unsetProfileKeys(TWO, 'prod', ['engine', 'headers', 'readOnly']);
    expect(result).toEqual({
      defaultProfile: 'dev',
      profiles: {
        dev: TWO.profiles.dev,
        prod: {
          url: 'https://prod/engine-rest',
          auth: { type: 'none' },
          output: 'json',
          timeout: 5000,
        },
      },
    });
  });

  it('accepts kebab and singular spellings', () => {
    const result = unsetProfileKeys(TWO, 'prod', ['read-only', 'header']);
    expect(result.profiles.prod).not.toHaveProperty('readOnly');
    expect(result.profiles.prod).not.toHaveProperty('headers');
    expect(result.profiles.prod).toHaveProperty('url');
  });

  it('can remove every key', () => {
    const keys = ['url', 'engine', 'auth', 'output', 'timeout', 'headers', 'readOnly'];
    expect(unsetProfileKeys(TWO, 'prod', keys).profiles.prod).toEqual({});
  });

  it('ignores keys the profile does not set', () => {
    expect(unsetProfileKeys(TWO, 'dev', ['engine', 'timeout'])).toEqual(TWO);
  });

  it('rejects unknown keys and lists the valid ones', () => {
    const error = failure(() => unsetProfileKeys(TWO, 'prod', ['url', 'user']));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('Unknown profile key "user"');
    expect(error.details.hint).toBe(
      'Valid keys: url, engine, auth, output, timeout, headers, readOnly.',
    );
  });

  it('rejects a missing profile with the known profiles as hint', () => {
    const error = failure(() => unsetProfileKeys(TWO, 'qa', ['url']));
    expect(error.message).toBe('Profile "qa" does not exist');
    expect(error.details.hint).toBe(
      'Known profiles: dev, prod. Create it with `operate config set qa --url <url>`.',
    );
    expect(failure(() => unsetProfileKeys(undefined, 'qa', ['url'])).details.hint).toBe(
      'Create it with `operate config set qa --url <url>`.',
    );
  });

  it('does not modify its input', () => {
    const input = frozen(TWO);
    unsetProfileKeys(input, 'prod', ['url']);
    expect(input).toEqual(TWO);
  });
});

describe('useProfile', () => {
  it('sets the default profile', () => {
    expect(useProfile(TWO, 'prod')).toEqual({ ...TWO, defaultProfile: 'prod' });
  });

  it('rejects a missing profile', () => {
    expect(failure(() => useProfile(TWO, 'qa')).message).toBe('Profile "qa" does not exist');
    expect(failure(() => useProfile(undefined, 'qa')).code).toBe('CONFIG');
    expect(failure(() => useProfile(TWO, 'constructor')).message).toBe(
      'Profile "constructor" does not exist',
    );
  });

  it('does not modify its input', () => {
    const input = frozen(TWO);
    useProfile(input, 'prod');
    expect(input).toEqual(TWO);
  });
});

describe('deleteProfile', () => {
  it('removes the profile and keeps the default', () => {
    expect(deleteProfile(TWO, 'prod')).toEqual({
      defaultProfile: 'dev',
      profiles: { dev: TWO.profiles.dev },
    });
  });

  it('clears the default when it pointed to the deleted profile', () => {
    const result = deleteProfile(TWO, 'dev');
    expect(result).toEqual({ profiles: { prod: TWO.profiles.prod } });
    expect(result).not.toHaveProperty('defaultProfile');
  });

  it('rejects a missing profile', () => {
    expect(failure(() => deleteProfile(TWO, 'qa')).message).toBe('Profile "qa" does not exist');
    expect(failure(() => deleteProfile(undefined, 'qa')).code).toBe('CONFIG');
  });

  it('does not modify its input', () => {
    const input = frozen(TWO);
    deleteProfile(input, 'dev');
    expect(input).toEqual(TWO);
  });
});

describe('listProfiles', () => {
  it('returns nothing without a file', () => {
    expect(listProfiles(undefined)).toEqual([]);
  });

  it('summarizes the profiles sorted by name', () => {
    const config: ConfigFile = {
      defaultProfile: 'prod',
      profiles: { zeta: {}, prod: TWO.profiles.prod ?? {}, alpha: { readOnly: false } },
    };
    expect(listProfiles(config)).toEqual([
      { name: 'alpha', default: false, url: null, engine: null, auth: null, readOnly: false },
      {
        name: 'prod',
        default: true,
        url: 'https://prod/engine-rest',
        engine: 'main',
        auth: 'none',
        readOnly: true,
      },
      { name: 'zeta', default: false, url: null, engine: null, auth: null, readOnly: false },
    ]);
  });

  it('sorts by code point, independent of the locale', () => {
    const config: ConfigFile = { profiles: { b: {}, B: {}, a: {}, A: {}, '1': {} } };
    expect(listProfiles(config).map((profile) => profile.name)).toEqual(['1', 'A', 'B', 'a', 'b']);
  });
});

describe('showConfig', () => {
  it('shows every effective value with its source', () => {
    const resolved = resolveConfig(
      { output: 'json', headers: ['X-Flag: 1'] },
      { OPERATE_TIMEOUT: '1000' },
      TWO,
    );
    expect(showConfig(resolved, '/home/me/.config/operate/config.json')).toEqual({
      configFile: '/home/me/.config/operate/config.json',
      profile: 'dev',
      values: {
        url: { value: 'http://localhost:8080/engine-rest', source: 'profile' },
        engine: { value: null, source: 'default' },
        auth: { value: 'none', source: 'default' },
        output: { value: 'json', source: 'flag' },
        timeout: { value: 1000, source: 'env' },
        headers: { value: { 'X-Flag': '1' }, source: 'flag' },
        readOnly: { value: false, source: 'profile' },
      },
    });
  });

  it('uses null for values that are not set', () => {
    const view = showConfig(resolveConfig({}, {}, undefined), 'c.json');
    expect(view.profile).toBeNull();
    expect(view.values.engine).toEqual({ value: null, source: 'default' });
    expect(view.values.output).toEqual({ value: null, source: 'default' });
  });

  it('shows the selected engine and profile', () => {
    const view = showConfig(resolveConfig({ profile: 'prod' }, {}, TWO), 'c.json');
    expect(view.profile).toBe('prod');
    expect(view.values.engine).toEqual({ value: 'main', source: 'profile' });
    expect(view.values.headers).toEqual({ value: { 'X-Tenant': 'acme' }, source: 'profile' });
  });
});
