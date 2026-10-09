/**
 * Everything the CLI needs from the outside world. Production wires Node.js in `src/bin`, tests pass
 * in-memory fakes, so every command can run in-process without touching the real system.
 */

export interface OutputStream {
  write(chunk: string | Uint8Array): void;
  readonly isTTY: boolean;
  /** Terminal width, if known. */
  readonly columns?: number;
}

/** What a path names; symbolic links are resolved, so a link to a directory is `other`. */
export type PathKind = 'file' | 'directory' | 'missing' | 'other';

/** One entry of a directory listing. */
export interface DirectoryEntry {
  readonly name: string;
  /** `other` for everything that is neither a file nor a directory, also symlinked directories. */
  readonly kind: 'file' | 'directory' | 'other';
}

export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>;
  /** With a `mode`, a private file: written atomically, never readable with another mode. */
  writeFile(path: string, data: string | Uint8Array, options?: { mode?: number }): Promise<void>;
  /** Creates the directory and its parents; `mode` applies to the directories it creates. */
  mkdir(path: string, options?: { mode?: number }): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Removes a file; resolves false when it did not exist. */
  remove(path: string): Promise<boolean>;
  /** The entries of a directory, in no particular order. */
  readdir(path: string): Promise<DirectoryEntry[]>;
  /** What `path` is; never throws for a missing path. */
  kind(path: string): Promise<PathKind>;
}

/** A request to the loopback server of `operate auth login` (the OAuth callback). */
export interface LoopbackRequest {
  readonly method: string;
  /** The path without the query string. */
  readonly path: string;
  readonly query: URLSearchParams;
}

/** The answer of the loopback server: a static HTML page. */
export interface LoopbackResponse {
  readonly status: number;
  readonly html: string;
}

export interface LoopbackServer {
  /** The bound port (the ephemeral one for port 0). */
  readonly port: number;
  close(): Promise<void>;
}

export interface Runtime {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readStdin(): Promise<Uint8Array>;
  readonly fetch: typeof globalThis.fetch;
  readonly fs: FileSystem;
  readonly homedir: string;
  readonly platform: string;
  /** Milliseconds since epoch; injectable for deterministic tests. */
  now(): number;
  /** Cryptographically strong random bytes (WebCrypto getRandomValues). */
  randomBytes(length: number): Uint8Array;
  /**
   * An HTTP server on 127.0.0.1 only (port 0: an ephemeral port); rejects with the listen error
   * (its `code`, e.g. EADDRINUSE). Only `operate auth login` starts one.
   */
  listenLoopback(
    port: number,
    handler: (request: LoopbackRequest) => Promise<LoopbackResponse>,
  ): Promise<LoopbackServer>;
  /** Starts the system browser without waiting for it; false when there is none to start. Never throws. */
  openBrowser(url: string): Promise<boolean>;
  /**
   * Runs `action` holding an exclusive lock file (0600) at `path`. `holdMs` is how long this
   * holder may keep it: recorded in the file as `staleAt`; other processes break the lock only
   * after that. Gives up (rejects; the caller maps it to CONFIG) after waiting `2 × holdMs`.
   */
  withLock<T>(path: string, holdMs: number, action: () => Promise<T>): Promise<T>;
  /**
   * Resolves after `ms` without keeping the process alive (an unref'd timer): a time limit raced
   * against other work, such as the wait for the OAuth login callback.
   */
  deadline(ms: number): Promise<void>;
  /**
   * Waits `ms` milliseconds and keeps the process alive meanwhile, like any pending work (the
   * polling of the workflow commands; the fake runtime advances its clock instead).
   */
  sleep(ms: number): Promise<void>;
}
