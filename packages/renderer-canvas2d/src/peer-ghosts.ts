import {
  boundsUnion,
  inkStrokesToWorld,
  shapeBounds,
  type CanvasSectionApi,
  type CanvasDocument,
  type CanvasPeer,
  type BoardNode,
  type Bounds,
  type InkNode,
  type Point,
  type ShapeNode,
  type Viewport,
} from '@canvash/core';
import { paintItem } from './painter.js';
import { projectScene, type RenderableItem } from './scene.js';

/** Acima deste número de nós, a prévia vira só a caixa da união, tracejada. */
export const MAX_GHOST_NODES = 20;
/** Pontos por traço de tinta na prévia. */
export const MAX_INK_POINTS = 64;
/** Tolerância da simplificação da tinta, em px da tela do observador. */
export const INK_TOLERANCE_PX = 2;
/** Espessura do contorno da prévia, em px da tela. */
export const GHOST_LINE_WIDTH = 1.5;
/** Opacidade do contorno da prévia. */
export const GHOST_OPACITY = 0.8;

/** Um pedaço da prévia, em coordenadas de mundo, na posição original dos nós. */
export type GhostPart =
  | { readonly kind: 'item'; readonly item: RenderableItem }
  | { readonly kind: 'polyline'; readonly points: readonly Point[] }
  | { readonly kind: 'box'; readonly bounds: Bounds; readonly dashed: boolean };

/** O que desenhar para o arrasto de um participante; só falta transladar pelo `dx, dy`. */
export interface PeerGhost {
  readonly parts: readonly GhostPart[];
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Douglas-Peucker com `tolerance` em unidades de mundo e, se ainda passar de `maxPoints`, redução
 * uniforme. Sempre mantém o primeiro e o último ponto.
 */
export function simplifyPolyline(
  points: readonly Point[],
  tolerance: number,
  maxPoints: number,
): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = from + 1; i < to; i += 1) {
      const distance = distanceToSegment(points[i]!, points[from]!, points[to]!);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([from, farthest], [farthest, to]);
    }
  }
  const kept = points.filter((_, index) => keep[index]);
  if (kept.length <= maxPoints) return kept;
  const last = kept.length - 1;
  return Array.from(
    { length: maxPoints },
    (_, i) => kept[Math.round((i * last) / (maxPoints - 1))]!,
  );
}

/**
 * Monta a prévia dos nós `ids` (que existem no documento): contorno da silhueta para as formas,
 * traço para linha e bezier, retângulo para texto, nota e board (este com a faixa do título),
 * polilinha simplificada para tinta e, acima de {@link MAX_GHOST_NODES}, só a caixa da união.
 */
export function buildGhostParts(
  document: CanvasDocument,
  ids: readonly string[],
  color: string,
  zoom: number,
): GhostPart[] {
  const nodes = ids
    .map((id) => document.nodes[id])
    .filter((node): node is ShapeNode | BoardNode => node !== undefined && node.type !== 'group');
  if (nodes.length === 0) return [];

  if (nodes.length > MAX_GHOST_NODES) {
    const union = nodes
      .map((node) => shapeBounds(node, { stroke: false }))
      .reduce((total, bounds) => boundsUnion(total, bounds));
    return [{ kind: 'box', bounds: union, dashed: true }];
  }

  const safeZoom = zoom > 0 ? zoom : 1;
  const style = {
    fill: null,
    stroke: color,
    strokeWidth: GHOST_LINE_WIDTH / safeZoom,
    opacity: GHOST_OPACITY,
  };
  const parts: GhostPart[] = [];
  for (const node of nodes) {
    if (node.type === 'board' || node.type === 'text' || node.type === 'sticky') {
      // O board vira a moldura com a faixa do título; o texto e a nota, o retângulo deles.
      parts.push({ kind: 'box', bounds: shapeBounds(node, { stroke: false }), dashed: false });
    } else if (node.type === 'ink') {
      for (const stroke of inkStrokesToWorld(node as InkNode)) {
        parts.push({
          kind: 'polyline',
          points: simplifyPolyline(stroke.points, INK_TOLERANCE_PX / safeZoom, MAX_INK_POINTS),
        });
      }
    } else {
      const [item] = projectScene(document, { candidateIds: new Set([node.id]) }).items;
      if (item && item.type !== 'ink' && item.type !== 'board') {
        parts.push({ kind: 'item', item: { ...item, style } });
      }
    }
  }
  return parts;
}

