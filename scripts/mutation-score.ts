/**
 * Applies the break threshold of stryker.config.js to the CI mutation shards together.
 * Usage: npm run test:mutation:score -- <mutation.json of each shard>...
 * Prints the mutant counts and scores of each shard and of all of them (also to the GitHub job
 * summary) and fails below the threshold, as a single unsharded Stryker run would.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { readReport, summarize, type Thresholds } from './mutation/score.js';

interface StrykerConfig {
  readonly SHARDS: number;
  readonly thresholds: Thresholds;
}

// A dynamic import: TypeScript does not type check the JavaScript configuration.
const configUrl = new URL('../stryker.config.js', import.meta.url).href;
const config = (await import(configUrl)) as StrykerConfig;
const files = process.argv.slice(2);
if (files.length === config.SHARDS) {
  const reports = files.map((file) => readReport(JSON.parse(readFileSync(file, 'utf8')), file));
  const { text, passed } = summarize(reports, config.thresholds);
  console.log(text);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `## Mutation testing\n\n${text}\n`);
  if (!passed) process.exitCode = 1;
} else {
  console.error(`Expected the reports of all ${config.SHARDS} shards, got ${files.length}.`);
  process.exitCode = 1;
}
