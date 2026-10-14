/**
 * The project file part of `operate config` (design §22, §23): the file an edit writes (the user's
 * config file, or with `--project` the project file `.operate.json`), the checks and notices of
 * edits next to a project file, and `config trust|untrust`, which allow or forbid the token
 * commands and secret variables of the project file's current content.
 */

import type { Command } from 'commander';
import { configError } from '../../config/config-error.js';
import { readConfigFile, serializeConfigFile, writeConfigFile } from '../../config/file.js';
import {
  findProjectFile,
  needsTrust,
  PROJECT_FILE,
  projectSecretProblem,
  readProjectFile,
  type TrustKey,
  trustSettings,
} from '../../config/project.js';
import { findProfile } from '../../config/resolve.js';
import {
  contentHash,
  isTrusted,
  readTrustStore,
  trustStorePath,
  withTrust,
  writeTrustStore,
} from '../../config/trust.js';
import { type ConfigFile, ENV } from '../../config/types.js';
import { usageError } from '../../errors.js';
import { renderValue } from '../../output/render.js';
import type { Runtime } from '../../runtime.js';
import { configPath, isExplicit, projectFileOf } from '../config-files.js';
import type { CliContext } from '../context.js';
import { displayOf } from '../display.js';
import { readGlobals } from '../globals.js';

export const PROJECT_OPTION = [
  '--project',
  `Write the project file (${PROJECT_FILE} of the repository, shared with the team) instead of your config file`,
] as const;

/** The file an edit writes, and the project file of the working directory for notices. */
export interface EditTarget {
  readonly path: string;
  readonly project: boolean;
  /** The project file in effect, read best effort, when the edit writes the user's file. */
  readonly other?: { readonly path: string; readonly file: ConfigFile };
}

function noProjectDirectory(runtime: Runtime) {
  return configError(
    `No project directory: ${runtime.cwd} is your home directory`,
    `operate looks up ${PROJECT_FILE} from the working directory up to the repository root; run the command inside the repository (\`config set --project\` creates the file at its root).`,
  );
}

/** The project file in effect, read best effort (an invalid one is reported by other commands). */
async function projectInEffect(runtime: Runtime, flag: string | undefined) {
  try {
    const found = await projectFileOf(runtime, flag);
    if (found?.exists !== true) return undefined;
    return { path: found.path, file: (await readProjectFile(runtime.fs, found.path)).file };
  } catch {
    return undefined;
  }
}

/** The file of an edit: the project file with `--project`, else the user's config file. */
export async function editTarget(
  runtime: Runtime,
  flags: { readonly config?: string | undefined; readonly project?: boolean | undefined },
): Promise<EditTarget> {
  if (flags.project !== true) {
    const other = await projectInEffect(runtime, flags.config);
    const path = configPath(runtime, flags.config);
    return other === undefined ? { path, project: false } : { path, project: false, other };
  }
  if (flags.config !== undefined) {
    throw usageError(
      '--project and --config exclude each other',
      `--project writes the project file (${PROJECT_FILE}); --config names your own config file.`,
    );
  }
  const found = await findProjectFile(runtime.fs, runtime.cwd, runtime);
  if (found === undefined) throw noProjectDirectory(runtime);
  return { path: found.path, project: true };
}

/** The current content of the target, and for a project file whether it is trusted. */
export async function readTarget(runtime: Runtime, target: EditTarget) {
  if (!target.project) {
    return { file: await readConfigFile(runtime.fs, target.path), trusted: false };
  }
  if (!(await runtime.fs.exists(target.path))) return { file: undefined, trusted: true };
  const { file, content } = await readProjectFile(runtime.fs, target.path);
  const store = await readTrustStore(runtime.fs, trustStorePath(runtime.env, runtime));
  // a file without settings that need trust is no risk, so whatever an edit adds is the user's own
  const trusted = !needsTrust(file) || isTrusted(store, target.path, await contentHash(content));
  return { file, trusted };
}

/**
 * Writes the edited file. A project file must stay free of secrets (CONFIG, nothing written) and
 * is readable by others (0644, it is shared). An edit keeps the trust of a project file: when it
 * was trusted before (or had no settings that need trust), its new content is trusted, since the
 * token commands and variables in it are the user's own.
 */
export async function writeTarget(
  runtime: Runtime,
  target: EditTarget,
  file: ConfigFile,
  trusted: boolean,
): Promise<void> {
  if (!target.project) {
    await writeConfigFile(runtime.fs, target.path, file);
    return;
  }
  const problem = projectSecretProblem(file);
  if (problem !== undefined) {
    throw configError(
      `The project file ${target.path} must not store secrets: ${problem}`,
      'Store the name of the variable that holds the secret (--auth-password-env, --oauth-client-secret-env, --auth-token-env) or a token command (--auth-token-command), or keep the profile in your own config file (without --project).',
    );
  }
  await writeConfigFile(runtime.fs, target.path, file, 0o644);
  if (!trusted) return;
  const path = trustStorePath(runtime.env, runtime);
  const hash = needsTrust(file)
    ? await contentHash(new TextEncoder().encode(serializeConfigFile(file)))
    : undefined;
  await writeTrustStore(
    runtime.fs,
    path,
    withTrust(await readTrustStore(runtime.fs, path), target.path, hash),
  );
}

/**
 * `config unset|use|delete` of a profile that only the project file has, without `--project`:
 * CONFIG, pointing to `--project` (the user's file does not have it).
 */
