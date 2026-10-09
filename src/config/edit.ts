/**
 * Pure edit functions behind `operate config set|unset|use|delete|list|show`. They take the parsed
 * config file (undefined when it does not exist yet), never modify it and return a new one; the CLI
 * reads and writes the file. Values are validated with the validators of resolve.ts.
 */

import { compact, mergeHeaders } from '../util.js';
import { changedAuth, settleAuthorization } from './auth-edit.js';
import { configError } from './config-error.js';
import { parseHeaders } from './headers.js';
import {
  findProfile,
  missingProfileError,
  parseTimeout,
  validateEngine,
  validateOutput,
  validateUrl,
} from './resolve.js';
import {
  type ConfigFile,
  type OutputFormat,
  PROFILE_KEYS,
  type Profile,
  type ProfileKey,
  type ResolvedConfig,
  type Source,
} from './types.js';

export interface ProfileChanges {
  readonly url?: string;
  readonly engine?: string;
  /** Auth type: none or basic. */
  readonly auth?: string;
  /** Basic auth username. */
  readonly authUser?: string;
  /** Name of the environment variable holding the password; replaces a stored password. */
  readonly authPasswordEnv?: string;
  /** Literal password (discouraged: stored in plain text); replaces a stored passwordEnv. */
  readonly authPassword?: string;
  readonly output?: string;
  readonly timeout?: string | number;
  /** Headers in the form "Name: value", merged into the existing headers of the profile. */
  readonly headers?: readonly string[];
  readonly readOnly?: boolean;
  /** Make this profile the default profile. */
  readonly makeDefault?: boolean;
}

/** One row of `operate config list`. Values the profile does not set are null. */
export interface ProfileSummary {
  readonly name: string;
  readonly default: boolean;
  readonly url: string | null;
  readonly engine: string | null;
  readonly auth: string | null;
  readonly readOnly: boolean;
}

interface ConfigValue<T> {
  readonly value: T;
  readonly source: Source;
}

/**
 * Output of `operate config show`: every effective value with its source (`auth` is the type,
 * `username` and `password` the Basic auth credentials). Header values and the password are not
 * masked here; the CLI masks them unless --show-secrets is given.
 */
export interface ConfigView {
  readonly configFile: string;
  readonly profile: string | null;
  readonly values: {
    readonly url: ConfigValue<string>;
    readonly engine: ConfigValue<string | null>;
    readonly auth: ConfigValue<string>;
    readonly username: ConfigValue<string | null>;
    readonly password: ConfigValue<string | null>;
    readonly output: ConfigValue<OutputFormat | null>;
    readonly timeout: ConfigValue<number>;
    readonly headers: ConfigValue<Readonly<Record<string, string>>>;
    readonly readOnly: ConfigValue<boolean>;
  };
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Accepted spellings for `config unset` besides the profile keys themselves. */
const KEY_ALIASES: Readonly<Record<string, ProfileKey>> = {
  'read-only': 'readOnly',
  header: 'headers',
};

const EMPTY: ConfigFile = { profiles: {} };

export function validateProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw configError(
      `Invalid profile name "${name}"`,
      'Use letters, digits, ".", "_" and "-", starting with a letter or digit, e.g. "local" or "prod-eu".',
    );
  }
  return name;
}

function ifGiven<T, R>(value: T | undefined, convert: (value: T) => R): R | undefined {
  return value === undefined ? undefined : convert(value);
}

