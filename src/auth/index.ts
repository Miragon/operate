/** Creates the authentication provider for the resolved auth configuration. */

import { validateAuthType } from '../config/auth.js';
import type { AuthConfig } from '../config/types.js';
import { basicAuth } from './basic.js';
import { noAuth } from './none.js';
import { oauthAuth } from './oauth/provider.js';
import type { OAuthDeps } from './oauth/types.js';
import type { AuthProvider } from './types.js';

/**
 * The provider of the configured type; `deps` serve OAuth (token cache, refresh). Throws the
 * CONFIG error of config resolution for types without a provider, e.g. a config object built
 * without `resolveConfig`. No provider can start an interactive login.
 */
export function createAuthProvider(config: AuthConfig, deps: OAuthDeps): AuthProvider {
  validateAuthType(config.type);
  switch (config.type) {
    case 'basic':
      return basicAuth(config);
    case 'oauth':
      return oauthAuth(config, deps);
    case 'none':
      return noAuth(config.off);
  }
}
