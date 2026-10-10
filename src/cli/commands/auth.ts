/**
 * `operate auth login|status|logout` (design §16.3): the OAuth login of a person in a terminal,
 * the state of the token cache, and the logout; `auth status` also shows a bearer token from
 * elsewhere (auth-bearer.ts, §18). This is the only module that imports the interactive login
 * (src/auth/oauth/login.ts): no other command can start a loopback server or a browser, so agents
 * never end up in an interactive login.
 */

import type { Command } from 'commander';
import { cachePath, readCache } from '../../auth/oauth/cache.js';
import { checkUsable, iso, notLoggedIn, otherIdentity } from '../../auth/oauth/errors.js';
import { identityOf, sameIdentity } from '../../auth/oauth/identity.js';
import { login } from '../../auth/oauth/login.js';
import { logout, type LogoutTarget } from '../../auth/oauth/logout.js';
import type { LoginDeps } from '../../auth/oauth/types.js';
import { profileTokenFile, readConfigFile } from '../../config/file.js';
import type { Env } from '../../config/pick.js';
import { selectedAuth } from '../../config/resolve-auth.js';
import { endpointSource } from '../../config/resolve-oauth.js';
import {
  MAX_TIMEOUT_MS,
  parseTimeout,
  resolveConfig,
  selectProfile,
} from '../../config/resolve.js';
import {
  type BearerAuthConfig,
  DEFAULT_TIMEOUT_MS,
  type ResolvedConfig,
  type SelectedProfile,
} from '../../config/types.js';
import { usageError } from '../../errors.js';
import { renderValue } from '../../output/render.js';
import { terminalSafe } from '../../output/terminal.js';
import type { OutputStream, Runtime } from '../../runtime.js';
import { subcommand } from '../command.js';
import type { CliContext } from '../context.js';
import { type Display, displayOf } from '../display.js';
import { addGlobalOptions, configFlags, type GlobalOptions, readGlobals } from '../globals.js';
import { maxWidthOf } from '../output-format.js';
import { configPath, isExplicit, oauthDeps, type Session, sessionOAuthDeps } from '../session.js';
import {
  bearerNotManaged,
  type BearerStatusView,
  bearerStatusView,
  expiredError,
} from './auth-bearer.js';
import { authSession, notOAuth, notOAuthOf, oauthOf } from './auth-session.js';
import { type LoginView, loginView, type LogoutView, viewRows } from './auth-view.js';
import type { UtilityCommand } from './types.js';

const LOGIN_OPTIONS = ['profile', 'config', 'output', 'timeout', 'verbose'];
/** `--auth-token-stdin` lets `auth status` show a piped bearer token (design §18). */
const STATUS_OPTIONS = ['profile', 'config', 'output', 'auth-token-stdin'];
const OPTIONS_GROUP = 'Options:';
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

const DESCRIPTION = [
  'Log in with OAuth 2.0 (authorization code flow with PKCE) and manage the cached tokens.',
  '',
  'A person runs "operate auth login" once in a terminal; every other command reads the token cache and refreshes the token on its own. Agents never log in themselves: without a usable login a command fails with LOGIN_REQUIRED (exit 4).',
  '',
  'A bearer token from elsewhere (--auth bearer, OPERATE_TOKEN) needs no login: "operate auth status" shows where it comes from and, for a JWT, its subject, issuer, audience and expiry.',
].join('\n');

type Format = Pick<Display, 'format' | 'pretty' | 'maxWidth'>;

function printView(
  view: LoginView | LogoutView | BearerStatusView,
  display: Format,
  runtime: Runtime,
): void {
  const value = display.format === 'json' ? view : viewRows(view);
  runtime.stdout.write(renderValue(value, display));
}

/** stderr with control characters replaced on a terminal (the user name comes from the AS). */
function safeStderr(runtime: Runtime): OutputStream {
  const { stderr } = runtime;
  return {
    isTTY: stderr.isTTY,
    write: (chunk) => {
      stderr.write(typeof chunk === 'string' && stderr.isTTY ? terminalSafe(chunk) : chunk);
    },
  };
}

/** `--login-timeout <ms>`: a positive whole number up to the largest timer delay. */
export function parseLoginTimeout(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LOGIN_TIMEOUT_MS;
  const value = /^\s*\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS) return value;
  throw usageError(
    `--login-timeout expects a positive number of milliseconds, got "${raw}"`,
    `Use a whole number between 1 and ${MAX_TIMEOUT_MS}, e.g. 600000 for ten minutes.`,
  );
}

