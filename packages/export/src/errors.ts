import type { Result } from '@canvash/core';

export type ExportErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_SCOPE'
  | 'EXPORT_FAILED'
  | 'LIMIT_EXCEEDED'
  | 'UNSUPPORTED_ENVIRONMENT';

/** O `details` de um erro `INVALID_SCOPE`. */
export interface InvalidScopeDetails {
  readonly reason: 'not-found' | 'not-a-board' | 'hidden' | 'malformed';
  /** O ID pedido, quando era uma string não vazia. */
  readonly id?: string;
}

export interface ExportError {
  readonly code: ExportErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export function ok<T>(value: T): Result<T, ExportError> {
  return { ok: true, value };
}

export function err(
  code: ExportErrorCode,
  message: string,
  details?: unknown,
): Result<never, ExportError> {
  return {
    ok: false,
    error: { code, message, details },
  };
}
