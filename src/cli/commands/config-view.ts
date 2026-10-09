/** What the `operate config` commands print: profiles and the effective configuration. Pure. */

import type { ConfigView } from '../../config/edit.js';
import { findProfile } from '../../config/resolve.js';
import type { ConfigFile } from '../../config/types.js';
import { maskHeaders } from '../../output/secrets.js';

/** A stored profile with its name and default flag; header values masked. */
export function profileView(file: ConfigFile, name: string): Record<string, unknown> {
  const profile = findProfile(file, name) ?? {};
  const headers =
    profile.headers === undefined ? {} : { headers: maskHeaders(profile.headers, false) };
  return { name, default: file.defaultProfile === name, ...profile, ...headers };
}

/** The `config show` view with header values masked unless `showSecrets`. */
export function maskedView(view: ConfigView, showSecrets: boolean): ConfigView {
  const { headers } = view.values;
  return {
    ...view,
    values: {
      ...view.values,
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
