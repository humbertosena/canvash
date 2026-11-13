import type { Result, ValidationIssue } from '@canvash/core';

export type PersistenceErrorCode =
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_VERSION'
  | 'STORAGE_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'CONFLICT'
  | 'LIMIT_EXCEEDED';

export interface PersistenceError {
  readonly code: PersistenceErrorCode;
  readonly message: string;
  readonly issues?: readonly ValidationIssue[];
  readonly details?: unknown;
}

export function ok<T>(value: T): Result<T, PersistenceError> {
  return { ok: true, value };
}

export function err<T = never>(
  code: PersistenceErrorCode,
  message: string,
  extra?: { issues?: readonly ValidationIssue[]; details?: unknown },
): Result<T, PersistenceError> {
  return {
    ok: false,
    error: {
      code,
      message,
      issues: extra?.issues,
      details: extra?.details,
    },
  };
}
