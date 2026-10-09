/**
 * In-memory Runtime for in-process CLI tests: environment, files, stdin, terminal flags per stream,
 * captured stdout/stderr (text and bytes), a fixed clock, deterministic random bytes, an in-memory
 * loopback server, a recording browser, in-memory locks and controllable timers. Nothing touches
 * the real system.
 */

import type {
  FileSystem,
  LoopbackRequest,
  LoopbackResponse,
  LoopbackServer,
  OutputStream,
  Runtime,
} from '../../src/runtime.js';

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
  /** Random bytes; default: deterministic, a different counter-seeded value per call. */
  readonly randomBytes?: (length: number) => Uint8Array;
  /** `listenLoopback` fails with this error code (e.g. EADDRINUSE). */
  readonly listenError?: string;
  /** The port an ephemeral (0) loopback listen gets; default 53682. */
  readonly loopbackPort?: number;
  /**
   * What `openBrowser` resolves to (default false), or a hook called with the URL (e.g. one that
   * completes the login through the fake identity provider).
   */
  readonly browser?: boolean | ((url: string, runtime: FakeRuntime) => Promise<boolean>);
  /** `withLock` gives up at once, like a lock that cannot be taken. */
  readonly lockTimeout?: boolean;
  /** `sleep` resolves at once (default: never). */
  readonly sleepResolves?: boolean;
}

/** The in-memory loopback server: tests drive its handler with requests. */
interface FakeLoopback {
  /** Ports passed to `listenLoopback`. */
  readonly listens: number[];
  listening: boolean;
  closed: boolean;
  /** Sends a request to the handler (fails when nothing listens). */
  request(
    path: string,
    query?: string | Record<string, string> | URLSearchParams,
    method?: string,
  ): Promise<LoopbackResponse>;
}

export interface FakeRuntime extends Runtime {
  readonly stdout: FakeStream;
  readonly stderr: FakeStream;
  readonly files: Map<string, StoredFile>;
  readonly dirs: Set<string>;
  /** Modes passed to `mkdir`, by path. */
  readonly dirModes: Map<string, number | undefined>;
  /** URLs passed to `openBrowser`. */
  readonly browserUrls: string[];
  /** Every `withLock` call: path and holdMs. */
  readonly locks: { readonly path: string; readonly holdMs: number }[];
  /** Delays passed to `sleep`. */
  readonly sleeps: number[];
  /** Lengths passed to `randomBytes`. */
  readonly randomRequests: number[];
  readonly loopback: FakeLoopback;
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

function fakeFileSystem(
  files: Map<string, StoredFile>,
  dirs: Set<string>,
  dirModes: Map<string, number | undefined>,
): FileSystem {
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
    mkdir(path, options) {
      dirs.add(path);
      if (!dirModes.has(path)) dirModes.set(path, options?.mode);
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(files.has(path) || dirs.has(path)),
    remove: (path) => Promise.resolve(files.delete(path)),
  };
}

/** Deterministic random bytes: each call gets bytes derived from a fresh counter value. */
function counterBytes() {
  let counter = 0;
  return (length: number): Uint8Array => {
    counter += 1;
    return Uint8Array.from({ length }, (_, index) => (counter * 31 + index * 7) % 256);
  };
}

type Handler = (request: LoopbackRequest) => Promise<LoopbackResponse>;

function fakeLoopback(options: FakeRuntimeOptions) {
  let handler: Handler | undefined;
  const loopback: FakeLoopback = {
    listens: [],
    listening: false,
    closed: false,
    request(path, query = '', method = 'GET') {
      if (handler === undefined || !loopback.listening) {
        return Promise.reject(new Error('the fake loopback server is not listening'));
      }
      return handler({ method, path, query: new URLSearchParams(query) });
    },
  };
  const listen = (port: number, next: Handler): Promise<LoopbackServer> => {
    loopback.listens.push(port);
    if (options.listenError !== undefined) {
      const code = options.listenError;
      return Promise.reject(Object.assign(new Error(`listen ${code} 127.0.0.1:${port}`), { code }));
    }
    handler = next;
    loopback.listening = true;
    return Promise.resolve({
      port: port === 0 ? (options.loopbackPort ?? 53_682) : port,
      close: () => {
        loopback.listening = false;
        loopback.closed = true;
        return Promise.resolve();
      },
    });
  };
  return { loopback, listen };
}

/** An in-memory mutex per path; with `lockTimeout` every lock fails like a timeout. */
function fakeLocks(options: FakeRuntimeOptions, locks: FakeRuntime['locks']) {
  const queues = new Map<string, Promise<unknown>>();
  return <T>(path: string, holdMs: number, action: () => Promise<T>): Promise<T> => {
    locks.push({ path, holdMs });
    if (options.lockTimeout === true) {
      return Promise.reject(
        new Error(`Timed out after ${2 * holdMs} ms waiting for the lock ${path}`),
      );
    }
    const result = (queues.get(path) ?? Promise.resolve()).then(action);
    queues.set(
      path,
      result.catch(() => undefined),
    );
    return result;
  };
}

function rejectFetch(): Promise<Response> {
  return Promise.reject(new Error('the fake runtime has no fetch; pass one in the options'));
}

function streams(options: FakeRuntimeOptions) {
  return {
    env: options.env ?? {},
    stdout: fakeStream(options.stdoutTTY ?? false, options.columns),
    stderr: fakeStream(options.stderrTTY ?? false, options.stderrColumns),
  };
}

export function fakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
  const files = new Map<string, StoredFile>(
    Object.entries(options.files ?? {}).map(([path, data]) => [path, { data: toBytes(data) }]),
  );
  const dirs = new Set<string>();
  const dirModes = new Map<string, number | undefined>();
  const { stdin } = options;
  const { loopback, listen } = fakeLoopback(options);
  const browserUrls: string[] = [];
  const locks: FakeRuntime['locks'] = [];
  const sleeps: number[] = [];
  const randomRequests: number[] = [];
  const random = options.randomBytes ?? counterBytes();
  const runtime: FakeRuntime = {
    ...streams(options),
    readStdin: () =>
      stdin === undefined
        ? Promise.reject(new Error('stdin is a terminal in this test'))
        : Promise.resolve(toBytes(stdin)),
    fetch: options.fetch ?? rejectFetch,
    fs: fakeFileSystem(files, dirs, dirModes),
    files,
    dirs,
    dirModes,
    browserUrls,
    locks,
    sleeps,
    randomRequests,
    loopback,
    homedir: options.homedir ?? HOME,
    platform: options.platform ?? 'linux',
    now: options.now ?? (() => FIXED_NOW),
    randomBytes: (length) => {
      randomRequests.push(length);
      return random(length);
    },
    listenLoopback: listen,
    openBrowser: (url) => {
      browserUrls.push(url);
      const { browser } = options;
      return typeof browser === 'function'
        ? browser(url, runtime)
        : Promise.resolve(browser === true);
    },
    withLock: fakeLocks(options, locks),
    sleep: (ms) => {
      sleeps.push(ms);
      return options.sleepResolves === true ? Promise.resolve() : new Promise(() => undefined);
    },
  };
  return runtime;
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
