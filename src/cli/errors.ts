/**
 * Error handling of `run()`: commander exits become exit code 0 (help, version) or USAGE errors
 * with a hint (design §2.7); everything is rendered by `renderError` in the best known format.
 */

import type { Command, CommanderError } from 'commander';
import { type OperateError, usageError } from '../errors.js';
import { renderError, toOperateError } from '../output/error.js';
import { terminalSafe } from '../output/terminal.js';
import type { Runtime } from '../runtime.js';
import { closeNames } from '../util.js';
import { globalFromArgv, outputFromArgv, verboseRequested } from './argv.js';
import type { CliState } from './context.js';
import { commandPath } from './help.js';
import { envFormat, profileFormat, terminalFormat } from './output-format.js';
import { didYouMean } from './commands/suggest.js';

/** commander exits that are answers, not errors. */
const DISPLAY_CODES: ReadonlySet<string> = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

/** A commander exit together with the command that raised it (for the hint). */
export class CommandExit extends Error {
  readonly exit: CommanderError;
  readonly command: Command;

  constructor(exit: CommanderError, command: Command) {
    super(exit.message);
    this.name = 'CommandExit';
    this.exit = exit;
    this.command = command;
  }
}

/** exitOverride callback for `command`: throws instead of exiting the process. */
export function exitHandler(command: Command): (exit: CommanderError) => never {
  return (exit) => {
    throw new CommandExit(exit, command);
  };
}

/** True for help and version output, which end the run with exit code 0. */
export function isDisplayExit(error: unknown): boolean {
  return error instanceof CommandExit && DISPLAY_CODES.has(error.exit.code);
}

/** The quoted name of commander's unknown command / unknown option message. */
function unknownName(message: string): string {
  return /'([^']*)'/.exec(message)?.[1] ?? '';
}

/** Names and aliases of the subcommands, or the long flags of the options of `command`. */
function knownNames(command: Command, code: string): string[] {
  if (code === 'commander.unknownCommand') {
    return command.commands.flatMap((sub) => [sub.name(), ...sub.aliases()]);
  }
  return command.options.flatMap((option) => (option.long === undefined ? [] : [option.long]));
}

function helpHint(command: Command, exit: CommanderError): string {
  const help = `Run "${commandPath(command)} --help"`;
  if (exit.code !== 'commander.unknownCommand') return `${help} for the usage.`;
  const word = command.args[0] ?? '';
  return `${help} for the commands, or search all commands with "operate commands --search ${word}".`;
}

const UNKNOWN_CODES: ReadonlySet<string> = new Set([
  'commander.unknownCommand',
  'commander.unknownOption',
]);

/**
 * commander's message without its `error: ` prefix and capitalized. Unknown commands and options
 * read `Unknown command "tsk"`; their suggestions (the same `closeNames` rule as everywhere) go
 * into the hint, like the suggestions of `commands` and `describe`.
 */
export function commanderUsageError(error: CommandExit): OperateError {
  const { exit, command } = error;
  const text = exit.message.replace(/^error: /, '').replace(/\n\(Did you mean[^)]*\)$/, '');
  if (!UNKNOWN_CODES.has(exit.code)) {
    return usageError(`${text.charAt(0).toUpperCase()}${text.slice(1)}`, helpHint(command, exit));
  }
  const name = unknownName(text);
  const kind = exit.code === 'commander.unknownCommand' ? 'command' : 'option';
  const suggestions = didYouMean(closeNames(name, knownNames(command, exit.code)));
  return usageError(`Unknown ${kind} "${name}"`, `${suggestions}${helpHint(command, exit)}`);
}

/**
 * Format for errors (design §2.6 order): the resolved one when a command got that far, else
 * `-o/--output` from argv, else OPERATE_OUTPUT, else the profile's output (best effort), else json
 * unless stdout is a terminal. Never fails.
 */
export async function errorFormat(argv: readonly string[], runtime: Runtime, state: CliState) {
  return (
    state.format ??
    outputFromArgv(argv) ??
    envFormat(runtime, false) ??
    (await profileFormat(runtime, {
      config: globalFromArgv(argv, 'config'),
      profile: globalFromArgv(argv, 'profile'),
    })) ??
    terminalFormat(runtime)
  );
}

/** Writes the error to stderr and resolves to the exit code (0 for help and version). */
export async function reportError(
  error: unknown,
  argv: readonly string[],
  runtime: Runtime,
  state: CliState,
): Promise<number> {
  if (isDisplayExit(error)) return 0;
  const operateError =
    error instanceof CommandExit ? commanderUsageError(error) : toOperateError(error);
  const format = await errorFormat(argv, runtime, state);
  const text = renderError(operateError, format, verboseRequested(argv));
  runtime.stderr.write(runtime.stderr.isTTY ? terminalSafe(text) : text);
  return operateError.exitCode;
}
