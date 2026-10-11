import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addTallies,
  judgeShards,
  mutationScore,
  readReport,
  summarize,
  workflowCommand,
  type ReportTally,
  type Tally,
} from './score.js';

const STATUSES = [
  'Killed',
  'Timeout',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Ignored',
] as const;

type Files = Record<string, readonly string[]>;

/** A Stryker JSON report with the given mutant statuses per file. */
function report(files: Files): unknown {
  return {
    schemaVersion: '1.0',
    files: Object.fromEntries(
      Object.entries(files).map(([name, statuses]) => [
        name,
        { language: 'typescript', source: '', mutants: statuses.map((status) => ({ status })) },
      ]),
    ),
  };
}

const THRESHOLDS = { high: 97, low: 95, break: 94 };

function tally(partial: Partial<Tally>): Tally {
  return { killed: 0, timeout: 0, survived: 0, noCoverage: 0, excluded: 0, ...partial };
}

describe('readReport', () => {
  it('counts every status of a finished report and lists its files', () => {
    const read = readReport(
      report({
        'src/a.ts': ['Killed', 'Killed', 'Survived', 'Timeout'],
        'src/b.ts': ['NoCoverage', 'CompileError', 'RuntimeError', 'Ignored', 'Killed'],
        'src/c.ts': [],
      }),
      'a.json',
    );
    expect(read).toEqual({
      name: 'a.json',
      files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      tally: tally({ killed: 3, timeout: 1, survived: 1, noCoverage: 1, excluded: 3 }),
    });
  });

  it('rejects what is no finished Stryker report, naming the source', () => {
    expect(() => readReport(null, 'x.json')).toThrow('x.json: not a Stryker report');
    expect(() => readReport({ files: [] }, 'x.json')).toThrow('not a Stryker report');
    expect(() => readReport({ files: { 'a.ts': {} } }, 'x.json')).toThrow(
      'x.json: a file without a "mutants" list.',
    );
    expect(() => readReport(report({ 'a.ts': ['Pending'] }), 'x.json')).toThrow(
      'x.json: unexpected mutant status "Pending".',
    );
    expect(() => readReport(report({ 'a.ts': ['constructor'] }), 'x.json')).toThrow(
      'unexpected mutant status "constructor"',
    );
    expect(() => readReport({ files: { 'a.ts': { mutants: [{}] } } }, 'x.json')).toThrow(
      'unexpected mutant status none.',
    );
    expect(() => readReport({ files: { 'a.ts': { mutants: [7] } } }, 'x.json')).toThrow(
      'unexpected mutant status none.',
    );
  });
});

describe('mutationScore', () => {
  it('divides detected (killed, timeout) by valid (detected, survived, no coverage) mutants', () => {
    expect(mutationScore(tally({ killed: 8, timeout: 1, survived: 1 }))).toBe(90);
    expect(mutationScore(tally({ killed: 3, noCoverage: 1, excluded: 50 }))).toBe(75);
    expect(mutationScore(tally({ survived: 2 }))).toBe(0);
  });

  it('is NaN without valid mutants', () => {
    expect(mutationScore(tally({}))).toBeNaN();
    expect(mutationScore(tally({ excluded: 4 }))).toBeNaN();
  });
});

describe('sharding', () => {
  const files = fc.dictionary(
    fc.stringMatching(/^src\/[a-z]{1,8}\.ts$/),
    fc.array(fc.constantFrom(...STATUSES), { maxLength: 20 }),
    { maxKeys: 12 },
  );

  it('gives the score of one report over all files, however the files are split', () => {
    fc.assert(
      fc.property(files, fc.integer({ min: 1, max: 5 }), fc.nat(), (all, shards, seed) => {
        const split: Files[] = Array.from({ length: shards }, () => ({}));
        Object.entries(all).forEach(([name, statuses], index) => {
          const shard = split[(index + seed) % shards]!;
          shard[name] = statuses;
        });
        const combined = addTallies(
          split.map((part, index) => readReport(report(part), `${index}`).tally),
        );
        const whole = readReport(report(all), 'all').tally;
        expect(combined).toEqual(whole);
        expect(Object.is(mutationScore(combined), mutationScore(whole))).toBe(true);
      }),
    );
  });

  it('keeps the score between 0 and 100 %', () => {
    fc.assert(
      fc.property(files, (all) => {
        const score = mutationScore(readReport(report(all), 'all').tally);
        expect(Number.isNaN(score) || (score >= 0 && score <= 100)).toBe(true);
      }),
    );
  });
});

