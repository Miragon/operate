/**
 * Token commands (design §23) and profiles of a project file (design §22) in config resolution:
 * the token sources and their order, the trust of a project file's command, unused commands,
 * the profile selection with a project file and what `config show` and `config set` make of it.
 */

import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { changedBearerKeys } from './bearer-edit.js';
import { setProfile, showConfig, unsetProfileKeys } from './edit.js';
import { mergeProject } from './project.js';
import { bearerSource, unusedTokenNote } from './resolve-bearer.js';
import { resolveAuth, selectedAuth } from './resolve-auth.js';
import { missingProfileError, resolveConfig, selectProfile } from './resolve.js';
import type { LoadedConfig, ProfileAuth, ProjectSource, SelectedProfile } from './types.js';

function failure(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    if (error instanceof OperateError) return error;
    throw error;
  }
  throw new Error('expected an OperateError');
}

const PROJECT: ProjectSource = { path: '/repo/.operate.json', directory: '/repo', trusted: true };

function profile(auth: ProfileAuth, project?: ProjectSource): SelectedProfile {
  return project === undefined
    ? { name: 'dev', profile: { auth } }
    : { name: 'dev', profile: { auth }, project };
}

const COMMAND: ProfileAuth = { type: 'bearer', tokenCommand: ' ./token.sh dev ' };

