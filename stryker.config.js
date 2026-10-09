/**
 * StrykerJS configuration (`npm run test:mutation`): mutates the same files as the coverage gate.
 *
 * This module is also the only Stryker plugin module (`plugins`): it provides the `vitest` test
 * runner as a wrapper around the stock runner of @stryker-mutator/vitest-runner 10.0.0, plus that
 * package's options schema. The stock runner builds its per-test filter from describe/test names
 * joined with " ", but vitest 5 matches `testNamePattern` against names joined with " > ". Every
 * filtered mutant run then skips all tests, so each covered mutant is reported as "Survived" with
 * 0 tests run. The wrapper lets each separator in the generated pattern match both forms right
 * before vitest starts. Once the stock runner supports vitest 5, delete `strykerPlugins`, the
 * schema re-export and the `plugins` option.
 */
import { strykerPlugins as vitestRunnerPlugins } from '@stryker-mutator/vitest-runner';

export { strykerValidationSchema } from '@stryker-mutator/vitest-runner';

/** A name separator that matches both the runner's (" ") and vitest 5's (" > ") form. */
const SEPARATOR = '(?: > | )';

const stockRunner = vitestRunnerPlugins.find(
  (plugin) => plugin.kind === 'TestRunner' && plugin.name === 'vitest',
);
if (!stockRunner) {
  throw new Error('@stryker-mutator/vitest-runner no longer provides the "vitest" test runner.');
}

/** Patterns already relaxed, so a pattern reused for a second start is not rewritten twice. */
const relaxed = new WeakSet();

/**
 * @param {RegExp} pattern test name pattern built by the stock runner
 * @returns {RegExp} the same pattern accepting " > " wherever it expects a name separator
 */
function relaxSeparators(pattern) {
  const result = new RegExp(pattern.source.replaceAll(' ', SEPARATOR), pattern.flags);
  relaxed.add(result);
  return result;
}

/** Rewrites the name pattern of every vitest project before each test run. */
function patchStart(ctx) {
  const start = ctx.start.bind(ctx);
  ctx.start = (filters) => {
    for (const project of ctx.projects) {
      const pattern = project.config.testNamePattern;
      if (pattern instanceof RegExp && !relaxed.has(pattern)) {
        project.config.testNamePattern = relaxSeparators(pattern);
      }
    }
    return start(filters);
  };
}

/** Factory of the wrapped runner: the stock runner with a vitest 5 compatible name filter. */
function vitestRunner(injector) {
  const runner = stockRunner.factory(injector);
  const init = runner.init.bind(runner);
  runner.init = async () => {
    await init();
    patchStart(runner.ctx);
  };
  return runner;
}
vitestRunner.inject = stockRunner.factory.inject;

export const strykerPlugins = [{ kind: 'TestRunner', name: 'vitest', factory: vitestRunner }];

export default {
  packageManager: 'npm',
  // replaces the default `@stryker-mutator/*` glob; add further plugin packages (checkers) here
  plugins: ['./stryker.config.js'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts', related: true },
  coverageAnalysis: 'perTest',
  mutate: [
    'src/**/*.ts',
    'scripts/catalog/**/*.ts',
    '!**/*.test.ts',
    '!**/*.d.ts',
    '!src/bin/**',
    '!src/**/types.ts',
    '!scripts/catalog/openapi.ts',
  ],
  ignorePatterns: ['dist', 'coverage', '.context', '.claude', '.github'],
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { reportTests: false, reportMutants: true, reportScoreTable: true },
  // ratcheted to the last full run (97.70 %): high = floor(score), low = floor - 2, break = floor - 3
  thresholds: { high: 97, low: 95, break: 94 },
  concurrency: '50%',
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
