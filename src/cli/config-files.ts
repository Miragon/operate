/**
 * The configuration a command reads (design §22): the config file named by `--config` or
 * OPERATE_CONFIG alone (it must exist), else the project file (`.operate.json`, looked up from the
 * working directory up to the repository root) merged with the user's config file. Whether
 * `operate config trust` covers the project file is only looked up when it has settings that need
 * trust (token commands, secret variables).
 */

import { configFilePath, explicitConfigPath, pathModule, readConfigFile } from '../config/file.js';
import {
  findProjectFile,
  mergeProject,
  needsTrust,
  type ProjectFile,
  readProjectFile,
} from '../config/project.js';
import { contentHash, isTrusted, readTrustStore, trustStorePath } from '../config/trust.js';
import type { ConfigFile, LoadedConfig, ProjectSource } from '../config/types.js';
import type { Runtime } from '../runtime.js';

/** Path of the config file for `--config`, OPERATE_CONFIG or the platform default. */
export function configPath(runtime: Runtime, explicit: string | undefined): string {
  return configFilePath(runtime.env, runtime, explicit);
}

/** True when the config file was named by `--config` or OPERATE_CONFIG: then it must exist. */
export function isExplicit(runtime: Runtime, flag: string | undefined): boolean {
  return explicitConfigPath(runtime.env, flag) !== undefined;
}

export interface LoadedFiles {
  /** The user's config file, or the one named by `--config` / OPERATE_CONFIG. */
  readonly path: string;
  /** The project file in effect (never next to an explicit config file). */
  readonly project?: ProjectSource;
  /** What the command sees: the profiles of both files. */
  readonly config: LoadedConfig | undefined;
}

/** The project file of the working directory; none with an explicit config file. */
export async function projectFileOf(
  runtime: Runtime,
  flag: string | undefined,
): Promise<ProjectFile | undefined> {
  if (isExplicit(runtime, flag)) return undefined;
  return findProjectFile(runtime.fs, runtime.cwd, runtime);
}

/** True when `operate config trust` covers the current content of the project file. */
async function projectTrusted(runtime: Runtime, path: string, content: Uint8Array) {
  const store = await readTrustStore(runtime.fs, trustStorePath(runtime.env, runtime));
  return isTrusted(store, path, await contentHash(content));
}

async function projectOf(runtime: Runtime, path: string) {
  const { file, content } = await readProjectFile(runtime.fs, path);
  const trusted = needsTrust(file) && (await projectTrusted(runtime, path, content));
  const directory = pathModule(runtime.platform).dirname(path);
  const source: ProjectSource = { path, directory, trusted };
  return { source, file };
}

/** Reads the config file(s) of a command. */
export async function loadConfig(runtime: Runtime, flag: string | undefined): Promise<LoadedFiles> {
  const path = configPath(runtime, flag);
  const user: ConfigFile | undefined = await readConfigFile(
    runtime.fs,
    path,
    isExplicit(runtime, flag),
  );
  const found = await projectFileOf(runtime, flag);
  if (found?.exists !== true) return { path, config: user };
  const project = await projectOf(runtime, found.path);
  return { path, project: project.source, config: mergeProject(user, project) };
}
