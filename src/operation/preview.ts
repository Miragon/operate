/** Request previews for `--dry-run` and results: JSON bodies parsed, multipart parts summarized. */

import type { HttpRequest } from '../http/types.js';
import { parseJson } from '../util.js';
import type { MultipartPartPreview, RequestPreview } from './result.js';

/** The JSON body as value (large integers kept), or the text when it is not JSON. */
function bodyValue(text: string): unknown {
  try {
    return parseJson(text);
  } catch {
    return text;
  }
}

function partsOf(form: FormData): MultipartPartPreview[] {
  return [...form.entries()].map(([name, value]) =>
    typeof value === 'string' ? { name, value } : { name, fileName: value.name, bytes: value.size },
  );
}

export function previewRequest(request: HttpRequest): RequestPreview {
  const preview = { method: request.method, url: request.url, headers: { ...request.headers } };
  if (request.body === undefined) return preview;
  const body = typeof request.body === 'string' ? bodyValue(request.body) : partsOf(request.body);
  return { ...preview, body };
}