/**
 * Os nós do arrasto do participante que podem ser mostrados: existem no documento e ele detém o
 * bloqueio deles. IDs desconhecidos e nós alheios são ignorados.
 */
export function ghostIdsOf(section: CanvasSectionApi, peer: CanvasPeer): string[] {
  if (peer.drag === null) return [];
  const nodes = section.getSnapshot().document.nodes;
  return peer.drag.ids.filter(
    (id) => nodes[id] !== undefined && section.getPeerLock(id)?.sessionId === peer.sessionId,
  );
}

interface CacheEntry {
  readonly ids: readonly string[];
  /** Os nós no começo do gesto: se algum for trocado no documento, o gesto foi confirmado. */
  readonly nodes: readonly unknown[];
  readonly zoom: number;
  readonly color: string;
  readonly ghost: PeerGhost;
  /** O nó mudou no documento: a prévia não vale mais até o gesto (o `drag`) acabar. */
  committed: boolean;
}

/** Cache da prévia por participante: vale enquanto os nós e o zoom do gesto não mudam. */
export interface PeerGhostCache {
  /** A prévia do arrasto do participante, ou `null` se não há o que desenhar. */
  get(section: CanvasSectionApi, peer: CanvasPeer, zoom: number): PeerGhost | null;
  /** Esquece os participantes que não estão em `sessionIds`. */
  retain(sessionIds: ReadonlySet<string>): void;
  clear(): void;
}

export function createPeerGhostCache(): PeerGhostCache {
  const entries = new Map<string, CacheEntry>();
  return {
    get(section, peer, zoom) {
      const ids = ghostIdsOf(section, peer);
      if (ids.length === 0) {
        entries.delete(peer.sessionId);
        return null;
      }
      const nodes = section.getSnapshot().document.nodes;
      const nodeRefs = ids.map((id) => nodes[id]);
      const known = entries.get(peer.sessionId);
      if (known && known.ids.length === ids.length && known.ids.every((id, i) => id === ids[i])) {
        if (known.committed || known.nodes.some((node, i) => node !== nodeRefs[i])) {
          // A alteração do documento chegou: o gesto terminou, e a prévia não é mais necessária.
          known.committed = true;
          return null;
        }
        if (known.zoom === zoom && known.color === peer.color) return known.ghost;
      }
      const ghost: PeerGhost = {
        parts: buildGhostParts(section.getSnapshot().document, ids, peer.color, zoom),
      };
      entries.set(peer.sessionId, {
        ids,
        nodes: nodeRefs,
        zoom,
        color: peer.color,
        ghost,
        committed: false,
      });
      return ghost;
    },
    retain(sessionIds) {
      for (const id of [...entries.keys()]) if (!sessionIds.has(id)) entries.delete(id);
    },
    clear() {
      entries.clear();
    },
  };
}

/** Um arrasto a desenhar: a prévia, o deslocamento em mundo e a cor do participante. */
export interface PeerGhostPaint {
  readonly ghost: PeerGhost;
  readonly dx: number;
  readonly dy: number;
  readonly color: string;
}

/**
 * Pinta as prévias em CSS px, deslocadas pelo `dx, dy` de cada participante. Sem interpolação:
 * cada amostra é um quadro.
 */
export function paintPeerGhosts(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  paints: readonly PeerGhostPaint[],
): void {
  if (paints.length === 0) return;
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  for (const { ghost, dx, dy, color } of paints) {
    context.save();
    context.translate(viewport.x + dx * zoom, viewport.y + dy * zoom);
    context.scale(zoom, zoom);
    for (const part of ghost.parts) {
      if (part.kind === 'item') {
        paintItem(context, part.item);
        continue;
      }
      context.save();
      context.globalAlpha = GHOST_OPACITY;
      context.strokeStyle = color;
      context.lineWidth = GHOST_LINE_WIDTH / zoom;
      if (part.kind === 'polyline') {
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.beginPath();
        part.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();
      } else {
        context.setLineDash(part.dashed ? [6 / zoom, 4 / zoom] : []);
        context.strokeRect(part.bounds.x, part.bounds.y, part.bounds.width, part.bounds.height);
      }
      context.restore();
    }
    context.restore();
  }
}
