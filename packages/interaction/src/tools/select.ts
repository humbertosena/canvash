import {
  findGroupOfNode,
  type CanvasSectionApi,
  type CanvasDocument,
  type Point,
} from '@canvash/core';
import { isPeerLocked } from '../peer-lock.js';

export const DRAG_THRESHOLD_PX = 3;

/**
 * Se o nó indicado pertencer a um grupo, resolve para o ID do grupo raiz (INPUT-08).
 */
export function resolveSelectableId(
  document: CanvasDocument,
  id: string | undefined,
): string | undefined {
  if (id === undefined) return undefined;
  const group = findGroupOfNode(document, id);
  return group ? group.id : id;
}

/**
 * Determina se a distância percorrida entre o início e o fim em coordenadas de tela
 * é menor que o threshold para ser considerada um click puro (sem arrasto).
 */
export function isClickGesture(
  startScreen: Point,
  endScreen: Point,
  threshold = DRAG_THRESHOLD_PX,
): boolean {
  const dx = endScreen.x - startScreen.x;
  const dy = endScreen.y - startScreen.y;
  return Math.hypot(dx, dy) < threshold;
}

/**
 * Calcula os novos IDs de seleção dado o nó atingido e o modificador Shift.
 * - Sem hitId e sem Shift: seleção limpa ([]).
 * - Sem hitId com Shift: mantém a seleção atual.
 * - Com hitId sem Shift: seleciona exclusivamente o hitId ([hitId]).
 * - Com hitId com Shift: alterna a presença do hitId na seleção.
 */
export function computeClickSelection(
  currentSelectedIds: readonly string[],
  hitId: string | undefined,
  shiftKey: boolean,
): readonly string[] {
  if (hitId === undefined) {
    return shiftKey ? currentSelectedIds : [];
  }

  if (!shiftKey) {
    return [hitId];
  }

  if (currentSelectedIds.includes(hitId)) {
    return currentSelectedIds.filter((id) => id !== hitId);
  }

  return [...currentSelectedIds, hitId];
}

/**
 * Executa a seleção por click no canvas a partir de um ponto em coordenadas de mundo.
 */
export function executeClickSelection(
  section: CanvasSectionApi,
  worldPoint: Point,
  shiftKey: boolean,
): void {
  const hitId = section.hitTest(worldPoint, {
    includeLocked: false,
    includePreview: false,
  });

  const resolvedHitId = resolveSelectableId(section.getSnapshot().document, hitId);
  // Nó bloqueado por outro participante: o clique não o seleciona nem seleciona o que está atrás.
  if (resolvedHitId !== undefined && isPeerLocked(section, resolvedHitId)) return;
  const currentSelection = section.getSnapshot().session.selectedIds;
  const nextSelection = computeClickSelection(currentSelection, resolvedHitId, shiftKey);

  section.setSelection(nextSelection);
}
