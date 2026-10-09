import { describe, expect, it } from 'vitest';
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from '../../../test/support/fake-runtime.js';
import { GUIDE } from '../../docs/guide.js';
import { run } from '../run.js';

function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime(options));
}

describe('operate guide', () => {
  it('prints the guide as markdown', async () => {
    const result = await cli(['guide']);
    expect(result).toMatchObject({ code: 0, stdout: GUIDE, stderr: '' });
    expect(result.stdout).toMatch(/^# operate: /);
    expect(result.stdout.endsWith('\n')).toBe(true);
  });

  it('prints markdown whatever the output format', async () => {
    const cases: [readonly string[], FakeRuntimeOptions][] = [
      [['guide'], { stdoutTTY: true }],
      [['guide', '-o', 'json'], {}],
      [['guide', '--output', 'table'], { stdoutTTY: true }],
      [['-o', 'json', 'guide'], {}],
      [['guide'], { env: { OPERATE_OUTPUT: 'json' } }],
    ];
    for (const [args, options] of cases) {
      expect(await cli(args, options)).toMatchObject({ code: 0, stdout: GUIDE, stderr: '' });
    }
  });

  it('takes no arguments', async () => {
    const result = await cli(['guide', 'setup']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'USAGE',
        exitCode: 2,
        message: "Too many arguments for 'guide'. Expected 0 arguments but got 1: setup.",
        hint: 'Run "operate guide --help" for the usage.',
      },
    });
  });

  it('describes itself in its help', async () => {
    const result = await cli(['guide', '--help']);
    expect(result.stdout).toMatch(/^Usage: operate guide \[options\]\n\nPrint the usage guide/);
    expect(result.stdout).toMatch(
      /\n {2}-o, --output <format> +Ignored: the guide is always markdown\n/,
    );
  });
});
