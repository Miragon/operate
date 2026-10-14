/**
 * Running a bearer token command (design §23): `--auth-token-command`, OPERATE_TOKEN_COMMAND or
 * auth.tokenCommand. The shell runs it with stdin closed, bounded by the request timeout; the
 * first line of its stdout is the token (a leading `Bearer ` is dropped, the rest must be an RFC
 * 6750 b64token). A command that fails, times out or prints no token is LOGIN_FAILED (exit 4)
 * quoting the end of its stderr. A command of a project file runs in the file's directory and only
 * while `operate config trust` covers the file (CONFIG otherwise). Messages never show the token,
 * nor the command line (it may contain a secret; `operate config show` prints it).
 */

import { normalizeToken } from '../config/bearer.js';
import { configError } from '../config/config-error.js';
import type { CommandBearerConfig } from '../config/types.js';
import { OperateError } from '../errors.js';
import type { Runtime } from '../runtime.js';
import { isRecord } from '../util.js';
import { iso } from './oauth/errors.js';
import type { OAuthDeps } from './oauth/types.js';

/** What running a token command needs: the shell, the clock, the timeout and `--verbose`. */
export interface CommandDeps extends Pick<OAuthDeps, 'now' | 'timeoutMs' | 'trace'> {
  readonly runCommand: Runtime['runCommand'];
}

/** Longest stderr excerpt a message quotes. */
const MAX_EXCERPT = 300;

const LINE_FEED = 0x0a;

function where(config: CommandBearerConfig): string {
  return config.command.cwd ?? 'the current directory';
}

function runHint(config: CommandBearerConfig): string {
  return `operate runs the command of ${config.origin} with the shell in ${where(config)}, stdin closed, and takes the first line of its stdout as the token. Run it in a shell to see what goes wrong (\`operate config show\` prints it).`;
}

/** LOGIN_FAILED: the command did not give a token; `problem` says why (never the token). */
function loginFailed(config: CommandBearerConfig, problem: string, hint?: string) {
  return new OperateError(
    'LOGIN_FAILED',
    `The bearer token command (${config.origin}) ${problem}`,
    {
      hint: hint ?? runHint(config),
    },
  );
}

/** CONFIG: the command comes from a project file that `operate config trust` does not cover. */
function untrustedCommand(config: CommandBearerConfig): OperateError {
  return configError(
    `The bearer token command (${config.origin}) comes from the project file ${config.command.projectFile ?? ''}, which is not trusted`,
    'A token command of a project file runs code from the repository, so operate runs it only after a person reviewed the file and ran `operate config trust` in the repository (again after every change of the file). An agent asks the user to do that and never trusts a file itself.',
  );
}

/** TOKEN_EXPIRED: the command printed a JWT whose `exp` lies more than 30 s in the past. */
export function commandTokenExpired(config: CommandBearerConfig, expiresAt: number) {
  return new OperateError(
    'TOKEN_EXPIRED',
    `The bearer token that the command of ${config.origin} printed expired at ${iso(expiresAt)}`,
    {
      hint: 'operate has just run the command, and it printed an expired token: check that the command fetches a new token instead of printing a stored one, and that the clock of this machine is right.',
    },
  );
}

/** The end of stderr, control characters replaced, lines joined: what a message quotes. */
function excerpt(stderr: Uint8Array): string {
  const lines = new TextDecoder()
    .decode(stderr)
    .split(/\r?\n/)
    .map((line) => line.replace(/\p{Cc}/gu, ' ').trim())
    .filter((line) => line !== '');
  const text = lines.slice(-3).join(' / ');
  return text.length > MAX_EXCERPT ? `…${text.slice(-(MAX_EXCERPT - 1))}` : text;
}

function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

/** The first line of stdout, decoded as UTF-8 (undefined for other bytes). */
function firstLine(stdout: Uint8Array): string | undefined {
  const end = stdout.indexOf(LINE_FEED);
  try {
    const bytes = end < 0 ? stdout : stdout.subarray(0, end);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** The token on the first line of stdout; LOGIN_FAILED for anything else. */
function tokenOf(config: CommandBearerConfig, stdout: Uint8Array): string {
  const line = firstLine(stdout);
  if (line === undefined) throw loginFailed(config, 'printed bytes that are not UTF-8');
  if (line.trim() === '') throw loginFailed(config, 'printed no token on the first line of stdout');
  try {
    return normalizeToken(line, `the command of ${config.origin}`);
  } catch (error) {
    if (!(error instanceof OperateError)) throw error;
    throw new OperateError('LOGIN_FAILED', error.message, error.details);
  }
}

async function run(config: CommandBearerConfig, deps: CommandDeps) {
  const { cwd, line } = config.command;
  try {
    return await deps.runCommand(line, {
      timeoutMs: deps.timeoutMs,
      ...(cwd === undefined ? {} : { cwd }),
    });
  } catch (error) {
    throw loginFailed(
      config,
      `could not be started in ${where(config)} (${reasonOf(error)})`,
      'Check that the directory exists and that a shell (sh, cmd.exe on Windows) can run there; the container image has none, pass the token with OPERATE_TOKEN there.',
    );
  }
}

/**
 * Runs the command and returns its token (not yet checked for expiry). Traces the run with
 * `--verbose`, never the token.
 */
export async function runTokenCommand(
  config: CommandBearerConfig,
  deps: CommandDeps,
): Promise<string> {
  if (!config.command.trusted) throw untrustedCommand(config);
  const started = deps.now();
  deps.trace?.({ type: 'note', message: `Running the bearer token command of ${config.origin}.` });
  const result = await run(config, deps);
  if (result.timedOut) {
    throw loginFailed(
      config,
      `did not finish within ${deps.timeoutMs} ms and was stopped`,
      'The request timeout (--timeout, OPERATE_TIMEOUT, the profile timeout) bounds the command, too; a command must not wait for input.',
    );
  }
  if (result.exitCode !== 0) {
    const code =
      result.exitCode === null ? 'ended by a signal' : `failed with exit code ${result.exitCode}`;
    const stderr = excerpt(result.stderr);
    throw loginFailed(config, `${code}${stderr === '' ? '' : `: ${stderr}`}`);
  }
  const token = tokenOf(config, result.stdout);
  deps.trace?.({
    type: 'note',
    message: `The bearer token command printed a token after ${deps.now() - started} ms.`,
  });
  return token;
}
