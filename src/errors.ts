/** Error type and exit codes shared by all layers. */

export const EXIT_CODES = {
  ok: 0,
  internal: 1,
  usage: 2,
  config: 3,
  auth: 4,
  notFound: 5,
  client: 6,
  server: 7,
  network: 8,
} as const;

export type ErrorCode =
  | 'USAGE'
  | 'CONFIG'
  | 'READ_ONLY'
  | 'CONFIRMATION_REQUIRED'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'HTTP_CLIENT_ERROR'
  | 'HTTP_SERVER_ERROR'
  | 'HTTP_REDIRECT'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'INTERNAL';

const EXIT_CODE_BY_ERROR: Readonly<Record<ErrorCode, number>> = {
  USAGE: EXIT_CODES.usage,
  CONFIG: EXIT_CODES.config,
  READ_ONLY: EXIT_CODES.usage,
  CONFIRMATION_REQUIRED: EXIT_CODES.usage,
  VALIDATION: EXIT_CODES.usage,
  UNAUTHORIZED: EXIT_CODES.auth,
  FORBIDDEN: EXIT_CODES.auth,
  NOT_FOUND: EXIT_CODES.notFound,
  HTTP_CLIENT_ERROR: EXIT_CODES.client,
  HTTP_SERVER_ERROR: EXIT_CODES.server,
  // the URL (or the credentials) of the configuration are wrong, see redirectError
  HTTP_REDIRECT: EXIT_CODES.config,
  NETWORK: EXIT_CODES.network,
  TIMEOUT: EXIT_CODES.network,
  INTERNAL: EXIT_CODES.internal,
};

export interface ErrorDetails {
  readonly hint?: string;
  readonly status?: number;
  /** Exception class reported by the engine, e.g. `InvalidRequestException`. */
  readonly engineType?: string;
  readonly engineMessage?: string;
  readonly engineCode?: number;
  readonly request?: { readonly method: string; readonly url: string };
  /** Extra structured data from the engine error (validation reports and similar). */
  readonly data?: unknown;
}

export class OperateError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OperateError';
    this.code = code;
    this.details = details;
  }

  get exitCode(): number {
    return EXIT_CODE_BY_ERROR[this.code];
  }
}

export function usageError(message: string, hint?: string): OperateError {
  return new OperateError('USAGE', message, hint === undefined ? {} : { hint });
}
