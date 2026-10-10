/**
 * `operate config path|show|list|set|unset|use|delete` (design §3). The edits are the pure
 * functions of src/config/edit.ts; this module reads and writes the file (mode 0600) and prints.
 */

import type { Command } from 'commander';
import {
  deleteProfile,
  listProfiles,
  type ProfileChanges,
  setProfile,
  showConfig,
  unsetProfileKeys,
  useProfile,
} from '../../config/edit.js';
import { readConfigFile, writeConfigFile } from '../../config/file.js';
import { OAUTH_UNSET_KEYS } from '../../config/oauth-edit.js';
import { findProfile, validateOutput } from '../../config/resolve.js';
import { AUTH_TYPES, type ConfigFile, OUTPUT_FORMATS, PROFILE_KEYS } from '../../config/types.js';
import { renderValue } from '../../output/render.js';
import { compact } from '../../util.js';
import { subcommand } from '../command.js';
import { setOptionCompletion, setPositional } from '../completion-meta.js';
import type { CliContext } from '../context.js';
import { type DisplayFlags, displayOf } from '../display.js';
import { addGlobalOptions, readGlobals } from '../globals.js';
import { collect } from '../options.js';
import { maxWidthOf } from '../output-format.js';
import { configPath, isExplicit, openSession } from '../session.js';
import {
  addOAuthOptions,
  oauthChanges,
  readSetSecrets,
  removeLogin,
  setNotices,
} from './config-oauth.js';
import { maskedView, profileView, showHeader, showRows } from './config-view.js';
import type { UtilityCommand } from './types.js';

/**
 * Global options accepted by `config show`: the config related ones. Config commands inherit
 * `-h, --help` from the program, under the same "Options:" heading.
 */
const SHOW_OPTIONS = [
  'url',
  'engine',
  'profile',
  'config',
  'output',
  'timeout',
  'header',
  'auth',
  'auth-user',
  'auth-password-stdin',
  'read-only',
  'show-secrets',
];
/** Global options of the other config commands; `-o/--output` only chooses the output format. */
const FILE_OPTIONS = ['config', 'output'];
/** `config set` has no global `--output`: its `--output` is a profile value, `-o` the format. */
const SET_OPTIONS = ['config'];

interface SetOptions {
  readonly url?: string;
  readonly engine?: string;
  readonly auth?: string;
  readonly authUser?: string;
  readonly authPasswordEnv?: string;
  readonly output?: string;
  readonly timeout?: string;
  readonly header?: string[];
  readonly readOnly?: boolean;
  readonly default?: boolean;
}

type Edit = (file: ConfigFile | undefined) => ConfigFile;

function write(context: CliContext, text: string): void {
  context.runtime.stdout.write(text);
}

async function printPath(command: Command, context: CliContext): Promise<void> {
  const globals = readGlobals(command);
  const view = await displayOf(context, globals);
  const path = configPath(context.runtime, globals.config);
  write(context, view.format === 'json' ? renderValue({ path }, view) : `${path}\n`);
}

/**
 * `-o` only chooses how `config show` prints: the values are what an operation command resolves
 * without it (OPERATE_OUTPUT, the profile's output or the default).
 */
async function printConfig(command: Command, context: CliContext): Promise<void> {
  const { output, ...globals } = readGlobals(command);
  const display = output === undefined ? undefined : validateOutput(output);
  const session = await openSession(context, globals);
  const format = display ?? session.format;
  context.state.format = format;
  const view = maskedView(showConfig(session.config, session.configPath), globals.showSecrets);
  const options = { format, pretty: session.pretty, maxWidth: maxWidthOf(context.runtime) };
  write(
    context,
    format === 'json'
      ? renderValue(view, options)
      : `${showHeader(view)}${renderValue(showRows(view), options)}`,
  );
}

async function printProfiles(command: Command, context: CliContext): Promise<void> {
  const globals = readGlobals(command);
  const view = await displayOf(context, globals);
  const path = configPath(context.runtime, globals.config);
  const file = await readConfigFile(
    context.runtime.fs,
    path,
    isExplicit(context.runtime, globals.config),
  );
  write(context, renderValue(listProfiles(file), view));
}

/**
 * `--config` and the output format of an edit command: `-o/--output`, on `config set` `-o` alone
 * (its `--output` is the profile value).
 */
