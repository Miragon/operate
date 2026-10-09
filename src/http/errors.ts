/** Maps HTTP error responses (and the engine's ExceptionDto) to OperateError with hints. */

import { type ErrorCode, OperateError } from '../errors.js';
import { compact, isRecord, parseJson } from '../util.js';
import type { HttpResponse } from './types.js';

interface EngineError {
  readonly type?: string;
  readonly message?: string;
  readonly code?: number;
  readonly data?: Record<string, unknown>;
}

const decoder = new TextDecoder();

function jsonOf(body: Uint8Array): unknown {
  try {
    return parseJson(decoder.decode(body));
  } catch {
    return undefined;
  }
}

/** Longest excerpt of a text error body that is kept. */
const MAX_TEXT_LENGTH = 500;

/** The media type without parameters, in lower case (media types are case-insensitive). */
function mediaType(contentType: string): string {
  return contentType.replace(/;.*/s, '').trim().toLowerCase();
}

/**
 * A plain text error body as the message, shortened: the REST API answers body deserialization
 * errors with Jackson's explanation as text/plain. HTML error pages of servlet containers and
 * proxies are left out; their status line says enough.
 */
function textError(response: HttpResponse): EngineError | undefined {
  const type = mediaType(response.contentType);
  if (!type.startsWith('text/') || type === 'text/html') return undefined;
  const text = decoder.decode(response.body).trim();
  if (text === '') return undefined;
  return {
    message: text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text,
  };
}

/**
 * Reads the engine's ExceptionDto (`type`, `message`, `code` and further details) from a JSON body,
 * or the message of a plain text body.
 */
export function parseEngineError(response: HttpResponse): EngineError | undefined {
  if (!mediaType(response.contentType).includes('json')) return textError(response);
  const parsed = jsonOf(response.body);
  if (!isRecord(parsed)) return undefined;
  const { type, message, code, ...data } = parsed;
  return compact({
    type: typeof type === 'string' ? type : undefined,
    message: typeof message === 'string' ? message : undefined,
    code: typeof code === 'number' ? code : undefined,
    data: Object.keys(data).length > 0 ? data : undefined,
  });
}

export function errorCodeForStatus(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  return status >= 500 ? 'HTTP_SERVER_ERROR' : 'HTTP_CLIENT_ERROR';
}

/**
 * True when a 404 comes from routing rather than from the engine: no ExceptionDto at all (a servlet
 * container or Spring Boot error page at the wrong root) or the JAX-RS `NotFoundException` the REST
 * API reports for unknown paths. Missing resources are reported as `InvalidRequestException`.
 */
function isUnknownEndpoint(engine: EngineError | undefined): boolean {
  return engine?.type === undefined || engine.type === 'NotFoundException';
}

/**
 * The CLI command that sent a request, so that hints name concrete commands instead of
 * placeholders. `command` is `<group> <command>`, `listCommand` the group's `list` command if any.
 */
export interface CommandRef {
  readonly command: string;
  readonly listCommand?: string;
}

function notFoundHint(ref: CommandRef | undefined): string {
  if (ref === undefined) {
    return 'Check the id or key. List existing resources with the `list` command of the group.';
  }
  if (ref.listCommand === undefined) {
    return `Check the id or key; \`operate describe ${ref.command}\` explains the arguments.`;
  }
  return `Check the id or key. List the existing ones with \`operate ${ref.listCommand}\`.`;
}

/**
 * How the REST API reports an engine name it does not serve on an engine scoped path: Camunda 7
 * and Operaton answer 400 `No process engine available`, CIB seven 404 `Process engine x not
 * available`.
 */
const UNKNOWN_ENGINE = /^(?:No process engine|Process engine \S+ not) available$/;

/** Built-in Basic auth, the planned fix for most 401s. */
const BASIC_AUTH_ISSUE = 'https://github.com/Miragon/operate/issues/1';

const HINTS = {
  unauthenticated: `The engine requires authentication and operate sent no credentials (the built-in auth type is none). Pass them as a header: -H 'Authorization: Basic <base64 of user:password>', OPERATE_HEADERS, or store it with \`operate config set <profile> --header 'Authorization: ...'\`. Built-in Basic auth is planned: ${BASIC_AUTH_ISSUE}.`,
  rejected:
    'The engine rejected the credentials of the Authorization header (from -H, OPERATE_HEADERS or the profile headers; `operate config show` shows which). Check user and password or the token.',
  403: 'The user is authenticated but lacks the authorization for this operation.',
  server:
    'The engine could not process the request; the engine message says why. Camunda 7 engines also report rule violations (task already claimed, dependent instances, ...) as 500, so retrying unchanged rarely helps.',
  engine:
    'The process engine named by --engine (or OPERATE_ENGINE, or the profile setting engine) does not exist. Run `operate ping` to list the engines of the REST API.',
  endpoint:
    'The endpoint does not exist. Check that the URL points to the REST API root, e.g. http://localhost:8080/engine-rest, and the engine name (--engine).',
  queryParam:
    'A query parameter has a value the engine cannot read, e.g. a number beyond the int32 range or a malformed date; the engine reports this as 404. Check the option values.',
} as const;