describe('resolveAuth with a token command', () => {
  it('takes the command of the profile, run in the current directory', () => {
    expect(resolveAuth({}, {}, profile(COMMAND)).auth).toEqual({
      type: 'bearer',
      source: 'profile',
      origin: 'auth.tokenCommand of profile "dev"',
      profile: 'dev',
      command: { line: './token.sh dev', trusted: true },
    });
  });

  it("runs a project file's command in its directory, while the file is trusted", () => {
    expect(resolveAuth({}, {}, profile(COMMAND, PROJECT)).auth).toMatchObject({
      command: {
        line: './token.sh dev',
        cwd: '/repo',
        projectFile: '/repo/.operate.json',
        trusted: true,
      },
    });
    const untrusted = resolveAuth({}, {}, profile(COMMAND, { ...PROJECT, trusted: false }));
    expect(untrusted.auth).toMatchObject({ command: { trusted: false } });
  });

  it('takes a flag over the environment over the profile, a token over a command', () => {
    const env = { OPERATE_TOKEN_COMMAND: 'env-cmd', OPERATE_AUTH: 'bearer' };
    const flag = resolveAuth({ authTokenCommand: 'flag-cmd' }, env, profile(COMMAND, PROJECT));
    expect(flag.auth).toEqual({
      type: 'bearer',
      source: 'flag',
      origin: '--auth-token-command',
      profile: 'dev',
      command: { line: 'flag-cmd', trusted: true },
    });
    expect(resolveAuth({}, env, profile(COMMAND)).auth).toMatchObject({
      source: 'env',
      origin: 'OPERATE_TOKEN_COMMAND',
      command: { line: 'env-cmd', trusted: true },
    });
    const token = resolveAuth({}, { ...env, OPERATE_TOKEN: 'tok' }, profile(COMMAND));
    expect(token.auth).toMatchObject({ token: 'tok', origin: 'OPERATE_TOKEN' });
    const piped = resolveAuth({ authToken: 'piped', authTokenCommand: 'c' }, {}, profile(COMMAND));
    expect(piped.auth).toMatchObject({ token: 'piped', origin: '--auth-token-stdin' });
    // the variable a profile names, read only when no flag or environment value is given
    const variable = profile({ type: 'bearer', tokenEnv: 'CI_TOKEN' });
    expect(resolveAuth({}, { CI_TOKEN: 'ci' }, variable).auth).toMatchObject({ token: 'ci' });
  });

  it('selects bearer auth for a command of a flag or the environment without a type', () => {
    const resolved = resolveAuth({}, { OPERATE_TOKEN_COMMAND: 'c' }, {});
    expect(resolved.source).toBe('env');
    expect(resolved.auth).toMatchObject({ type: 'bearer', command: { line: 'c' } });
    expect(resolveAuth({ authTokenCommand: 'c' }, {}, {}).source).toBe('flag');
    expect(selectedAuth({}, { OPERATE_TOKEN_COMMAND: 'c' }, {})).toEqual({
      type: 'bearer',
      source: 'env',
      label: 'a bearer token command (from OPERATE_TOKEN_COMMAND) without an auth type',
      token: { origin: 'OPERATE_TOKEN_COMMAND', command: true },
    });
  });

  it('refuses a command of more than one line or a blank one, without repeating it', () => {
    const error = failure(() => resolveAuth({}, { OPERATE_TOKEN_COMMAND: 'a\nb' }, {}));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(
      'The bearer token command from OPERATE_TOKEN_COMMAND must be one line that is not blank',
    );
    expect(error.details.hint).toContain("--auth-token-command './scripts/token.sh dev'");
    // a trailing line break (export X="$(cat file)") is fine
    expect(resolveAuth({}, { OPERATE_TOKEN_COMMAND: 'c\n' }, {}).auth).toMatchObject({
      command: { line: 'c' },
    });
  });

  it('names a Basic auth and token command conflict', () => {
    const error = failure(() => resolveAuth({ authUser: 'u' }, { OPERATE_TOKEN_COMMAND: 'c' }, {}));
    expect(error.message).toBe(
      'Both Basic auth and a bearer token command are configured, but no auth type says which one to use',
    );
    expect(error.details.hint).toContain(
      'a bearer token command (from OPERATE_TOKEN_COMMAND) selects bearer auth',
    );
  });

  it('reports an unused command of the environment, and refuses an unused flag', () => {
    const basic = profile({ type: 'basic', username: 'u', password: 'p' });
    const resolved = resolveAuth({}, { OPERATE_TOKEN_COMMAND: 'c' }, basic);
    expect(resolved.unusedToken).toEqual({
      value: 'c',
      source: 'env',
      reason: 'Basic auth is selected by the auth.type of profile "dev"',
      command: true,
    });
    expect(unusedTokenNote(resolved.unusedToken!)).toBe(
      'A bearer token command is set (from OPERATE_TOKEN_COMMAND) but not used: Basic auth is selected by the auth.type of profile "dev"; send it with --auth bearer or OPERATE_AUTH=bearer.',
    );
    const flag = failure(() => resolveAuth({ authTokenCommand: 'c' }, {}, basic));
    expect(flag.message).toBe(
      '--auth-token-command gives a bearer token command, but Basic auth is selected by the auth.type of profile "dev"',
    );
    expect(flag.details.hint).toBe(
      'Drop --auth-token-command, or select bearer auth with --auth bearer.',
    );
    const off = resolveAuth({ auth: 'none', authTokenCommand: 'c' }, {}, {});
    expect(unusedTokenNote(off.unusedToken!, true)).toBe(
      'A bearer token command is set (from --auth-token-command) but not used: bearer auth is switched off by --auth none; use it with OPERATE_AUTH=bearer.',
    );
  });
});

describe('bearerSource', () => {
  const context = (selected: SelectedProfile, env = {}) => ({ flags: {}, env, selected });

  it('names where the token would come from without reading a variable', () => {
    expect(bearerSource(context(profile({ tokenEnv: 'UNSET' })))).toEqual({
      origin: 'auth.tokenEnv of profile "dev"',
      command: false,
    });
    expect(bearerSource(context(profile(COMMAND)))).toEqual({
      origin: 'auth.tokenCommand of profile "dev"',
      command: true,
    });
    expect(bearerSource(context(profile({ token: 't' })))).toEqual({
      origin: 'auth.token of profile "dev"',
      command: false,
    });
    expect(bearerSource(context(profile({}), { OPERATE_TOKEN_COMMAND: 'c' }))).toEqual({
      origin: 'OPERATE_TOKEN_COMMAND',
      command: true,
    });
    expect(bearerSource(context(profile({})))).toBeUndefined();
    expect(bearerSource(context({}))).toBeUndefined();
  });
});

