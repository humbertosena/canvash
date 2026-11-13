import type {
  BoardNode,
  CanvasCommand,
  CanvasDocument,
  CanvasSectionApi,
  Point,
  PreviewShape,
  ShapeNode,
} from '@canvash/core';
import { isPeerLocked } from '../peer-lock.js';
import { buildMovePatch, toPreviewShape, translateShape } from '../transform.js';

/** Um nó que a seleção move: forma com geometria própria ou board. */
export type MovableNode = ShapeNode | BoardNode;

/**
 * Calcula o deslocamento vetorial (dx, dy) entre o ponto inicial e o ponto atual em mundo.
 */
export function computeMoveDelta(startWorld: Point, currentWorld: Point): Point {
  return {
    x: currentWorld.x - startWorld.x,
    y: currentWorld.y - startWorld.y,
  };
}

/** Os descendentes de um board que têm geometria: os filhos e os membros dos grupos filhos. */
function boardDescendants(document: CanvasDocument, board: BoardNode): ShapeNode[] {
  const found: ShapeNode[] = [];
  for (const childId of board.childIds) {
    const child = document.nodes[childId];
    if (child === undefined || child.type === 'board') continue;
    if (child.type === 'group') {
      for (const memberId of child.childIds) {
        const member = document.nodes[memberId];
        if (member !== undefined && member.type !== 'group' && member.type !== 'board') {
          found.push(member);
        }
      }
    } else {
      found.push(child);
    }
  }
  return found;
}

export interface MovableNodesOptions {
  /**
   * `false` deixa o board sozinho, sem os descendentes: é o que Delete quer, porque remover o
   * board já remove os descendentes. O padrão é expandir, como o arrasto e as setas.
   */
  readonly expandBoards?: boolean | undefined;
}

/**
 * Os nós que a seleção move: existem, não têm `locked` (nem eles, nem a camada, o grupo ou o
 * board que os contém) e outra sessão não os bloqueia. Um grupo vale pelos membros, e um board,
 * por ele e pelos descendentes, sem repetir quem também está na seleção. Se algum descendente de
 * um board selecionado está `locked` ou bloqueado por outra sessão, a seleção inteira não se
 * move.
 */
export function getMovableNodes(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
  options?: MovableNodesOptions,
): MovableNode[] {
  const document = section.getSnapshot().document;
  const expandBoards = options?.expandBoards !== false;
  const free = (id: string): boolean =>
    section.getNodeInfo(id)?.locked === false && !isPeerLocked(section, id);

  // Com o board sozinho (Delete), quem é descendente de um board selecionado sai com ele.
  const covered = new Set<string>();
  if (!expandBoards) {
    for (const id of selectedIds) {
      const node = document.nodes[id];
      if (node?.type !== 'board') continue;
      for (const childId of node.childIds) {
        covered.add(childId);
        const child = document.nodes[childId];
        if (child?.type === 'group') for (const memberId of child.childIds) covered.add(memberId);
      }
    }
  }

  const seen = new Set<string>();
  const movable: MovableNode[] = [];
  const add = (node: MovableNode): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    movable.push(node);
  };

  for (const id of selectedIds) {
    const node = document.nodes[id];
    if (!node || covered.has(id) || !free(id)) continue;

    if (node.type === 'group') {
      for (const childId of node.childIds) {
        const childNode = document.nodes[childId];
        if (
          childNode &&
          childNode.type !== 'group' &&
          childNode.type !== 'board' &&
          !childNode.locked
        ) {
          add(childNode);
        }
      }
    } else if (node.type === 'board') {
      const descendants = boardDescendants(document, node);
      if (
        descendants.some((descendant) => descendant.locked || isPeerLocked(section, descendant.id))
      ) {
        return [];
      }
      add(node);
      if (expandBoards) for (const descendant of descendants) add(descendant);
    } else {
      add(node);
    }
  }
  return movable;
}

/** Os nós da seleção que escalam e giram em conjunto: os de `getMovableNodes`, sem os boards. */
export function getTransformableNodes(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
): ShapeNode[] {
  return getMovableNodes(section, selectedIds).filter(
    (node): node is ShapeNode => node.type !== 'board',
  );
}

/**
 * Gera a lista de PreviewShape para atualização provisória durante o arrasto.
 */
export function buildMovePreviews(nodes: readonly MovableNode[], delta: Point): PreviewShape[] {
  return nodes.map((node) => toPreviewShape(translateShape(node, delta)));
}

/**
 * Constrói a lista de comandos `shape.update` para aplicar o deslocamento delta a todos os nós.
 */
export function buildMoveCommands(nodes: readonly MovableNode[], delta: Point): CanvasCommand[] {
  return nodes.map((node) => ({
    type: 'shape.update' as const,
    id: node.id,
    patch: buildMovePatch(node, delta),
  }));
}

export interface ExecuteMoveOptions {
  /**
   * A seleção do gesto. Com ela, o fim do arrasto recalcula a pertença (§5.2): cada unidade que
   * cai com o centro dentro de um board entra nele, e a que sai de um board é devolvida à camada.
   * Sem ela, como nas setas do teclado, a pertença não muda.
   */
  readonly selectedIds?: readonly string[] | undefined;
}

