/**
 * The Runtime on Node.js: process streams (a closed pipe such as `| head` ends output quietly),
 * stdin, the file system, fetch and the environment.
 */

import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { usageError } from '../errors.js';
import type { FileSystem, OutputStream, Runtime } from '../runtime.js';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/** The parts of a process stream used here; `isTTY` is undefined (not false) for pipes and files. */
interface ProcessStream {
  readonly isTTY?: boolean;
  readonly columns?: number;
  write(chunk: string | Uint8Array): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Wraps a process stream. EPIPE (the reader went away) stops further output instead of crashing
 * with an unhandled 'error' event and a stack trace; other stream errors are rethrown.
 */
function outputStream(stream: ProcessStream): OutputStream {
  let closed = false;
  stream.on('error', (error) => {
    if (errorCode(error) !== 'EPIPE') throw error;
    closed = true;
  });
  const isTTY = stream.isTTY === true;
  return {
    write(chunk) {
      if (!closed) stream.write(chunk);
    },
    isTTY,
    // pseudo terminals of `script` or `docker exec -t` report 0 columns: unknown width
    ...(isTTY && stream.columns !== undefined && stream.columns > 0
      ? { columns: stream.columns }
      : {}),
  };
}

/** Reads stdin completely; refuses to wait for a terminal. */
async function readStdin(stdin: NodeJS.ReadStream = process.stdin): Promise<Uint8Array> {
  if (stdin.isTTY) {
    throw usageError(
      'stdin is a terminal; pipe the body into the command',
      "Example: echo '{}' | operate ... --body -, or pass --body @file.json.",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

const nodeFileSystem: FileSystem = {
  readFile: async (path) => new Uint8Array(await readFile(path)),
  async writeFile(path, data, options) {
    const mode = options?.mode;
    await writeFile(path, data, mode === undefined ? {} : { mode });
    // the mode of writeFile only applies to new files; existing files keep theirs otherwise
    if (mode !== undefined) await chmod(path, mode);
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  exists,
};

export function createNodeRuntime(): Runtime {
  return {
    env: process.env,
    stdout: outputStream(process.stdout),
    stderr: outputStream(process.stderr),
    readStdin: () => readStdin(),
    fetch: globalThis.fetch,
    fs: nodeFileSystem,
    homedir: homedir(),
    platform: process.platform,
    now: () => Date.now(),
  };
}