describe('profiles of a project file', () => {
  const source: ProjectSource = { ...PROJECT, trusted: false };
  const file = mergeProject(
    { defaultProfile: 'mine', profiles: { mine: { url: 'http://mine' } } },
    { source, file: { defaultProfile: 'svc', profiles: { svc: { url: 'http://svc' } } } },
  )!;

  it('selects the project default and says where the profile comes from', () => {
    expect(selectProfile({}, {}, file)).toEqual({
      name: 'svc',
      profile: { url: 'http://svc' },
      project: source,
    });
    expect(selectProfile({ profile: 'mine' }, {}, file)).toEqual({
      name: 'mine',
      profile: { url: 'http://mine' },
    });
    const resolved = resolveConfig({}, {}, file);
    expect(resolved).toMatchObject({ profile: 'svc', url: 'http://svc', project: source });
    expect(resolveConfig({ profile: 'mine' }, {}, file).project).toBeUndefined();
  });

  it('names the project file when its default profile is missing', () => {
    const broken: LoadedConfig = { ...file, defaultProfile: 'gone' };
    const error = failure(() => selectProfile({}, {}, broken));
    expect(error.details.hint).toBe(
      'It is the defaultProfile of the project file /repo/.operate.json; choose another one with `operate config use <profile> --project`. Known profiles: svc, mine. Create it with `operate config set gone --url <url>`.',
    );
    expect(missingProfileError('x', { profiles: {} }, 'default').details.hint).toBe(
      'It is the defaultProfile of the config file; choose another one with `operate config use <profile>`. Create it with `operate config set x --url <url>`.',
    );
  });

  it('shows the project file and the file of the selected profile', () => {
    const view = showConfig(resolveConfig({}, {}, file), '/c.json', PROJECT.path);
    expect(view).toMatchObject({
      configFile: '/c.json',
      projectFile: PROJECT.path,
      profile: 'svc',
      profileFile: PROJECT.path,
    });
    const own = showConfig(resolveConfig({ profile: 'mine' }, {}, file), '/c.json', PROJECT.path);
    expect(own).toMatchObject({ profileFile: '/c.json' });
    expect(showConfig(resolveConfig({}, {}, undefined), '/c.json')).toMatchObject({
      projectFile: null,
      profileFile: null,
    });
  });
});

describe('variables that a project file names for secrets', () => {
  const untrusted: ProjectSource = { ...PROJECT, trusted: false };
  const CASES: readonly (readonly [ProfileAuth, Record<string, string>, string])[] = [
    [
      { type: 'bearer', tokenEnv: 'CI_TOKEN' },
      { CI_TOKEN: 'tok' },
      'token variable CI_TOKEN (auth.tokenEnv of profile "dev")',
    ],
    [
      { type: 'basic', username: 'u', passwordEnv: 'CI_PASSWORD' },
      { CI_PASSWORD: 'pw' },
      'password variable CI_PASSWORD (auth.passwordEnv of profile "dev")',
    ],
    [
      { type: 'oauth', issuer: 'https://idp.example', clientId: 'c', clientSecretEnv: 'CI_SECRET' },
      { CI_SECRET: 'sec' },
      'client secret variable CI_SECRET (auth.clientSecretEnv of profile "dev")',
    ],
  ];

  it('are read only while the file is trusted', () => {
    for (const [auth, env, named] of CASES) {
      expect(() => resolveAuth({}, env, profile(auth, PROJECT)), named).not.toThrow();
      expect(() => resolveAuth({}, env, profile(auth)), named).not.toThrow();
      const error = failure(() => resolveAuth({}, env, profile(auth, untrusted)));
      expect(error.code).toBe('CONFIG');
      expect(error.message).toBe(
        `The ${named} comes from the project file /repo/.operate.json, which is not trusted`,
      );
      expect(error.details.hint).toContain('ran `operate config trust` in the repository');
      expect(error.details.hint).toContain('never trusts a file itself');
    }
  });

  it('are not read when a flag or the environment gives the secret', () => {
    const auth: ProfileAuth = { type: 'bearer', tokenEnv: 'CI_TOKEN' };
    const resolved = resolveAuth({}, { OPERATE_TOKEN: 'tok' }, profile(auth, untrusted));
    expect(resolved.auth).toMatchObject({ token: 'tok', origin: 'OPERATE_TOKEN' });
  });

  it('repeat a name only in the usual form', () => {
    const name = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
    const auth: ProfileAuth = { type: 'bearer', tokenEnv: name };
    const error = failure(() => resolveAuth({}, { [name]: 'tok' }, profile(auth, untrusted)));
    expect(error.message).toBe(
      'The token variable named by auth.tokenEnv of profile "dev" comes from the project file /repo/.operate.json, which is not trusted',
    );
    expect(JSON.stringify(error.details)).not.toContain(name);
  });
});

