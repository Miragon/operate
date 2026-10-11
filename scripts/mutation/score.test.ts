import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addTallies, mutationScore, readReport, summarize, type Tally } from './score.js';

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
    const { text, passed } = summarize([shard1, shard2], THRESHOLDS);
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
      passed: false,
    });
  });

  it('fails when reports share a file, whose mutants would count twice', () => {
    const again = { ...shard2, name: 'again', files: ['src/c.ts', 'src/a.ts', 'src/d.ts'] };
    expect(summarize([shard1, shard2, again], THRESHOLDS)).toEqual({
      text: expect.stringMatching(/\nFiles in more than one report: src\/a\.ts, src\/c\.ts\.$/),
      passed: false,
    });
  });

  it('passes without a break threshold or without valid mutants, as Stryker does', () => {
    const low = [{ name: 'a', files: [], tally: tally({ survived: 1 }) }];
    expect(summarize(low, { ...THRESHOLDS, break: null })).toEqual({
      text: expect.stringMatching(/\nMutation score 0\.00 %, no break threshold\.$/),
      passed: true,
    });
    const empty = summarize([{ name: 'a', files: [], tally: tally({ excluded: 2 }) }], THRESHOLDS);
    expect(empty.passed).toBe(true);
    expect(empty.text).toContain('| a | 0 | 0 | 0 | 0 | 2 | n/a |');
    expect(empty.text).toMatch(/\nNo valid mutants, nothing to judge\.$/);
  });
});
