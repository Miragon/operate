import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { b64tokens } from '../../test/support/bearer.js';
import { OperateError } from '../errors.js';
import { profileAuthProblem } from './auth.js';
import {
  checkTokenEnv,
  hasBearerKeys,
  isConventionalVariable,
  normalizeToken,
  validateTokenEnv,
} from './bearer.js';

function failure(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

describe('normalizeToken', () => {
  it('keeps a valid token as it is', () => {
    expect(normalizeToken('abc.DEF-ghi_jkl~mno+pqr/stu==', 'OPERATE_TOKEN')).toBe(
      'abc.DEF-ghi_jkl~mno+pqr/stu==',
    );
  });

  it('drops a pasted "Bearer " prefix in any case and surrounding blanks', () => {
    fc.assert(
      fc.property(
        b64tokens,
        fc.constantFrom('', 'Bearer ', 'bearer ', 'BEARER\t', 'BeArEr   '),
        fc.constantFrom('', ' ', '\t', ' \n', ' '),
        fc.constantFrom('', ' ', '\r\n', '\t'),
        (token, prefix, before, after) => {
          expect(normalizeToken(`${before}${prefix}${token}${after}`, 'OPERATE_TOKEN')).toBe(token);
        },
      ),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(b64tokens, fc.constantFrom('', 'Bearer '), (token, prefix) => {
        const once = normalizeToken(`${prefix}${token}`, 'x');
        expect(normalizeToken(once, 'x')).toBe(once);
      }),
    );
  });

  it('keeps tokens that only start with the word bearer', () => {
    expect(normalizeToken('bearerXYZ', 'x')).toBe('bearerXYZ');
    expect(normalizeToken('Bearer.abc', 'x')).toBe('Bearer.abc');
  });

  it.each(['', '   ', 'Bearer', 'bearer ', ' Bearer \t '])('refuses the empty token %j', (raw) => {
    const error = failure(() => normalizeToken(raw, 'OPERATE_TOKEN'));
    expect(error.code).toBe('CONFIG');
    expect(error.exitCode).toBe(3);
    expect(error.message).toBe('The bearer token from OPERATE_TOKEN is empty');
    expect(error.details.hint).toBe(
      'Set the token itself, e.g. export OPERATE_TOKEN=<token> or pipe it into --auth-token-stdin.',
    );
  });

  it('refuses tokens beyond the b64token syntax without repeating them', () => {
    const invalid = fc
      .tuple(
        b64tokens.filter((token) => !token.endsWith('=')),
        fc.constantFrom(' ', ':', '"', '{', '}', 'ä', ',', ';', '@', '\\', 'Bearer ', '=x', '%'),
        b64tokens,
      )
      .map(([head, bad, tail]) => `Secret${head}${bad}${tail}`);
    fc.assert(
      fc.property(invalid, (token) => {
        const error = failure(() => normalizeToken(token, 'auth.token of profile "p"'));
        expect(error.code).toBe('CONFIG');
        expect(error.message).toBe(
          'The bearer token from auth.token of profile "p" has characters a bearer token cannot have (RFC 6750)',
        );
        expect(`${error.message} ${error.details.hint ?? ''}`).not.toContain(token);
        expect(error.details.hint).toContain('a leading "Bearer " is fine');
      }),
    );
  });

  it('refuses padding in front and names line breaks and control characters', () => {
    expect(failure(() => normalizeToken('=abc', 'x')).message).toContain('cannot have');
    for (const token of ['abc\ndef', 'abc\u0000def', 'abc\u007fdef']) {
      expect(failure(() => normalizeToken(token, '--auth-token-stdin')).message).toBe(
        'The bearer token from --auth-token-stdin contains line breaks or control characters (RFC 6750)',
      );
    }
  });
});

describe('validateTokenEnv', () => {
  it('accepts and trims variable names', () => {
    expect(validateTokenEnv(' CI_ENGINE_TOKEN ')).toBe('CI_ENGINE_TOKEN');
    expect(validateTokenEnv('_x1')).toBe('_x1');
  });

  it.each(['', '1ABC', 'MY-VAR', 'eyJhbGciOi.payload.sig', 'a b'])(
    'refuses %j without repeating it',
    (name) => {
      const error = failure(() => validateTokenEnv(name));
      expect(error.code).toBe('CONFIG');
      expect(error.message).toBe(
        'Invalid --auth-token-env: expected the name of an environment variable',
      );
      expect(error.details.hint).toBe(
        'Use letters, digits and "_", not starting with a digit, e.g. --auth-token-env CI_ENGINE_TOKEN; the variable holds the token.',
      );
      if (name !== '') expect(`${error.message}${error.details.hint ?? ''}`).not.toContain(name);
    },
  );
});

describe('isConventionalVariable', () => {
  it('accepts upper-case names of words up to 24 characters, at most 64 in all', () => {
    for (const name of ['CI_ENGINE_TOKEN', '_X', 'A', 'OPERATE_ENGINE_PRODUCTION_BEARER_TOKEN']) {
      expect(isConventionalVariable(name)).toBe(true);
    }
    expect(isConventionalVariable(`${'A'.repeat(24)}_B`)).toBe(true);
  });

  it('refuses lower case, long words and long names: opaque tokens look like that', () => {
    for (const name of [
      'tok_SECRETabcdefghijklmnopqrstuvwxyz0123',
      'ci_token',
      'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6',
      'A'.repeat(25),
      Array.from({ length: 14 }, () => 'ABCD').join('_'),
      '1ABC',
      '',
    ]) {
      expect(isConventionalVariable(name)).toBe(false);
    }
  });
});

describe('checkTokenEnv', () => {
  it('accepts a set variable in any form and an unset one in the usual form', () => {
    expect(checkTokenEnv(' CI_ENGINE_TOKEN ', {})).toBe('CI_ENGINE_TOKEN');
    expect(checkTokenEnv('ci_token', { ci_token: 'v' })).toBe('ci_token');
  });

  it('refuses an unset name in another form without repeating it: it may be the token', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][A-Za-z0-9_]{8,40}$/), (name) => {
        fc.pre(!isConventionalVariable(name));
        for (const env of [{}, { [name]: ' ' }]) {
          const error = failure(() => checkTokenEnv(name, env));
          expect(error.code).toBe('CONFIG');
          expect(error.message).toBe(
            '--auth-token-env names a variable that is not set and does not look like a variable name: it may be the token itself, so it is neither stored nor repeated',
          );
          expect(`${error.message}${error.details.hint ?? ''}`).not.toContain(name);
        }
      }),
    );
    expect(failure(() => checkTokenEnv('a.b.c', {})).message).toBe(
      'Invalid --auth-token-env: expected the name of an environment variable',
    );
  });
});

