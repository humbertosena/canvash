import {
  isBindingEndpoint,
  isZeroLengthArrow,
  resolveAnchorPosition,
  type BindingEndpoint,
} from './arrows.js';
import { at, isRecord, nonEmptyString, rejectUnknownKeys, report } from './checks.js';
import type { Draft } from './draft.js';
import type { IdGenerator } from './ids.js';
import {
  createLayer,
  lockOf,
  reorderLayer,
  reorderNode,
  updateLayer,
  type CreateLayerCommand,
  type ReorderLayerCommand,
  type ReorderNodeCommand,
  type UpdateLayerCommand,
} from './layers.js';
import { coordinateOverflow, textLengthOverflow, type CanvasLimits } from './limits.js';
import { generateNewId, readNewId } from './new-ids.js';
import { createGroup, ungroupGroup } from './groups.js';
import {
  limitError,
  lockedError,
  notFoundError,
  validationError,
  type CanvasError,
  type ValidationIssue,
} from './result.js';
import {
  attachToBoard,
  detachFromBoard,
  patchBoard,
  readBoardInput,
  type AttachToBoardCommand,
  type DetachFromBoardCommand,
} from './boards.js';
import {
  patchShape,
  readShapeInput,
  type BoardNode,
  type CanvasNode,
  type GroupNode,
  type ShapeInput,
  type ShapePatch,
} from './shapes.js';

/** Cria um shape. A geometria é obrigatória; ID, camada e estilo têm padrão. */
export interface CreateShapeCommand {
  readonly type: 'shape.create';
  readonly shape: ShapeInput;
  /** Camada que recebe o shape. O padrão é a camada mais à frente. */
  readonly layerId?: string | undefined;
}

/** Altera campos de um shape que já existe. */
export interface UpdateShapeCommand {
  readonly type: 'shape.update';
  readonly id: string;
  readonly patch: ShapePatch;
}

/** Remove um shape do documento e da camada que o contém. */
export interface RemoveShapeCommand {
  readonly type: 'shape.remove';
  readonly id: string;
}

/**
 * Alteração pedida ao canvas. Comandos são objetos simples, serializáveis em JSON, e o canvas
 * os confere em execução: campo desconhecido ou valor inválido é recusado sem efeito.
 *
 * Esta união pode ganhar membros em versões futuras: ao tratá-la caso a caso, deixe um ramo
 * para o que não conhecer.
 */
export type CanvasCommand =
  | CreateShapeCommand
  | UpdateShapeCommand
  | RemoveShapeCommand
  | CreateLayerCommand
  | UpdateLayerCommand
  | ReorderLayerCommand
  | ReorderNodeCommand
  | CreateGroupCommand
  | UngroupCommand
  | AttachToBoardCommand
  | DetachFromBoardCommand;

/** Cria um grupo a partir de nós da mesma camada. */
export interface CreateGroupCommand {
  readonly type: 'group.create';
  readonly id?: string | undefined;
  readonly childIds: readonly string[];
}

/** Desfaz um grupo, recolocando seus nós filhos na camada no mesmo ponto. */
export interface UngroupCommand {
  readonly type: 'group.ungroup';
  readonly id: string;
}

/** O que um comando aceito fez. */
export interface CommandReceipt {
  /** Revisão do snapshot depois do comando. */
  readonly revision: number;
  /** `false` quando o comando não mudou o documento. */
  readonly changed: boolean;
  /** IDs dos nós e das camadas criados, alterados ou removidos. */
  readonly affectedIds: readonly string[];
  /** IDs criados pelo comando, na ordem de criação. */
  readonly createdIds: readonly string[];
}

// Caminhos, dentro do comando, dos dois campos que carregam um shape.
const SHAPE = at(undefined, 'shape');
const PATCH = at(undefined, 'patch');

/** O que um undo ou um redo fez. */
export interface HistoryReceipt {
  /** Revisão do snapshot depois da operação. */
  readonly revision: number;
  /** `false` quando não havia o que desfazer ou refazer. */
  readonly changed: boolean;
  /** IDs dos nós e das camadas criados, alterados ou removidos. */
  readonly affectedIds: readonly string[];
}

