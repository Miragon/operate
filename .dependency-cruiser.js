/**
 * dependency-cruiser rules: the architecture gate of design §6 and the docs layer rules of §9.1.
 * Run with `npm run arch`. Test code (`*.test.ts` and everything under `test/`) is exempt from the
 * rules about shipped code (builtins, layering, scripts/test imports, devDependencies); cycles,
 * unresolvable imports, the CLI and commander boundaries and the generated-catalog rule apply to it too.
 */

/** Test code: colocated unit tests, integration tests and test support files. */
const TEST_CODE = ['[.]test[.]ts$', '^test/'];

/** Layers that must stay pure (no Node built-ins; WebCrypto and timers are globals). */
const PURE_LAYERS = '^src/(?:auth|catalog|docs|output|workflow)/|^src/(?:errors|util)[.]ts$';

/** The interactive OAuth login: loopback server, browser, callback pages. */
const INTERACTIVE_LOGIN = '^src/auth/oauth/(?:login|callback|pages)[.]ts$';

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies are not allowed. Extract the shared part into its own module.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Orphan module: nothing imports it and it imports nothing. Use it or delete it.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          '[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)[^/]+[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          '^scripts/generate-catalog[.]ts$',
          ...TEST_CODE,
        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'This import cannot be resolved to a file or an installed package.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'This package is not declared in package.json.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node built-in module.',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: ['^(?:node:)?(?:punycode|domain|constants|sys|_linklist|_stream_wrap)$'],
      },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Nothing may import a test file. Move shared helpers to test/support/.',
      from: {},
      to: { path: '[.]test[.]ts$' },
    },
    {
      name: 'src-not-to-scripts-or-test',
      severity: 'error',
      comment:
        'Production code in src/ must not import the generator (scripts/) or test code (test/).',
      from: { path: '^src/', pathNot: TEST_CODE },
      to: { path: '^(?:scripts|test)/' },
    },
    {
      name: 'test-support-only-from-tests',
      severity: 'error',
      comment: 'test/support/ holds fakes for tests; only test code may import it.',
      from: { pathNot: TEST_CODE },
      to: { path: '^test/support/' },
    },
    {
      name: 'cli-only-from-bin',
      severity: 'error',
      comment: 'Only src/bin may import the CLI layer (src/cli).',
      from: { pathNot: '^src/(?:bin|cli)/' },
      to: { path: '^src/cli/' },
    },
    {
      name: 'commander-only-in-cli',
      severity: 'error',
      comment: 'Only the CLI layer (src/cli) may import commander.',
      from: { pathNot: '^src/cli/' },
      to: { path: '(?:^|/)node_modules/commander/' },
    },
    {
      name: 'pure-layers-no-builtins',
      severity: 'error',
      comment:
        'auth, catalog, docs, output, workflow, errors and util are pure: no Node built-in modules.',
      from: { path: PURE_LAYERS, pathNot: TEST_CODE },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'operation-only-path-builtin',
      severity: 'error',
      comment: 'src/operation may import node:path and no other Node built-in module.',
      from: { path: '^src/operation/', pathNot: TEST_CODE },
      to: { dependencyTypes: ['core'], pathNot: '^(?:node:)?path(?:/(?:posix|win32))?$' },
    },
    {
      name: 'docs-only-catalog-errors-util',
      severity: 'error',
      comment: 'src/docs may import from src/ only src/catalog/**, src/errors.ts and src/util.ts.',
      from: { path: '^src/docs/', pathNot: TEST_CODE },
      to: { path: '^src/', pathNot: '^src/(?:catalog|docs)/|^src/(?:errors|util)[.]ts$' },
    },
    {
      name: 'auth-allowed-imports',
      severity: 'error',
      comment:
        'src/auth may import from src/ only src/auth/**, src/config/**, src/http/{client,status,types}.ts, src/errors.ts, src/util.ts and src/runtime.ts.',
      from: { path: '^src/auth/', pathNot: TEST_CODE },
      to: {
        path: '^src/',
        pathNot:
          '^src/(?:auth|config)/|^src/http/(?:client|status|types)[.]ts$|^src/(?:errors|util|runtime)[.]ts$',
      },
    },
    {
      name: 'config-not-to-auth',
      severity: 'error',
      comment: 'src/config never imports src/auth: authentication builds on the configuration.',
      from: { path: '^src/config/', pathNot: TEST_CODE },
      to: { path: '^src/auth/' },
    },
    {
      name: 'interactive-login-only-from-auth-command',
      severity: 'error',
      comment:
        'Only `operate auth login` may start a loopback server or a browser; operation commands, api and ping never start an interactive login (AI first).',
      from: {
        pathNot: [INTERACTIVE_LOGIN, '^src/cli/commands/auth[.]ts$', ...TEST_CODE],
      },
      to: { path: INTERACTIVE_LOGIN },
    },
    {
      name: 'workflow-not-to-cli-config-auth-bin',
      severity: 'error',
      comment:
        'The workflow commands (src/workflow) build on catalog, operation, http, output, errors and util; never on cli, config, auth or bin.',
      from: { path: '^src/workflow/', pathNot: TEST_CODE },
      to: { path: '^src/(?:cli|config|auth|bin)/' },
    },
    {
      name: 'workflow-only-from-cli',
      severity: 'error',
      comment: 'Only the CLI layer (src/cli) uses the workflow commands; output and docs never do.',
      from: { path: '^src/', pathNot: ['^src/(?:cli|workflow)/', ...TEST_CODE] },
      to: { path: '^src/workflow/' },
    },
    {
      name: 'http-not-to-config-cli-operation',
      severity: 'error',
      comment: 'The HTTP layer must not depend on config, cli or operation.',
      from: { path: '^src/http/', pathNot: TEST_CODE },
      to: { path: '^src/(?:config|cli|operation)/' },
    },
    {
      name: 'generated-catalog-only-via-catalog-ts',
      severity: 'error',
      comment: 'The generated catalog JSON is accessed only through src/catalog/catalog.ts.',
      from: { pathNot: '^src/catalog/catalog[.]ts$' },
      to: { path: '^src/generated/' },
    },
    {
      name: 'output-only-operation-result',
      severity: 'error',
      comment: 'src/output may import from src/operation only result.ts.',
      from: { path: '^src/output/', pathNot: TEST_CODE },
      to: { path: '^src/operation/', pathNot: '^src/operation/result[.]ts$' },
    },
    {
      name: 'output-operation-result-type-only',
      severity: 'error',
      comment: 'src/output may import only types from src/operation/result.ts (use `import type`).',
      from: { path: '^src/output/', pathNot: TEST_CODE },
      to: { path: '^src/operation/result[.]ts$', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'scripts-only-catalog-types-and-schema',
      severity: 'error',
      comment:
        'The generator may import from src/ only src/catalog/types.ts, schema.ts and rules.ts.',
      from: { path: '^scripts/', pathNot: TEST_CODE },
      to: { path: '^src/', pathNot: '^src/catalog/(?:types|schema|rules)[.]ts$' },
    },
    {
      name: 'src-not-to-dev-dep',
      severity: 'error',
      comment:
        'Shipped code may use runtime dependencies only (devDependencies are not installed).',
      from: { path: '^src/', pathNot: TEST_CODE },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        pathNot: ['(?:^|/)node_modules/@types/'],
      },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: { path: ['^(?:dist|coverage|reports|spec)/', '(?:^|/)[.]stryker-tmp/'] },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    // NodeNext imports use `.js` suffixes for `.ts` sources; dependency-cruiser retries such imports
    // with `.ts` / `.d.ts` like tsc does (its config schema does not accept enhanced-resolve's
    // `extensionAlias`), so listing the TypeScript extensions here is all the mapping needs.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json', '.d.ts'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    skipAnalysisNotInRules: true,
    reporterOptions: {
      archi: { collapsePattern: '^(?:src|scripts|test)/[^/]+|node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
      text: { highlightFocused: true },
    },
  },
};