describe('config show and config set with a token command', () => {
  it('shows the command (never run), with the trust of a project file', () => {
    const selected = (project?: ProjectSource): LoadedConfig =>
      mergeProject(undefined, {
        source: project ?? PROJECT,
        file: { defaultProfile: 'dev', profiles: { dev: { auth: COMMAND } } },
      })!;
    const trusted = showConfig(resolveConfig({}, {}, selected()), '/c.json');
    expect(trusted.values.tokenCommand).toEqual({
      value: './token.sh dev',
      source: 'profile',
      trusted: true,
    });
    expect(trusted.values.token).toBeUndefined();
    const untrusted = selected({ ...PROJECT, trusted: false });
    expect(showConfig(resolveConfig({}, {}, untrusted), '/c.json').values.tokenCommand).toEqual({
      value: './token.sh dev',
      source: 'profile',
      trusted: false,
    });
    const own = resolveConfig({}, { OPERATE_TOKEN_COMMAND: 'c' }, undefined);
    expect(showConfig(own, '/c.json').values.tokenCommand).toEqual({ value: 'c', source: 'env' });
  });

  it('shows an unused command as unused', () => {
    const resolved = resolveConfig({ auth: 'none' }, { OPERATE_TOKEN_COMMAND: 'c' }, undefined);
    expect(showConfig(resolved, '/c.json').values).toMatchObject({
      tokenCommand: {
        value: 'c',
        source: 'env',
        unused: 'bearer auth is switched off by --auth none',
      },
    });
  });

  it('stores a command in place of a token or its variable, and unsets it', () => {
    const file = setProfile(undefined, 'p', { authTokenCommand: '  ./t.sh  ' });
    expect(file.profiles.p).toEqual({ auth: { type: 'bearer', tokenCommand: './t.sh' } });
    const replaced = setProfile(file, 'p', { authTokenEnv: 'CI_TOKEN' });
    expect(replaced.profiles.p?.auth).toEqual({ type: 'bearer', tokenEnv: 'CI_TOKEN' });
    const back = setProfile(replaced, 'p', { authTokenCommand: 'c' });
    expect(back.profiles.p?.auth).toEqual({ type: 'bearer', tokenCommand: 'c' });
    expect(setProfile(back, 'p', { url: 'http://h' }).profiles.p?.auth).toEqual({
      type: 'bearer',
      tokenCommand: 'c',
    });
    expect(unsetProfileKeys(back, 'p', ['tokenCommand']).profiles.p?.auth).toEqual({
      type: 'bearer',
    });
    expect(unsetProfileKeys(back, 'p', ['auth.token']).profiles.p?.auth).toEqual({
      type: 'bearer',
    });
    expect(changedBearerKeys({ tokenCommand: 'c', type: 'bearer' }, {})).toEqual({
      tokenCommand: 'c',
    });
  });
});
