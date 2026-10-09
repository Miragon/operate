/** What every command action of the CLI gets: the runtime, the catalog and the run state. */

import type { Catalog } from '../catalog/types.js';
import type { OutputFormat } from '../config/types.js';
import type { Runtime } from '../runtime.js';

/**
 * Mutable state of one `run()`: commands record the output format as soon as it is resolved, so
 * that errors raised later are rendered in the same format.
 */
export interface CliState {
  format?: OutputFormat;
}

export interface CliContext {
  readonly runtime: Runtime;
  readonly catalog: Catalog;
  readonly state: CliState;
}
