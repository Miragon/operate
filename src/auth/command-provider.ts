/**
 * The AuthProvider of a bearer token command (design §23): operate runs the command when it needs
 * a token. A JWT with `exp` is reused, also across calls (command-cache.ts), until shortly before
 * it expires, then the command runs again, so a long `operate wait` keeps a valid token; an opaque
 * token is fetched once per call. After a 401 the command runs once more and the request is
 * retried with the new token. `--dry-run` runs the command too (or uses the cached token), and
 * reports a failing one as a note.
 */

import type { CommandBearerConfig } from '../config/types.js';
import { OperateError } from '../errors.js';
import { bearerRejectedHint, principalOf } from './bearer.js';
import {
  type CommandCacheDeps,
  type CommandToken,
  commandCachePath,
  isFresh,
  readCommandToken,
  writeCommandToken,
} from './command-cache.js';
import { isExpired, jwtClaims } from './jwt.js';
import { iso } from './oauth/errors.js';
import { type CommandDeps, commandTokenExpired, runTokenCommand } from './token-command.js';
import type { AuthPreview, AuthProvider, Principal } from './types.js';

/** What the provider needs: running the command and the token cache. */
export type CommandProviderDeps = CommandDeps & CommandCacheDeps;

/** Failures `--dry-run` reports as a note: the request would fail with them. */
const PREVIEW_NOTED: ReadonlySet<string> = new Set(['LOGIN_FAILED', 'TOKEN_EXPIRED']);

/** Runs the command and checks the token's expiry; caches a JWT with `exp`. */
async function fetchCommandToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<CommandToken> {
  const token = await runTokenCommand(config, deps);
  const fetchedAt = deps.now();
  const expiresAt = jwtClaims(token)?.expiresAt ?? null;
  if (expiresAt !== null && isExpired({ expiresAt }, fetchedAt)) {
    throw commandTokenExpired(config, expiresAt);
  }
  const entry = { token, expiresAt, fetchedAt };
  const path = await commandCachePath(config.command, deps);
  if (await writeCommandToken(path, config.command, entry, deps)) {
    deps.trace?.({
      type: 'note',
      message: `Cached the token until shortly before it expires at ${iso(expiresAt ?? 0)}.`,
    });
  }
  return entry;
}

/** The cached token of the command if it is still fresh, else a new one from the command. */
export async function commandToken(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): Promise<{ readonly entry: CommandToken; readonly cached: boolean }> {
  if (config.command.trusted) {
    const path = await commandCachePath(config.command, deps);
    const cached = await readCommandToken(path, config.command, deps);
    if (cached !== undefined && isFresh(cached, deps.now())) {
      deps.trace?.({
        type: 'note',
        message: `Using the token of the bearer token command of ${config.origin}, cached until it expires at ${iso(cached.expiresAt ?? 0)}.`,
      });
      return { entry: cached, cached: true };
    }
  }
  return { entry: await fetchCommandToken(config, deps), cached: false };
}

function header(entry: CommandToken): Readonly<Record<string, string>> {
  return { Authorization: `Bearer ${entry.token}` };
}

class CommandProvider implements AuthProvider {
  readonly type = 'bearer';
  private current: CommandToken | undefined;
  private rerun = false;

  constructor(
    private readonly config: CommandBearerConfig,
    private readonly deps: CommandProviderDeps,
  ) {}

  get principal(): Principal | undefined {
    return this.current === undefined
      ? undefined
      : principalOf(this.config.origin, jwtClaims(this.current.token));
  }

  async headers(): Promise<Readonly<Record<string, string>>> {
    const { current } = this;
    if (current !== undefined && isFresh(current, this.deps.now())) return header(current);
    // the cache first: a parallel command may have run the command already
    this.current = (await commandToken(this.config, this.deps)).entry;
    return header(this.current);
  }

  /** After a 401: runs the command once more; true when it printed another token. */
  async refresh(): Promise<boolean> {
    if (this.rerun) return false;
    this.rerun = true;
    const before = this.current?.token;
    this.current = await fetchCommandToken(this.config, this.deps);
    return this.current.token !== before;
  }

  async preview(): Promise<AuthPreview> {
    try {
      return { headers: await this.headers() };
    } catch (error) {
      if (!(error instanceof OperateError) || !PREVIEW_NOTED.has(error.code)) throw error;
      return { headers: {}, note: `${error.message}: the request would fail with ${error.code}.` };
    }
  }

  rejectedHint(status: number): string | undefined {
    const again = this.rerun
      ? 'operate ran the command again after the 401, and the engine rejected that token too (or the command printed the same one)'
      : 'operate ran the command for this request';
    const token = this.current?.token;
    const rejected = {
      origin: `the command of ${this.config.origin}`,
      claims: token === undefined ? undefined : jwtClaims(token),
      now: this.deps.now(),
    };
    return bearerRejectedHint(
      status,
      rejected,
      `${again}. Check what the command prints and for which audience (\`operate auth status\` shows the claims of its token).`,
    );
  }
}

export function commandBearerAuth(
  config: CommandBearerConfig,
  deps: CommandProviderDeps,
): AuthProvider {
  return new CommandProvider(config, deps);
}
