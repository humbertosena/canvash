import { isRecord } from './checks.js';
import type { CanvasDocument } from './document.js';
import type { DocumentPatch } from './draft.js';
import {
  boundsUnion,
  shapeBounds,
  type Bounds,
  type ShapeBoundsOptions,
} from './geometry/bounds.js';
import { shapeInsideRect, shapeIntersectsRect } from './geometry/intersect.js';
import { pointInShape } from './geometry/shapes.js';
import { must } from './invariant.js';
import { DEFAULT_LIMITS } from './limits.js';
import type { Placements } from './placement.js';
import type { CanvasPreview } from './preview.js';
import type { BoardNode, Point, ShapeNode } from './shapes.js';
import { createGridIndex, type SpatialIndex } from './spatial-index.js';

/** Tolerância padrão do hit-test, em CSS px. */
const DEFAULT_TOLERANCE = 6;
// Maior folga do hit-test em unidades de mundo. Fica muito acima de qualquer coordenada aceita
// e muito abaixo de onde a soma com a coordenada do ponto deixaria de ser um número finito.
const MAX_WORLD_TOLERANCE = 1e100;
// A caixa de um shape girado e a conta de `pointInShape` arredondam em pontos diferentes, e
// podem divergir em alguns bits na borda. A busca de candidatos ganha essa folga relativa, para
// a caixa nunca descartar o que a forma exata aceita.
const ROUNDING_SLACK = 16 * Number.EPSILON;

/** O que toda consulta espacial precisa dizer. */
export interface PreviewOption {
  /**
   * `true` consulta o que está sendo mostrado: a geometria provisória do preview no lugar da
   * do documento, mais os nós que só existem no preview. `false` consulta só o documento.
   */
  readonly includePreview: boolean;
}

/** Opções de `hitTest` e `hitTestAll`. */
export interface HitTestOptions extends PreviewOption {
  /**
   * Folga em volta do shape, em CSS px; vira distância de mundo dividida pelo zoom atual. O
   * padrão é 6. Valor negativo ou não finito vale como o padrão, e a folga em unidades de
   * mundo não passa de 1e100.
   */
  readonly tolerance?: number | undefined;
  /** Inclui nós bloqueados e nós de camadas bloqueadas. O padrão é `false`. */
  readonly includeLocked?: boolean | undefined;
  /**
   * A área inscrita do texto conta como interior da forma fechada, mesmo sem texto ou sem
   * `label`. O padrão é `false`: sem a opção, só a forma com texto tem a área clicável.
   */
  readonly labelAreas?: boolean | undefined;
}

/** Opções de `queryBounds`. */
export interface QueryBoundsOptions extends PreviewOption {
  /** Inclui nós ocultos e nós de camadas ocultas. O padrão é `false`. */
  readonly includeHidden?: boolean | undefined;
}

/** Opções de `queryMarquee`. */
export interface MarqueeOptions extends PreviewOption {
  /**
   * `contain` devolve só o que cabe inteiro no retângulo; `intersect`, tudo o que o retângulo
   * toca.
   */
  readonly mode: 'contain' | 'intersect';
  /** Inclui nós bloqueados e nós de camadas bloqueadas. O padrão é `false`. */
  readonly includeLocked?: boolean | undefined;
}

/** Opções de `getBounds`. */
export interface BoundsOptions extends PreviewOption, ShapeBoundsOptions {}

/** O que as consultas leem do canvas. */
export interface Scene {
  readonly document: CanvasDocument;
  readonly placements: Placements;
  /** Caixas dos nós do documento. */
  readonly index: SpatialIndex;
  readonly preview: CanvasPreview | null;
  readonly previewIndex: PreviewIndex;
  readonly zoom: number;
}

/** O que as consultas derivam do preview, refeito a cada preview novo. */
export interface PreviewIndex {
  /** Caixas dos shapes do preview. */
  readonly boxes: SpatialIndex;
  /** Posição de cada nó novo na lista `additions`. */
  readonly ranks: Map<string, number>;
}