/** O que os comandos precisam do canvas que os executa. */
export interface CommandContext {
  readonly generateId: IdGenerator;
  readonly limits: Required<CanvasLimits>;
}

type Handler = (
  draft: Draft,
  command: Record<string, unknown>,
  context: CommandContext,
) => CanvasError | undefined;

// Um Map, e não um objeto: `type` vem de fora, e num objeto um tipo chamado `toString` acharia
// o método herdado.
const HANDLERS: ReadonlyMap<unknown, Handler> = new Map<unknown, Handler>([
  ['shape.create', createShape],
  ['shape.update', updateShape],
  ['shape.remove', removeShape],
  ['layer.create', createLayer],
  ['layer.update', updateLayer],
  ['layer.reorder', reorderLayer],
  ['node.reorder', reorderNode],
  ['group.create', createGroup],
  ['group.ungroup', ungroupGroup],
  ['board.attach', attachToBoard],
  ['board.detach', detachFromBoard],
]);

/** Aplica um comando ao rascunho. Devolve o erro, ou `undefined` se o comando foi aceito. */
export function applyCommand(
  draft: Draft,
  command: unknown,
  context: CommandContext,
): CanvasError | undefined {
  if (!isRecord(command)) {
    return validationError([{ path: [], rule: 'type', message: 'command must be an object' }]);
  }
  const handler = HANDLERS.get(command['type']);
  if (handler === undefined) {
    return validationError([
      { path: ['type'], rule: 'unknown-type', message: 'is not a known command type' },
    ]);
  }
  return handler(draft, command, context);
}

function createShape(
  draft: Draft,
  command: Record<string, unknown>,
  context: CommandContext,
): CanvasError | undefined {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'shape', 'layerId'], undefined, issues);
  const layerId =
    command['layerId'] === undefined
      ? undefined
      : nonEmptyString(command['layerId'], at(undefined, 'layerId'), issues);

  const shape = command['shape'];
  if (!isRecord(shape)) {
    report(issues, SHAPE, 'type', 'must be an object');
    return validationError(issues);
  }
  // O board tem leitor próprio: `boards.ts` importa `shapes.ts`, então o caminho inverso fecharia um ciclo.
  const build =
    shape['type'] === 'board'
      ? readBoardInput(shape, SHAPE, issues)
      : readShapeInput(shape, SHAPE, issues);
  const givenId =
    shape['id'] === undefined ? undefined : readNewId(draft, shape['id'], at(SHAPE, 'id'), issues);
  if (build === undefined || issues.length > 0) return validationError(issues);

  let layer = draft.frontLayer();
  if (layerId !== undefined) {
    const found = draft.layerHeader(layerId);
    if (found === undefined) return notFoundError('layer', layerId);
    layer = found;
  }
  if (layer.locked) return lockedError(layer.id, layer.id);

  const { maxNodes, maxCoordinate, maxTextLength } = context.limits;
  if (draft.nodeCount >= maxNodes) return limitError('nodes', maxNodes, draft.nodeCount + 1);
  const candidate = build('');
  const overflow = coordinateOverflow(candidate, maxCoordinate);
  if (overflow !== undefined) return limitError('coordinate', maxCoordinate, overflow);
  const textOverflow = textLengthOverflow(candidate, maxTextLength);
  if (textOverflow !== undefined) return limitError('text', maxTextLength, textOverflow);

  if (candidate.type === 'arrow') {
    if (isBindingEndpoint(candidate.start)) {
      if (givenId !== undefined && candidate.start.targetId === givenId) {
        report(issues, at(SHAPE, 'start'), 'broken-reference', 'cannot bind to itself');
        return validationError(issues);
      }
      if (draft.getNode(candidate.start.targetId) === undefined) {
        return notFoundError('node', candidate.start.targetId);
      }
    }
    if (isBindingEndpoint(candidate.end)) {
      if (givenId !== undefined && candidate.end.targetId === givenId) {
        report(issues, at(SHAPE, 'end'), 'broken-reference', 'cannot bind to itself');
        return validationError(issues);
      }
      if (draft.getNode(candidate.end.targetId) === undefined) {
        return notFoundError('node', candidate.end.targetId);
      }
    }
    if (
      isZeroLengthArrow(candidate, (nodeId) => {
        const n = draft.getNode(nodeId);
        return n && n.type !== 'group' && n.type !== 'board' ? n : undefined;
      })
    ) {
      report(issues, SHAPE, 'zero-length', 'start and end must differ');
      return validationError(issues);
    }
  }

  // O ID só é gerado aqui, com tudo conferido: comando recusado não gasta ID do gerador.
  const id = givenId ?? generateNewId(draft, context.generateId);
  draft.addNode(build(id), layer.id);
  return undefined;
}