describe('summarize', () => {
  const shard1 = {
    name: 'shard-1/mutation.json',
    files: ['src/a.ts'],
    tally: tally({ killed: 47, survived: 3 }),
  };
  const shard2 = {
    name: 'shard-2/mutation.json',
    files: ['src/b.ts', 'src/c.ts'],
    tally: tally({ killed: 47, timeout: 1, noCoverage: 2, excluded: 5 }),
  };

  it('tables each report and all of them, then judges the combined score', () => {
    const { text, verdict, passed } = summarize([shard1, shard2], THRESHOLDS);
    expect(text).toBe(
      [
        '| Report | Killed | Timeout | Survived | No coverage | Excluded | Score |',
        '| --- | --: | --: | --: | --: | --: | --: |',
        '| shard-1/mutation.json | 47 | 0 | 3 | 0 | 0 | 94.00 % |',
        '| shard-2/mutation.json | 47 | 1 | 0 | 2 | 5 | 96.00 % |',
        '| All | 94 | 1 | 3 | 2 | 5 | 95.00 % |',
        '',
        'Mutation score 95.00 % meets the break threshold 94 %.',
      ].join('\n'),
    );
    expect(verdict).toBe('Mutation score 95.00 % meets the break threshold 94 %.');
    expect(passed).toBe(true);
  });

  it('passes at the break threshold and fails below it', () => {
    expect(summarize([shard1], THRESHOLDS).passed).toBe(true);
    const below = summarize(
      [{ name: 'a', files: [], tally: tally({ killed: 93, survived: 7 }) }],
      THRESHOLDS,
    );
    expect(below).toEqual({
      text: expect.stringMatching(/\nMutation score 93\.00 % is below the break threshold 94 %\.$/),
      verdict: 'Mutation score 93.00 % is below the break threshold 94 %.',
      passed: false,
    });
  });

  it('fails when reports share a file, whose mutants would count twice', () => {
    const again = { ...shard2, name: 'again', files: ['src/c.ts', 'src/a.ts', 'src/d.ts'] };
    expect(summarize([shard1, shard2, again], THRESHOLDS)).toEqual({
      text: expect.stringMatching(/\nFiles in more than one report: src\/a\.ts, src\/c\.ts\.$/),
      verdict: 'Files in more than one report: src/a.ts, src/c.ts.',
      passed: false,
    });
  });

  it('passes without a break threshold or without valid mutants, as Stryker does', () => {
    const low = [{ name: 'a', files: [], tally: tally({ survived: 1 }) }];
    expect(summarize(low, { ...THRESHOLDS, break: null })).toEqual({
      text: expect.stringMatching(/\nMutation score 0\.00 %, no break threshold\.$/),
      verdict: 'Mutation score 0.00 %, no break threshold.',
      passed: true,
    });
    const empty = summarize([{ name: 'a', files: [], tally: tally({ excluded: 2 }) }], THRESHOLDS);
    expect(empty.passed).toBe(true);
    expect(empty.text).toContain('| a | 0 | 0 | 0 | 0 | 2 | n/a |');
    expect(empty.text).toMatch(/\nNo valid mutants, nothing to judge\.$/);
  });
});

describe('judgeShards', () => {
  const shard = (index: number, partial: Partial<Tally>): ReportTally => ({
    name: `shard-${index}`,
    files: [`src/${index}.ts`],
    tally: tally(partial),
  });
  const good = [shard(1, { killed: 19, survived: 1 }), shard(2, { killed: 10 })];
  const poor = [shard(1, { killed: 9, survived: 1 }), shard(2, { killed: 8, noCoverage: 2 })];
  const strict = { shards: 2, informational: false };
  const informational = { shards: 2, informational: true };

  it('requires one report per shard and the break threshold outside pull requests', () => {
    expect(judgeShards(good, THRESHOLDS, strict)).toEqual({
      text: summarize(good, THRESHOLDS).text,
      annotations: [],
      passed: true,
    });
    expect(judgeShards(poor, THRESHOLDS, strict)).toEqual({
      text: summarize(poor, THRESHOLDS).text,
      annotations: [],
      passed: false,
    });
    for (const reports of [[], good.slice(1), [...good, shard(3, {})]]) {
      expect(judgeShards(reports, THRESHOLDS, strict)).toEqual({
        text: `Expected the reports of all 2 shards, got ${reports.length}.`,
        annotations: [],
        passed: false,
      });
    }
  });

  it('only informs on pull requests: a low score becomes a warning, never a failure', () => {
    const judged = judgeShards(poor, THRESHOLDS, informational);
    const verdict = 'Mutation score 85.00 % is below the break threshold 94 %.';
    expect(judged).toEqual({
      text: [
        summarize(poor, THRESHOLDS).text,
        'Informational on pull requests: pushes to main and the weekly run enforce the break threshold.',
      ].join('\n\n'),
      annotations: [{ level: 'warning', message: verdict }],
      passed: true,
    });
    expect(judgeShards(good, THRESHOLDS, informational)).toMatchObject({
      annotations: [],
      passed: true,
    });
  });

  it('scores the shards that ran on pull requests and notes the skipped ones', () => {
    const judged = judgeShards(poor.slice(1), THRESHOLDS, informational);
    const skipped =
      '1 of 2 mutation shards ran; the others had no baseline of main (or failed), and their ' +
      'mutants are not in the score.';
    expect(judged.passed).toBe(true);
    expect(judged.annotations).toEqual([
      { level: 'notice', message: skipped },
      { level: 'warning', message: 'Mutation score 80.00 % is below the break threshold 94 %.' },
    ]);
    expect(judged.text).toBe(
      [
        summarize(poor.slice(1), THRESHOLDS).text,
        skipped,
        'Informational on pull requests: pushes to main and the weekly run enforce the break threshold.',
      ].join('\n\n'),
    );
  });

  it('notes a pull request on which no shard ran', () => {
    const judged = judgeShards([], THRESHOLDS, informational);
    expect(judged.passed).toBe(true);
    expect(judged.text).toMatch(/^No mutation shard ran: main has no baseline for this setup /);
    expect(judged.text).toMatch(/a pull request never runs in full\. The push to main and the /);
    expect(judged.annotations).toEqual([{ level: 'notice', message: judged.text }]);
  });

  it('fails on pull requests with more reports than shards', () => {
    expect(judgeShards([...good, shard(3, {})], THRESHOLDS, informational)).toEqual({
      text: 'Expected at most 2 reports, got 3.',
      annotations: [],
      passed: false,
    });
  });
});

describe('workflowCommand', () => {
  it('escapes what GitHub Actions would read as the end of the message', () => {
    expect(workflowCommand({ level: 'warning', message: 'Score 93.00 % is below 94 %.' })).toBe(
      '::warning::Score 93.00 %25 is below 94 %25.',
    );
    expect(workflowCommand({ level: 'notice', message: 'a\r\nb\nc%0A' })).toBe(
      '::notice::a%0D%0Ab%0Ac%250A',
    );
  });
});
