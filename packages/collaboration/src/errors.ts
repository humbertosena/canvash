export type Result<T = void, E = CollaborationError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export type CollaborationErrorCode =
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_VERSION'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'LIMIT_EXCEEDED'
  | 'ROOM_EPOCH_MISMATCH'
  | 'PENDING_CHANGES'
  | 'STORAGE_UNAVAILABLE'
  | 'CONNECTION_FAILED'
  | 'DISCONNECTED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED';

export interface CollaborationError {
  readonly code: CollaborationErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = CollaborationError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function createCollaborationError(
  code: CollaborationErrorCode,
  message: string,
  details?: unknown,
): CollaborationError {
  return { code, message, details };
}
