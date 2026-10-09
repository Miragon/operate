/**
 * In-memory Runtime for in-process CLI tests: environment, files, stdin, terminal flags per stream,
 * captured stdout/stderr (text and bytes) and a fixed clock. Nothing touches the real system.
 */

import type { FileSystem, OutputStream, Runtime } from '../../src/runtime.js';

interface StoredFile {
  readonly data: Uint8Array;
  readonly mode?: number;
}

export interface FakeStream extends OutputStream {
  readonly chunks: (string | Uint8Array)[];
  /** Everything written, decoded as UTF-8. */
  text(): string;
  /** Everything written, as bytes. */
  bytes(): Uint8Array;
}

export interface FakeRuntimeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Initial files by path. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  /** stdin content; without it, reading stdin fails like a terminal would. */
  readonly stdin?: string | Uint8Array;
  readonly stdoutTTY?: boolean;
  readonly stderrTTY?: boolean;
  /** Terminal width of stdout (only reported when stdout is a TTY). */
  readonly columns?: number;
  /** Terminal width of stderr (only reported when stderr is a TTY). */
  readonly stderrColumns?: number;
  readonly fetch?: typeof globalThis.fetch;
  /** Clock; defaults to a fixed instant. */
  readonly now?: () => number;
  readonly homedir?: string;
  readonly platform?: string;
}

export interface FakeRuntime extends Runtime {
  readonly stdout: FakeStream;
  readonly stderr: FakeStream;
  readonly files: Map<string, StoredFile>;
  readonly dirs: Set<string>;
}

const FIXED_NOW = 1_700_000_000_000;
const HOME = '/home/tester';
/** Default config file location for HOME on Linux. */
export const CONFIG_PATH = `${HOME}/.config/operate/config.json`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data;
}

function concat(chunks: readonly (string | Uint8Array)[]): Uint8Array {
  const parts = chunks.map(toBytes);
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function fakeStream(isTTY = false, columns?: number): FakeStream {
  const chunks: (string | Uint8Array)[] = [];
  return {
    chunks,
    isTTY,
    ...(isTTY && columns !== undefined ? { columns } : {}),
    write(chunk) {
      chunks.push(chunk);
    },
    text: () => decoder.decode(concat(chunks)),
    bytes: () => concat(chunks),
  };
}

/** A Node.js style file system error (`code` is what the CLI looks at). */
function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: no such file or directory, open '${path}'`), { code });
}

function fakeFileSystem(files: Map<string, StoredFile>, dirs: Set<string>): FileSystem {
  return {
    readFile(path) {
      const file = files.get(path);
      if (file === undefined) {
        return Promise.reject(dirs.has(path) ? fsError('EISDIR', path) : fsError('ENOENT', path));
      }
      return Promise.resolve(file.data);
    },
    writeFile(path, data, options) {
      if (dirs.has(path)) return Promise.reject(fsError('EISDIR', path));
      const mode = options?.mode ?? files.get(path)?.mode;
      files.set(path, mode === undefined ? { data: toBytes(data) } : { data: toBytes(data), mode });
      return Promise.resolve();
    },
    mkdir(path) {
      dirs.add(path);
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(files.has(path) || dirs.has(path)),
  };
}

function rejectFetch(): Promise<Response> {
  return Promise.reject(new Error('the fake runtime has no fetch; pass one in the options'));
}

export function fakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
  const files = new Map<string, StoredFile>(
    Object.entries(options.files ?? {}).map(([path, data]) => [path, { data: toBytes(data) }]),
  );
  const dirs = new Set<string>();
  const { stdin } = options;
  return {
    env: options.env ?? {},
    stdout: fakeStream(options.stdoutTTY ?? false, options.columns),
    stderr: fakeStream(options.stderrTTY ?? false, options.stderrColumns),
    readStdin: () =>
      stdin === undefined
        ? Promise.reject(new Error('stdin is a terminal in this test'))
        : Promise.resolve(toBytes(stdin)),
    fetch: options.fetch ?? rejectFetch,
    fs: fakeFileSystem(files, dirs),
    files,
    dirs,
    homedir: options.homedir ?? HOME,
    platform: options.platform ?? 'linux',
    now: options.now ?? (() => FIXED_NOW),
  };
}

/** Text content of a file of the fake file system. */
export function fileText(runtime: FakeRuntime, path: string): string | undefined {
  const file = runtime.files.get(path);
  return file === undefined ? undefined : decoder.decode(file.data);
}

export interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly runtime: FakeRuntime;
}

/**
 * Runs a CLI entry point (`run` of src/cli/run.ts, passed in because test support code must not
 * import the CLI layer) on a fake runtime and captures the outcome.
 */
export async function execute(
  run: (argv: readonly string[], runtime: Runtime) => Promise<number>,
  args: readonly string[],
  runtime: FakeRuntime,
): Promise<Outcome> {
  const code = await run(args, runtime);
  return { code, stdout: runtime.stdout.text(), stderr: runtime.stderr.text(), runtime };
}
