/**
 * Entry point of the CLI: parses the arguments, runs the command and turns every outcome into an
 * exit code. Errors are rendered to stderr by `renderError` (design §2.7), never printed directly.
 */

import { loadCatalog } from '../catalog/catalog.js';
import { EXIT_CODES } from '../errors.js';
import type { Runtime } from '../runtime.js';
import { normalizeArgv } from './argv.js';
import { COMPLETE_COMMAND, runComplete } from './completion-model.js';
import type { CliContext } from './context.js';
import { reportError } from './errors.js';
import { createProgram, hasSubcommands } from './program.js';

/** Runs `operate <argv...>` and resolves to the exit code. Never rejects. */
export async function run(argv: readonly string[], runtime: Runtime): Promise<number> {
  const context: CliContext = { runtime, catalog: loadCatalog(), state: { argv } };
  if (argv[0] === COMPLETE_COMMAND) {
    await runComplete(argv.slice(1), context);
    return EXIT_CODES.ok;
  }
  try {
    const args = normalizeArgv(argv, (name) => hasSubcommands(context.catalog, name));
    await createProgram(args, context).parseAsync(args, { from: 'user' });
    return EXIT_CODES.ok;
  } catch (error) {
    return reportError(error, argv, runtime, context.state);
  }
}
