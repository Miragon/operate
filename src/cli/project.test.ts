/**
 * Project config files end to end through `run()` (design §22, §23): the lookup from the working
 * directory, the merge with the user's config file, `config set|unset|use|delete --project`,
 * `config path|list|show`, the secrets a project file refuses, the trust of its token commands and
 * secret variables (`config trust|untrust`, kept across edits by operate) and the files a command
 * reads.
 */

import { describe, expect, it } from 'vitest';
import { BASE_URL, fakeServer, json } from '../../test/support/fake-fetch.js';
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from '../../test/support/fake-runtime.js';
import { TOKEN_DIR } from '../../test/support/oauth.js';
import { run } from './run.js';

const REPO = '/home/tester/repo';
const PROJECT = `${REPO}/.operate.json`;
const STORE = '/home/tester/.config/operate/trusted.json';

function runtimeOf(options: FakeRuntimeOptions = {}): FakeRuntime {
  const server = fakeServer()
    .on('GET', '/version', json({ version: '7.24.0' }))
    .on('GET', '/engine', json([{ name: 'default' }]))
    .on('GET', '/task', json([]));
  return fakeRuntime({
    fetch: server.fetch,
    cwd: `${REPO}/src`,
    dirs: [`${REPO}/.git`],
    ...options,
  });
}

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, runtimeOf(options));
}

/** Runs the commands on the same runtime; returns the last outcome. */
async function sequence(runtime: FakeRuntime, ...commands: (readonly string[])[]) {
  let last = await execute(run, [], runtime);
  for (const args of commands) {
    runtime.stdout.chunks.length = 0;
    runtime.stderr.chunks.length = 0;
    last = await execute(run, args, runtime);
  }
  return last;
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

function json5(value: unknown): string {
  return JSON.stringify(value);
}

const PROJECT_FILE = json5({
  defaultProfile: 'svc',
  profiles: {
    svc: { url: BASE_URL, readOnly: true },
    shared: { url: 'http://project-shared/engine-rest' },
  },
});

const USER_FILE = json5({
  defaultProfile: 'mine',
  profiles: {
    mine: { url: 'http://mine/engine-rest' },
    shared: { url: 'http://user-shared/engine-rest', engine: 'e' },
  },
});

describe('the project file in commands', () => {
  it("uses the project's default profile, its URL and its read-only guard", async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE };
    const ping = await cli(['ping', '-o', 'json'], { files });
    expect(ping.code).toBe(0);
    expect(JSON.parse(ping.stdout)).toMatchObject({ url: BASE_URL });
    const write = await cli(['task', 'claim', 't1', '--user-id', 'u'], { files });
    expect(write.code).toBe(2);
    expect(errorOf(write.stderr)).toMatchObject({ code: 'READ_ONLY' });
    expect(errorOf(write.stderr).hint).toContain('profile "svc"');
  });

  it("lets the user's profile of the same name win, and --profile pick one", async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE };
    const show = await cli(['config', 'show', '--profile', 'shared'], { files });
    expect(JSON.parse(show.stdout)).toMatchObject({
      configFile: CONFIG_PATH,
      projectFile: PROJECT,
      profile: 'shared',
      profileFile: CONFIG_PATH,
      values: { url: { value: 'http://user-shared/engine-rest' }, engine: { value: 'e' } },
    });
    const svc = await cli(['config', 'show', '-o', 'table'], { files });
    expect(svc.stdout).toMatch(
      new RegExp(
        `^Config file: ${CONFIG_PATH}\\nProject file: ${PROJECT}\\nProfile: svc \\(from the project file\\)\\n\\n`,
      ),
    );
    const mine = await cli(['config', 'show', '-o', 'table', '--profile', 'mine'], { files });
    expect(mine.stdout).toContain('\nProfile: mine\n\n');
  });

  it('lists the profiles of both files with their scope', async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE };
    const list = await cli(['config', 'list'], { files });
    expect(
      (JSON.parse(list.stdout) as { name: string; scope: string; default: boolean }[]).map(
        ({ name, scope, default: isDefault }) => [name, scope, isDefault],
      ),
    ).toEqual([
      ['mine', 'user', false],
      ['shared', 'user', false],
      ['svc', 'project', true],
    ]);
  });

  it('is left out with --config or OPERATE_CONFIG', async () => {
    const files = { [PROJECT]: PROJECT_FILE, '/other.json': USER_FILE };
    const flag = await cli(['config', 'show', '--config', '/other.json'], { files });
    expect(JSON.parse(flag.stdout)).toMatchObject({ projectFile: null, profile: 'mine' });
    const env = await cli(['config', 'list'], { files, env: { OPERATE_CONFIG: '/other.json' } });
    expect(env.stdout).not.toContain('svc');
  });

  it('is not looked up in the home directory', async () => {
    const files = { '/home/tester/.operate.json': PROJECT_FILE };
    const show = await cli(['config', 'show'], { files, cwd: '/home/tester' });
    expect(JSON.parse(show.stdout)).toMatchObject({ projectFile: null, profile: null });
  });

  it('is a CONFIG error when it stores a secret, also for best-effort readers', async () => {
    const files = {
      [PROJECT]: json5({ profiles: { p: { auth: { type: 'bearer', token: 'Tk9-secret' } } } }),
    };
    const result = await cli(['ping'], { files });
    expect(result.code).toBe(3);
    expect(errorOf(result.stderr).message).toBe(
      `Invalid project file ${PROJECT}: profile "p" stores a secret (auth.token); a project file is shared, so it names where the secret comes from instead (auth.tokenEnv or auth.tokenCommand)`,
    );
    expect(result.stderr).not.toContain('Tk9-secret');
    // the docs commands still work, with the default output format
    expect((await cli(['commands', '-o', 'json'], { files })).code).toBe(0);
  });

  it('completes the profiles of the project file too', async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE };
    const result = await cli(['__complete', 'ping', '--profile', ''], { files });
    const names = result.stdout.split('\n').map((line) => line.split('\t')[0]);
    expect(names.filter((line) => line !== '')).toEqual(['mine', 'shared', 'svc']);
  });

  it("takes the output format of the project's profile for docs commands", async () => {
    const files = {
      [PROJECT]: json5({ defaultProfile: 'p', profiles: { p: { output: 'table' } } }),
    };
    expect((await cli(['config', 'path'], { files })).stdout).toBe(`${CONFIG_PATH}\n`);
  });
});

