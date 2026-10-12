/**
 * Mutation score over the reports of the CI mutation shards (stryker.config.js, `STRYKER_SHARD`).
 * Each shard mutates other files, so the score of the project comes from the mutant counts of all
 * reports, with the metrics of mutation-testing-elements that Stryker uses: detected (Killed,
 * Timeout) divided by valid (detected plus Survived and NoCoverage), in percent. CompileError,
 * RuntimeError and Ignored mutants are not valid and do not count.
 */

/** The thresholds of stryker.config.js; a `break` of null never fails. */
export interface Thresholds {
  readonly high: number;
  readonly low: number;
  readonly break: number | null;
}

/** Mutant counts of one report or of several together. */
export interface Tally {
  readonly killed: number;
  readonly timeout: number;
  readonly survived: number;
  readonly noCoverage: number;
  /** CompileError, RuntimeError and Ignored */
  readonly excluded: number;
}

/** One report: its name, the files it mutates and its mutant counts. */
export interface ReportTally {
  readonly name: string;
  readonly files: readonly string[];
  readonly tally: Tally;
}

/** Summary text (Markdown), its last line and whether the combined score meets the threshold. */
export interface Summary {
  readonly text: string;
  readonly verdict: string;
  readonly passed: boolean;
}

/** How the score job judges the shard reports. */
export interface Mode {
  /** `SHARDS` of stryker.config.js */
  readonly shards: number;
  /**
   * Pull requests: a shard without a baseline of main skips Stryker and has no report, and the
   * job reports the score without ever failing.
   */
  readonly informational: boolean;
}

/** An annotation of the GitHub Actions job. */
export interface Annotation {
  readonly level: 'notice' | 'warning';
  readonly message: string;
}

/** The summary of the score job, the annotations it adds and whether it passes. */
export interface Judgement {
  readonly text: string;
  readonly annotations: readonly Annotation[];
  readonly passed: boolean;
}

const EMPTY: Tally = { killed: 0, timeout: 0, survived: 0, noCoverage: 0, excluded: 0 };

