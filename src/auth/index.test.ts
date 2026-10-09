import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '../config/types.js';
import { OperateError } from '../errors.js';
import { createAuthProvider } from './index.js';

describe('createAuthProvider', () => {
  it('creates the none provider', async () => {
    const provider = createAuthProvider({ type: 'none' });
    expect(provider.type).toBe('none');
    await expect(provider.headers()).resolves.toEqual({});
    expect(provider.principal).toBeUndefined();
    expect(provider.off).toBeUndefined();
    expect(createAuthProvider({ type: 'none', off: 'switched off' }).off).toBe('switched off');
  });

  it('creates the basic provider', async () => {
    const provider = createAuthProvider({
      type: 'basic',
      username: 'demo',
      password: 'demo',
      sources: { username: 'env', password: 'env' },
    });
    expect(provider.type).toBe('basic');
    await expect(provider.headers()).resolves.toEqual({ Authorization: 'Basic ZGVtbzpkZW1v' });
    expect(provider.principal).toEqual({ user: 'demo', source: 'env' });
  });

  it.each(['oauth', 'constructor', 'NONE', ''])('rejects the unsupported type %j', (type) => {
    try {
      createAuthProvider({ type } as unknown as AuthConfig);
    } catch (error) {
      expect(error).toBeInstanceOf(OperateError);
      expect((error as OperateError).code).toBe('CONFIG');
      expect((error as OperateError).exitCode).toBe(3);
      expect((error as OperateError).message).toBe(`Unsupported auth type "${type}"`);
      const hint = (error as OperateError).details.hint;
      expect(hint).toBe(
        'Supported: none, basic. OAuth authorization code (https://github.com/Miragon/operate/issues/2) is planned.',
      );
      return;
    }
    throw new Error('expected an error');
  });
});