describe('config path --project', () => {
  it('prints the project file in effect, else where config set --project creates it', async () => {
    const found = await cli(['config', 'path', '--project'], { files: { [PROJECT]: '{}' } });
    expect(found.stdout).toBe(`{"path":"${PROJECT}"}\n`);
    const created = await cli(['config', 'path', '--project', '-o', 'table']);
    expect(created.stdout).toBe(`${PROJECT}\n`);
  });

  it('refuses the home directory and --config', async () => {
    const home = await cli(['config', 'path', '--project'], { cwd: '/home/tester' });
    expect(home.code).toBe(3);
    expect(errorOf(home.stderr)).toMatchObject({
      message: 'No project directory: /home/tester is your home directory',
    });
    const both = await cli(['config', 'path', '--project', '--config', '/c.json']);
    expect(both.code).toBe(2);
    expect(errorOf(both.stderr).message).toBe('--project and --config exclude each other');
  });
});

describe('config set|unset|use|delete --project', () => {
  it('creates the project file at the repository root (0644) and edits it', async () => {
    const runtime = runtimeOf();
    const set = await sequence(runtime, [
      'config',
      'set',
      'svc',
      '--project',
      '--url',
      'http://localhost:8112/engine-rest/svc',
    ]);
    expect(set.code).toBe(0);
    expect(set.stderr).toBe(
      `Created the project file ${PROJECT}; commit it to share its profiles.\n`,
    );
    expect(runtime.files.get(PROJECT)?.mode).toBe(0o644);
    expect(JSON.parse(fileText(runtime, PROJECT) ?? '')).toEqual({
      defaultProfile: 'svc',
      profiles: { svc: { url: 'http://localhost:8112/engine-rest/svc' } },
    });
    expect(runtime.files.has(CONFIG_PATH)).toBe(false);
    const edited = await sequence(
      runtime,
      ['config', 'set', 'b', '--project', '--url', 'http://b/engine-rest'],
      ['config', 'use', 'b', '--project'],
      ['config', 'unset', 'svc', 'url', '--project'],
      ['config', 'delete', 'svc', '--project'],
    );
    expect(edited).toMatchObject({ code: 0, stderr: `Deleted profile "svc" from ${PROJECT}\n` });
    expect(JSON.parse(fileText(runtime, PROJECT) ?? '')).toEqual({
      defaultProfile: 'b',
      profiles: { b: { url: 'http://b/engine-rest' } },
    });
  });

  it('refuses secrets before writing anything', async () => {
    const runtime = runtimeOf({ stdin: 'Tk9-secret\n' });
    const token = await sequence(runtime, [
      'config',
      'set',
      'p',
      '--project',
      '--auth',
      'bearer',
      '--auth-token-stdin',
    ]);
    expect(token.code).toBe(3);
    expect(errorOf(token.stderr).message).toBe(
      `The project file ${PROJECT} must not store secrets: profile "p" stores a secret (auth.token); a project file is shared, so it names where the secret comes from instead (auth.tokenEnv or auth.tokenCommand)`,
    );
    expect(errorOf(token.stderr).hint).toContain('without --project');
    const header = await sequence(runtime, [
      'config',
      'set',
      'p',
      '--project',
      '-H',
      'X-Api-Key: k-1',
    ]);
    expect(errorOf(header.stderr).message).toContain('stores the secret header X-Api-Key');
    expect(runtime.files.has(PROJECT)).toBe(false);
  });

  it('points a user edit of a project profile to --project', async () => {
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE };
    for (const args of [
      ['config', 'unset', 'svc', 'url'],
      ['config', 'use', 'svc'],
      ['config', 'delete', 'svc'],
    ]) {
      const result = await cli(args, { files });
      expect(result.code, args.join(' ')).toBe(3);
      expect(errorOf(result.stderr)).toMatchObject({
        message: `Profile "svc" is a profile of the project file ${PROJECT}, not of your config file`,
        hint: "Add --project to change the project file; `operate config set svc <options>` without it creates a profile of your own that overrides the project's.",
      });
    }
    // a profile in neither file keeps the usual error
    const missing = await cli(['config', 'use', 'nope'], { files });
    expect(errorOf(missing.stderr).message).toBe('Profile "nope" does not exist');
  });

  it('notes when a profile of the user overrides one of the project, or its default loses', async () => {
    const runtime = runtimeOf({ files: { [PROJECT]: PROJECT_FILE } });
    const set = await sequence(runtime, ['config', 'set', 'svc', '--engine', 'mine']);
    expect(set.code).toBe(0);
    expect(set.stderr).toBe(
      [
        `Notice: profile "svc" of your config file now overrides the profile of the same name in the project file ${PROJECT} as a whole: none of the project's settings of "svc" apply. Add --project to change the project's profile instead.`,
        `Notice: in this repository the defaultProfile of the project file ${PROJECT} ("svc") wins; use --profile, OPERATE_PROFILE or \`operate config use <profile> --project\`.`,
        '',
      ].join('\n'),
    );
    const again = await sequence(runtime, ['config', 'set', 'svc', '--timeout', '5']);
    expect(again.stderr).toBe('');
  });

  it('keeps the OAuth login of a profile that the other file still has', async () => {
    const login = `${TOKEN_DIR}/profile-shared.json`;
    const files = { [PROJECT]: PROJECT_FILE, [CONFIG_PATH]: USER_FILE, [login]: '{}' };
    const runtime = runtimeOf({ files });
    const project = await sequence(runtime, ['config', 'delete', 'shared', '--project']);
    expect(project.stderr).toBe(`Deleted profile "shared" from ${PROJECT}\n`);
    expect(runtime.files.has(login)).toBe(true);
    const user = await sequence(runtime, ['config', 'delete', 'shared']);
    expect(user.stderr).toContain(`Removed the OAuth login of profile "shared"`);
    expect(runtime.files.has(login)).toBe(false);
    const both = runtimeOf({ files });
    await sequence(both, ['config', 'delete', 'shared']);
    expect(both.files.has(login)).toBe(true);
  });
});