async function runLogin(command: Command, context: CliContext): Promise<void> {
  const { runtime } = context;
  const options = command.opts<{ browser?: boolean; loginTimeout?: string }>();
  const loginTimeoutMs = parseLoginTimeout(options.loginTimeout);
  const session = await authSession(command, context, 'login');
  const config = oauthOf(session, 'login', runtime.env);
  const deps: LoginDeps = {
    ...sessionOAuthDeps(session, runtime),
    randomBytes: (length) => runtime.randomBytes(length),
    listenLoopback: (port, handler) => runtime.listenLoopback(port, handler),
    openBrowser: (url) => runtime.openBrowser(url),
    deadline: (ms) => runtime.deadline(ms),
    stderr: safeStderr(runtime),
  };
  const noBrowser = options.browser === false;
  const result = await login(config, { noBrowser, loginTimeoutMs }, deps);
  const view = loginView(result.login, config, result.tokenFile, runtime.now());
  printView(view, { ...session, maxWidth: maxWidthOf(runtime) }, runtime);
}

/** `auth status` of a bearer token: the view, then TOKEN_EXPIRED for an expired JWT. */
function bearerStatus(auth: BearerAuthConfig, session: Session, runtime: Runtime): void {
  const now = runtime.now();
  printView(bearerStatusView(auth, now), { ...session, maxWidth: maxWidthOf(runtime) }, runtime);
  const expired = expiredError(auth, now);
  if (expired !== undefined) throw expired;
}

async function runStatus(command: Command, context: CliContext): Promise<void> {
  const { runtime } = context;
  const session = await authSession(command, context, 'status');
  const { auth } = session.config;
  if (auth.type === 'bearer') {
    bearerStatus(auth, session, runtime);
    return;
  }
  const config = oauthOf(session, 'status', runtime.env);
  const deps = sessionOAuthDeps(session, runtime);
  const path = await cachePath(config, deps);
  const cached = await readCache(path, deps, config.profile);
  if (cached === undefined) throw notLoggedIn(config.profile);
  if (!sameIdentity(cached.identity, identityOf(config)))
    throw otherIdentity(cached.identity, config);
  const now = runtime.now();
  checkUsable(cached, now, config.profile);
  printView(
    loginView(cached, config, path, now),
    { ...session, maxWidth: maxWidthOf(runtime) },
    runtime,
  );
}

/** The resolved configuration, or why it does not resolve (logout resolves best effort). */
function tryResolve(
  globals: GlobalOptions,
  runtime: Runtime,
  file: Parameters<typeof resolveConfig>[2],
): { readonly config: ResolvedConfig } | { readonly error: unknown } {
  try {
    return {
      config: resolveConfig(configFlags(globals), runtime.env, file, { authCommand: true }),
    };
  } catch (error) {
    return { error };
  }
}

/** Why logout has no OAuth settings to revoke a confidential login with. */
function unresolvedReason(error: unknown, profile: string | undefined): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `the OAuth settings of ${profile === undefined ? 'the configuration' : `profile "${profile}"`} do not resolve: ${reason}`;
}

/** The request timeout of logout: resolved, else `--timeout`, else the default. */
function logoutTimeout(globals: GlobalOptions, resolved: ResolvedConfig | undefined): number {
  if (resolved !== undefined) return resolved.timeoutMs;
  return globals.timeout === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(globals.timeout);
}

/** Whose login logout removes, and the OAuth settings for a confidential client's secret. */
function targetOf(
  selected: SelectedProfile,
  resolution: ReturnType<typeof tryResolve>,
): LogoutTarget {
  const resolved = 'config' in resolution ? resolution.config : undefined;
  const settings = resolved?.auth.type === 'oauth' ? resolved.auth : undefined;
  return {
    profile: selected.name,
    source:
      settings === undefined ? 'the revocation endpoint cached at login' : endpointSource(settings),
    settings,
    unresolved:
      'error' in resolution ? unresolvedReason(resolution.error, selected.name) : undefined,
  };
}

/** What selected bearer auth for logout, or undefined when another type is selected. */
function bearerSelection(globals: GlobalOptions, env: Env, selected: SelectedProfile) {
  const auth = selectedAuth(configFlags(globals), env, selected);
  return auth?.type === 'bearer' ? { profile: selected.name, source: auth.source, env } : undefined;
}

