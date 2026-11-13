import {
  at,
  finite,
  isFull,
  isRecord,
  items,
  nonEmptyString,
  nonNegative,
  readAll,
  rejectUnknownKeys,
  report,
  RESERVED_KEY,
  type Check,
  type Path,
} from './checks.js';
import type { CanvasDocument } from './document.js';
import { deepFreeze } from './freeze.js';
import type { Bounds } from './geometry/bounds.js';
import { coordinateOverflow, textLengthOverflow, type CanvasLimits } from './limits.js';
import {
  fail,
  limitError,
  notFoundError,
  ok,
  validationError,
  type Result,
  type ValidationIssue,
} from './result.js';
import { readBoardInput } from './boards.js';
import {
  readShapeInput,
  type ArrowInput,
  type BezierInput,
  type BoardInput,
  type BoardNode,
  type CircleInput,
  type BraceInput,
  type ChevronInput,
  type CrossInput,
  type DiamondInput,
  type EllipseInput,
  type InkInput,
  type LineInput,
  type PolygonInput,
  type StickyInput,
  type RectangleInput,
  type ShapeNode,
  type SquareInput,
  type TextInput,
  type TriangleInput,
} from './shapes.js';

/**
 * Estado efêmero de um gesto em andamento, compartilhado por quem trata o input e por quem
 * desenha. Não faz parte do documento nem do snapshot, não entra no histórico e não avança a
 * revisão. As consultas só o consideram quando pedem.
 */
export interface CanvasPreview {
  /**
   * Geometria provisória de nós que existem, por ID. Vale no lugar do nó, na mesma posição
   * visual. O objeto não herda de `Object.prototype`.
   */
  readonly updates: Readonly<Record<string, ShapeNode | BoardNode>>;
  /** Nós que ainda não existem, do fundo para a frente, à frente de todo o documento. */
  readonly additions: readonly (ShapeNode | BoardNode)[];
  /** Retângulo de seleção em andamento, em coordenadas de mundo. */
  readonly marquee: Bounds | null;
}

export interface PreviewRectangle extends RectangleInput {
  readonly id: string;
}

export interface PreviewSquare extends SquareInput {
  readonly id: string;
}

export interface PreviewEllipse extends EllipseInput {
  readonly id: string;
}

export interface PreviewCircle extends CircleInput {
  readonly id: string;
}

export interface PreviewDiamond extends DiamondInput {
  readonly id: string;
}

export interface PreviewTriangle extends TriangleInput {
  readonly id: string;
}

export interface PreviewPolygon extends PolygonInput {
  readonly id: string;
}

export interface PreviewCross extends CrossInput {
  readonly id: string;
}

export interface PreviewBrace extends BraceInput {
  readonly id: string;
}

export interface PreviewChevron extends ChevronInput {
  readonly id: string;
}

export interface PreviewSticky extends StickyInput {
  readonly id: string;
}

export interface PreviewInk extends InkInput {
  readonly id: string;
}

export interface PreviewBezier extends BezierInput {
  readonly id: string;
}

export interface PreviewLine extends LineInput {
  readonly id: string;
}

export interface PreviewText extends TextInput {
  readonly id: string;
}

export interface PreviewArrow extends ArrowInput {
  readonly id: string;
}

/**
 * O preview de um board: como o de `shape.create`, com o ID obrigatório. Não tem filhos: em
 * `additions` ele é pintado sem fundo (só a borda e o título), e em `updates` vale a geometria
 * provisória do board do documento.
 */
export interface PreviewBoard extends BoardInput {
  readonly id: string;
}

/** Shape de preview: como o de `shape.create`, com o ID obrigatório. */
export type PreviewShape =
  | PreviewRectangle
  | PreviewSquare
  | PreviewEllipse
  | PreviewCircle
  | PreviewDiamond
  | PreviewTriangle
  | PreviewPolygon
  | PreviewCross
  | PreviewChevron
  | PreviewBrace
  | PreviewSticky
  | PreviewInk
  | PreviewLine
  | PreviewBezier
  | PreviewText
  | PreviewArrow
  | PreviewBoard;

/** Preview a definir. Substitui o anterior por inteiro; o que não for dado fica vazio. */
export interface PreviewInput {
  /** Geometria provisória de nós existentes. Cada um mantém o tipo do nó original. */
  readonly updates?: readonly PreviewShape[] | undefined;
  /** Nós que ainda não existem, com IDs que o documento não usa. */
  readonly additions?: readonly PreviewShape[] | undefined;
  readonly marquee?: Bounds | null | undefined;
}

