/**
 * `--auth-password-stdin`: the Basic auth password is the first line of stdin, so it never shows
 * up in the shell history or the process list. operate never prompts for it.
 */

import { usageError } from '../errors.js';
import type { Runtime } from '../runtime.js';

const PIPE_EXAMPLE = `printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin`;

const LINE_FEED = 0x0a;

/**
 * The first line of `data` without its line break (LF, CRLF or a trailing CR). Only that line is
 * decoded (a UTF-8 sequence never contains the byte of LF). Bytes that are not UTF-8, e.g. a
 * Latin-1 password file, are a usage error: replaced characters would send wrong credentials, and
 * engines lock a user after repeated failed logins. The error never quotes the bytes.
 */
export function firstLine(data: Uint8Array): string {
  const end = data.indexOf(LINE_FEED);
  let line: string;
  try {
    // fatal: fails on bytes that are not UTF-8 instead of replacing them with U+FFFD; drops a BOM
    line = new TextDecoder('utf-8', { fatal: true }).decode(end < 0 ? data : data.subarray(0, end));
  } catch {
    throw usageError(
      '--auth-password-stdin read bytes that are not valid UTF-8',
      'Re-encode the password as UTF-8, e.g. with iconv -f latin1 -t utf-8; operate sends it UTF-8 encoded.',
    );
  }
  return line.replace(/\r+$/, '');
}

/** Both `--auth-password-stdin` and `--body -` want stdin: a usage error. */
export function checkStdinUse(passwordFromStdin: boolean, bodyFromStdin: boolean): void {
  if (passwordFromStdin && bodyFromStdin) {
    throw usageError(
      '--auth-password-stdin and --body - both read stdin',
      'Pass the body as a file (--body @file.json), or the password with OPERATE_PASSWORD or a profile (--auth-password-env).',
    );
  }
}

/** Reads the password; a blank first line is a usage error. */
export async function readStdinPassword(runtime: Runtime): Promise<string> {
  const password = firstLine(await runtime.readStdin());
  if (password.trim() === '') {
    throw usageError(
      '--auth-password-stdin read an empty password',
      `Pipe the password into the command, e.g. ${PIPE_EXAMPLE}.`,
    );
  }
  return password;
}
