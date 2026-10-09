/** Creates the authentication provider for the resolved auth configuration. */

import { validateAuthType } from '../config/auth.js';
import type { AuthConfig } from '../config/types.js';
import { basicAuth } from './basic.js';
import { noAuth } from './none.js';
import type { AuthProvider } from './types.js';

/**
 * Throws the CONFIG error of config resolution for types without a provider, e.g. a config object
 * built without `resolveConfig`.
 */
export function createAuthProvider(config: AuthConfig): AuthProvider {
  validateAuthType(config.type);
  return config.type === 'basic' ? basicAuth(config) : noAuth(config.off);
}
