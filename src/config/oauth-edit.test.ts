/** `operate config set` with OAuth options (design §16.2.2, rules 1–6) and `config show` rows. */

import fc from 'fast-check';
import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { changedAuth, replacedFamily, settleAuthorization, usesCredentials } from './auth-edit.js';
import { listProfiles, setProfile, showConfig } from './edit.js';
import { legacyProfileOf, profileTokenFile, tokenDirectory, tokenPath } from './file.js';
import { changedOAuthKeys, hasOAuthOptions } from './oauth-edit.js';
import { resolveConfig } from './resolve.js';
import type { ConfigFile, ProfileAuth } from './types.js';

const ISSUER = 'https://login.example.com/realms/camunda';
const OAUTH: ProfileAuth = { type: 'oauth', issuer: ISSUER, clientId: 'operate-cli' };
const BASIC: ProfileAuth = { type: 'basic', username: 'demo', passwordEnv: 'PW' };

function failure(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    expect((error as OperateError).code).toBe('CONFIG');
    return error as OperateError;
  }
  throw new Error('expected an error');
}

describe('changedOAuthKeys', () => {
  it('stores the given OAuth values, validated', () => {
    expect(
      changedOAuthKeys(undefined, {
        oauthIssuer: ` ${ISSUER} `,
        oauthClientId: ' cli ',
        oauthScopes: 'openid,profile',
        oauthAudience: 'engine-rest',
        oauthRedirectPort: '8765',
        oauthClientSecretEnv: 'SECRET',
      }),
    ).toEqual({
      issuer: ISSUER,
      clientId: 'cli',
      scopes: ['openid', 'profile'],
      audience: 'engine-rest',
      redirectPort: 8765,
      clientSecretEnv: 'SECRET',
    });
    expect(changedOAuthKeys(undefined, { oauthScopes: '' })).toEqual({ scopes: [] });
  });

  it('keeps stored values that were not given', () => {
    const stored: ProfileAuth = {
      ...OAUTH,
      scopes: ['openid'],
      audience: 'a',
      redirectPort: 1,
      clientSecret: 's',
    };
    expect(changedOAuthKeys(stored, { oauthClientId: 'other' })).toEqual({
      issuer: ISSUER,
      clientId: 'other',
      scopes: ['openid'],
      audience: 'a',
      redirectPort: 1,
      clientSecret: 's',
    });
  });

  it('goes back to discovery when only a new issuer is given', () => {
    const stored = {
      ...OAUTH,
      authorizationEndpoint: 'https://as/a',
      tokenEndpoint: 'https://as/t',
    };
    expect(changedOAuthKeys(stored, { oauthIssuer: 'https://new.example.com' })).toEqual({
      issuer: 'https://new.example.com',
      clientId: 'operate-cli',
    });
  });

  it('takes both endpoints together and keeps the issuer', () => {
    expect(
      changedOAuthKeys(OAUTH, {
        oauthAuthorizationEndpoint: 'https://as/a',
        oauthTokenEndpoint: 'https://as/t',
      }),
    ).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: 'https://as/a',
      tokenEndpoint: 'https://as/t',
      clientId: 'operate-cli',
    });
    const error = failure(() => changedOAuthKeys(OAUTH, { oauthTokenEndpoint: 'https://as/t' }));
    expect(error.message).toBe(
      '--oauth-authorization-endpoint and --oauth-token-endpoint must be given together',
    );
    expect(
      failure(() =>
        changedOAuthKeys(OAUTH, {
          oauthAuthorizationEndpoint: 'http://as/a',
          oauthTokenEndpoint: 'https://as/t',
        }),
      ).message,
    ).toContain('(from --oauth-authorization-endpoint) must use https://');
  });

  it('replaces a stored secret source with the other one; both at once are refused', () => {
    expect(
      changedOAuthKeys({ ...OAUTH, clientSecret: 'x' }, { oauthClientSecretEnv: 'S' }),
    ).toMatchObject({ clientSecretEnv: 'S' });
    expect(
      changedOAuthKeys({ ...OAUTH, clientSecret: 'x' }, { oauthClientSecretEnv: 'S' }),
    ).not.toHaveProperty('clientSecret');
    expect(
      changedOAuthKeys({ ...OAUTH, clientSecretEnv: 'S' }, { oauthClientSecret: ' lit ' }),
    ).toEqual({ issuer: ISSUER, clientId: 'operate-cli', clientSecret: ' lit ' });
    const error = failure(() =>
      changedOAuthKeys(OAUTH, { oauthClientSecretEnv: 'S', oauthClientSecret: 'x' }),
    );
    expect(error.message).toBe(
      '--oauth-client-secret-env and --oauth-client-secret-stdin exclude each other',
    );
    expect(failure(() => changedOAuthKeys(OAUTH, { oauthClientSecret: 'a\nb' })).message).toContain(
      '(from --oauth-client-secret-stdin)',
    );
    expect(
      failure(() => changedOAuthKeys(OAUTH, { oauthClientSecretEnv: 'my secret' })).message,
    ).toBe('Invalid --oauth-client-secret-env: expected the name of an environment variable');
  });

  it.each([
    [{ oauthIssuer: 'ftp://x' }, 'from --oauth-issuer'],
    [{ oauthClientId: '' }, 'from --oauth-client-id'],
    [{ oauthScopes: 'a a' }, 'from --oauth-scopes'],
    [{ oauthAudience: ' ' }, 'from --oauth-audience'],
    [{ oauthRedirectPort: '-1' }, 'from --oauth-redirect-port'],
  ])('validates %j naming the option', (changes, label) => {
    expect(failure(() => changedOAuthKeys(undefined, changes)).message).toContain(`(${label})`);
  });

  it('knows whether OAuth options were given', () => {
    expect(hasOAuthOptions({})).toBe(false);
    expect(hasOAuthOptions({ oauthScopes: '' })).toBe(true);
  });
});

