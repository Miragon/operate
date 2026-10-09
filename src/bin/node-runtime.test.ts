import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { createNodeRuntime } from './node-runtime.js';

const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(process.stdin, 'isTTY');
  else Object.defineProperty(process.stdin, 'isTTY', original);
});

describe('createNodeRuntime().readStdin', () => {
  it('refuses to wait for a terminal with a one-line message and hint for both stdin uses', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const error: unknown = await createNodeRuntime()
      .readStdin()
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect(error).toBeInstanceOf(OperateError);
    const { code, message, details } = error as OperateError;
    expect(code).toBe('USAGE');
    expect(message).toBe('stdin is a terminal; pipe the input into the command');
    expect(details.hint).toBe(
      `Examples: echo '{}' | operate ... --body - (or --body @file.json); printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin.`,
    );
    // rendered errors are single lines; a template literal "\n" would break the printf example
    expect(details.hint).not.toMatch(/[\r\n]/);
  });
});

describe.skipIf(process.platform === 'win32')(
  'createNodeRuntime().fs.writeFile with a mode',
  () => {
    let dir = '';
    const fs = createNodeRuntime().fs;
    const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'operate-fs-'));
    });

    afterEach(async () => {
      await chmod(dir, 0o700);
      await rm(dir, { recursive: true, force: true });
    });

    it('replaces an existing file readable by others with a private one, leaving no temporary file', async () => {
      const path = join(dir, 'config.json');
      await writeFile(path, 'old', { mode: 0o644 });
      await chmod(path, 0o644);
      await fs.writeFile(path, 'secret', { mode: 0o600 });
      expect(await readFile(path, 'utf8')).toBe('secret');
      expect(await modeOf(path)).toBe(0o600);
      expect(await readdir(dir)).toEqual(['config.json']);
    });

    it('creates a new file with the mode', async () => {
      const path = join(dir, 'new.json');
      await fs.writeFile(path, 'secret', { mode: 0o600 });
      expect(await modeOf(path)).toBe(0o600);
    });

    it('keeps a symlinked config file linked and writes its target', async () => {
      const target = join(dir, 'dotfiles.json');
      const link = join(dir, 'config.json');
      await writeFile(target, 'old', { mode: 0o644 });
      await symlink(target, link);
      await fs.writeFile(link, 'secret', { mode: 0o600 });
      expect((await stat(link)).isFile()).toBe(true);
      expect(await readFile(target, 'utf8')).toBe('secret');
      expect(await modeOf(target)).toBe(0o600);
      expect((await readdir(dir)).sort()).toEqual(['config.json', 'dotfiles.json']);
    });

    it('removes the temporary file when the rename fails', async () => {
      const path = join(dir, 'config.json');
      await mkdir(path);
      await expect(fs.writeFile(path, 'secret', { mode: 0o600 })).rejects.toThrow();
      expect(await readdir(dir)).toEqual(['config.json']);
    });

    it.skipIf(process.getuid?.() === 0)(
      'writes in place, private first, in a directory it may not create files in',
      async () => {
        const path = join(dir, 'config.json');
        await writeFile(path, 'old', { mode: 0o644 });
        await chmod(path, 0o644);
        await chmod(dir, 0o500);
        await fs.writeFile(path, 'secret', { mode: 0o600 });
        expect(await readFile(path, 'utf8')).toBe('secret');
        expect(await modeOf(path)).toBe(0o600);
        await expect(fs.writeFile(join(dir, 'other.json'), 'x', { mode: 0o600 })).rejects.toThrow();
      },
    );

    it('writes files without a mode in place', async () => {
      const path = join(dir, 'out.bin');
      await fs.writeFile(path, Uint8Array.of(1, 2));
      expect([...(await readFile(path))]).toEqual([1, 2]);
    });
  },
);
