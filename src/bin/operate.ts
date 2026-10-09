#!/usr/bin/env node
/** Executable entry point: runs the CLI on the Node.js runtime and sets the exit code. */

import { run } from '../cli/run.js';
import { createNodeRuntime } from './node-runtime.js';

process.exitCode = await run(process.argv.slice(2), createNodeRuntime());
