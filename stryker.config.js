/**
 * StrykerJS configuration (`npm run test:mutation`): mutates the logic layers (`MUTATE`).
 *
 * CI splits the run into `SHARDS` jobs: `STRYKER_SHARD=<shard>/<shards>` mutates only the files of
 * that shard (`shardOf`) and turns off the break threshold, which `npm run test:mutation:score`
 * then applies to the combined shard reports. Each CI shard keeps its incremental file in its own
 * cache entry: Stryker carries the results of existing files outside `mutate` over from the
 * incremental file into the new one and into the report, so a shard must start from its own file
 * only (the score fails on a file in two reports). The shard of a file only changes with this
 * configuration, whose change starts every shard without a baseline (ci.yml).
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
import { createHash } from 'node:crypto';
import { globSync } from 'node:fs';
import { env } from 'node:process';
import { strykerPlugins as vitestRunnerPlugins } from '@stryker-mutator/vitest-runner';

export { strykerValidationSchema } from '@stryker-mutator/vitest-runner';

/** Number of CI shards: the matrix of the `mutation` job in .github/workflows/ci.yml. */
export const SHARDS = 8;

// ratcheted when a full run scored 97.70 %: high = floor(score), low = floor - 2, break = floor - 3
export const thresholds = { high: 97, low: 95, break: 94 };

/**
 * The logic layers and the catalog generator. Left out: the CLI wiring and registration
 * (`src/cli`), help and guide texts (`src/docs`), the Node.js glue (`src/bin`) and the packaging
 * scripts (`scripts/exe`), which the command line and integration tests cover, and the data tables
 * of the generator (group descriptions, name overrides; the summary texts in summaries.ts are
 * disabled inline), whose mutants only the golden catalog test detects, as `generate:check` does.
 * The coverage gate still measures all of them.
 */
const MUTATE = [
  'src/auth/**/*.ts',
  'src/catalog/**/*.ts',
  'src/config/**/*.ts',
  'src/http/**/*.ts',
  'src/operation/**/*.ts',
  'src/output/**/*.ts',
  'src/workflow/**/*.ts',
  'src/errors.ts',
  'src/util.ts',
  'scripts/catalog/**/*.ts',
  '!**/*.test.ts',
  '!**/types.ts',
  '!scripts/catalog/groups.ts',
  '!scripts/catalog/openapi.ts',
  '!scripts/catalog/overrides.ts',
];

/**
 * @param {string} file project relative path with forward slashes
 * @returns {number} its shard, 1 to `SHARDS`. It depends on the path alone, so adding or removing a
 *   file never moves another file (and its incremental results) to a different shard.
 */
function shardOf(file) {
  return (createHash('sha256').update(file).digest().readUInt32BE(0) % SHARDS) + 1;
}

/** @returns {string[]} the files `MUTATE` selects: project relative, forward slashes, sorted */
function mutatedFiles() {
  const include = MUTATE.filter((pattern) => !pattern.startsWith('!'));
  const exclude = MUTATE.filter((pattern) => pattern.startsWith('!')).map((pattern) =>
    pattern.slice(1),
  );
  return globSync(include, { exclude })
    .map((file) => file.replaceAll('\\', '/'))
    .sort();
}

/**
 * @param {string} spec `<shard>/<shards>`; `<shards>` must equal `SHARDS`, so the CI matrix and
 *   this file cannot drift apart unnoticed
 * @returns options that mutate the files of that shard, without a break threshold
 */
function shardOptions(spec) {
  const [shard, shards] = spec.split('/').map(Number);
  if (shards !== SHARDS || !Number.isInteger(shard) || shard < 1 || shard > SHARDS) {
    throw new Error(
      `STRYKER_SHARD must be <shard>/${SHARDS} (shard 1 to ${SHARDS}), got "${spec}".`,
    );
  }
  return {
    mutate: mutatedFiles().filter((file) => shardOf(file) === shard),
    thresholds: { ...thresholds, break: null },
  };
}

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
  mutate: MUTATE,
  ignorePatterns: ['dist', 'build', 'coverage', '.context', '.claude', '.github'],
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { reportTests: false, reportMutants: true, reportScoreTable: true },
  thresholds,
  concurrency: '50%',
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
  ...(env.STRYKER_SHARD ? shardOptions(env.STRYKER_SHARD) : {}),
};
