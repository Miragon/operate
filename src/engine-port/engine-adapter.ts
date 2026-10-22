/** An engine as operate sees it: its name, its command catalog and its port. Types only. */

import type { Catalog } from '../catalog/types.js';
import type { ClientOptions } from '../http/client.js';
import type { Target } from '../operation/request.js';
import type { EnginePort } from './engine-port.js';

export type EngineName = 'operaton' | 'cibseven' | 'camunda7';

export interface EngineAdapter {
  readonly name: EngineName;
  readonly catalog: Catalog;
  port(target: Target, client: ClientOptions): EnginePort;
}