/** Every status of a finished report; `Pending` only appears in unfinished ones. */
const COUNTER = new Map<string, keyof Tally>([
  ['Killed', 'killed'],
  ['Timeout', 'timeout'],
  ['Survived', 'survived'],
  ['NoCoverage', 'noCoverage'],
  ['CompileError', 'excluded'],
  ['RuntimeError', 'excluded'],
  ['Ignored', 'excluded'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mutantsOf(file: unknown, source: string): readonly unknown[] {
  const mutants = isRecord(file) ? file.mutants : undefined;
  if (!Array.isArray(mutants)) throw new Error(`${source}: a file without a "mutants" list.`);
  return mutants;
}

function counterOf(mutant: unknown, source: string): keyof Tally {
  const status = isRecord(mutant) ? mutant.status : undefined;
  const counter = typeof status === 'string' ? COUNTER.get(status) : undefined;
  if (counter === undefined) {
    const shown = status === undefined ? 'none' : JSON.stringify(status);
    throw new Error(`${source}: unexpected mutant status ${shown}.`);
  }
  return counter;
}

/**
 * Reads a parsed Stryker JSON report (`jsonReporter`).
 * @param name names the report in the summary and in errors
 * @throws Error when the report is no finished mutation testing report
 */
export function readReport(report: unknown, name: string): ReportTally {
  const files = isRecord(report) ? report.files : undefined;
  if (!isRecord(files)) throw new Error(`${name}: not a Stryker report (no "files").`);
  const counts: Record<keyof Tally, number> = { ...EMPTY };
  for (const file of Object.values(files)) {
    for (const mutant of mutantsOf(file, name)) counts[counterOf(mutant, name)] += 1;
  }
  return { name, files: Object.keys(files), tally: counts };
}

/** The counts of all tallies together. */
export function addTallies(tallies: readonly Tally[]): Tally {
  return tallies.reduce(
    (sum, tally) => ({
      killed: sum.killed + tally.killed,
      timeout: sum.timeout + tally.timeout,
      survived: sum.survived + tally.survived,
      noCoverage: sum.noCoverage + tally.noCoverage,
      excluded: sum.excluded + tally.excluded,
    }),
    EMPTY,
  );
}

/** The mutation score in percent; NaN (0 / 0) without valid mutants, as in Stryker. */
export function mutationScore(tally: Tally): number {
  const detected = tally.killed + tally.timeout;
  const valid = detected + tally.survived + tally.noCoverage;
  return (detected / valid) * 100;
}

function formatScore(score: number): string {
  return Number.isNaN(score) ? 'n/a' : `${score.toFixed(2)} %`;
}

function row(name: string, tally: Tally): string {
  const { killed, timeout, survived, noCoverage, excluded } = tally;
  const counts = [killed, timeout, survived, noCoverage, excluded].join(' | ');
  return `| ${name} | ${counts} | ${formatScore(mutationScore(tally))} |`;
}

interface Verdict {
  readonly text: string;
  readonly passed: boolean;
}

function verdict(score: number, limit: number | null): Verdict {
  const text = formatScore(score);
  // like Stryker: no break threshold or no valid mutants never break the build
  if (limit === null) return { text: `Mutation score ${text}, no break threshold.`, passed: true };
  if (Number.isNaN(score)) return { text: 'No valid mutants, nothing to judge.', passed: true };
  if (score < limit) {
    return {
      text: `Mutation score ${text} is below the break threshold ${limit} %.`,
      passed: false,
    };
  }
  return { text: `Mutation score ${text} meets the break threshold ${limit} %.`, passed: true };
}

/** Files in more than one report: their mutants would count twice. */
function sharedFiles(reports: readonly ReportTally[]): string[] {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const file of reports.flatMap(({ files }) => files)) {
    if (seen.has(file)) shared.add(file);
    seen.add(file);
  }
  return [...shared].sort();
}

/**
 * A Markdown table of each report and of all together, followed by the verdict on the break
 * threshold, which applies to the combined score. Reports that share a file fail.
 */
export function summarize(reports: readonly ReportTally[], thresholds: Thresholds): Summary {
  const total = addTallies(reports.map(({ tally }) => tally));
  const shared = sharedFiles(reports);
  const result =
    shared.length > 0
      ? { text: `Files in more than one report: ${shared.join(', ')}.`, passed: false }
      : verdict(mutationScore(total), thresholds.break);
  const lines = [
    '| Report | Killed | Timeout | Survived | No coverage | Excluded | Score |',
    '| --- | --: | --: | --: | --: | --: | --: |',
    ...reports.map(({ name, tally }) => row(name, tally)),
    row('All', total),
    '',
    result.text,
  ];
  return { text: lines.join('\n'), verdict: result.text, passed: result.passed };
}

const NO_SHARD =
  'No mutation shard ran: main has no baseline for this setup (a change of the Stryker, vitest ' +
  'or TypeScript configuration, the dependencies or the Node major), and a pull request never ' +
  'runs in full. The push to main and the weekly run test it.';

const INFORMATIONAL =
  'Informational on pull requests: pushes to main and the weekly run enforce the break threshold.';

/** Pull requests: the score of the shards that ran, as information. */
function inform(
  reports: readonly ReportTally[],
  thresholds: Thresholds,
  shards: number,
): Judgement {
  if (reports.length === 0) {
    return { text: NO_SHARD, annotations: [{ level: 'notice', message: NO_SHARD }], passed: true };
  }
  const summary = summarize(reports, thresholds);
  const partial =
    reports.length < shards
      ? [
          `${reports.length} of ${shards} mutation shards ran; the others had no baseline of ` +
            'main (or failed), and their mutants are not in the score.',
        ]
      : [];
  const annotations: Annotation[] = partial.map((message) => ({ level: 'notice', message }));
  if (!summary.passed) annotations.push({ level: 'warning', message: summary.verdict });
  return {
    text: [summary.text, ...partial, INFORMATIONAL].join('\n\n'),
    annotations,
    passed: true,
  };
}

/**
 * Judges the reports of the CI shards: the summary of all of them, which must be one per shard and
 * meet the break threshold, or on pull requests (`informational`) the score of those that ran,
 * with annotations instead of a failure.
 */
export function judgeShards(
  reports: readonly ReportTally[],
  thresholds: Thresholds,
  mode: Mode,
): Judgement {
  const { shards, informational } = mode;
  if (informational && reports.length <= shards) return inform(reports, thresholds, shards);
  if (!informational && reports.length === shards) {
    const { text, passed } = summarize(reports, thresholds);
    return { text, annotations: [], passed };
  }
  const expected = informational
    ? `at most ${shards} reports`
    : `the reports of all ${shards} shards`;
  return { text: `Expected ${expected}, got ${reports.length}.`, annotations: [], passed: false };
}

/** A workflow command that adds the annotation to the GitHub Actions job. */
export function workflowCommand({ level, message }: Annotation): string {
  const escaped = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return `::${level}::${escaped}`;
}