describe('changedAuth with both families (rules 1–3)', () => {
  it('selects oauth for OAuth options without --auth, also over a stored type none', () => {
    expect(changedAuth(undefined, { oauthIssuer: ISSUER, oauthClientId: 'c' })).toEqual({
      type: 'oauth',
      issuer: ISSUER,
      clientId: 'c',
    });
    expect(changedAuth({ type: 'none' }, { oauthClientId: 'c' })).toEqual({
      type: 'oauth',
      clientId: 'c',
    });
  });

  it('stores OAuth options switched off with --auth none', () => {
    expect(changedAuth(undefined, { auth: 'none', oauthClientId: 'c' })).toEqual({
      type: 'none',
      clientId: 'c',
    });
  });

  it('refuses mixed families', () => {
    expect(
      failure(() => changedAuth(undefined, { auth: 'basic', oauthClientId: 'c' })).message,
    ).toBe('OAuth options need --auth oauth, not --auth basic');
    expect(failure(() => changedAuth(undefined, { auth: 'oauth', authUser: 'u' })).message).toBe(
      'Basic auth options need --auth basic, not --auth oauth',
    );
    const both = failure(() => changedAuth(undefined, { authUser: 'u', oauthClientId: 'c' }));
    expect(both.message).toBe('Basic auth options and OAuth options exclude each other');
    expect(both.details.hint).toBe(
      'A profile uses Basic auth (--auth basic --auth-user <name> --auth-password-env <VAR>), OAuth (--auth oauth --oauth-issuer <url> --oauth-client-id <id>) or a bearer token (--auth bearer --auth-token-env <VAR>).',
    );
    expect(
      failure(() => changedAuth(undefined, { auth: 'none', authUser: 'u', oauthClientId: 'c' }))
        .message,
    ).toBe('Basic auth options and OAuth options exclude each other');
  });

  it('drops the stored keys of the other family', () => {
    expect(changedAuth(BASIC, { oauthIssuer: ISSUER, oauthClientId: 'c' })).toEqual({
      type: 'oauth',
      issuer: ISSUER,
      clientId: 'c',
    });
    expect(changedAuth(BASIC, { auth: 'oauth' })).toEqual({ type: 'oauth' });
    expect(changedAuth(OAUTH, { authUser: 'demo' })).toEqual({ type: 'basic', username: 'demo' });
    expect(changedAuth(OAUTH, { auth: 'basic' })).toEqual({ type: 'basic' });
    expect(changedAuth(BASIC, { auth: 'none', oauthClientId: 'c' })).toEqual({
      type: 'none',
      clientId: 'c',
    });
  });

  it('keeps the stored keys when only the type none is given', () => {
    expect(changedAuth(OAUTH, { auth: 'none' })).toEqual({ ...OAUTH, type: 'none' });
    expect(changedAuth(BASIC, { auth: 'none' })).toEqual({ ...BASIC, type: 'none' });
  });

  it('names the family that was replaced', () => {
    expect(replacedFamily(BASIC, OAUTH)).toBe('basic');
    expect(replacedFamily(OAUTH, BASIC)).toBe('oauth');
    expect(replacedFamily(OAUTH, { ...OAUTH, type: 'none' })).toBeUndefined();
    expect(replacedFamily(BASIC, { ...BASIC, password: 'x' })).toBeUndefined();
    expect(replacedFamily(undefined, OAUTH)).toBeUndefined();
  });
});

