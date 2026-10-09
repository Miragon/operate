import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOBAL_FLAGS } from '../../scripts/catalog/flags.js';
import { EXIT_CODES } from '../errors.js';
import { VARIABLE_TYPES } from '../operation/variables.js';
import { GUIDE } from './guide.js';

const SKILL = readFileSync(new URL('../../skills/operate/SKILL.md', import.meta.url), 'utf8');
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/;

describe('GUIDE', () => {
  const lines = GUIDE.split('\n');

  it('is a concise markdown document', () => {
    expect(GUIDE.startsWith('# operate')).toBe(true);
    expect(GUIDE.endsWith('\n')).toBe(true);
    expect(GUIDE.endsWith('\n\n')).toBe(false);
    expect(lines.length).toBeGreaterThanOrEqual(150);
    expect(lines.length).toBeLessThanOrEqual(250);
    expect(GUIDE.split('```').length % 2).toBe(1);
  });

  it('has the sections an agent needs', () => {
    const headings = lines.filter((line) => line.startsWith('## '));
    expect(headings).toEqual([
      '## Setup',
      '## Workflow: discover, describe, preview, run',
      '## Invocation conventions',
      '## Output',
      '## Errors and exit codes',
      '## Safety',
      '## Recipes',
      '## Authentication',
    ]);
  });

  it('names the supported engines and the setup', () => {
    for (const text of [
      'Operaton',
      'CIB seven',
      'Camunda 7',
      'OPERATE_URL',
      'operate config set',
      'operate ping',
    ]) {
      expect(GUIDE).toContain(text);
    }
    expect(GUIDE).toContain('flag > environment variable > profile > default');
  });

  it('documents every exit code', () => {
    for (const code of Object.values(EXIT_CODES)) {
      expect(GUIDE).toMatch(new RegExp(`^\\| ${code} +\\| \\S`, 'm'));
    }
  });

  it('mentions every global option and every variable type', () => {
    for (const flag of GLOBAL_FLAGS.filter((name) => name !== 'help')) {
      expect(GUIDE).toContain(`--${flag}`);
    }
    for (const type of VARIABLE_TYPES) {
      expect(GUIDE).toMatch(new RegExp(`\\b${type}\\b`));
    }
  });

  it('covers safety, output and authentication details', () => {
    for (const text of [
      '--dry-run',
      '--yes',
      'CONFIRMATION_REQUIRED',
      'READ_ONLY',
      'OPERATE_READ_ONLY',
      '--no-validate',
      '--body -',
      '--body @file.json',
      'name:Type=value',
      'Date',
      '2024-05-01T10:00:00.000+0200',
      'Done: <METHOD> <path>',
      '--out-file <path>',
      'operate api',
      'https://github.com/Miragon/operate/issues/1',
      'https://github.com/Miragon/operate/issues/2',
    ]) {
      expect(GUIDE).toContain(text);
    }
  });
});

describe('skills/operate/SKILL.md', () => {
  const match = FRONTMATTER.exec(SKILL);

  it('has a YAML frontmatter with name and description', () => {
    expect(match).not.toBeNull();
    const frontmatter = match![1]!.split('\n');
    expect(frontmatter[0]).toBe('name: operate');
    expect(frontmatter).toHaveLength(2);
    const description = frontmatter[1]!;
    expect(description).toMatch(/^description: \S/);
    for (const text of [
      'Camunda 7',
      'Operaton',
      'CIB seven',
      'REST API',
      'external tasks',
      'incidents',
    ]) {
      expect(description).toContain(text);
    }
    expect(description.slice('description: '.length)).not.toMatch(/: |^['"]/);
  });

  it('is followed by exactly the guide', () => {
    expect(match![2]).toBe(GUIDE);
  });
});
