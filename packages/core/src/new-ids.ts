import { nonEmptyString, report, RESERVED_KEY, type Path } from './checks.js';
import type { Draft } from './draft.js';
import { nextId, type IdGenerator } from './ids.js';
import type { ValidationIssue } from './result.js';

/** Confere um ID escolhido pelo chamador para um item novo do documento. */
export function readNewId(
  draft: Draft,
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string {
  const before = issues.length;
  const id = nonEmptyString(value, path, issues);
  if (issues.length > before) return id;
  if (id === RESERVED_KEY) {
    report(issues, path, 'reserved-id', `must not be "${RESERVED_KEY}"`);
  } else if (draft.hasId(id)) {
    report(issues, path, 'duplicate-id', 'is already used in this document');
  }
  return id;
}

/**
 * Gera o ID de um item novo.
 *
 * @throws {TypeError} Se o gerador devolver um ID inválido ou já usado no documento.
 */
export function generateNewId(draft: Draft, generateId: IdGenerator): string {
  const id = nextId(generateId);
  if (draft.hasId(id)) {
    throw new TypeError('generateId must return a different ID on each call');
  }
  return id;
}
