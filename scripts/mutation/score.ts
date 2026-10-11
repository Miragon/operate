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

/** Summary text (Markdown) and whether the combined score meets the break threshold. */
export interface Summary {
  readonly text: string;
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

function verdict(score: number, limit: number | null): Summary {
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
  return { text: lines.join('\n'), passed: result.passed };
}
