/**
 * The resolved setting of one command run: configuration (flag > env > profile > default), output
 * format, HTTP client and target. Shared by operation commands, `api` and `ping`.
 */

import { createAuthProvider } from '../auth/index.js';
import { configFilePath, explicitConfigPath, readConfigFile } from '../config/file.js';
import { resolveConfig } from '../config/resolve.js';
import { ENV, type OutputFormat, type ResolvedConfig } from '../config/types.js';
import type { ClientOptions } from '../http/client.js';
import type { GuardOptions } from '../operation/guards.js';
import type { Target } from '../operation/request.js';
import type { RenderOptions } from '../output/render.js';
import { parseFieldList } from '../output/fields.js';
import type { Runtime } from '../runtime.js';
import type { CliContext } from './context.js';
import { configFlags, type GlobalOptions } from './globals.js';
import { maxWidthOf, terminalFormat } from './output-format.js';
import { checkStdinUse, readStdinPassword } from './stdin-password.js';
import { traceWriter } from './trace.js';

export interface Session {
  readonly globals: GlobalOptions;
  readonly config: ResolvedConfig;
  readonly configPath: string;
  readonly format: OutputFormat;
  readonly pretty: boolean;
  readonly fields: readonly string[] | undefined;
}

/** Path of the config file for `--config`, OPERATE_CONFIG or the platform default. */
export function configPath(runtime: Runtime, explicit: string | undefined): string {
  return configFilePath(runtime.env, runtime, explicit);
}

/** True when the config file was named by `--config` or OPERATE_CONFIG: then it must exist. */
export function isExplicit(runtime: Runtime, flag: string | undefined): boolean {
  return explicitConfigPath(runtime.env, flag) !== undefined;
}

/**
 * Resolves the configuration and records the output format for error rendering. Reads the
 * password from stdin for `--auth-password-stdin`; `bodyFromStdin` (`--body -`) refuses that.
 */
export async function openSession(
  context: CliContext,
  globals: GlobalOptions,
  bodyFromStdin = false,
): Promise<Session> {
  const { runtime } = context;
  checkStdinUse(globals.authPasswordStdin, bodyFromStdin);
  const path = configPath(runtime, globals.config);
  const file = await readConfigFile(runtime.fs, path, isExplicit(runtime, globals.config));
  const password = globals.authPasswordStdin ? await readStdinPassword(runtime) : undefined;
  const config = resolveConfig(configFlags(globals, password), runtime.env, file);
  const format = config.output ?? terminalFormat(runtime);
  context.state.format = format;
  return {
    globals,
    config,
    configPath: path,
    format,
    pretty: globals.pretty || runtime.stdout.isTTY,
    fields: parseFieldList(globals.fields),
  };
}

export function targetOf(session: Session): Target {
  const { url, engine, headers } = session.config;
  return engine === undefined ? { baseUrl: url, headers } : { baseUrl: url, engine, headers };
}

export function clientOf(session: Session, runtime: Runtime): ClientOptions {
  const { config, globals } = session;
  const client: ClientOptions = {
    fetch: runtime.fetch,
    auth: createAuthProvider(config.auth),
    timeoutMs: config.timeoutMs,
    now: () => runtime.now(),
  };
  return globals.verbose
    ? { ...client, trace: traceWriter(runtime.stderr, globals.showSecrets) }
    : client;
}

/** Where read-only mode was switched on, for the READ_ONLY hint. */
export function readOnlySource(config: ResolvedConfig): string | undefined {
  switch (config.sources.readOnly) {
    case 'flag':
      return '--read-only';
    case 'env':
      return ENV.readOnly;
    case 'profile':
      return `profile "${config.profile ?? ''}"`;
    case 'default':
      return undefined;
  }
}

export function guardsOf(session: Session): GuardOptions {
  const source = readOnlySource(session.config);
  return {
    readOnly: session.config.readOnly,
    ...(source === undefined ? {} : { readOnlySource: source }),
    yes: session.globals.yes,
    dryRun: session.globals.dryRun,
  };
}

/** Render options for results; `unwrap` is the XML property of the operation, if it applies. */
export function renderOptionsOf(
  session: Session,
  runtime: Runtime,
  unwrap?: string,
): RenderOptions {
  return {
    format: session.format,
    pretty: session.pretty,
    fields: session.fields,
    maxWidth: maxWidthOf(runtime),
    unwrap,
    showSecrets: session.globals.showSecrets,
    baseUrl: session.config.url,
  };
}