describe('profileAuthProblem with bearer keys', () => {
  it('accepts a stored token or its variable with type bearer or none', () => {
    for (const type of ['bearer', 'none']) {
      expect(profileAuthProblem('p', { type, tokenEnv: 'CI_TOKEN' })).toBeUndefined();
      expect(profileAuthProblem('p', { type, token: 'abc' })).toBeUndefined();
    }
    expect(profileAuthProblem('p', { type: 'bearer' })).toBeUndefined();
  });

  it('checks the shape of the keys without quoting values', () => {
    expect(profileAuthProblem('p', { type: 'bearer', tokenEnv: 'not a name' })).toBe(
      'profile "p" has an invalid auth.tokenEnv (expected the name of an environment variable, e.g. CI_ENGINE_TOKEN)',
    );
    expect(profileAuthProblem('p', { type: 'bearer', token: ' ' })).toBe(
      'profile "p" has an invalid auth.token (expected a non-empty string)',
    );
    expect(profileAuthProblem('p', { type: 'bearer', token: 7 })).toBe(
      'profile "p" has an invalid auth.token (expected a non-empty string)',
    );
  });

  it('refuses both token sources', () => {
    expect(profileAuthProblem('p', { type: 'bearer', token: 'abc', tokenEnv: 'X' })).toBe(
      'profile "p" sets both auth.token and auth.tokenEnv; keep one (tokenEnv is recommended)',
    );
  });

  it('refuses bearer keys next to Basic auth or OAuth keys', () => {
    expect(profileAuthProblem('p', { username: 'u', tokenEnv: 'X' })).toBe(
      'profile "p" mixes bearer token keys (tokenEnv) and Basic auth keys (username); keep one',
    );
    expect(profileAuthProblem('p', { type: 'bearer', username: 'u', token: 't' })).toBe(
      'profile "p" mixes bearer token keys (token) and Basic auth keys (username); keep one',
    );
    expect(profileAuthProblem('p', { type: 'oauth', clientId: 'c', token: 't' })).toBe(
      'profile "p" mixes bearer token keys (token) and OAuth keys (clientId); keep one',
    );
  });

  it('needs type bearer or none for bearer keys (a stored token implies no type)', () => {
    expect(profileAuthProblem('p', { tokenEnv: 'X' })).toBe(
      'profile "p" has bearer token keys (tokenEnv) but its auth.type is not set; set "type": "bearer"',
    );
    expect(profileAuthProblem('p', { type: 'basic', token: 't' })).toBe(
      'profile "p" has bearer token keys (token) but its auth.type is basic; set "type": "bearer"',
    );
    expect(profileAuthProblem('p', { type: 'oauth', token: 't' })).toBe(
      'profile "p" has bearer token keys (token) but its auth.type is oauth; set "type": "bearer"',
    );
    // unknown types are left to resolution, which names the supported ones
    expect(profileAuthProblem('p', { type: 'digest', token: 't' })).toBeUndefined();
  });

  it('names the type rule of the other families for type bearer', () => {
    expect(profileAuthProblem('p', { type: 'bearer', username: 'u' })).toBe(
      'profile "p" has Basic auth keys (username) but its auth.type is bearer; set "type": "basic"',
    );
    expect(profileAuthProblem('p', { type: 'bearer', issuer: 'https://x' })).toBe(
      'profile "p" has OAuth keys (issuer) but its auth.type is bearer; set "type": "oauth"',
    );
  });
});

describe('hasBearerKeys', () => {
  it('tells whether a stored auth object has a bearer token setting', () => {
    expect(hasBearerKeys(undefined)).toBe(false);
    expect(hasBearerKeys({ type: 'bearer' })).toBe(false);
    expect(hasBearerKeys({ type: 'none', tokenEnv: 'X' })).toBe(true);
    expect(hasBearerKeys({ token: 't' })).toBe(true);
  });
});