describe('config trust and untrust', () => {
  const COMMAND_FILE = json5({
    defaultProfile: 'dev',
    profiles: { dev: { url: BASE_URL, auth: { type: 'bearer', tokenCommand: './token.sh' } } },
  });

  it('allow the token commands of the current content, until the file changes', async () => {
    const runtime = runtimeOf({
      files: { [PROJECT]: COMMAND_FILE },
      commands: { stdout: 'tok\n' },
    });
    const untrusted = await sequence(runtime, ['task', 'list']);
    expect(untrusted.code).toBe(3);
    expect(errorOf(untrusted.stderr).message).toBe(
      `The bearer token command (auth.tokenCommand of profile "dev") comes from the project file ${PROJECT}, which is not trusted`,
    );
    expect(runtime.commandRuns).toEqual([]);
    const trust = await sequence(runtime, ['config', 'trust']);
    expect(trust.code).toBe(0);
    expect(JSON.parse(trust.stdout)).toEqual({
      projectFile: PROJECT,
      trusted: true,
      tokenCommands: { dev: './token.sh' },
      variables: {},
    });
    expect(trust.stderr).toBe(
      `Trusted the current content of ${PROJECT}. operate runs its token commands and reads the variables it names for secrets until the file changes; a change made outside \`operate config ... --project\` needs a new \`operate config trust\`.\n`,
    );
    expect(runtime.files.get(STORE)?.mode).toBe(0o600);
    expect((await sequence(runtime, ['task', 'list'])).code).toBe(0);
    expect(runtime.commandRuns).toEqual([
      { command: './token.sh', options: { timeoutMs: 30_000, cwd: REPO } },
    ]);
    // a change by hand needs a new trust
    runtime.files.set(PROJECT, { data: new TextEncoder().encode(`${COMMAND_FILE}\n`) });
    expect((await sequence(runtime, ['task', 'list'])).code).toBe(3);
    await sequence(runtime, ['config', 'trust']);
    const untrust = await sequence(runtime, ['config', 'untrust', '-o', 'table']);
    const row = (key: string, value: string) => `${key.padEnd(18)}${value}`;
    expect(untrust.stdout).toBe(
      [
        row('KEY', 'VALUE'),
        row('projectFile', PROJECT),
        row('trusted', 'false'),
        row('tokenCommand dev', './token.sh'),
        '',
      ].join('\n'),
    );
    expect(untrust.stderr).toBe(
      `No longer trusting ${PROJECT}: its token commands do not run and the variables it names for secrets are not read.\n`,
    );
    expect((await sequence(runtime, ['task', 'list'])).code).toBe(3);
  });

  it('allow the variables a profile names for secrets, which are not read before', async () => {
    const files = {
      [PROJECT]: json5({
        defaultProfile: 'dev',
        profiles: {
          dev: { url: BASE_URL, auth: { type: 'bearer', tokenEnv: 'CI_TOKEN' } },
          ops: { auth: { type: 'basic', username: 'u', passwordEnv: 'CI_PASSWORD' } },
        },
      }),
    };
    const runtime = runtimeOf({ files, env: { CI_TOKEN: 'tok-1' } });
    const untrusted = await sequence(runtime, ['task', 'list']);
    expect(untrusted.code).toBe(3);
    expect(errorOf(untrusted.stderr).message).toBe(
      `The token variable CI_TOKEN (auth.tokenEnv of profile "dev") comes from the project file ${PROJECT}, which is not trusted`,
    );
    expect(untrusted.stderr).not.toContain('tok-1');
    const trust = await sequence(runtime, ['config', 'trust']);
    expect(JSON.parse(trust.stdout)).toEqual({
      projectFile: PROJECT,
      trusted: true,
      tokenCommands: {},
      variables: { dev: { tokenEnv: 'CI_TOKEN' }, ops: { passwordEnv: 'CI_PASSWORD' } },
    });
    const list = await sequence(runtime, ['task', 'list']);
    expect(list.code).toBe(0);
    const untrust = await sequence(runtime, ['config', 'untrust', '-o', 'table']);
    const row = (key: string, value: string) => `${key.padEnd(17)}${value}`;
    expect(untrust.stdout).toBe(
      [
        row('KEY', 'VALUE'),
        row('projectFile', PROJECT),
        row('trusted', 'false'),
        row('tokenEnv dev', 'CI_TOKEN'),
        row('passwordEnv ops', 'CI_PASSWORD'),
        '',
      ].join('\n'),
    );
    expect((await sequence(runtime, ['task', 'list'])).code).toBe(3);
  });

  it('show the untrusted command in config show without running it', async () => {
    const runtime = runtimeOf({ files: { [PROJECT]: COMMAND_FILE } });
    const show = await sequence(runtime, ['config', 'show', '-o', 'table']);
    expect(show.stdout).toContain(
      'tokenCommand  ./token.sh (not trusted: review the project file, then operate config trust)  profile',
    );
    expect(runtime.commandRuns).toEqual([]);
  });

  it('keep the trust of a file across edits made with --project', async () => {
    const runtime = runtimeOf({ commands: { stdout: 'tok\n' } });
    await sequence(runtime, [
      'config',
      'set',
      'dev',
      '--project',
      '--url',
      BASE_URL,
      '--auth-token-command',
      './token.sh',
    ]);
    expect((await sequence(runtime, ['task', 'list'])).code).toBe(0);
    await sequence(runtime, ['config', 'set', 'dev', '--project', '--timeout', '5000']);
    expect((await sequence(runtime, ['task', 'list'])).code).toBe(0);
    // an untrusted file stays untrusted
    await sequence(runtime, ['config', 'untrust']);
    await sequence(runtime, ['config', 'set', 'dev', '--project', '--timeout', '6000']);
    expect((await sequence(runtime, ['task', 'list'])).code).toBe(3);
    // without token commands the entry goes
    await sequence(runtime, ['config', 'trust']);
    await sequence(runtime, ['config', 'unset', 'dev', 'auth', '--project']);
    expect(JSON.parse(fileText(runtime, STORE) ?? '')).toEqual({ files: {} });
  });

  it('need a project file, and say when OPERATE_CONFIG leaves it out', async () => {
    const none = await cli(['config', 'trust']);
    expect(none.code).toBe(3);
    expect(errorOf(none.stderr).message).toBe(`No project file in ${REPO}/src or above`);
    const plain = await cli(['config', 'trust'], {
      files: { [PROJECT]: '{"profiles":{}}', '/c.json': '{"profiles":{}}' },
      env: { OPERATE_CONFIG: '/c.json' },
    });
    expect(plain.stderr).toBe(
      `Trusted the current content of ${PROJECT}. It has no token commands and names no variables for secrets, so it needs no trust. Note: OPERATE_CONFIG names a config file, so commands do not use the project file now.\n`,
    );
    const untrust = await cli(['config', 'untrust'], {
      files: { [PROJECT]: '{"profiles":{}}', '/c.json': '{"profiles":{}}' },
      env: { OPERATE_CONFIG: '/c.json' },
    });
    expect(untrust.stderr).toContain('are not read. Note: OPERATE_CONFIG');
  });
});
