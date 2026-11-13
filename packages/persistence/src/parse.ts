import {
  SCHEMA_VERSION,
  validateDocument,
  type CanvasDocument,
  type Result,
  type ValidationIssue,
} from '@canvash/core';
import { err, ok, type PersistenceError } from './errors.js';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MiB (IO-02)

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Reviver seguro para JSON.parse que impede prototype pollution (IO-06).
 */
function safeJsonReviver(key: string, value: unknown): unknown {
  if (FORBIDDEN_KEYS.has(key)) {
    throw new TypeError(`Forbidden key "${key}" detected in document JSON.`);
  }
  return value;
}

/**
 * Executa migrações sequenciais caso o documento pertença a versões legadas publicadas.
 */
function applyMigrations(
  rawDoc: Record<string, unknown>,
): Result<Record<string, unknown>, PersistenceError> {
  const version = rawDoc['schemaVersion'];

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return err('INVALID_DOCUMENT', 'Document schemaVersion must be a positive integer.');
  }

  if (version > SCHEMA_VERSION) {
    return err(
      'UNSUPPORTED_VERSION',
      `Document schemaVersion ${version} is newer than supported version ${SCHEMA_VERSION}.`,
    );
  }

  // Atualmente SCHEMA_VERSION é 1; futuras migrações v1 -> v2 entrarão sequencialmente aqui.
  return ok(rawDoc);
}

/**
 * Faz o parse e a validação estrita de um documento Canvash (IO-01, IO-02, IO-06).
 *
 * Suporta string JSON, Uint8Array UTF-8 ou objeto já parseado.
 * Aplica limite de 20 MiB, previne prototype pollution, executa migrações e
 * valida integridade estrutural e referencial do documento.
 */
export function parseDocument(input: unknown): Result<CanvasDocument, PersistenceError> {
  let parsedObject: unknown = input;

  if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_DOCUMENT_BYTES) {
      return err(
        'LIMIT_EXCEEDED',
        `Document payload size (${input.byteLength} bytes) exceeds limit of ${MAX_DOCUMENT_BYTES} bytes.`,
      );
    }
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const text = decoder.decode(input);
      parsedObject = JSON.parse(text, safeJsonReviver);
    } catch (error) {
      return err(
        'INVALID_DOCUMENT',
        'Failed to parse binary document payload as valid UTF-8 JSON.',
        {
          details: error,
        },
      );
    }
  } else if (typeof input === 'string') {
    // Estimativa e verificação de bytes
    if (input.length > MAX_DOCUMENT_BYTES) {
      return err(
        'LIMIT_EXCEEDED',
        `Document string length exceeds limit of ${MAX_DOCUMENT_BYTES} bytes.`,
      );
    }
    const byteLength = new TextEncoder().encode(input).byteLength;
    if (byteLength > MAX_DOCUMENT_BYTES) {
      return err(
        'LIMIT_EXCEEDED',
        `Document byte length (${byteLength} bytes) exceeds limit of ${MAX_DOCUMENT_BYTES} bytes.`,
      );
    }

    try {
      parsedObject = JSON.parse(input, safeJsonReviver);
    } catch (error) {
      return err('INVALID_DOCUMENT', 'Failed to parse JSON string.', { details: error });
    }
  }

  if (!parsedObject || typeof parsedObject !== 'object' || Array.isArray(parsedObject)) {
    return err('INVALID_DOCUMENT', 'Document root must be a non-null object.');
  }

  // Verifica chaves perigosas em objeto recebido diretamente
  const checkForbiddenKeys = (obj: unknown): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) return true;
      if (checkForbiddenKeys((obj as Record<string, unknown>)[key])) return true;
    }
    return false;
  };

  if (checkForbiddenKeys(parsedObject)) {
    return err('INVALID_DOCUMENT', 'Document contains forbidden prototype property keys.');
  }

  const migrationResult = applyMigrations(parsedObject as Record<string, unknown>);
  if (!migrationResult.ok) {
    return migrationResult;
  }

  const validationResult = validateDocument(migrationResult.value);
  if (!validationResult.ok) {
    const error = validationResult.error;
    if (error.code === 'UNSUPPORTED_VERSION') {
      return err('UNSUPPORTED_VERSION', error.message);
    }
    if (error.code === 'LIMIT_EXCEEDED') {
      return err('LIMIT_EXCEEDED', error.message);
    }
    const details = error.details as { issues?: readonly ValidationIssue[] } | undefined;
    return err('INVALID_DOCUMENT', error.message, {
      issues: details?.issues,
      details: error.details,
    });
  }

  return ok(validationResult.value);
}
