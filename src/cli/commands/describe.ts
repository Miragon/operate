/**
 * `operate describe <group> [command] | <operationId>` (design §5): the full description of one
 * operation (usage, arguments, options, request body schema, responses, examples) as JSON when
 * stdout is not a terminal, else as readable text. A group alone lists its commands like
 * `operate commands <group>`.
 */

import type { Command } from 'commander';
import { findByOperationId, findGroup, findOperation } from '../../catalog/catalog.js';
import type { Catalog, OperationSpec } from '../../catalog/types.js';
import { listCommands } from '../../docs/commands.js';
import { describeOperation, type DescribeView, renderDescribeText } from '../../docs/describe.js';
import { type OperateError, usageError } from '../../errors.js';
import { subcommand } from '../command.js';
import type { CliContext } from '../context.js';
import { type Display, displayOf, displayText } from '../display.js';
import { addGlobalOptions, readGlobals } from '../globals.js';
import { commandsText, DOCS_OPTIONS, OPTIONS_GROUP } from './commands.js';
import { describeSuggestions, didYouMean } from './suggest.js';
import type { UtilityCommand } from './types.js';

const DESCRIPTION = [
  'Describe a command: usage, arguments, options, request body schema, responses and examples.',
  '',
  'Name the command by group and command (process-definition start) or by its operationId (startProcessInstanceByKey). A group alone lists its commands like "operate commands <group>". Prints JSON when stdout is not a terminal, readable text otherwise.',
].join('\n');

/** What `describe` was asked for: a group (its commands) or one operation. */
export type DescribeTarget =
  | { readonly kind: 'group'; readonly group: string }
  | { readonly kind: 'operation'; readonly operation: OperationSpec };

function unknownTarget(catalog: Catalog, first: string, second: string | undefined): OperateError {
  // a group alone is a target of its own, so a known group here always comes with a command
  const known = findGroup(catalog, first) !== undefined;
  const message =
    second === undefined
      ? `Unknown group or operationId "${first}"`
      : `Unknown command "${first} ${second}"`;
  const list = known
    ? `Run "operate commands ${first}" for the commands of the group`
    : 'Run "operate commands" for the groups';
  const suggestions = didYouMean(describeSuggestions(catalog, first, second));
  return usageError(
    message,
    `${suggestions}${list}, or search all commands with "operate commands --search ${second ?? first}".`,
  );
}

/** Resolves the arguments of `describe`; unknown names are USAGE errors with suggestions. */
export function describeTarget(
  catalog: Catalog,
  first: string,
  second: string | undefined,
): DescribeTarget {
  if (second === undefined && findGroup(catalog, first) !== undefined) {
    return { kind: 'group', group: first };
  }
  const operation =
    second === undefined
      ? findByOperationId(catalog, first)
      : findOperation(catalog, first, second);
  if (operation === undefined) throw unknownTarget(catalog, first, second);
  return { kind: 'operation', operation };
}

/** JSON (or a table of the `--fields`), else the readable text. */
export function describeText(view: DescribeView, display: Display): string {
  return displayText(view, display, () => renderDescribeText(view));
}

async function runDescribe(
  first: string,
  second: string | undefined,
  command: Command,
  context: CliContext,
): Promise<void> {
  const { catalog, runtime } = context;
  const display = await displayOf(context, readGlobals(command));
  const target = describeTarget(catalog, first, second);
  runtime.stdout.write(
    target.kind === 'group'
      ? commandsText(listCommands(catalog, { group: target.group }), display)
      : describeText(describeOperation(target.operation, catalog), display),
  );
}

export const describeCommand: UtilityCommand = {
  name: 'describe',
  nested: false,
  register(program, context) {
    const command = subcommand(program, 'describe')
      .summary('Describe a command: options, request body, responses, examples')
      .description(DESCRIPTION)
      .usage('<group> [command] [options]')
      .argument('<group>', 'Group, e.g. process-definition, or an operationId')
      .argument('[command]', 'Command of the group, e.g. start');
    addGlobalOptions(command, DOCS_OPTIONS, OPTIONS_GROUP);
    command.action((first: string, second: string | undefined) =>
      runDescribe(first, second, command, context),
    );
  },
};
