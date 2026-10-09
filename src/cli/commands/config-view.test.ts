import { describe, expect, it } from 'vitest';
import type { ConfigView } from '../../config/edit.js';
import { maskedView, profileView, showHeader, showRows } from './config-view.js';

const VIEW: ConfigView = {
  configFile: '/c.json',
  profile: null,
  values: {
    url: { value: 'http://h/rest', source: 'default' },
    engine: { value: null, source: 'default' },
    auth: { value: 'none', source: 'default' },
    output: { value: 'json', source: 'env' },
    timeout: { value: 30000, source: 'default' },
    headers: { value: { Cookie: 'a=b', 'X-A': '1' }, source: 'flag' },
    readOnly: { value: false, source: 'default' },
  },
};

describe('profileView', () => {
  it('shows a stored profile with name, default flag and masked headers', () => {
    const file = {
      defaultProfile: 'a',
      profiles: { a: { url: 'http://a', headers: { Authorization: 'Bearer t' } }, b: {} },
    };
    expect(profileView(file, 'a')).toEqual({
      name: 'a',
      default: true,
      url: 'http://a',
      headers: { Authorization: 'Bearer ***' },
    });
    expect(profileView(file, 'b')).toEqual({ name: 'b', default: false });
    expect(profileView(file, 'missing')).toEqual({ name: 'missing', default: false });
  });
});

describe('maskedView', () => {
  it('masks header values unless secrets are shown', () => {
    expect(maskedView(VIEW, false).values.headers).toEqual({
      value: { Cookie: '***', 'X-A': '1' },
      source: 'flag',
    });
    expect(maskedView(VIEW, true)).toEqual(VIEW);
    expect(maskedView(VIEW, false).values.url).toBe(VIEW.values.url);
  });
});

describe('showRows and showHeader', () => {
  it('lists KEY VALUE SOURCE rows in order', () => {
    expect(showRows(VIEW)).toEqual([
      { KEY: 'url', VALUE: 'http://h/rest', SOURCE: 'default' },
      { KEY: 'engine', VALUE: null, SOURCE: 'default' },
      { KEY: 'auth', VALUE: 'none', SOURCE: 'default' },
      { KEY: 'output', VALUE: 'json', SOURCE: 'env' },
      { KEY: 'timeout', VALUE: 30000, SOURCE: 'default' },
      { KEY: 'headers', VALUE: { Cookie: 'a=b', 'X-A': '1' }, SOURCE: 'flag' },
      { KEY: 'readOnly', VALUE: false, SOURCE: 'default' },
    ]);
  });

  it('names file and profile', () => {
    expect(showHeader(VIEW)).toBe('Config file: /c.json\nProfile: (none)\n\n');
    expect(showHeader({ ...VIEW, profile: 'p' })).toBe('Config file: /c.json\nProfile: p\n\n');
  });
});
