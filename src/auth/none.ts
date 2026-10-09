/** No authentication: requests carry no credentials (engines without the REST auth filter). */

import type { AuthProvider } from './types.js';

export function noAuth(): AuthProvider {
  return { type: 'none', headers: () => Promise.resolve({}) };
}
