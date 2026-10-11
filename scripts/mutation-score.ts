/**
 * Applies the break threshold of stryker.config.js to the CI mutation shards together.
 * Usage: npm run test:mutation:score -- [--informational] <mutation.json of each shard>...
 * Prints the mutant counts and scores of each shard and of all of them (also to the GitHub job
 * summary) and fails below the threshold, as a single unsharded Stryker run would. With
 * `--informational` (pull requests) shards may lack a report and the script never fails: missing
 * shards and a score below the threshold become annotations of the GitHub job instead.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { judgeShards, readReport, workflowCommand, type Thresholds } from './mutation/score.js';

interface StrykerConfig {
  readonly SHARDS: number;
  readonly thresholds: Thresholds;
}

// A dynamic import: TypeScript does not type check the JavaScript configuration.
const configUrl = new URL('../stryker.config.js', import.meta.url).href;
const config = (await import(configUrl)) as StrykerConfig;
const args = process.argv.slice(2);
const informational = args[0] === '--informational';
const files = informational ? args.slice(1) : args;
const reports = files.map((file) => readReport(JSON.parse(readFileSync(file, 'utf8')), file));
const { text, annotations, passed } = judgeShards(reports, config.thresholds, {
  shards: config.SHARDS,
  informational,
});
console.log(text);
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) appendFileSync(summaryFile, `## Mutation testing\n\n${text}\n`);
if (process.env.GITHUB_ACTIONS === 'true') {
  for (const annotation of annotations) console.log(workflowCommand(annotation));
}
if (!passed) process.exitCode = 1;
