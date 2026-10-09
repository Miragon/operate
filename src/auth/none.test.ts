import { describe, expect, it } from 'vitest';
import { noAuth } from './none.js';

describe('noAuth', () => {
  it('has type none', () => {
    expect(noAuth().type).toBe('none');
  });

  it('adds no headers', async () => {
    await expect(noAuth().headers()).resolves.toEqual({});
  });

  it('cannot refresh credentials', () => {
    expect('refresh' in noAuth()).toBe(false);
  });
});