/**
 * JAX-RS answers a query parameter it cannot convert (`maxResults=abc`) with 404 and this type.
 * Nothing is missing, so it is reported as a rejected request (exit 6), not as NOT_FOUND.
 */
const QUERY_PARAM_EXCEPTION = 'QueryParamException';

/** The request as far as the hints need it; `headers` tell whether credentials were sent. */
export interface FailedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

function sentCredentials(request: FailedRequest): boolean {
  return Object.keys(request.headers ?? {}).some((name) => name.toLowerCase() === 'authorization');
}

function clientErrorHint(ref: CommandRef | undefined): string {
  return `The engine rejected the request. Check parameters and body with \`operate describe ${ref?.command ?? '<group> <command>'}\`.`;
}

/** Hints that follow from the status alone. */
function statusHint(status: number, request: FailedRequest): string | undefined {
  if (status === 401) return sentCredentials(request) ? HINTS.rejected : HINTS.unauthenticated;
  if (status === 403) return HINTS[403];
  return status >= 500 ? HINTS.server : undefined;
}

/** Hints for engine errors that mean something else than their status suggests. */
function engineHint(engine: EngineError | undefined): string | undefined {
  if (engine?.message !== undefined && UNKNOWN_ENGINE.test(engine.message)) return HINTS.engine;
  return engine?.type === QUERY_PARAM_EXCEPTION ? HINTS.queryParam : undefined;
}

function hintFor(
  status: number,
  engine: EngineError | undefined,
  request: FailedRequest,
  ref?: CommandRef,
): string {
  const hint = statusHint(status, request) ?? engineHint(engine);
  if (hint !== undefined) return hint;
  if (status !== 404) return clientErrorHint(ref);
  return isUnknownEndpoint(engine) ? HINTS.endpoint : notFoundHint(ref);
}

function codeFor(status: number, engine: EngineError | undefined): ErrorCode {
  return engine?.type === QUERY_PARAM_EXCEPTION ? 'HTTP_CLIENT_ERROR' : errorCodeForStatus(status);
}

/** `HTTP <status> <text>: <engine message>`; a message that only repeats the status line is dropped. */
function errorMessage(response: HttpResponse, engine: EngineError | undefined): string {
  const summary = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const detail = engine?.message;
  return detail === undefined || detail === '' || detail === summary
    ? summary
    : `${summary}: ${detail}`;
}

export function httpError(
  response: HttpResponse,
  request: FailedRequest,
  ref?: CommandRef,
): OperateError {
  const engine = parseEngineError(response);
  return new OperateError(codeFor(response.status, engine), errorMessage(response, engine), {
    status: response.status,
    request: { method: request.method, url: request.url },
    hint: hintFor(response.status, engine, request, ref),
    ...compact({
      engineType: engine?.type,
      engineMessage: engine?.message,
      engineCode: engine?.code,
      data: engine?.data,
    }),
  });
}

/** Location of a redirect without query and fragment (they may carry tokens), absolute. */
function redirectTarget(response: HttpResponse, url: string): string | undefined {
  const location = Object.entries(response.headers).find(
    ([name]) => name.toLowerCase() === 'location',
  )?.[1];
  if (location === undefined || !URL.canParse(location, url)) return undefined;
  const target = new URL(location, url);
  return `${target.origin}${target.pathname}`;
}

/**
 * A 3xx answer. operate never follows redirects: a redirected POST would turn into a GET of a
 * login page that "succeeds", and custom credential headers would travel to the other origin.
 */
export function redirectError(response: HttpResponse, request: FailedRequest): OperateError {
  const target = redirectTarget(response, request.url);
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  return new OperateError(
    'HTTP_REDIRECT',
    target === undefined ? `${status}: redirect` : `${status}: redirect to ${target}`,
    {
      status: response.status,
      request: { method: request.method, url: request.url },
      hint: 'operate does not follow redirects. Point --url (OPERATE_URL or the profile url) at the REST API root itself, e.g. https:// when the server redirects from http://. A redirect to a login page means the credentials (headers) are missing or expired.',
    },
  );
}
