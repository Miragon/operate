/** Creates the authentication provider for the resolved auth configuration. */

import { validateAuth } from '../config/resolve.js';
import type { AuthConfig, AuthType } from '../config/types.js';
import { noAuth } from './none.js';
import type { AuthProvider } from './types.js';

/** One factory per supported auth type; the compiler keeps it in sync with `AUTH_TYPES`. */
const PROVIDERS: Readonly<Record<AuthType, () => AuthProvider>> = { none: noAuth };

/**
 * Throws the CONFIG error of config resolution (with the links to the planned Basic and OAuth
 * issues) for types without a provider, e.g. a config object built without `resolveConfig`.
 */
export function createAuthProvider(config: AuthConfig): AuthProvider {
  const { type } = validateAuth(config.type);
  return PROVIDERS[type]();
}
