import {
  ERASER_MIN_PIECE_CSS_PX,
  ERASER_SIZE_NAMES,
  eraseFromStrokes,
  eraserRadiusWorld,
  inkPatchFromWorldStrokes,
  inkStrokesToLocal,
  inkStrokesToWorld,
  type CanvasSectionApi,
  type Bounds,
  type EraserSize,
  type InkNode,
  type Point,
  type PreviewShape,
  type WorldInkStroke,
} from '@canvash/core';
import { isPeerLocked } from '../peer-lock.js';

export const DEFAULT_ERASER_SIZE: EraserSize = 'medium';

/** Posição e tamanho do indicador sob o ponteiro: ponto em mundo e raio em pixels CSS. */
export interface EraserCursor {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** O elemento de traços durante a passada: o estado original e o que já foi apagado dele. */
export interface ErasedInk {
  readonly node: InkNode;
  /** Traços em mundo depois das amostras da passada até agora. */
  world: readonly WorldInkStroke[];
  /** A passada já apagou algo deste elemento. */
  changed: boolean;
}

export function isEraserSize(value: unknown): value is EraserSize {
  return (ERASER_SIZE_NAMES as readonly unknown[]).includes(value);
}

/** Caixa do segmento do ponteiro alargada pelo raio: onde pode haver traço a apagar. */
export function eraserSegmentBounds(from: Point, to: Point, radius: number): Bounds {
  const x = Math.min(from.x, to.x) - radius;
  const y = Math.min(from.y, to.y) - radius;
  return {
    x,
    y,
    width: Math.max(from.x, to.x) + radius - x,
    height: Math.max(from.y, to.y) + radius - y,
  };
}

/** Elemento de traços que a borracha pode alterar: visível e desbloqueado de fato (com a camada). */
function erasableInk(section: CanvasSectionApi, id: string): InkNode | undefined {
  const node = section.getSnapshot().document.nodes[id];
  if (!node || node.type !== 'ink' || !node.visible || node.locked) return undefined;
  if (isPeerLocked(section, id)) return undefined;
  const info = section.getNodeInfo(id);
  return info && info.visible && !info.locked ? node : undefined;
}

/**
 * Aplica um trecho da passada (do ponto anterior ao novo) aos elementos de traços sob ele,
 * acumulando o resultado em `erased`. Só o último trecho é calculado: o estado já apagado serve de
 * base. Devolve se algum elemento mudou.
 */
export function eraseSegment(
  section: CanvasSectionApi,
  erased: Map<string, ErasedInk>,
  from: Point,
  to: Point,
  size: EraserSize,
  zoom: number,
): boolean {
  const radius = eraserRadiusWorld(size, zoom);
  const candidates = section.queryBounds(eraserSegmentBounds(from, to, radius), {
    includePreview: false,
  });
  let changed = false;
  for (const id of candidates) {
    let entry = erased.get(id);
    if (entry === undefined) {
      const node = erasableInk(section, id);
      if (node === undefined) continue;
      entry = { node, world: inkStrokesToWorld(node), changed: false };
      erased.set(id, entry);
    }
    const next = eraseFromStrokes(entry.world, {
      points: [from, to],
      radius,
      minPieceLength: ERASER_MIN_PIECE_CSS_PX / (zoom > 0 ? zoom : 1),
    });
    if (next !== entry.world) {
      entry.world = next;
      entry.changed = true;
      changed = true;
    }
  }
  return changed;
}

/**
 * O que a passada mostra no lugar dos elementos alterados: cada um com a caixa original e os
 * pontos já apagados, e o que ficou sem traço oculto. A caixa só é refeita no commit.
 */
export function buildErasePreviews(erased: ReadonlyMap<string, ErasedInk>): PreviewShape[] {
  const previews: PreviewShape[] = [];
  for (const [id, entry] of erased) {
    if (!entry.changed) continue;
    const { node } = entry;
    const empty = entry.world.length === 0;
    previews.push({
      id,
      type: 'ink',
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      strokes: empty ? node.strokes : inkStrokesToLocal(node, entry.world),
      style: node.style,
      visible: !empty && node.visible,
      locked: node.locked,
    });
  }
  return previews;
}

export type EraseCommand =
  | { readonly type: 'shape.remove'; readonly id: string }
  | { readonly type: 'shape.update'; readonly id: string; readonly patch: Record<string, unknown> };

/** Os comandos que gravam a passada: atualiza os elementos alterados e remove os esvaziados. */
export function buildEraseCommands(erased: ReadonlyMap<string, ErasedInk>): EraseCommand[] {
  const commands: EraseCommand[] = [];
  for (const [id, entry] of erased) {
    if (!entry.changed) continue;
    const patch = inkPatchFromWorldStrokes(entry.node, entry.world);
    if (patch === null) commands.push({ type: 'shape.remove', id });
    else commands.push({ type: 'shape.update', id, patch: { ...patch } });
  }
  return commands;
}
