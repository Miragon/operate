import { describe, expect, it } from 'vitest';
import { previewRequest } from './preview.js';

describe('previewRequest', () => {
  it('copies method, url and headers without a body', () => {
    const headers = { Accept: 'application/json' };
    const preview = previewRequest({ method: 'GET', url: 'http://h/x', headers });
    expect(preview).toEqual({ method: 'GET', url: 'http://h/x', headers });
    expect(preview).not.toHaveProperty('body');
    expect(preview.headers).not.toBe(headers);
  });

  it('parses JSON bodies', () => {
    expect(
      previewRequest({ method: 'POST', url: 'u', headers: {}, body: '{"a":[1,{"b":null}]}' }).body,
    ).toEqual({ a: [1, { b: null }] });
  });

  it('keeps bodies that are not JSON as text', () => {
    expect(previewRequest({ method: 'POST', url: 'u', headers: {}, body: 'plain' }).body).toBe(
      'plain',
    );
    expect(previewRequest({ method: 'POST', url: 'u', headers: {}, body: '' }).body).toBe('');
  });

  it('summarizes multipart parts', () => {
    const form = new FormData();
    form.append('deployment-name', 'app');
    form.append('order.bpmn', new Blob(['<bpmn/>']), 'order.bpmn');
    form.append('enable-duplicate-filtering', 'true');
    expect(previewRequest({ method: 'POST', url: 'u', headers: {}, body: form }).body).toEqual([
      { name: 'deployment-name', value: 'app' },
      { name: 'order.bpmn', fileName: 'order.bpmn', bytes: 7 },
      { name: 'enable-duplicate-filtering', value: 'true' },
    ]);
  });

  it('previews an empty form as no parts', () => {
    expect(
      previewRequest({ method: 'POST', url: 'u', headers: {}, body: new FormData() }).body,
    ).toEqual([]);
  });
});
