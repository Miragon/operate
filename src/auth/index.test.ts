import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '../config/types.js';
import { OperateError } from '../errors.js';
import { createAuthProvider } from './index.js';

describe('createAuthProvider', () => {
  it('creates the none provider', async () => {
    const provider = createAuthProvider({ type: 'none' });
    expect(provider.type).toBe('none');
    await expect(provider.headers()).resolves.toEqual({});
  });

  it.each(['basic', 'oauth', 'constructor', ''])('rejects the unsupported type %j', (type) => {
    try {
      createAuthProvider({ type } as unknown as AuthConfig);
    } catch (error) {
      expect(error).toBeInstanceOf(OperateError);
      expect((error as OperateError).code).toBe('CONFIG');
      expect((error as OperateError).exitCode).toBe(3);
      expect((error as OperateError).message).toBe(`Unsupported auth type "${type}"`);
      const hint = (error as OperateError).details.hint;
      expect(hint).toContain('Supported: none.');
      expect(hint).toContain('https://github.com/Miragon/operate/issues/1');
      expect(hint).toContain('https://github.com/Miragon/operate/issues/2');
      return;
    }
    throw new Error('expected an error');
  });
});