const bounds: Check<Bounds> = (value, path, issues) => {
  if (!isRecord(value)) {
    report(issues, path, 'type', 'must be an object with x, y, width and height');
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  rejectUnknownKeys(value, ['x', 'y', 'width', 'height'], path, issues);
  return readAll(
    value,
    { x: finite, y: finite, width: nonNegative, height: nonNegative },
    path,
    issues,
  );
};

function documentHasId(document: CanvasDocument, id: string): boolean {
  return (
    id === document.id ||
    document.nodes[id] !== undefined ||
    document.layers.some((layer) => layer.id === id)
  );
}

/**
 * Lê uma lista de shapes de preview. `seen` junta os IDs já usados no preview inteiro, e
 * `confer` confere contra o documento cada shape que passou, com o caminho que ele tem na
 * lista dada.
 */
function readShapes(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
  seen: Set<string>,
  confer: (shape: ShapeNode | BoardNode, path: Path) => void,
): (ShapeNode | BoardNode)[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(issues, path, 'type', 'must be an array of shapes');
    return [];
  }
  const shapes: (ShapeNode | BoardNode)[] = [];
  for (const [index, item] of items(value)) {
    if (isFull(issues)) break;
    const itemPath = at(path, index);
    if (!isRecord(item)) {
      report(issues, itemPath, 'type', 'must be an object');
      continue;
    }
    const before = issues.length;
    const build =
      item['type'] === 'board'
        ? readBoardInput(item, itemPath, issues)
        : readShapeInput(item, itemPath, issues);
    const idPath = at(itemPath, 'id');
    const beforeId = issues.length;
    const id = nonEmptyString(item['id'], idPath, issues);
    // Um ID recusado não entra na conta dos repetidos: o marcador dele casaria com o do
    // próximo ID recusado.
    if (issues.length === beforeId) {
      if (id === RESERVED_KEY) {
        report(issues, idPath, 'reserved-id', `must not be "${RESERVED_KEY}"`);
      } else if (seen.has(id)) {
        report(issues, idPath, 'duplicate-id', 'is already used in this preview');
      }
      seen.add(id);
    }
    if (build !== undefined && issues.length === before) {
      const shape = build(id);
      confer(shape, itemPath);
      shapes.push(shape);
    }
  }
  return shapes;
}

function toRecord(
  shapes: readonly (ShapeNode | BoardNode)[],
): Record<string, ShapeNode | BoardNode> {
  const record = Object.create(null) as Record<string, ShapeNode | BoardNode>;
  for (const shape of shapes) record[shape.id] = shape;
  return record;
}

function build(
  updates: readonly (ShapeNode | BoardNode)[],
  additions: readonly (ShapeNode | BoardNode)[],
  marquee: Bounds | null,
): CanvasPreview | null {
  if (updates.length === 0 && additions.length === 0 && marquee === null) return null;
  return deepFreeze({ updates: toRecord(updates), additions, marquee });
}

/**
 * Confere um preview pedido contra o documento e os limites do canvas, e devolve a forma
 * guardada, com cópias congeladas. `null`, ou um preview sem nada, é o preview limpo.
 *
 * Os limites são os do documento: um shape de preview cabe nas mesmas coordenadas que um nó, e
 * os nós novos, somados aos `nodeCount` nós que o documento já tem, cabem no máximo de nós. O
 * que o preview mostra é o que um comando poderia criar.
 */
export function readPreview(
  input: unknown,
  document: CanvasDocument,
  nodeCount: number,
  limits: Required<CanvasLimits>,
): Result<CanvasPreview | null> {
  if (input === null) return ok(null);
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    report(issues, undefined, 'type', 'preview must be an object or null');
    return fail(validationError(issues));
  }
  rejectUnknownKeys(input, ['updates', 'additions', 'marquee'], undefined, issues);
  const seen = new Set<string>();
  const updates = readShapes(
    input['updates'],
    at(undefined, 'updates'),
    issues,
    seen,
    (shape, path) => {
      const original = document.nodes[shape.id];
      if (original !== undefined && original.type !== shape.type) {
        report(issues, at(path, 'type'), 'type', `must be ${original.type}`);
      }
    },
  );
  const additions = readShapes(
    input['additions'],
    at(undefined, 'additions'),
    issues,
    seen,
    (shape, path) => {
      if (documentHasId(document, shape.id)) {
        report(issues, at(path, 'id'), 'duplicate-id', 'is already used in this document');
      }
    },
  );
  const marquee =
    input['marquee'] === undefined || input['marquee'] === null
      ? null
      : bounds(input['marquee'], at(undefined, 'marquee'), issues);
  if (issues.length > 0) return fail(validationError(issues));

  const missing = updates.find((shape) => document.nodes[shape.id] === undefined);
  if (missing !== undefined) return fail(notFoundError('node', missing.id));

  const total = nodeCount + additions.length;
  if (total > limits.maxNodes) return fail(limitError('nodes', limits.maxNodes, total));
  for (const shape of [...updates, ...additions]) {
    const overflow = coordinateOverflow(shape, limits.maxCoordinate);
    if (overflow !== undefined) {
      return fail(limitError('coordinate', limits.maxCoordinate, overflow));
    }
    const textOverflow = textLengthOverflow(shape, limits.maxTextLength);
    if (textOverflow !== undefined) {
      return fail(limitError('text', limits.maxTextLength, textOverflow));
    }
  }
  return ok(build(updates, additions, marquee));
}

/**
 * Tira do preview o que o documento novo invalidou: a geometria provisória de um nó que
 * deixou de existir ou mudou de tipo, e o nó novo cujo ID passou a existir. Sem nada a tirar,
 * devolve o mesmo preview.
 */
export function prunePreview(
  preview: CanvasPreview | null,
  document: CanvasDocument,
): CanvasPreview | null {
  if (preview === null) return null;
  const current = Object.values(preview.updates);
  const updates = current.filter((shape) => document.nodes[shape.id]?.type === shape.type);
  const additions = preview.additions.filter((shape) => !documentHasId(document, shape.id));
  if (updates.length === current.length && additions.length === preview.additions.length) {
    return preview;
  }
  return build(updates, additions, preview.marquee);
}
