/**
 * Sends a prepared request and decodes the response; HTTP error statuses become OperateErrors
 * whose hints name `ref`, the command that sent the request, when given, and the user whose Basic
 * auth credentials were sent.
 */

import { type ClientOptions, send } from '../http/client.js';
import { type CommandRef, httpError, redirectError } from '../http/errors.js';
import type { HttpRequest } from '../http/types.js';
import { decodeResponse } from './decode.js';
import { previewRequest } from './preview.js';
import type { OperationResult } from './result.js';

export async function sendRequest(
  request: HttpRequest,
  client: ClientOptions,
  ref?: CommandRef,
): Promise<OperationResult> {
  const response = await send(request, client);
  if (response.status >= 400) {
    const { principal, off } = client.auth;
    throw httpError(response, { ...request, principal, authOff: off }, ref);
  }
  if (response.status >= 300) throw redirectError(response, request);
  return decodeResponse(response, previewRequest(request));
}
