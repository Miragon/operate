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

export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>;
  /** With a `mode`, a private file: written atomically, never readable with another mode. */
  writeFile(path: string, data: string | Uint8Array, options?: { mode?: number }): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
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
}
