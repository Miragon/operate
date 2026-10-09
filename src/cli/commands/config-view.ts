/** What the `operate config` commands print: profiles and the effective configuration. Pure. */

import type { ConfigView } from '../../config/edit.js';
import { findProfile } from '../../config/resolve.js';
import type { ConfigFile } from '../../config/types.js';
import { MASK, maskHeaders } from '../../output/secrets.js';

/** A stored profile with its name and default flag; header values and the password masked. */
export function profileView(file: ConfigFile, name: string): Record<string, unknown> {
  const profile = findProfile(file, name) ?? {};
  const headers =
    profile.headers === undefined ? {} : { headers: maskHeaders(profile.headers, false) };
  const auth =
    profile.auth?.password === undefined ? {} : { auth: { ...profile.auth, password: MASK } };
  return { name, default: file.defaultProfile === name, ...profile, ...headers, ...auth };
}

/** The `config show` view with header values and the password masked unless `showSecrets`. */
export function maskedView(view: ConfigView, showSecrets: boolean): ConfigView {
  const { headers, password } = view.values;
  const hidden = showSecrets || password.value === null ? password.value : MASK;
  return {
    ...view,
    values: {
      ...view.values,
      password: { ...password, value: hidden },
      headers: { ...headers, value: maskHeaders(headers.value, showSecrets) },
    },
  };
}

/** Rows of the `config show` table: KEY VALUE SOURCE. */
export function showRows(view: ConfigView): Record<string, unknown>[] {
  return Object.entries(view.values).map(([key, entry]) => ({
    KEY: key,
    VALUE: entry.value,
    SOURCE: entry.source,
  }));
}

/** Lines in front of the `config show` table. */
export function showHeader(view: ConfigView): string {
  return `Config file: ${view.configFile}\nProfile: ${view.profile ?? '(none)'}\n\n`;
}
