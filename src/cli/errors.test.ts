import { Command, CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { CONFIG_PATH, fakeRuntime } from '../../test/support/fake-runtime.js';
import { OperateError } from '../errors.js';
import {
  CommandExit,
  commanderUsageError,
  errorFormat,
  exitHandler,
  isDisplayExit,
  reportError,
} from './errors.js';

function exitOf(command: Command, code: string, message: string): CommandExit {
  return new CommandExit(new CommanderError(1, code, message), command);
}

describe('exitHandler', () => {
  it('throws a CommandExit that names the command', () => {
    const command = new Command('task');
    const exit = new CommanderError(1, 'commander.unknownOption', "error: unknown option '--x'");
    let thrown: unknown;
    try {
      exitHandler(command)(exit);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandExit);
    expect(thrown).toMatchObject({ name: 'CommandExit', exit, command, message: exit.message });
  });
});

describe('isDisplayExit', () => {
  it('is true for help and version exits only', () => {
    const command = new Command('x');
    for (const code of ['commander.help', 'commander.helpDisplayed', 'commander.version']) {
      expect(isDisplayExit(exitOf(command, code, ''))).toBe(true);
    }
    expect(isDisplayExit(exitOf(command, 'commander.unknownOption', ''))).toBe(false);
    expect(isDisplayExit(new CommanderError(0, 'commander.help', ''))).toBe(false);
  });
});

describe('commanderUsageError', () => {
  const root = new Command('operate');
  const group = new Command('task');
  root.addCommand(group);
  group.addCommand(new Command('list').alias('get-tasks'));
  group.addCommand(new Command('claim'));
  const list = group.commands[0]!;
  list.option('--assignee <value>').option('--assigned');

  it('strips the error prefix, capitalizes and points to the help of the command', () => {
    const error = commanderUsageError(
      exitOf(group, 'commander.missingArgument', "error: missing required argument 'id'"),
    );
    expect(error).toBeInstanceOf(OperateError);
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe("Missing required argument 'id'");
    expect(error.details.hint).toBe('Run "operate task --help" for the usage.');
  });

  it('reports unknown commands with the suggestion in the hint, plus the command search', () => {
    group.args = ['lsit'];
    const error = commanderUsageError(
      exitOf(
        group,
        'commander.unknownCommand',
        "error: unknown command 'lsit'\n(Did you mean list?)",
      ),
    );
    expect(error.message).toBe('Unknown command "lsit"');
    expect(error.details.hint).toBe(
      'Did you mean list? Run "operate task --help" for the commands, or search all commands with "operate commands --search lsit".',
    );
    group.args = ['get-taks'];
    expect(
      commanderUsageError(
        exitOf(group, 'commander.unknownCommand', "error: unknown command 'get-taks'"),
      ).details.hint,
    ).toMatch(/^Did you mean get-tasks\? /);
    group.args = [];
    const odd = commanderUsageError(exitOf(group, 'commander.unknownCommand', 'error: x'));
    expect(odd.message).toBe('Unknown command ""');
    expect(odd.details.hint).toContain('"operate commands --search ".');
  });

  it('reports unknown options with the close long flags in the hint', () => {
    const error = commanderUsageError(
      exitOf(list, 'commander.unknownOption', "error: unknown option '--assigne'"),
    );
    expect(error.message).toBe('Unknown option "--assigne"');
    expect(error.details.hint).toBe(
      'Did you mean one of --assignee, --assigned? Run "operate task list --help" for the usage.',
    );
    const far = commanderUsageError(
      exitOf(list, 'commander.unknownOption', "error: unknown option '--zzz'"),
    );
    expect(far.details.hint).toBe('Run "operate task list --help" for the usage.');
  });

  it('keeps messages without prefix', () => {
    expect(commanderUsageError(exitOf(root, 'commander.error', 'odd')).message).toBe('Odd');
  });
});

describe('errorFormat', () => {
  it('prefers the resolved format, then argv, then OPERATE_OUTPUT, then the terminal', async () => {
    const tty = fakeRuntime({ stdoutTTY: true, env: { OPERATE_OUTPUT: 'json' } });
    expect(await errorFormat(['-o', 'json'], tty, { format: 'table' })).toBe('table');
    expect(await errorFormat(['-o', 'table'], tty, {})).toBe('table');
    expect(await errorFormat([], tty, {})).toBe('json');
    expect(await errorFormat([], fakeRuntime({ stdoutTTY: true }), {})).toBe('table');
    const spaced = fakeRuntime({ env: { OPERATE_OUTPUT: ' table ' } });
    expect(await errorFormat([], spaced, {})).toBe('table');
    expect(await errorFormat([], fakeRuntime({ env: { OPERATE_OUTPUT: 'yaml' } }), {})).toBe(
      'json',
    );
    expect(await errorFormat([], fakeRuntime(), {})).toBe('json');
  });

  it('takes the output of the profile named in argv, or of the default profile', async () => {
    const file = JSON.stringify({
      defaultProfile: 't',
      profiles: { t: { output: 'table' }, j: { output: 'json' } },
    });
    const runtime = fakeRuntime({ files: { '/c.json': file, [CONFIG_PATH]: file } });
    expect(await errorFormat([], runtime, {})).toBe('table');
    expect(await errorFormat(['--profile', 'j'], runtime, {})).toBe('json');
    expect(await errorFormat(['--config=/c.json', '--profile=t'], runtime, {})).toBe('table');
    expect(await errorFormat(['-o', 'json'], runtime, {})).toBe('json');
    const broken = fakeRuntime({ files: { [CONFIG_PATH]: '{' } });
    expect(await errorFormat([], broken, {})).toBe('json');
  });
});

describe('reportError', () => {
  it('returns 0 and prints nothing for help and version', async () => {
    const runtime = fakeRuntime();
    const exit = exitOf(new Command('x'), 'commander.version', '1');
    const code = await reportError(exit, [], runtime, {});
    expect(code).toBe(0);
    expect(runtime.stderr.text()).toBe('');
  });

  it('renders OperateErrors and returns their exit code', async () => {
    const runtime = fakeRuntime();
    const error = new OperateError('NOT_FOUND', 'gone', { hint: 'look elsewhere' });
    expect(await reportError(error, [], runtime, {})).toBe(5);
    expect(runtime.stderr.text()).toBe(
      '{"error":{"code":"NOT_FOUND","exitCode":5,"message":"gone","hint":"look elsewhere"}}\n',
    );
    expect(runtime.stdout.text()).toBe('');
  });

  it('turns other errors into INTERNAL with the stack when verbose', async () => {
    const runtime = fakeRuntime();
    const code = await reportError(new Error('bug'), ['--verbose'], runtime, { format: 'table' });
    expect(code).toBe(1);
    expect(runtime.stderr.text()).toMatch(/^Error: bug\n {2}Hint: This is likely a bug/);
    expect(runtime.stderr.text()).toContain('  Stack:\n');
    const quiet = fakeRuntime();
    await reportError(new Error('bug'), [], quiet, { format: 'table' });
    expect(quiet.stderr.text()).not.toContain('Stack:');
  });

  it('replaces control characters of messages on a terminal stderr only', async () => {
    const error = new OperateError('HTTP_CLIENT_ERROR', 'bad \u009b2J value');
    const tty = fakeRuntime({ stderrTTY: true });
    await reportError(error, [], tty, { format: 'json' });
    expect(tty.stderr.text()).toContain('bad \ufffd2J value');
    const pipe = fakeRuntime();
    await reportError(error, [], pipe, { format: 'json' });
    expect(pipe.stderr.text()).toContain('bad \u009b2J value');
  });
});
