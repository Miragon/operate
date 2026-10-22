import { createCamunda7RestClient } from '../../api/camunda7-rest/client.js';
import type { EngineAdapter } from '../../engine-port/engine-adapter.js';

export const cibseven: EngineAdapter = createCamunda7RestClient('cibseven');
