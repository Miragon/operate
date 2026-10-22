/** The Camunda 7 REST API: its catalog and the engine port over it, shared by the engines that speak it. */

import { loadCatalog } from '../../catalog/catalog.js';
import type { EngineAdapter, EngineName } from '../../engine-port/engine-adapter.js';
import { enginePort } from '../../workflow/engine.js';

export function createCamunda7RestClient(name: EngineName): EngineAdapter {
  const catalog = loadCatalog();
  return { name, catalog, port: (target, client) => enginePort(catalog, target, client) };
}
