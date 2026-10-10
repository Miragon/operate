/**
 * Mistyped auth flags in commander errors (design §15, §16.2.2). Secrets are never flags, so the
 * most likely mistakes (`--auth-password=...`, `--auth-password-stdin <password>`) must not echo
 * them on stderr, into CI logs and agent transcripts. The flag names proposed in issues #1 and #2
 * point to the `--auth-*` / `--oauth-*` flags they became.
 */

/** Flag names that were renamed to the `--auth-*` / `--oauth-*` flags, or are guessed for them. */
const AUTH_FLAGS: Readonly<Record<string, string>> = {
  '--username': '--auth-user',
  '--user': '--auth-user',
  '--auth-username': '--auth-user',
  '--password-stdin': '--auth-password-stdin',
  '--password-env': '--auth-password-env',
  '--auth-password-file': '--auth-password-stdin',
  '--auth-type': '--auth',
  '--issuer': '--oauth-issuer',
  '--client-id': '--oauth-client-id',
  '--client-secret': '--oauth-client-secret-env',
  '--oauth-client-secret': '--oauth-client-secret-env',
  '--scope': '--oauth-scopes',
  '--scopes': '--oauth-scopes',
};

/** Option names that ask for a secret as their value. */
const SECRET_NAME = /password|passwd|pwd|secret|token|-pass(?:$|-)/i;

const SECRET_HINT =
  'Secrets are never flag values: pipe the password into --auth-password-stdin, or set OPERATE_PASSWORD (a profile stores the name of a variable: config set --auth-password-env <VAR>); pass a token with OPERATE_HEADERS; an OAuth token comes from `operate auth login`. ';

const STDIN_HINT = `--auth-password-stdin takes no value: pipe the password into it, e.g. printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin. `;

/**
 * The option name of an unknown option token without its `=value`: commander quotes the whole
 * token, and `--auth-password=<password>` must not end up in the error.
 */
export function optionName(token: string): string {
  const equals = token.indexOf('=');
  return equals < 0 ? token : token.slice(0, equals);
}

/** The `--auth-*` flag meant by a renamed or guessed name, if the command has it. */
export function authFlagFor(name: string, known: readonly string[]): string[] {
  const flag = AUTH_FLAGS[name.toLowerCase()];
  return known.filter((candidate) => candidate === flag);
}

/** `--show-secrets` is no secret, but only some commands print credentials at all. */
const SHOW_SECRETS_HINT =
  '--show-secrets works where operate prints credentials: --dry-run and --verbose of API and workflow commands, api and ping, and config show. `operate auth` commands never print a token. ';

/**
 * A hint (with a trailing space) for an unknown option that looks like it wants a secret, or for
 * `--show-secrets` on a command without it.
 */
export function secretHint(name: string): string {
  if (name.toLowerCase() === '--show-secrets') return SHOW_SECRETS_HINT;
  return SECRET_NAME.test(name) ? SECRET_HINT : '';
}

/** True when the command line has an option about a secret, whose value may be an extra argument. */
export function mentionsSecret(argv: readonly string[]): boolean {
  return argv.some((token) => token.startsWith('-') && SECRET_NAME.test(optionName(token)));
}

/** The hint for extra arguments next to `--auth-password-stdin`, which takes no value. */
export function stdinHint(argv: readonly string[]): string {
  return argv.some((token) => optionName(token) === '--auth-password-stdin') ? STDIN_HINT : '';
}