/** What logout works on: the selected profile and, if they resolve, the OAuth settings. */
async function logoutTarget(globals: GlobalOptions, context: CliContext) {
  const { runtime } = context;
  const path = configPath(runtime, globals.config);
  const file = await readConfigFile(runtime.fs, path, isExplicit(runtime, globals.config));
  const selected = selectProfile(configFlags(globals), runtime.env, file);
  const resolution = tryResolve(globals, runtime, file);
  const resolved = 'config' in resolution ? resolution.config : undefined;
  const deps = oauthDeps(runtime, { ...globals, timeoutMs: logoutTimeout(globals, resolved) });
  const target = targetOf(selected, resolution);
  const bearer = bearerSelection(globals, runtime.env, selected);
  if (selected.name !== undefined) {
    const tokenCache = deps.tokenPath(profileTokenFile(selected.name));
    // a bearer profile may still have the OAuth login it used before (config set says so)
    if (bearer !== undefined && !(await runtime.fs.exists(tokenCache))) {
      throw bearerNotManaged('logout', bearer);
    }
    return { target, deps, tokenCache };
  }
  if (bearer !== undefined) throw bearerNotManaged('logout', bearer);
  // without a profile the file name is derived from the resolved OAuth settings
  if (target.settings === undefined) {
    if ('error' in resolution) throw resolution.error;
    throw notOAuth('logout', notOAuthOf(resolution.config), runtime.env);
  }
  return { target, deps, tokenCache: await cachePath(target.settings, deps) };
}

async function runLogout(command: Command, context: CliContext): Promise<void> {
  const { runtime } = context;
  const globals = readGlobals(command);
  const display = await displayOf(context, globals);
  const { target, deps, tokenCache } = await logoutTarget(globals, context);
  const result = await logout(tokenCache, target, deps);
  const stderr = safeStderr(runtime);
  for (const warning of result.warnings) stderr.write(`${warning}\n`);
  if (result.validUntil !== undefined) {
    const until = result.validUntil === null ? 'it expires' : iso(result.validUntil);
    stderr.write(
      `Note: the access token issued before stays valid until ${until} at gateways that check tokens offline.\n`,
    );
  }
  const { removed, revoked } = result;
  printView({ profile: target.profile ?? null, tokenCache, removed, revoked }, display, runtime);
}

function authSubcommand(parent: Command, name: string, description: string): Command {
  return subcommand(parent, name).description(description);
}

function registerLogin(auth: Command, context: CliContext): void {
  const command = authSubcommand(
    auth,
    'login',
    'Log in with the OAuth settings of the profile: prints the authorization URL, opens the system browser and waits for the login at http://127.0.0.1:<port>/callback. Replaces a cached login. Meant for a person in a terminal, not for agents.',
  )
    .option('--no-browser', 'Only print the URL; do not start the system browser')
    .option('--login-timeout <ms>', 'How long to wait for the login, default 300000');
  addGlobalOptions(command, LOGIN_OPTIONS, OPTIONS_GROUP);
  command.action(() => runLogin(command, context));
}

function registerStatus(auth: Command, context: CliContext): void {
  const command = authSubcommand(
    auth,
    'status',
    'Show the cached OAuth login without network access: user, scopes and the expiry of the access and refresh token. Exit 0 when commands can run without a new login, else LOGIN_REQUIRED (exit 4). With a bearer token: its source and, for a JWT, subject, issuer, audience and expiry; an expired JWT exits with TOKEN_EXPIRED (exit 4). Never prints a token.',
  );
  addGlobalOptions(command, STATUS_OPTIONS, OPTIONS_GROUP);
  command.action(() => runStatus(command, context));
}

function registerLogout(auth: Command, context: CliContext): void {
  const command = authSubcommand(
    auth,
    'logout',
    'Revoke the refresh token at the authorization server (when it supports revocation) and remove the cached login. Works for a profile whose OAuth settings no longer resolve.',
  );
  addGlobalOptions(command, LOGIN_OPTIONS, OPTIONS_GROUP);
  command.action(() => runLogout(command, context));
}

export const authCommand: UtilityCommand = {
  name: 'auth',
  nested: true,
  register(program, context) {
    const auth = subcommand(program, 'auth')
      .summary('Log in with OAuth, manage the cached tokens, check a bearer token')
      .description(DESCRIPTION);
    registerLogin(auth, context);
    registerStatus(auth, context);
    registerLogout(auth, context);
  },
};