function updateShape(
  draft: Draft,
  command: Record<string, unknown>,
  context: CommandContext,
): CanvasError | undefined {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'id', 'patch'], undefined, issues);
  const id = nonEmptyString(command['id'], at(undefined, 'id'), issues);
  const patch = command['patch'];
  if (!isRecord(patch)) {
    report(issues, PATCH, 'type', 'must be an object');
    return validationError(issues);
  }
  if (issues.length > 0) return validationError(issues);

  // O patch só é conferido depois de achar o nó: os campos aceitos dependem do tipo dele.
  const node = draft.getNode(id);
  if (node === undefined) return notFoundError('node', id);
  if (node.type === 'group') {
    return validationError([
      { path: ['id'], rule: 'type', message: 'cannot update a group with shape.update' },
    ]);
  }
  const next =
    node.type === 'board'
      ? patchBoard(node, patch, PATCH, issues)
      : patchShape(node, patch, PATCH, issues);
  if (issues.length > 0) return validationError(issues);

  // Um nó bloqueado só aceita o patch que o desbloqueia; em camada bloqueada, nenhum.
  const layer = draft.layerOf(id);
  if (layer.locked) return lockedError(id, layer.id);
  if (node.locked && next.locked) return lockedError(id, id);

  const { maxCoordinate, maxTextLength } = context.limits;
  const overflow = coordinateOverflow(next, maxCoordinate);
  if (overflow !== undefined) return limitError('coordinate', maxCoordinate, overflow);
  const textOverflow = textLengthOverflow(next, maxTextLength);
  if (textOverflow !== undefined) return limitError('text', maxTextLength, textOverflow);

  if (next.type === 'arrow') {
    if (isBindingEndpoint(next.start)) {
      if (next.start.targetId === id) {
        report(issues, at(PATCH, 'start'), 'broken-reference', 'cannot bind to itself');
        return validationError(issues);
      }
      if (draft.getNode(next.start.targetId) === undefined) {
        return notFoundError('node', next.start.targetId);
      }
    }
    if (isBindingEndpoint(next.end)) {
      if (next.end.targetId === id) {
        report(issues, at(PATCH, 'end'), 'broken-reference', 'cannot bind to itself');
        return validationError(issues);
      }
      if (draft.getNode(next.end.targetId) === undefined) {
        return notFoundError('node', next.end.targetId);
      }
    }
    if (
      isZeroLengthArrow(next, (nodeId) => {
        const n = draft.getNode(nodeId);
        return n && n.type !== 'group' && n.type !== 'board' ? n : undefined;
      })
    ) {
      report(issues, PATCH, 'zero-length', 'start and end must differ');
      return validationError(issues);
    }
  }

  draft.replaceNode(next);
  return undefined;
}