describe('the Authorization header with OAuth (rule 6)', () => {
  it('counts OAuth profiles as sending credentials', () => {
    expect(usesCredentials({ type: 'oauth' })).toBe(true);
    expect(usesCredentials(BASIC)).toBe(true);
    expect(usesCredentials({ type: 'none', clientId: 'c' })).toBe(false);
  });

  it('replaces a stored header with OAuth options, refuses both together', () => {
    const profile = { auth: OAUTH, headers: { Authorization: 'Bearer x', 'X-Tenant': 't' } };
    expect(settleAuthorization(profile, { oauthClientId: 'c' }, 'p')).toEqual({
      auth: OAUTH,
      headers: { 'X-Tenant': 't' },
    });
    const error = failure(() =>
      settleAuthorization(profile, { headers: ['Authorization: y'] }, 'p'),
    );
    expect(error.message).toBe('Profile "p" would have both OAuth and an Authorization header');
    expect(error.details.hint).toBe(
      "Keep one: OAuth options replace a stored Authorization header (`operate config set p --auth oauth`); --auth none switches OAuth off and keeps the header (`operate config set p --auth none -H 'Authorization: ...'`).",
    );
  });

  it('works through setProfile', () => {
    const file: ConfigFile = { profiles: { p: { headers: { Authorization: 'Bearer old' } } } };
    const updated = setProfile(file, 'p', {
      auth: 'oauth',
      oauthIssuer: ISSUER,
      oauthClientId: 'c',
    });
    expect(updated.profiles.p).toEqual({ auth: { type: 'oauth', issuer: ISSUER, clientId: 'c' } });
  });
});

