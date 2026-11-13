import {
  findGroupOfNode,
  shapeInsideRect,
  type CanvasSectionApi,
  type CanvasDocument,
  type Bounds,
  type Point,
} from '@canvash/core';
import { isPeerLocked } from '../peer-lock.js';

/**
 * Calcula o retângulo delimitador (Bounds com width >= 0 e height >= 0)
 * formado por dois pontos em coordenadas de mundo.
 */
export function computeMarqueeBounds(startWorld: Point, currentWorld: Point): Bounds {
  const minX = Math.min(startWorld.x, currentWorld.x);
  const minY = Math.min(startWorld.y, currentWorld.y);
  const maxX = Math.max(startWorld.x, currentWorld.x);
  const maxY = Math.max(startWorld.y, currentWorld.y);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Determina o modo de consulta do marquee com base na direção horizontal do gesto:
 * - Da esquerda para a direita (current.x >= start.x): contenção estrita ('contain' / Window).
 * - Da direita para a esquerda (current.x < start.x): interseção geométrica ('intersect' / Crossing).
 */
export function computeMarqueeMode(
  startWorld: Point,
  currentWorld: Point,
): 'contain' | 'intersect' {
  return currentWorld.x >= startWorld.x ? 'contain' : 'intersect';
}

/**
 * Combina a lista de IDs retornados pelo marquee com a seleção prévia:
 * - Sem Shift: a seleção é substituída pelos IDs atingidos.
 * - Com Shift: os IDs atingidos são adicionados à seleção inicial, preservando unicidade.
 */
export function computeMarqueeSelection(
  initialSelectedIds: readonly string[],
  queriedIds: readonly string[],
  shiftKey: boolean,
): readonly string[] {
  if (!shiftKey) {
    return [...queriedIds];
  }

  const combined = new Set([...initialSelectedIds, ...queriedIds]);
  return Array.from(combined);
}

/**
 * Mapeia os IDs retornados pela consulta espacial do marquee para garantir que grupos ajam como unidades (INPUT-08):
 * - No modo 'intersect': se qualquer membro do grupo intersectar o marquee, o grupo é selecionado.
 * - No modo 'contain': todos os membros do grupo devem estar contidos no marquee para que o grupo seja selecionado.
 * - Shapes que não pertencem a grupo são preservados individualmente.
 */
export function resolveMarqueeGroupIds(
  document: CanvasDocument,
  queriedIds: readonly string[],
  mode: 'contain' | 'intersect',
  bounds?: Bounds,
): readonly string[] {
  const result = new Set<string>();
  const processedGroups = new Set<string>();

  for (const id of queriedIds) {
    const node = document.nodes[id];
    if (node?.type === 'board') {
      // O board só entra quando a marquee o contém inteiro, com a faixa do título, nos dois modos:
      // quem começa a marquee dentro de um board quer os filhos, não o board.
      if (bounds !== undefined && shapeInsideRect(node, bounds)) result.add(id);
      continue;
    }
    const group = findGroupOfNode(document, id);
    if (!group) {
      result.add(id);
    } else if (!processedGroups.has(group.id)) {
      processedGroups.add(group.id);
      if (mode === 'intersect') {
        result.add(group.id);
      } else {
        const allContained = group.childIds.every((childId) => queriedIds.includes(childId));
        if (allContained) {
          result.add(group.id);
        }
      }
    }
  }

  return withoutBoardDescendants(document, result);
}

/** Tira do resultado os descendentes de cada board que já entrou: ele os leva consigo. */
function withoutBoardDescendants(document: CanvasDocument, ids: ReadonlySet<string>): string[] {
  const covered = new Set<string>();
  for (const id of ids) {
    const node = document.nodes[id];
    if (node?.type !== 'board') continue;
    for (const childId of node.childIds) {
      covered.add(childId);
      const child = document.nodes[childId];
      if (child?.type === 'group') for (const memberId of child.childIds) covered.add(memberId);
    }
  }
  return [...ids].filter((id) => !covered.has(id));
}

/**
 * Executa a seleção por marquee sobre o canvas:
 * 1. Consulta os nós elegíveis respeitando modo (contain/intersect), bloqueio e visibilidade.
 * 2. Mapeia membros para seus grupos pai garantindo que grupos ajam como unidades atômicas.
 * 3. Aplica a nova seleção no canvas via section.setSelection.
 */
export function executeMarqueeSelection(
  section: CanvasSectionApi,
  bounds: Bounds,
  mode: 'contain' | 'intersect',
  shiftKey: boolean,
  initialSelectedIds: readonly string[],
): readonly string[] {
  const queriedIds = section.queryMarquee(bounds, {
    mode,
    includeLocked: false,
    includePreview: false,
  });

  const resolvedIds = resolveMarqueeGroupIds(
    section.getSnapshot().document,
    queriedIds,
    mode,
    bounds,
  ).filter((id) => !isPeerLocked(section, id));
  const nextSelection = computeMarqueeSelection(initialSelectedIds, resolvedIds, shiftKey);
  section.setSelection(nextSelection);
  return nextSelection;
}
