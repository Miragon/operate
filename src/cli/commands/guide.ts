/**
 * `operate guide` (design §5): prints the usage guide for agents. Always the raw markdown, whatever
 * the output format, so that it reads the same in a terminal, a pipe and an agent's context.
 */

import { GUIDE } from '../../docs/guide.js';
import { subcommand } from '../command.js';
import type { UtilityCommand } from './types.js';

const DESCRIPTION = [
  'Print the usage guide for agents and scripts as markdown: setup, workflow, conventions, output, errors and exit codes, safety and recipes.',
  '',
  'The guide is always markdown; -o/--output is accepted and ignored. skills/operate/SKILL.md of the npm package holds the same text as an agent skill.',
].join('\n');

export const guideCommand: UtilityCommand = {
  name: 'guide',
  nested: false,
  register(program, context) {
    const command = subcommand(program, 'guide')
      .summary('Print the usage guide for agents (markdown)')
      .description(DESCRIPTION)
      .option('-o, --output <format>', 'Ignored: the guide is always markdown');
    command.action(() => {
      context.runtime.stdout.write(GUIDE);
    });
  },
};