describe('config list and show with OAuth', () => {
  it('lists the type', () => {
    expect(listProfiles({ profiles: { p: { auth: OAUTH } } })[0]?.auth).toBe('oauth');
  });

  it('shows the OAuth rows only for type oauth, with their sources', () => {
    const file: ConfigFile = {
      defaultProfile: 'p',
      profiles: { p: { auth: { ...OAUTH, clientSecretEnv: 'S', audience: 'engine-rest' } } },
    };
    const view = showConfig(
      resolveConfig({}, { S: 'sec', OPERATE_OAUTH_SCOPES: 'openid' }, file),
      '/c.json',
    );
    expect(Object.keys(view.values)).toEqual([
      'url',
      'engine',
      'auth',
      'username',
      'password',
      'issuer',
      'authorizationEndpoint',
      'tokenEndpoint',
      'clientId',
      'clientSecret',
      'scopes',
      'audience',
      'redirectPort',
      'output',
      'timeout',
      'headers',
      'readOnly',
    ]);
    expect(view.values).toMatchObject({
      auth: { value: 'oauth', source: 'profile' },
      username: { value: null, source: 'default' },
      password: { value: null, source: 'default' },
      issuer: { value: ISSUER, source: 'profile' },
      authorizationEndpoint: { value: null, source: 'default' },
      tokenEndpoint: { value: null, source: 'default' },
      clientId: { value: 'operate-cli', source: 'profile' },
      clientSecret: { value: 'sec', source: 'profile' },
      scopes: { value: ['openid'], source: 'env' },
      audience: { value: 'engine-rest', source: 'profile' },
      redirectPort: { value: 0, source: 'default' },
    });
    const publicClient = showConfig(
      resolveConfig({}, {}, { defaultProfile: 'p', profiles: { p: { auth: OAUTH } } }),
      '/c.json',
    );
    expect(publicClient.values.clientSecret).toEqual({ value: null, source: 'default' });
    expect(publicClient.values.audience).toEqual({ value: null, source: 'default' });
    const none = showConfig(resolveConfig({}, {}, undefined), '/c.json');
    expect(none.values).not.toHaveProperty('issuer');
  });
});

describe('token cache paths', () => {
  it('lives in the operate config directory, never next to --config', () => {
    const home = { homedir: '/home/u', platform: 'linux' };
    expect(tokenDirectory({}, home)).toBe('/home/u/.config/operate/tokens');
    expect(
      tokenDirectory({ XDG_CONFIG_HOME: '/xdg', OPERATE_CONFIG: '/project/c.json' }, home),
    ).toBe('/xdg/operate/tokens');
    expect(tokenDirectory({ XDG_CONFIG_HOME: 'relative' }, home)).toBe(
      '/home/u/.config/operate/tokens',
    );
    const windows = { homedir: 'C:\\Users\\u', platform: 'win32' };
    expect(tokenDirectory({ APPDATA: 'D:\\AppData' }, windows)).toBe(
      'D:\\AppData\\operate\\tokens',
    );
    expect(tokenDirectory({}, windows)).toBe('C:\\Users\\u\\AppData\\Roaming\\operate\\tokens');
  });

  it('joins file names per platform', () => {
    expect(profileTokenFile('prod')).toBe('profile-prod.json');
    expect(profileTokenFile('prod-eu_1.x')).toBe('profile-prod-eu_1.x.json');
    expect(tokenPath('/t', 'profile-p.json', 'linux')).toBe('/t/profile-p.json');
    expect(tokenPath('C:\\t', 'profile-p.json', 'win32')).toBe('C:\\t\\profile-p.json');
  });

  it('percent-encodes every character a valid profile name cannot have', () => {
    expect(profileTokenFile('x/../../victim/package')).toBe(
      'profile-x%2f..%2f..%2fvictim%2fpackage.json',
    );
    expect(profileTokenFile('a\\b:c%d ü€')).toBe('profile-a%5cb%3ac%25d%20%fc%u20ac.json');
    expect(profileTokenFile('..')).toBe('profile-...json');
    expect(profileTokenFile('\u00ff\u0100')).toBe('profile-%ff%u0100.json');
    expect(profileTokenFile('\ud800')).not.toBe(profileTokenFile('\ud801'));
    expect(profileTokenFile('a%')).not.toBe(profileTokenFile('a%25'));
  });

  it('percent-encodes upper-case letters: names that differ only in case get different files', () => {
    expect(profileTokenFile('Prod-EU_1.x')).toBe('profile-%50rod-%45%55_1.x.json');
    expect(profileTokenFile('LOWER')).toBe('profile-%4c%4f%57%45%52.json');
    expect(profileTokenFile('lower')).toBe('profile-lower.json');
    expect(profileTokenFile('Lower')).toBe('profile-%4cower.json');
  });

  it('keeps the file of any profile name directly inside the token directory', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (name) => {
        const file = profileTokenFile(name);
        expect(file).toMatch(/^profile-[a-z0-9._%-]*\.json$/);
        expect(posix.dirname(tokenPath('/t/tokens', file, 'linux'))).toBe('/t/tokens');
        expect(win32.dirname(tokenPath('C:\\t\\tokens', file, 'win32'))).toBe('C:\\t\\tokens');
      }),
    );
  });

  it('gives different profile names different files', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (a, b) => {
        // lone surrogates included: every UTF-16 code unit is encoded on its own
        fc.pre(a !== b);
        expect(profileTokenFile(a)).not.toBe(profileTokenFile(b));
      }),
    );
  });

  it('gives different profile names different files also after case folding', () => {
    // the name has no upper-case letter (it is its own case folding) and decodes to the profile
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (name) => {
        const file = profileTokenFile(name);
        expect(file.toLowerCase()).toBe(file);
        expect(decodedProfile(file.toLowerCase())).toBe(name);
      }),
    );
    // and directly: case variants and arbitrary pairs never collide when compared without case
    fc.assert(
      fc.property(fc.oneof(caseVariants, fc.tuple(fc.string(), fc.string())), ([a, b]) => {
        fc.pre(a !== b);
        const [fileA, fileB] = [profileTokenFile(a), profileTokenFile(b)];
        expect(fileA.toLowerCase()).not.toBe(fileB.toLowerCase());
        expect(fileA.toUpperCase()).not.toBe(fileB.toUpperCase());
      }),
    );
  });
});

