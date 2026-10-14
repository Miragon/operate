/**
 * The project config file (design §22): `.operate.json`, looked up from the working directory
 * upwards, so a repository can ship its profiles. The lookup stops at the repository root (a
 * directory with `.git`), before the home directory and at the file system root; the nearest file
 * wins. Its profiles are merged with those of the user's config file: the user's profile wins on a
 * name clash (a developer overrides one locally), the project's defaultProfile wins (in the
 * repository its default applies). A project file is shared, so it holds no secrets: only where a
 * secret comes from (passwordEnv, clientSecretEnv, tokenEnv, tokenCommand). Those settings take
 * effect only while `operate config trust` covers the file (TRUST_KEYS, design §23).
 */

import type { FileSystem } from '../runtime.js';
import { isRecord, isSecretHeader } from '../util.js';
import { configError } from './config-error.js';
import { type Location, parseConfigFile, pathModule } from './file.js';
import {
  type ConfigFile,
  ENV,
  type LoadedConfig,
  type Profile,
  type ProfileAuth,
  type ProjectSource,
} from './types.js';

export const PROJECT_FILE = '.operate.json';

/** The project file of a working directory: the nearest one, or where a new one goes. */
export interface ProjectFile {
  readonly path: string;
  readonly exists: boolean;
}

/** A directory as it is compared with the home directory: no trailing separators, on win32 no case. */
function comparable(path: string, platform: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * The project file for the working directory `cwd`: the nearest existing `.operate.json` from
 * `cwd` up to the repository root, else where `config set --project` creates one (the repository
 * root, else `cwd`). Undefined in the home directory itself: it is nobody's project.
 */
export async function findProjectFile(
  fs: FileSystem,
  cwd: string,
  location: Location,
): Promise<ProjectFile | undefined> {
  const path = pathModule(location.platform);
  const home = comparable(location.homedir, location.platform);
  let directory = cwd;
  for (;;) {
    if (comparable(directory, location.platform) === home) {
      return directory === cwd ? undefined : { path: path.join(cwd, PROJECT_FILE), exists: false };
    }
    const candidate = path.join(directory, PROJECT_FILE);
    if ((await fs.kind(candidate)) !== 'missing') return { path: candidate, exists: true };
    if ((await fs.kind(path.join(directory, '.git'))) !== 'missing') {
      return { path: candidate, exists: false };
    }
    const parent = path.dirname(directory);
    if (parent === directory) return { path: path.join(cwd, PROJECT_FILE), exists: false };
    directory = parent;
  }
}

/** The key of a profile's auth object that names where each stored secret comes from instead. */
const SECRET_SOURCES = {
  password: 'passwordEnv',
  clientSecret: 'clientSecretEnv',
  token: 'tokenEnv or auth.tokenCommand',
} as const;

function secretProblem(name: string, profile: Profile): string | undefined {
  const key = (Object.keys(SECRET_SOURCES) as (keyof typeof SECRET_SOURCES)[]).find(
    (candidate) => profile.auth?.[candidate] !== undefined,
  );
  if (key !== undefined) {
    return `profile "${name}" stores a secret (auth.${key}); a project file is shared, so it names where the secret comes from instead (auth.${SECRET_SOURCES[key]})`;
  }
  const header = Object.keys(profile.headers ?? {}).find(isSecretHeader);
  return header === undefined
    ? undefined
    : `profile "${name}" stores the secret header ${header}; a project file is shared, so secret headers go into ${ENV.headers} or a profile of your own config file`;
}

/**
 * Why a project file must not store `file`: a literal password, client secret or token, or a
 * secret header. Undefined when it holds none.
 */
export function projectSecretProblem(file: ConfigFile): string | undefined {
  for (const [name, profile] of Object.entries(file.profiles)) {
    const problem = secretProblem(name, profile);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** Parses a project file and refuses secrets in it (CONFIG, the value is never quoted). */
export function parseProjectFile(text: string, path: string): ConfigFile {
  const file = parseConfigFile(text, path);
  const problem = projectSecretProblem(file);
  if (problem !== undefined) {
    throw configError(
      `Invalid project file ${path}: ${problem}`,
      'Remove the secret from the file (and from the history of your repository, if it was committed), and keep it in an environment variable or your own config file (`operate config path`).',
    );
  }
  return file;
}

/** `EACCES`, `EISDIR`, ... of a file system error, else its message. */
function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

/** Reads and checks an existing project file; `content` is what `operate config trust` hashes. */
export async function readProjectFile(
  fs: FileSystem,
  path: string,
): Promise<{ readonly file: ConfigFile; readonly content: Uint8Array }> {
  let content: Uint8Array;
  try {
    content = await fs.readFile(path);
  } catch (error) {
    throw configError(
      `Cannot read project file ${path} (${reasonOf(error)})`,
      'Check the file and its permissions; operate looks up .operate.json from the working directory up to the repository root.',
    );
  }
  return { file: parseProjectFile(new TextDecoder().decode(content), path), content };
}

/**
 * The auth keys of a project file that take effect only while `operate config trust` covers its
 * content (design §23): a token command runs code from the repository, and the variables named
 * for secrets go to the engine URL that the file names, so without the trust step a repository
 * could send any variable of the environment anywhere.
 */
const TRUST_KEYS = [
  'tokenCommand',
  'tokenEnv',
  'passwordEnv',
  'clientSecretEnv',
] as const satisfies readonly (keyof ProfileAuth)[];

export type TrustKey = (typeof TRUST_KEYS)[number];

/** The settings of each profile that need trust (TRUST_KEYS), for `operate config trust`. */
export function trustSettings(file: ConfigFile): Record<string, Partial<Record<TrustKey, string>>> {
  return Object.fromEntries(
    Object.entries(file.profiles).flatMap(([name, profile]) => {
      const settings = TRUST_KEYS.flatMap((key) => {
        const value = profile.auth?.[key];
        return value === undefined ? [] : [[key, value] as const];
      });
      return settings.length === 0 ? [] : [[name, Object.fromEntries(settings)]];
    }),
  );
}

/** True when a profile of the file has a setting that needs trust (TRUST_KEYS). */
export function needsTrust(file: ConfigFile): boolean {
  return Object.keys(trustSettings(file)).length > 0;
}

function given(name: string | undefined): string | undefined {
  return name === undefined || name.trim() === '' ? undefined : name.trim();
}

/**
 * The configuration a command sees: the user's config file with the profiles of the project file
 * merged in. A profile of the user's file replaces the project's profile of the same name as a
 * whole; the project's defaultProfile wins over the user's.
 */
export function mergeProject(
  user: ConfigFile | undefined,
  project: { readonly source: ProjectSource; readonly file: ConfigFile } | undefined,
): LoadedConfig | undefined {
  if (project === undefined) return user;
  const own = user?.profiles ?? {};
  const projectDefault = given(project.file.defaultProfile);
  const defaultProfile = projectDefault ?? user?.defaultProfile;
  return {
    ...(defaultProfile === undefined ? {} : { defaultProfile }),
    profiles: { ...project.file.profiles, ...own },
    project: {
      source: project.source,
      profiles: Object.keys(project.file.profiles).filter((name) => !Object.hasOwn(own, name)),
      defaultProfile: projectDefault !== undefined,
    },
  };
}
