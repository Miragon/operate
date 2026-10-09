/**
 * Engine containers for the integration tests: one definition per supported Camunda 7 compatible
 * distribution, started with Testcontainers and reachable through a mapped port.
 */

import { GenericContainer, Wait } from 'testcontainers';

const ENGINE_NAMES = ['operaton', 'cibseven', 'camunda'] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export interface EngineDefinition {
  readonly name: EngineName;
  readonly image: string;
  /** Container port of the HTTP server. */
  readonly port: number;
  /** Path of the REST API root on that port. */
  readonly restPath: string;
  /** Version reported by `GET /version`. */
  readonly version: string;
}

export interface RunningEngine {
  readonly name: EngineName;
  /** REST API root, e.g. `http://localhost:32768/engine-rest`. */
  readonly url: string;
  stop(): Promise<void>;
}

/** Selects the engines to test; comma separated subset of {@link ENGINE_NAMES}. */
const ENGINES_ENV = 'OPERATE_IT_ENGINES';

const STARTUP_TIMEOUT_MS = 180_000;

export const ENGINES: Readonly<Record<EngineName, EngineDefinition>> = {
  operaton: {
    name: 'operaton',
    image: 'operaton/operaton:2.1.5',
    port: 8080,
    restPath: '/engine-rest',
    version: '2.1.5',
  },
  cibseven: {
    name: 'cibseven',
    image: 'cibseven/cibseven:run-2.2.0',
    port: 8080,
    restPath: '/engine-rest',
    version: '2.2.0',
  },
  camunda: {
    name: 'camunda',
    image: 'camunda/camunda-bpm-platform:run-7.24.0',
    port: 8080,
    restPath: '/engine-rest',
    version: '7.24.0',
  },
};

function isEngineName(value: string): value is EngineName {
  return ENGINE_NAMES.some((name) => name === value);
}

/** Engines selected by `OPERATE_IT_ENGINES` (all when unset or empty). Unknown names fail loudly. */
function enabledEngines(env: NodeJS.ProcessEnv = process.env): EngineName[] {
  const raw = env[ENGINES_ENV]?.trim() ?? '';
  if (raw === '') return [...ENGINE_NAMES];
  const names = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  const unknown = names.filter((entry) => !isEngineName(entry));
  if (unknown.length > 0) {
    throw new Error(
      `${ENGINES_ENV} contains unknown engine(s) ${unknown.join(', ')}; ` +
        `expected a comma separated subset of ${ENGINE_NAMES.join(', ')}`,
    );
  }
  return names.filter(isEngineName);
}

export function isEngineEnabled(name: EngineName, env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledEngines(env).includes(name);
}

/** Starts the engine container and waits until `GET <rest-root>/version` answers 200. */
export async function startEngine(name: EngineName): Promise<RunningEngine> {
  const definition = ENGINES[name];
  const container = await new GenericContainer(definition.image)
    .withExposedPorts(definition.port)
    .withWaitStrategy(
      Wait.forHttp(`${definition.restPath}/version`, definition.port).forStatusCode(200),
    )
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
  const url = `http://${container.getHost()}:${container.getMappedPort(definition.port)}${definition.restPath}`;
  return {
    name,
    url,
    stop: async () => {
      await container.stop();
    },
  };
}
