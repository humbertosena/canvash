import {
  at,
  boolean,
  finite,
  isFull,
  isRecord,
  items,
  nonEmptyString,
  readAll,
  rejectUnknownKeys,
  report,
  type Check,
  type Path,
} from './checks.js';
import type { CanvasDocument } from './document.js';
import { clampZoom, type Viewport } from './geometry/transform.js';
import type { Placements } from './placement.js';
import {
  fail,
  notFoundError,
  ok,
  validationError,
  type Result,
  type ValidationIssue,
} from './result.js';

/**
 * Identificador de ferramenta. O core só guarda qual está ativa: o conjunto de ferramentas
 * pertence a quem trata o input. `select` é a inicial.
 */
export type ToolId = string;

/**
 * Estado de uma sessão de edição. Não faz parte do documento, não entra no histórico e mudar
 * qualquer campo dele não avança a revisão.
 */
export interface SessionState {
  /** Nós selecionados, na ordem em que foram dados, sem repetição. Todos existem e são visíveis. */
  readonly selectedIds: readonly string[];
  readonly viewport: Viewport;
  readonly activeTool: ToolId;
  /** Com `true`, comandos, undo e redo são recusados; seleção, pan e zoom continuam. */
  readonly readOnly: boolean;
}

export const INITIAL_SESSION: SessionState = Object.freeze({
  selectedIds: Object.freeze([]),
  viewport: Object.freeze({ x: 0, y: 0, zoom: 1 }),
  activeTool: 'select',
  readOnly: false,
});

/** Diz se o nó existe e está visível de fato: ele e a camada dele. */
function isVisible(document: CanvasDocument, placements: Placements, id: string): boolean {
  const node = document.nodes[id];
  return node !== undefined && node.visible && placements.get(id)?.layer.visible === true;
}

/**
 * Confere uma seleção pedida: lista de IDs de nós que existem e estão visíveis. Devolve a
 * lista sem repetições, na ordem dada.
 */
export function readSelection(
  value: unknown,
  document: CanvasDocument,
  placements: Placements,
): Result<readonly string[]> {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(value)) {
    report(issues, undefined, 'type', 'selection must be an array of node IDs');
    return fail(validationError(issues));
  }
  const given: string[] = [];
  for (const [index, id] of items(value)) {
    if (isFull(issues)) break;
    given.push(nonEmptyString(id, at(undefined, index), issues));
  }
  if (issues.length > 0) return fail(validationError(issues));

  const ids = [...new Set(given)];
  const missing = ids.find((id) => document.nodes[id] === undefined);
  if (missing !== undefined) return fail(notFoundError('node', missing));
  for (const id of ids) {
    if (isFull(issues)) break;
    if (!isVisible(document, placements, id)) {
      report(issues, at(undefined, given.indexOf(id)), 'not-visible', 'must be a visible node');
    }
  }
  return issues.length > 0 ? fail(validationError(issues)) : ok(ids);
}

/** Tira da seleção o que deixou de existir ou de estar visível. Sem nada a tirar, devolve a mesma lista. */
export function pruneSelection(
  selectedIds: readonly string[],
  document: CanvasDocument,
  placements: Placements,
): readonly string[] {
  const kept = selectedIds.filter((id) => isVisible(document, placements, id));
  return kept.length === selectedIds.length ? selectedIds : kept;
}

const zoom: Check<number> = (value, path, issues) => {
  const before = issues.length;
  const number = finite(value, path, issues);
  if (issues.length === before && number <= 0) {
    report(issues, path, 'range', 'must be greater than 0');
  }
  return number;
};

/**
 * Confere um viewport pedido e leva o zoom para dentro da faixa aceita. `path` é onde o
 * viewport está dentro da entrada conferida.
 */
export function readViewport(value: unknown, path?: Path): Result<Viewport> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    report(issues, path, 'type', 'viewport must be an object with x, y and zoom');
    return fail(validationError(issues));
  }
  rejectUnknownKeys(value, ['x', 'y', 'zoom'], path, issues);
  const viewport = readAll(value, { x: finite, y: finite, zoom }, path, issues);
  if (issues.length > 0) return fail(validationError(issues));
  return ok({ ...viewport, zoom: clampZoom(viewport.zoom) });
}

function readValue<T>(value: unknown, check: Check<T>): Result<T> {
  const issues: ValidationIssue[] = [];
  const checked = check(value, undefined, issues);
  return issues.length > 0 ? fail(validationError(issues)) : ok(checked);
}

export function readTool(value: unknown): Result<ToolId> {
  return readValue(value, nonEmptyString);
}

export function readReadOnly(value: unknown): Result<boolean> {
  return readValue(value, boolean);
}