export function createPreviewIndex(): PreviewIndex {
  return { boxes: createGridIndex(), ranks: new Map() };
}

/** Um nó como a consulta o enxerga: do documento ou do preview. */
interface Candidate {
  readonly id: string;
  readonly node: ShapeNode | BoardNode;
  /** Posição na ordem visual, do fundo para a frente. */
  readonly rank: number;
  readonly visible: boolean;
  readonly locked: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && isFiniteNumber(value['x']) && isFiniteNumber(value['y']);
}

function isBounds(value: unknown): value is Bounds {
  return (
    isPoint(value) &&
    isFiniteNumber((value as Partial<Bounds>).width) &&
    isFiniteNumber((value as Partial<Bounds>).height) &&
    (value as Bounds).width >= 0 &&
    (value as Bounds).height >= 0
  );
}

/** Mantém o índice espacial em dia com um patch aplicado ao documento. */
export function updateIndex(index: SpatialIndex, patch: DocumentPatch): void {
  for (const [id, { after }] of patch.nodes) {
    if (after === undefined || after.type === 'group') {
      index.delete(id);
    } else index.set(id, shapeBounds(after));
  }
}

/** Refaz o que as consultas derivam do preview. */
export function indexPreview(index: PreviewIndex, preview: CanvasPreview | null): void {
  index.boxes.clear();
  index.ranks.clear();
  if (preview === null) return;
  for (const shape of Object.values(preview.updates)) index.boxes.set(shape.id, shapeBounds(shape));
  for (const [position, shape] of preview.additions.entries()) {
    index.boxes.set(shape.id, shapeBounds(shape));
    index.ranks.set(shape.id, position);
  }
}

/**
 * Nós cuja caixa toca `bounds`, sem ordem. O índice dá os candidatos; com preview, o nó que
 * tem geometria provisória entra por ela, e os nós que só existem no preview ficam à frente
 * de todo o documento.
 */
function candidates(scene: Scene, bounds: Bounds, options: unknown): Candidate[] {
  const { document, placements } = scene;
  const preview = isRecord(options) && options['includePreview'] === true ? scene.preview : null;
  const found: Candidate[] = [];

  for (const id of scene.index.query(bounds)) {
    if (preview?.updates[id] !== undefined) continue;
    // O índice é mantido a cada commit: todo candidato é um nó do documento.
    const node = must(document.nodes[id], 'an indexed node');
    if (node.type === 'group') continue;
    const { layer, rank } = must(placements.get(id), 'the placement of an indexed node');
    found.push({
      id,
      node,
      rank,
      visible: node.visible && layer.visible,
      locked: node.locked || layer.locked,
    });
  }
  if (preview === null) return found;

  for (const id of scene.previewIndex.boxes.query(bounds)) {
    const update = preview.updates[id];
    if (update !== undefined) {
      // A geometria é a do preview; a posição visual e a camada são as do nó original.
      const { layer, rank } = must(placements.get(id), 'the placement of a previewed node');
      found.push({
        id,
        node: update,
        rank,
        visible: update.visible && layer.visible,
        locked: update.locked || layer.locked,
      });
    } else {
      const position = must(scene.previewIndex.ranks.get(id), 'the rank of a preview shape');
      const node = must(preview.additions[position], 'an indexed preview shape');
      found.push({
        id,
        node,
        rank: placements.size + position,
        visible: node.visible,
        locked: node.locked,
      });
    }
  }
  return found;
}

function backToFront(found: readonly Candidate[]): string[] {
  return [...found].sort((a, b) => a.rank - b.rank).map((candidate) => candidate.id);
}

/**
 * Nós visíveis sob o ponto, do mais à frente para o mais ao fundo. O índice dá os candidatos
 * pela caixa; a geometria de cada um decide, e a ordem é a do documento.
 */