function changedHeaders(
  existing: Profile | undefined,
  headers: readonly string[],
): Record<string, string> | undefined {
  const merged = mergeHeaders(existing?.headers ?? {}, parseHeaders(headers));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function changedValues(existing: Profile | undefined, changes: ProfileChanges): Profile {
  return compact({
    url: ifGiven(changes.url, validateUrl),
    engine: ifGiven(changes.engine, validateEngine),
    auth: changedAuth(existing?.auth, changes),
    output: ifGiven(changes.output, validateOutput),
    timeout: ifGiven(changes.timeout, parseTimeout),
    headers: ifGiven(changes.headers, (headers) => changedHeaders(existing, headers)),
    readOnly: changes.readOnly,
  });
}

/** Writes the keys in their canonical order and drops absent ones. */
function canonical(profile: Profile): Profile {
  return compact(Object.fromEntries(PROFILE_KEYS.map((key) => [key, profile[key]])));
}

function buildFile(
  profiles: Readonly<Record<string, Profile>>,
  defaultProfile: string | undefined,
): ConfigFile {
  return defaultProfile === undefined ? { profiles } : { defaultProfile, profiles };
}

function requireProfile(file: ConfigFile, name: string): Profile {
  const profile = findProfile(file, name);
  if (profile === undefined) throw missingProfileError(name, file);
  return profile;
}

/**
 * Creates or updates a profile; only the given keys change, headers are merged. The first profile
 * of a file becomes the default profile automatically. Basic auth options replace a stored
 * Authorization header; any other mix of the two is a CONFIG error (`settleAuthorization`).
 */
export function setProfile(
  file: ConfigFile | undefined,
  name: string,
  changes: ProfileChanges,
): ConfigFile {
  validateProfileName(name);
  const current = file ?? EMPTY;
  const existing = findProfile(current, name);
  const merged = { ...existing, ...changedValues(existing, changes) };
  const profile = canonical(settleAuthorization(merged, changes, name));
  const first = Object.keys(current.profiles).length === 0;
  const makeDefault = changes.makeDefault === true || first;
  return buildFile(
    { ...current.profiles, [name]: profile },
    makeDefault ? name : current.defaultProfile,
  );
}

function profileKey(key: string): ProfileKey {
  const wanted = KEY_ALIASES[key] ?? key;
  const known = PROFILE_KEYS.find((candidate) => candidate === wanted);
  if (known === undefined) {
    throw configError(`Unknown profile key "${key}"`, `Valid keys: ${PROFILE_KEYS.join(', ')}.`);
  }
  return known;
}

/** Removes keys from a profile. Unknown key names fail; keys the profile does not set are ignored. */
export function unsetProfileKeys(
  file: ConfigFile | undefined,
  name: string,
  keys: readonly string[],
): ConfigFile {
  const current = file ?? EMPTY;
  const profile = requireProfile(current, name);
  const removed = new Set<string>(keys.map(profileKey));
  const kept = Object.fromEntries(Object.entries(profile).filter(([key]) => !removed.has(key)));
  return buildFile({ ...current.profiles, [name]: kept }, current.defaultProfile);
}

/** Makes an existing profile the default profile. */
export function useProfile(file: ConfigFile | undefined, name: string): ConfigFile {
  const current = file ?? EMPTY;
  requireProfile(current, name);
  return buildFile(current.profiles, name);
}

/** Removes a profile and clears the default profile if it pointed to it. */
export function deleteProfile(file: ConfigFile | undefined, name: string): ConfigFile {
  const current = file ?? EMPTY;
  requireProfile(current, name);
  const profiles = Object.fromEntries(
    Object.entries(current.profiles).filter(([candidate]) => candidate !== name),
  );
  const defaultProfile = current.defaultProfile === name ? undefined : current.defaultProfile;
  return buildFile(profiles, defaultProfile);
}

/** Profile names are unique, so two summaries never compare equal. */
function byName(a: ProfileSummary, b: ProfileSummary): number {
  return a.name < b.name ? -1 : 1;
}

/** Profiles sorted by name. */
export function listProfiles(file: ConfigFile | undefined): ProfileSummary[] {
  const current = file ?? EMPTY;
  return Object.entries(current.profiles)
    .map(([name, profile]) => ({
      name,
      default: current.defaultProfile === name,
      url: profile.url ?? null,
      engine: profile.engine ?? null,
      auth: profile.auth?.type ?? (profile.auth?.username === undefined ? null : 'basic'),
      readOnly: profile.readOnly === true,
    }))
    .sort(byName);
}

const NOT_SET = { value: null, source: 'default' } as const;

/** The effective configuration with the source of every value. */
export function showConfig(resolved: ResolvedConfig, configFile: string): ConfigView {
  const { sources, auth } = resolved;
  const basic = auth.type === 'basic' ? auth : undefined;
  return {
    configFile,
    profile: resolved.profile ?? null,
    values: {
      url: { value: resolved.url, source: sources.url },
      engine: { value: resolved.engine ?? null, source: sources.engine },
      auth: { value: auth.type, source: sources.auth },
      username:
        basic === undefined ? NOT_SET : { value: basic.username, source: basic.sources.username },
      password:
        basic === undefined ? NOT_SET : { value: basic.password, source: basic.sources.password },
      output: { value: resolved.output ?? null, source: sources.output },
      timeout: { value: resolved.timeoutMs, source: sources.timeout },
      headers: { value: resolved.headers, source: sources.headers },
      readOnly: { value: resolved.readOnly, source: sources.readOnly },
    },
  };
}
