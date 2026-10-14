import { describe, expect, it } from 'vitest';
import { fakeRuntime, type FakeRuntimeOptions } from '../../test/support/fake-runtime.js';
import { authDeps } from '../../test/support/oauth.js';
import type { CommandBearerConfig, TokenCommand } from '../config/types.js';
import { OperateError } from '../errors.js';
import type { TraceEvent } from '../http/types.js';
import { runTokenCommand } from './token-command.js';

function config(command: Partial<TokenCommand> = {}): CommandBearerConfig {
  return {
    type: 'bearer',
    source: 'profile',
    origin: 'auth.tokenCommand of profile "dev"',
    profile: 'dev',
    command: { line: './token.sh dev', trusted: true, ...command },
  };
}

async function runWith(options: FakeRuntimeOptions, command?: Partial<TokenCommand>) {
  const runtime = fakeRuntime(options);
  const events: TraceEvent[] = [];
  const deps = authDeps(runtime, { events });
  try {
    return { token: await runTokenCommand(config(command), deps), runtime, events };
  } catch (error) {
    if (!(error instanceof OperateError)) throw error;
    return { error, runtime, events };
  }
}

describe('runTokenCommand', () => {
  it('runs the command line with the shell, bounded by the timeout, in its directory', async () => {
    const result = await runWith({ commands: { stdout: 'abc.def\nignored\n' } }, { cwd: '/repo' });
    expect(result.token).toBe('abc.def');
    expect(result.runtime.commandRuns).toEqual([
      { command: './token.sh dev', options: { timeoutMs: 30_000, cwd: '/repo' } },
    ]);
    const here = await runWith({ commands: { stdout: 'abc.def' } });
    // without a line break the whole output is the line
    expect(here.token).toBe('abc.def');
    expect(here.runtime.commandRuns[0]?.options).toStrictEqual({ timeoutMs: 30_000 });
  });

  it('takes the first line: CRLF, blanks and a "Bearer " prefix go', async () => {
    expect((await runWith({ commands: { stdout: '  Bearer abc.def== \r\n' } })).token).toBe(
      'abc.def==',
    );
  });

  it('traces the run and the duration with --verbose, never the token', async () => {
    let clock = 1_000;
    const result = await runWith({
      now: () => clock,
      commands: () => {
        clock += 250;
        return { stdout: 'tok-123' };
      },
    });
    expect(result.events).toEqual([
      {
        type: 'note',
        message: 'Running the bearer token command of auth.tokenCommand of profile "dev".',
      },
      { type: 'note', message: 'The bearer token command printed a token after 250 ms.' },
    ]);
    expect(JSON.stringify(result.events)).not.toContain('tok-123');
  });

  it('refuses the command of an untrusted project file before running it', async () => {
    const result = await runWith(
      { commands: { stdout: 'abc' } },
      { trusted: false, projectFile: '/repo/.operate.json', cwd: '/repo' },
    );
    expect(result.runtime.commandRuns).toEqual([]);
    expect(result.error?.code).toBe('CONFIG');
    expect(result.error?.message).toBe(
      'The bearer token command (auth.tokenCommand of profile "dev") comes from the project file /repo/.operate.json, which is not trusted',
    );
    expect(result.error?.details.hint).toContain('`operate config trust`');
    expect(result.error?.details.hint).toContain('never trusts a file itself');
  });

  it('is LOGIN_FAILED quoting the end of stderr when the command fails', async () => {
    const stderr = 'line 1\n\nline 2\r\nline \u001b[31m3\u0007\nline 4\n';
    const result = await runWith({ commands: { exitCode: 7, stderr } }, { cwd: '/repo' });
    expect(result.error?.code).toBe('LOGIN_FAILED');
    expect(result.error?.exitCode).toBe(4);
    expect(result.error?.message).toBe(
      'The bearer token command (auth.tokenCommand of profile "dev") failed with exit code 7: line 2 / line  [31m3 / line 4',
    );
    expect(result.error?.details.hint).toBe(
      'operate runs the command of auth.tokenCommand of profile "dev" with the shell in /repo, stdin closed, and takes the first line of its stdout as the token. Run it in a shell to see what goes wrong (`operate config show` prints it).',
    );
    const silent = await runWith({ commands: { exitCode: 1 } });
    expect(silent.error?.message).toBe(
      'The bearer token command (auth.tokenCommand of profile "dev") failed with exit code 1',
    );
    expect(silent.error?.details.hint).toContain('with the shell in the current directory');
    const killed = await runWith({ commands: { exitCode: null } });
    expect(killed.error?.message).toBe(
      'The bearer token command (auth.tokenCommand of profile "dev") ended by a signal',
    );
  });

  it('keeps the end of a long stderr', async () => {
    const result = await runWith({ commands: { exitCode: 2, stderr: `${'x'.repeat(400)}END` } });
    const message = result.error?.message ?? '';
    expect(message.endsWith(`: …${'x'.repeat(296)}END`)).toBe(true);
    const exact = await runWith({ commands: { exitCode: 2, stderr: 'y'.repeat(300) } });
    expect(exact.error?.message.endsWith(`: ${'y'.repeat(300)}`)).toBe(true);
  });

  it('is LOGIN_FAILED for a timeout, a start failure or no usable token', async () => {
    const timeout = await runWith({ commands: { timedOut: true, exitCode: null } });
    expect(timeout.error?.message).toBe(
      'The bearer token command (auth.tokenCommand of profile "dev") did not finish within 30000 ms and was stopped',
    );
    expect(timeout.error?.details.hint).toContain('must not wait for input');
    const missing = await runWith(
      {
        commands: () => Promise.reject(Object.assign(new Error('spawn'), { code: 'ENOENT' })),
      },
      { cwd: '/gone' },
    );
    expect(missing.error?.message).toBe(
      'The bearer token command (auth.tokenCommand of profile "dev") could not be started in /gone (ENOENT)',
    );
    expect(missing.error?.details.hint).toContain('Check that the directory exists');
    const odd = await runWith({ commands: () => Promise.reject(new Error('boom')) });
    expect(odd.error?.message).toContain('could not be started in the current directory (boom)');
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection
    const thrown = await runWith({ commands: () => Promise.reject('text') });
    expect(thrown.error?.message).toContain('(text)');
    for (const stdout of ['', '\nabc', '   \n']) {
      const empty = await runWith({ commands: { stdout } });
      expect(empty.error?.message, JSON.stringify(stdout)).toBe(
        'The bearer token command (auth.tokenCommand of profile "dev") printed no token on the first line of stdout',
      );
    }
    const binary = await runWith({ commands: { stdout: new Uint8Array([0xff, 0xfe, 0x0a]) } });
    expect(binary.error?.message).toBe(
      'The bearer token command (auth.tokenCommand of profile "dev") printed bytes that are not UTF-8',
    );
  });

  it('is LOGIN_FAILED for something that is not a token, never quoting it', async () => {
    const result = await runWith({ commands: { stdout: '{"access_token":"s3cr3t-value"}' } });
    expect(result.error?.code).toBe('LOGIN_FAILED');
    expect(result.error?.message).toBe(
      'The bearer token from the command of auth.tokenCommand of profile "dev" has characters a bearer token cannot have (RFC 6750)',
    );
    expect(result.error?.details.hint).toContain('not a whole header line, a JSON answer');
    expect(JSON.stringify(result.error)).not.toContain('s3cr3t-value');
  });

  it('passes on errors that are no OperateError', async () => {
    const runtime = fakeRuntime({ commands: { stdout: 'abc' } });
    const deps = authDeps(runtime, {
      now: () => {
        throw new TypeError('clock');
      },
    });
    await expect(runTokenCommand(config(), deps)).rejects.toThrow(TypeError);
  });
});