export function hitTestAll(scene: Scene, point: Point, options: HitTestOptions): string[] {
  if (!isPoint(point)) return [];
  const given = isRecord(options) ? options.tolerance : undefined;
  const includeLocked = isRecord(options) && options.includeLocked === true;
  const labelAreas = isRecord(options) && options.labelAreas === true;
  const tolerance = Math.min(
    (isFiniteNumber(given) && given >= 0 ? given : DEFAULT_TOLERANCE) / scene.zoom,
    MAX_WORLD_TOLERANCE,
  );
  // A folga alarga o retângulo nos eixos dele: girado, o canto alargado passa da caixa do
  // shape em até √2 vezes a folga. Os candidatos são buscados com essa margem, mais a folga
  // de arredondamento, proporcional ao tamanho dos números envolvidos.
  const scale = Math.abs(point.x) + Math.abs(point.y) + tolerance + DEFAULT_LIMITS.maxCoordinate;
  const margin = tolerance * Math.SQRT2 + ROUNDING_SLACK * scale;
  const reach = {
    x: point.x - margin,
    y: point.y - margin,
    width: 2 * margin,
    height: 2 * margin,
  };
  const hits = candidates(scene, reach, options).filter(
    ({ node, visible, locked }) =>
      visible && (includeLocked || !locked) && pointInShape(node, point, tolerance, { labelAreas }),
  );
  return backToFront(hits).reverse();
}

/**
 * Nós cuja caixa, com rotação e contorno, toca `bounds`, em ordem visual do fundo para a
 * frente. É a consulta de culling: devolve candidatos pela caixa, não pela forma exata.
 */
export function queryBounds(scene: Scene, bounds: Bounds, options: QueryBoundsOptions): string[] {
  if (!isBounds(bounds)) return [];
  const includeHidden = isRecord(options) && options.includeHidden === true;
  return backToFront(
    candidates(scene, bounds, options).filter(({ visible }) => includeHidden || visible),
  );
}

/**
 * Nós visíveis que o retângulo de seleção contém ou toca, conforme o modo, em ordem visual do
 * fundo para a frente. Decide pela geometria de cada forma, não pela caixa dela.
 */
export function queryMarquee(scene: Scene, rect: Bounds, options: MarqueeOptions): string[] {
  if (!isBounds(rect) || !isRecord(options)) return [];
  const matches =
    options.mode === 'contain'
      ? shapeInsideRect
      : options.mode === 'intersect'
        ? shapeIntersectsRect
        : undefined;
  if (matches === undefined) return [];
  return backToFront(
    candidates(scene, rect, options).filter(
      ({ node, visible, locked }) =>
        visible && (options.includeLocked === true || !locked) && matches(node, rect),
    ),
  );
}

/** Caixa que cobre os nós dados. IDs que não são de nós são ignorados. */
export function boundsOf(
  scene: Pick<Scene, 'document' | 'preview' | 'previewIndex'>,
  ids: readonly string[],
  options: BoundsOptions,
): Bounds | undefined {
  if (!Array.isArray(ids)) return undefined;
  const preview = isRecord(options) && options.includePreview === true ? scene.preview : null;
  let union: Bounds | undefined;
  for (const id of ids) {
    const added = preview?.additions[scene.previewIndex.ranks.get(id) ?? -1];
    const node = preview?.updates[id] ?? added ?? scene.document.nodes[id];
    if (node === undefined) continue;
    if (node.type === 'group') {
      const groupBounds = boundsOf(scene, node.childIds, options);
      if (groupBounds !== undefined) {
        union = union === undefined ? groupBounds : boundsUnion(union, groupBounds);
      }
      continue;
    }
    const bounds = shapeBounds(node, isRecord(options) ? options : undefined);
    union = union === undefined ? bounds : boundsUnion(union, bounds);
  }
  return union;
}