function removeShape(draft: Draft, command: Record<string, unknown>): CanvasError | undefined {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'id'], undefined, issues);
  const id = nonEmptyString(command['id'], at(undefined, 'id'), issues);
  if (issues.length > 0) return validationError(issues);
  const node = draft.getNode(id);
  if (node === undefined) return notFoundError('node', id);
  const lockedBy = lockOf(draft, node);
  if (lockedBy !== undefined) return lockedError(id, lockedBy);

  // Remover um board leva os descendentes (os filhos e os membros dos grupos filhos). Um deles
  // `locked` recusa a remoção inteira, com o ID dele em `lockedBy`.
  const removed = node.type === 'board' ? descendantsOf(draft, node) : [];
  for (const descendant of removed) {
    if (descendant.locked) return lockedError(id, descendant.id);
  }

  // Converte vínculos de setas apontando para o nó em endpoints livres na última posição
  for (const target of [node, ...removed]) freeArrowsBoundTo(draft, target);

  if (node.type === 'group') {
    for (const childId of node.childIds) {
      const childNode = draft.getNode(childId);
      if (childNode && childNode.type !== 'group' && childNode.type !== 'board') {
        freeArrowsBoundTo(draft, childNode);
        draft.removeNode(childId);
      }
    }
  }
  for (const descendant of removed) draft.removeNode(descendant.id);

  const parent = draft.parentOf(id);
  const parentNode = parent === undefined ? undefined : draft.getNode(parent);
  if (parentNode?.type === 'board') {
    // O filho sai da lista do board; o grupo filho leva os membros junto (acima).
    draft.replaceNode({
      ...parentNode,
      childIds: parentNode.childIds.filter((childId) => childId !== id),
    });
  } else if (parentNode?.type === 'group') {
    dissolveGroupWithout(draft, parentNode, id);
  }

  draft.removeNode(id);
  return undefined;
}

/** Os descendentes de um board: os filhos e, nos grupos filhos, os membros. */
function descendantsOf(draft: Draft, board: BoardNode): CanvasNode[] {
  const found: CanvasNode[] = [];
  for (const childId of board.childIds) {
    const child = draft.getNode(childId);
    if (child === undefined) continue;
    found.push(child);
    if (child.type === 'group') {
      for (const memberId of child.childIds) {
        const member = draft.getNode(memberId);
        if (member !== undefined) found.push(member);
      }
    }
  }
  return found;
}

/** As pontas de seta ligadas ao nó passam a livres, na última posição dele. */
function freeArrowsBoundTo(draft: Draft, target: CanvasNode): void {
  if (target.type === 'group' || target.type === 'board') return;
  for (const arrow of draft.allNodes()) {
    if (arrow.type !== 'arrow' || arrow.id === target.id) continue;
    const boundStart = isBindingEndpoint(arrow.start) && arrow.start.targetId === target.id;
    const boundEnd = isBindingEndpoint(arrow.end) && arrow.end.targetId === target.id;
    if (!boundStart && !boundEnd) continue;
    draft.replaceNode({
      ...arrow,
      start: boundStart
        ? resolveAnchorPosition(target, (arrow.start as BindingEndpoint).anchor)
        : arrow.start,
      end: boundEnd
        ? resolveAnchorPosition(target, (arrow.end as BindingEndpoint).anchor)
        : arrow.end,
    });
  }
}

/**
 * Tira `memberId` de um grupo. Com menos de dois membros o grupo se dissolve e devolve o membro
 * que sobra ao pai dele: o board, se estiver num, ou a camada.
 */
function dissolveGroupWithout(draft: Draft, group: GroupNode, memberId: string): void {
  const remaining = group.childIds.filter((childId) => childId !== memberId);
  if (remaining.length >= 2) {
    draft.replaceNode({ ...group, childIds: remaining });
    return;
  }
  const groupParent = draft.parentOf(group.id);
  const board = groupParent === undefined ? undefined : draft.getNode(groupParent);
  if (board?.type === 'board') {
    const next = [...board.childIds];
    next.splice(next.indexOf(group.id), 1, ...remaining);
    draft.replaceNode({ ...board, childIds: next });
    for (const keptId of remaining) draft.setParent(keptId, board.id);
  } else {
    const layerHeader = draft.layerOf(group.id);
    const layer = draft.getLayer(layerHeader.id);
    const index = layer ? layer.childIds.indexOf(group.id) : -1;
    if (layer && index !== -1) {
      const next = [...layer.childIds];
      next.splice(index, 1, ...remaining);
      draft.setLayerChildren(layerHeader.id, next);
    }
    for (const keptId of remaining) draft.setParent(keptId, undefined);
  }
  draft.removeNode(group.id);
}
