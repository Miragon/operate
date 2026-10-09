import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/catalog/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/bin/**', 'src/**/types.ts', 'scripts/catalog/openapi.ts'],
      reporter: ['text-summary', 'text', 'html', 'json-summary', 'lcov'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