/** Os IDs dos descendentes de cada board selecionado: filhos e membros dos grupos filhos. */
function coveredByBoards(document: CanvasDocument, selectedIds: readonly string[]): Set<string> {
  const covered = new Set<string>();
  for (const id of selectedIds) {
    const node = document.nodes[id];
    if (node?.type !== 'board') continue;
    for (const childId of node.childIds) {
      covered.add(childId);
      const child = document.nodes[childId];
      if (child?.type === 'group') for (const memberId of child.childIds) covered.add(memberId);
    }
  }
  return covered;
}

/** Uma unidade do arrasto com o board em que cairia (`undefined`: a camada). */
interface DropUnit {
  readonly id: string;
  readonly isBoard: boolean;
  readonly parentBoard: string | undefined;
  readonly target: string | undefined;
}

/**
 * Para cada unidade do arrasto (nó de nível superior, filho de board ou grupo; o descendente de
 * um board também selecionado não conta à parte), acha o board de destino: o mais à frente, visível
 * e desbloqueado, da camada da unidade, cujo retângulo (sem a faixa do título) contém o centro da
 * caixa dela depois do deslocamento. Os boards em movimento não contam, e um board nunca recebe
 * destino.
 */
function planDrop(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
  delta: Point,
): DropUnit[] {
  const document = section.getSnapshot().document;
  const covered = coveredByBoards(document, selectedIds);
  const moving = new Set(selectedIds);
  const units: DropUnit[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    if (seen.has(id) || covered.has(id)) continue;
    seen.add(id);
    const node = document.nodes[id];
    const info = node === undefined ? undefined : section.getNodeInfo(id);
    if (node === undefined || info === undefined) continue;
    if (node.type === 'board') {
      units.push({ id, isBoard: true, parentBoard: undefined, target: undefined });
      continue;
    }
    const bounds = section.getBounds([id], { includePreview: false, stroke: false });
    let target: string | undefined;
    if (bounds !== undefined) {
      const centerX = bounds.x + delta.x + bounds.width / 2;
      const centerY = bounds.y + delta.y + bounds.height / 2;
      const layer = document.layers.find((candidate) => candidate.id === info.layerId);
      for (const siblingId of [...(layer?.childIds ?? [])].reverse()) {
        const sibling = document.nodes[siblingId];
        if (sibling?.type !== 'board' || moving.has(siblingId)) continue;
        const siblingInfo = section.getNodeInfo(siblingId);
        if (!siblingInfo?.visible || siblingInfo.locked || isPeerLocked(section, siblingId))
          continue;
        if (
          centerX >= sibling.x &&
          centerX <= sibling.x + sibling.width &&
          centerY >= sibling.y &&
          centerY <= sibling.y + sibling.height
        ) {
          target = siblingId;
          break;
        }
      }
    }
    units.push({ id, isBoard: false, parentBoard: info.boardId, target });
  }
  return units;
}

/**
 * O board que recebe a primeira unidade do arrasto que cai dentro de um, ou `undefined`. É o que o
 * overlay contorna durante o gesto.
 */
export function findBoardDropTarget(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
  delta: Point,
): string | undefined {
  return planDrop(section, selectedIds, delta).find((unit) => unit.target !== undefined)?.target;
}

/** Os `board.attach` e `board.detach` que o fim do arrasto pede, um por destino. */
function buildMembershipCommands(
  section: CanvasSectionApi,
  selectedIds: readonly string[],
  delta: Point,
): CanvasCommand[] {
  const attach = new Map<string, string[]>();
  const detach: string[] = [];
  for (const unit of planDrop(section, selectedIds, delta)) {
    if (unit.isBoard || unit.target === unit.parentBoard) continue;
    if (unit.target === undefined) {
      detach.push(unit.id);
    } else {
      const ids = attach.get(unit.target) ?? [];
      ids.push(unit.id);
      attach.set(unit.target, ids);
    }
  }
  return [
    ...[...attach].map(
      ([boardId, ids]) => ({ type: 'board.attach' as const, boardId, ids }) as CanvasCommand,
    ),
    ...(detach.length > 0 ? [{ type: 'board.detach' as const, ids: detach } as CanvasCommand] : []),
  ];
}

/**
 * Aplica o deslocamento atômico em todos os nós elegíveis através de uma única transação no canvas.
 * Com `selectedIds`, a mudança de pai entra na mesma transação, então o movimento e a pertença são
 * uma entrada de histórico.
 */
export function executeMove(
  section: CanvasSectionApi,
  nodes: readonly MovableNode[],
  delta: Point,
  options?: ExecuteMoveOptions,
): void {
  if (nodes.length === 0 || (delta.x === 0 && delta.y === 0)) return;

  const membership =
    options?.selectedIds === undefined
      ? []
      : buildMembershipCommands(section, options.selectedIds, delta);
  section.transact([...buildMoveCommands(nodes, delta), ...membership]);
}