function editFlags(command: Command): DisplayFlags {
  const { config, output, o } = command.opts<{ config?: string; output?: string; o?: string }>();
  return compact({ config, output: command.name() === 'set' ? o : output });
}

/** Reads the config file, applies the edit and writes it back with mode 0600. */
async function editConfig(command: Command, context: CliContext, edit: Edit) {
  const { runtime } = context;
  const flags = editFlags(command);
  const view = await displayOf(context, flags);
  const path = configPath(runtime, flags.config);
  const previous = await readConfigFile(runtime.fs, path);
  const file = edit(previous);
  await writeConfigFile(runtime.fs, path, file);
  return { file, previous, path, view };
}

/**
 * The changes of `config set`; only options given on the command line. The secrets are what
 * `--auth-password-stdin` and `--oauth-client-secret-stdin` read.
 */
function profileChanges(
  command: Command,
  secrets: { readonly password?: string | undefined; readonly clientSecret?: string | undefined },
): ProfileChanges {
  // --read-only is defined before --no-read-only, so neither sets a default value
  const options = command.opts<SetOptions>();
  const password = secrets.password;
  return compact({
    ...oauthChanges(command, secrets.clientSecret),
    url: options.url,
    engine: options.engine,
    auth: options.auth,
    authUser: options.authUser,
    authPasswordEnv: options.authPasswordEnv,
    authPassword: password,
    output: options.output,
    timeout: options.timeout,
    headers: options.header,
    readOnly: options.readOnly,
    makeDefault: options.default === true ? true : undefined,
  });
}

/** Applies the edit and prints the profile; resolves to the file before and after, and its path. */
async function editProfile(name: string, command: Command, context: CliContext, edit: Edit) {
  const edited = await editConfig(command, context, edit);
  write(context, renderValue(profileView(edited.file, name), edited.view));
  return edited;
}

/** True for a variable name that has no non-blank value in `env` (blank passwords count as unset). */
function isUnset(env: CliContext['runtime']['env'], name: string): boolean {
  return (env[name.trim()] ?? '').trim() === '';
}

/** True when `variable` was given and names a variable that is not set. */
function unsetVariable(env: CliContext['runtime']['env'], variable: string | undefined): boolean {
  return variable !== undefined && isUnset(env, variable);
}

/** `config set`: reads literal secrets from stdin first, and warns after storing them. */
async function setProfileFrom(name: string, command: Command, context: CliContext) {
  const { runtime } = context;
  const secrets = await readSetSecrets(command, context);
  const changes = profileChanges(command, secrets);
  const { file, previous, path } = await editProfile(name, command, context, (current) =>
    setProfile(current, name, changes),
  );
  const notices = setNotices({
    name,
    path,
    before: findProfile(previous, name),
    after: findProfile(file, name),
    storedPassword: secrets.password !== undefined,
    unsetVariable: unsetVariable(runtime.env, changes.authPasswordEnv),
    storedClientSecret: secrets.clientSecret !== undefined,
    unsetSecretVariable: unsetVariable(runtime.env, changes.oauthClientSecretEnv),
  });
  for (const notice of notices) runtime.stderr.write(`${notice}\n`);
}

async function removeProfile(name: string, command: Command, context: CliContext): Promise<void> {
  const { path } = await editConfig(command, context, (file) => deleteProfile(file, name));
  context.runtime.stderr.write(`Deleted profile "${name}" from ${path}\n`);
  await removeLogin(name, context);
}

/** Heading of the own options of config commands (commander's default). */
const OPTIONS_GROUP = 'Options:';

function configSubcommand(parent: Command, name: string, description: string, options: string[]) {
  return addGlobalOptions(
    subcommand(parent, name).description(description),
    options,
    OPTIONS_GROUP,
  );
}

function registerReadCommands(config: Command, context: CliContext): void {
  const path = configSubcommand(
    config,
    'path',
    'Print the location of the config file',
    FILE_OPTIONS,
  );
  path.action(() => printPath(path, context));
  const show = configSubcommand(
    config,
    'show',
    'Print the effective configuration and where each value comes from; header values, the password and the client secret are masked unless --show-secrets. -o only formats this output: the values are what an operation command resolves without it.',
    SHOW_OPTIONS,
  );
  show.action(() => printConfig(show, context));
  const list = configSubcommand(config, 'list', 'List the profiles', FILE_OPTIONS);
  list.action(() => printProfiles(list, context));
}