/** Decodes a current token cache file name (`profileTokenFile`) back to the profile name. */
function decodedProfile(file: string): string {
  const encoded = /^profile-(.*)\.json$/.exec(file)?.[1] ?? '';
  return encoded.replace(
    /%u([0-9a-f]{4})|%([0-9a-f]{2})/g,
    (_match, wide?: string, narrow?: string) =>
      String.fromCharCode(Number.parseInt(wide ?? narrow ?? '', 16)),
  );
}

/** A profile name (ASCII) and a variant of it with some letters in the other case. */
const caseVariants = fc
  .tuple(fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,20}$/), fc.array(fc.boolean()))
  .map(([name, flips]): [string, string] => [
    name,
    name.replace(/./g, (char, index: number) => {
      if (flips[index] !== true) return char;
      return char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
    }),
  ]);

describe('legacyProfileOf', () => {
  it('names the profile of a file name operate 0.5.0 gave a profile with upper-case letters', () => {
    expect(legacyProfileOf('profile-Prod.json')).toBe('Prod');
    expect(legacyProfileOf('profile-LOWER.json')).toBe('LOWER');
    expect(legacyProfileOf('profile-Prod-EU_1.x.json')).toBe('Prod-EU_1.x');
    for (const name of [
      'profile-prod.json',
      'profile-%50rod.json',
      'profile-.json',
      'profile-Prod.json.lock',
      '.profile-Prod.json.0a1b.tmp',
      'profile-a%5Cb.json',
      'profile-.Prod.json',
      'env-0123456789ABCDEF.json',
      'Profile-prod.json',
      'old-profile-Prod.json',
    ]) {
      expect(legacyProfileOf(name)).toBeUndefined();
    }
  });

  it('matches every old name of a profile with upper-case letters, and no current name', () => {
    const names = fc
      .stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/)
      .filter((name) => /[A-Z]/.test(name));
    fc.assert(
      fc.property(names, (name) => {
        expect(legacyProfileOf(`profile-${name}.json`)).toBe(name);
        expect(legacyProfileOf(profileTokenFile(name))).toBeUndefined();
      }),
    );
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (name) => {
        expect(legacyProfileOf(profileTokenFile(name))).toBeUndefined();
      }),
    );
  });
});