export function checkUserProfile(target: EditTarget, file: ConfigFile | undefined, name: string) {
  const other = target.other;
  if (target.project || other === undefined || findProfile(file, name) !== undefined) return;
  if (findProfile(other.file, name) === undefined) return;
  throw configError(
    `Profile "${name}" is a profile of the project file ${other.path}, not of your config file`,
    `Add --project to change the project file; \`operate config set ${name} <options>\` without it creates a profile of your own that overrides the project's.`,
  );
}

type Other = NonNullable<EditTarget['other']>;

/** The user's file got a profile that the project file has, too: it now overrides it. */
function overrideNotice(other: Other, name: string, before?: ConfigFile, after?: ConfigFile) {
  const added = findProfile(before, name) === undefined && findProfile(after, name) !== undefined;
  if (!added || findProfile(other.file, name) === undefined) return undefined;
  return `Notice: profile "${name}" of your config file now overrides the profile of the same name in the project file ${other.path} as a whole: none of the project's settings of "${name}" apply. Add --project to change the project's profile instead.`;
}

/** The user's file got another default, but the project file's default wins in the repository. */
function defaultNotice(other: Other, before: ConfigFile | undefined, after: ConfigFile) {
  const projectDefault = other.file.defaultProfile?.trim() ?? '';
  if (after.defaultProfile === before?.defaultProfile || projectDefault === '') return undefined;
  return `Notice: in this repository the defaultProfile of the project file ${other.path} ("${projectDefault}") wins; use --profile, ${ENV.profile} or \`operate config use <profile> --project\`.`;
}

/** Notices after an edit of the user's file next to a project file. */
export function overrideNotices(
  target: EditTarget,
  name: string,
  before: ConfigFile | undefined,
  after: ConfigFile,
): string[] {
  const other = target.other;
  if (target.project || other === undefined) return [];
  return [overrideNotice(other, name, before, after), defaultNotice(other, before, after)].filter(
    (notice) => notice !== undefined,
  );
}

/** True when another file still has the profile (then its cached login stays). */
export async function stillDefined(name: string, target: EditTarget, runtime: Runtime) {
  if (!target.project) return findProfile(target.other?.file, name) !== undefined;
  const own = await readConfigFile(runtime.fs, configPath(runtime, undefined));
  return findProfile(own, name) !== undefined;
}

/** `config trust` and `config untrust`: name, description, and whether they trust. */
export const TRUST_COMMANDS = [
  [
    'trust',
    'Allow the token commands (auth.tokenCommand) and the variables named for secrets (auth.tokenEnv, auth.passwordEnv, auth.clientSecretEnv) of the project file in its current content; review the file first. A change of the file outside `operate config ... --project` needs a new trust. For a person, not for agents.',
    true,
  ],
  ['untrust', 'Forbid the token commands and secret variables of the project file again', false],
] as const;

/**
 * What `config trust` allows: the token commands by profile, and the variables named for secrets
 * by profile and key.
 */
function trustView(settings: ReturnType<typeof trustSettings>) {
  const tokenCommands: Record<string, string> = {};
  const variables: Record<string, Partial<Record<TrustKey, string>>> = {};
  for (const [name, { tokenCommand, ...named }] of Object.entries(settings)) {
    if (tokenCommand !== undefined) tokenCommands[name] = tokenCommand;
    if (Object.keys(named).length > 0) variables[name] = named;
  }
  return { tokenCommands, variables };
}

/** `config trust` (`trust`) and `config untrust`: records or removes the project file's trust. */
export async function changeTrust(command: Command, context: CliContext, trust: boolean) {
  const { runtime } = context;
  const display = await displayOf(context, readGlobals(command));
  const found = await findProjectFile(runtime.fs, runtime.cwd, runtime);
  if (found?.exists !== true) {
    throw configError(
      `No project file in ${runtime.cwd} or above`,
      `operate looks up ${PROJECT_FILE} from the working directory up to the repository root; \`operate config set <profile> --project --url <url>\` creates one.`,
    );
  }
  const { file, content } = await readProjectFile(runtime.fs, found.path);
  const storePath = trustStorePath(runtime.env, runtime);
  const store = await readTrustStore(runtime.fs, storePath);
  const hash = trust ? await contentHash(content) : undefined;
  await writeTrustStore(runtime.fs, storePath, withTrust(store, found.path, hash));
  const settings = trustSettings(file);
  const view = { projectFile: found.path, trusted: trust, ...trustView(settings) };
  const rows = [
    { KEY: 'projectFile', VALUE: found.path },
    { KEY: 'trusted', VALUE: trust },
    ...Object.entries(settings).flatMap(([name, values]) =>
      Object.entries(values).map(([key, value]) => ({ KEY: `${key} ${name}`, VALUE: value })),
    ),
  ];
  runtime.stdout.write(renderValue(display.format === 'json' ? view : rows, display));
  const notice = trustNotice(found.path, trust, needsTrust(file), isExplicit(runtime, undefined));
  runtime.stderr.write(`${notice}\n`);
}

function trustNotice(path: string, trust: boolean, needed: boolean, explicit: boolean): string {
  const unused = explicit
    ? ` Note: OPERATE_CONFIG names a config file, so commands do not use the project file now.`
    : '';
  if (!trust) {
    return `No longer trusting ${path}: its token commands do not run and the variables it names for secrets are not read.${unused}`;
  }
  const what = needed
    ? 'operate runs its token commands and reads the variables it names for secrets until the file changes; a change made outside `operate config ... --project` needs a new `operate config trust`.'
    : 'It has no token commands and names no variables for secrets, so it needs no trust.';
  return `Trusted the current content of ${path}. ${what}${unused}`;
}