/** Fixed values of the options of `config set`, for shell completion. */
const SET_VALUES: Readonly<Record<string, readonly string[]>> = {
  '--auth': AUTH_TYPES,
  '--output': OUTPUT_FORMATS,
  '-o': OUTPUT_FORMATS,
};

/**
 * Completion facts: the profile positional completes to the profile names of the file, the
 * positionals after it (`config unset`) to `rest`.
 */
function completeProfiles(command: Command, rest?: readonly string[]): Command {
  for (const option of command.options) {
    const values = SET_VALUES[option.long ?? option.short ?? ''];
    if (values !== undefined) setOptionCompletion(option, { values });
  }
  return setPositional(command, { kind: 'profiles', ...(rest === undefined ? {} : { rest }) });
}

function registerSet(config: Command, context: CliContext): void {
  const set = subcommand(config, 'set')
    .description(
      'Create or update a profile; only the given values change. The first profile becomes the default. --output is the output format stored in the profile; -o <format> chooses how the profile is printed. Basic auth: --auth basic --auth-user <name> --auth-password-env <VAR> keeps the password in an environment variable. OAuth: --auth oauth --oauth-issuer <url> --oauth-client-id <id>, then operate auth login --profile <profile> in a terminal.',
    )
    .argument('<profile>', 'Profile name, e.g. local or prod-eu')
    .option('--url <url>', 'REST API root, e.g. http://localhost:8080/engine-rest')
    .option('--engine <name>', 'Named process engine')
    .option('--auth <type>', 'Authentication: none, basic or oauth')
    .option('--auth-user <name>', 'Username for Basic auth')
    .option(
      '--auth-password-env <VAR>',
      'Name of the environment variable that holds the Basic auth password (recommended)',
    )
    .option(
      '--auth-password-stdin',
      'Store the password read from the first line of stdin (plain text in the file; discouraged)',
    );
  addOAuthOptions(set)
    .option('--output <format>', 'Output format to store in the profile: json or table')
    .option('--timeout <ms>', 'Request timeout in milliseconds')
    .option(
      '-H, --header <header>',
      'Header "Name: value" sent with every request; repeatable',
      collect,
    )
    .option('--read-only', 'Refuse every operation that is not a read')
    .option('--no-read-only', 'Allow operations that change the engine state')
    .option('--default', 'Make this the default profile')
    .option('-o <format>', 'Output format of the printed profile: json or table');
  addGlobalOptions(set, SET_OPTIONS, OPTIONS_GROUP);
  completeProfiles(set);
  set.action((name: string) => setProfileFrom(name, set, context));
}

function registerEditCommands(config: Command, context: CliContext): void {
  registerSet(config, context);
  const unset = configSubcommand(
    config,
    'unset',
    'Remove values from a profile; auth removes all auth settings, an OAuth setting only itself',
    FILE_OPTIONS,
  )
    .argument('<profile>', 'Profile name')
    .argument(
      '<keys...>',
      `Keys to remove: ${PROFILE_KEYS.join(', ')}; OAuth settings: ${OAUTH_UNSET_KEYS.join(', ')}`,
    );
  completeProfiles(unset, [...PROFILE_KEYS, ...OAUTH_UNSET_KEYS]);
  unset.action(async (name: string, keys: string[]) => {
    await editProfile(name, unset, context, (file) => unsetProfileKeys(file, name, keys));
  });
  const use = configSubcommand(config, 'use', 'Make a profile the default', FILE_OPTIONS);
  completeProfiles(use.argument('<profile>', 'Profile name'));
  use.action(async (name: string) => {
    await editProfile(name, use, context, (file) => useProfile(file, name));
  });
  const remove = configSubcommand(config, 'delete', 'Delete a profile', FILE_OPTIONS);
  completeProfiles(remove.argument('<profile>', 'Profile name'));
  remove.action((name: string) => removeProfile(name, remove, context));
}

export const configCommand: UtilityCommand = {
  name: 'config',
  nested: true,
  register(program, context) {
    const config = subcommand(program, 'config')
      .summary('Manage the config file and its profiles')
      .description(
        'Manage the config file and its profiles. The file is written with mode 0600; values are validated before they are stored.',
      );
    registerReadCommands(config, context);
    registerEditCommands(config, context);
  },
};
