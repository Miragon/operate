/** What the `operate config` commands print: profiles and the effective configuration. Pure. */

import type { ConfigView } from '../../config/edit.js';
import { findProfile } from '../../config/resolve.js';
import type { ConfigFile, ProfileAuth, Source } from '../../config/types.js';
import { MASK, maskHeaders } from '../../output/secrets.js';

/** The stored auth object with the password and the client secret masked. */
function maskedAuth(auth: ProfileAuth): ProfileAuth {
  return {
    ...auth,
    ...(auth.password === undefined ? {} : { password: MASK }),
    ...(auth.clientSecret === undefined ? {} : { clientSecret: MASK }),
  };
}

/**
 * A stored profile with its name and default flag; header values, the password and the client
 * secret masked.
 */
export function profileView(file: ConfigFile, name: string): Record<string, unknown> {
  const profile = findProfile(file, name) ?? {};
  const headers =
    profile.headers === undefined ? {} : { headers: maskHeaders(profile.headers, false) };
  const auth = profile.auth === undefined ? {} : { auth: maskedAuth(profile.auth) };
  return { name, default: file.defaultProfile === name, ...profile, ...headers, ...auth };
}

function masked<T>(entry: { value: T | null; source: Source }, show: boolean) {
  return { ...entry, value: show || entry.value === null ? entry.value : MASK };
}

/**
 * The `config show` view with header values, the password and the client secret masked unless
 * `showSecrets`.
 */
export function maskedView(view: ConfigView, showSecrets: boolean): ConfigView {
  const { headers, password, clientSecret } = view.values;
  return {
    ...view,
    values: {
      ...view.values,
      password: masked(password, showSecrets),
      ...(clientSecret === undefined ? {} : { clientSecret: masked(clientSecret, showSecrets) }),
      headers: { ...headers, value: maskHeaders(headers.value, showSecrets) },
    },
  };
}

/** Rows of the `config show` table: KEY VALUE SOURCE; lists (scopes) space-joined. */
export function showRows(view: ConfigView): Record<string, unknown>[] {
  return Object.entries(view.values).map(([key, entry]) => ({
    KEY: key,
    VALUE: Array.isArray(entry.value) ? entry.value.join(' ') : entry.value,
    SOURCE: entry.source,
  }));
}

/** Lines in front of the `config show` table. */
export function showHeader(view: ConfigView): string {
  return `Config file: ${view.configFile}\nProfile: ${view.profile ?? '(none)'}\n\n`;
}
