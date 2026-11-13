import { at, nonEmptyString, rejectUnknownKeys, report } from './checks.js';
import type { CanvasDocument } from './document.js';
import type { Draft } from './draft.js';
import type { IdGenerator } from './ids.js';
import { generateNewId, readNewId } from './new-ids.js';
import {
  lockedError,
  notFoundError,
  validationError,
  type CanvasError,
  type ValidationIssue,
} from './result.js';
import { lockOf } from './layers.js';
import type { CanvasNode, GroupNode } from './shapes.js';

export function isGroupNode(node: CanvasNode): node is GroupNode {
  return node.type === 'group';
}

/** Localiza o nó de grupo que contém `childId` como filho direto no documento. */
export function findGroupOfNode(document: CanvasDocument, childId: string): GroupNode | undefined {
  for (const node of Object.values(document.nodes)) {
    if (isGroupNode(node) && node.childIds.includes(childId)) {
      return node;
    }
  }
  return undefined;
}

/** Localiza o nó de grupo que contém `childId` como filho direto no rascunho. */
export function findGroupOfNodeInDraft(draft: Draft, childId: string): GroupNode | undefined {
  for (const node of draft.allNodes()) {
    if (isGroupNode(node) && node.childIds.includes(childId)) {
      return node;
    }
  }
  return undefined;
}

/** Executa o comando de criação de grupo (`group.create`). */
export function createGroup(
  draft: Draft,
  command: Record<string, unknown>,
  context: { readonly generateId: IdGenerator },
): CanvasError | undefined {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'id', 'childIds'], undefined, issues);

  const rawChildren = command['childIds'];
  const childrenPath = at(undefined, 'childIds');
  const childIds: string[] = [];

  if (!Array.isArray(rawChildren)) {
    report(issues, childrenPath, 'type', 'must be an array of node IDs');
  } else if (rawChildren.length < 2) {
    report(issues, childrenPath, 'range', 'requires at least two shapes to form a group');
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < rawChildren.length; i++) {
      const child = rawChildren[i];
      const itemPath = at(childrenPath, i);
      if (typeof child !== 'string' || child.trim() === '') {
        report(issues, itemPath, 'type', 'must be a non-empty string');
      } else if (seen.has(child)) {
        report(issues, itemPath, 'duplicate-id', 'child node listed multiple times');
      } else {
        seen.add(child);
        childIds.push(child);
      }
    }
  }

  const explicitId =
    command['id'] === undefined
      ? undefined
      : readNewId(draft, command['id'], at(undefined, 'id'), issues);

  if (issues.length > 0) {
    return validationError(issues);
  }

  // 1. Verifica existência de cada membro e se não é grupo
  for (const id of childIds) {
    const node = draft.getNode(id);
    if (!node) {
      return notFoundError('node', id);
    }
    if (isGroupNode(node)) {
      return validationError([
        {
          path: ['childIds'],
          rule: 'nested-group',
          message: 'groups cannot contain groups as children',
        },
      ]);
    }
    if (node.type === 'board') {
      return validationError([
        {
          path: ['childIds'],
          rule: 'board-in-group',
          message: 'groups cannot contain boards as children',
        },
      ]);
    }
  }

  // 2. Verifica se algum membro já pertence a outro grupo (restrição de 1 nível)
  for (const id of childIds) {
    const parentId = draft.parentOf(id);
    if (parentId !== undefined && draft.getNode(parentId)?.type === 'group') {
      return validationError([
        {
          path: ['childIds'],
          rule: 'nested-group',
          message: 'node is already part of a group',
        },
      ]);
    }
  }

  // 3. Verifica camada dos membros: todos devem pertencer à mesma camada
  const firstLayer = draft.layerOf(childIds[0]!);
  if (firstLayer.locked) {
    return lockedError(firstLayer.id, firstLayer.id);
  }

  for (const id of childIds) {
    const memberLayer = draft.layerOf(id);
    if (memberLayer.id !== firstLayer.id) {
      return validationError([
        {
          path: ['childIds'],
          rule: 'multiple-parents',
          message: 'all members must belong to the same layer',
        },
      ]);
    }
    // Os membros precisam ter o mesmo pai: todos na camada, ou todos no mesmo board.
    if (draft.parentOf(id) !== draft.parentOf(childIds[0]!)) {
      return validationError([
        {
          path: ['childIds'],
          rule: 'multiple-parents',
          message: 'all members must have the same parent (the layer or the same board)',
        },
      ]);
    }
    const lockedBy = lockOf(draft, draft.getNode(id)!);
    if (lockedBy !== undefined) {
      return lockedError(id, lockedBy);
    }
  }

  // 4. Semântica de ordem:
  // "Ao agrupar, retirar membros da ordem original e inserir grupo na posição do membro selecionado mais à frente, preservando a ordem relativa interna."
  const layer = draft.getLayer(firstLayer.id);
  if (!layer) {
    return notFoundError('layer', firstLayer.id);
  }

  // Os irmãos dos membros: os filhos do board, quando eles estão num, ou os da camada.
  const boardId = draft.parentOf(childIds[0]!);
  const board = boardId === undefined ? undefined : draft.getNode(boardId);
  const parentBoard = board?.type === 'board' ? board : undefined;
  const currentChildren = parentBoard ? parentBoard.childIds : layer.childIds;
  const indices = childIds.map((id) => currentChildren.indexOf(id));
  const maxIndex = Math.max(...indices);

  // Ordem interna preservada conforme a ordem relativa original dos membros na camada:
  const sortedChildIds = currentChildren.filter((id) => childIds.includes(id));

  // Retira os membros da camada
  const remaining = currentChildren.filter((id) => !childIds.includes(id));

  // O grupo entra na posição do membro selecionado mais à frente.
  // Contamos quantos membros removidos estavam antes de maxIndex para obter a posição final em remaining.
  let removedBeforeMax = 0;
  for (let i = 0; i < maxIndex; i++) {
    if (childIds.includes(currentChildren[i]!)) {
      removedBeforeMax++;
    }
  }
  const groupInsertIndex = maxIndex - removedBeforeMax;

  const nextLayerChildren = [...remaining];
  const groupId = explicitId ?? generateNewId(draft, context.generateId);

  nextLayerChildren.splice(groupInsertIndex, 0, groupId);

  const groupNode: GroupNode = {
    id: groupId,
    type: 'group',
    childIds: sortedChildIds,
    visible: true,
    locked: false,
  };

  draft.registerNode(groupNode, firstLayer.id);
  if (parentBoard) {
    draft.replaceNode({ ...parentBoard, childIds: nextLayerChildren });
    draft.setParent(groupId, parentBoard.id);
  } else {
    draft.setLayerChildren(firstLayer.id, nextLayerChildren);
  }
  for (const memberId of sortedChildIds) draft.setParent(memberId, groupId);

  return undefined;
}

/** Executa o comando de desagrupamento (`group.ungroup`). */
export function ungroupGroup(
  draft: Draft,
  command: Record<string, unknown>,
): CanvasError | undefined {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'id'], undefined, issues);
  const id = nonEmptyString(command['id'], at(undefined, 'id'), issues);

  if (issues.length > 0) {
    return validationError(issues);
  }

  const node = draft.getNode(id);
  if (!node) {
    return notFoundError('node', id);
  }
  if (!isGroupNode(node)) {
    return validationError([{ path: ['id'], rule: 'type', message: 'node is not a group' }]);
  }

  const layerHeader = draft.layerOf(id);
  const lockedBy = lockOf(draft, node);
  if (lockedBy !== undefined) {
    return lockedError(id, lockedBy);
  }

  // Dentro de um board, o grupo é substituído pelos membros na lista de filhos do board.
  const parentId = draft.parentOf(id);
  const parent = parentId === undefined ? undefined : draft.getNode(parentId);
  if (parent?.type === 'board') {
    const nextBoardChildren = [...parent.childIds];
    nextBoardChildren.splice(nextBoardChildren.indexOf(id), 1, ...node.childIds);
    draft.removeNode(id);
    draft.replaceNode({ ...parent, childIds: nextBoardChildren });
    for (const memberId of node.childIds) draft.setParent(memberId, parent.id);
    return undefined;
  }

  const layer = draft.getLayer(layerHeader.id);
  if (!layer) {
    return notFoundError('layer', layerHeader.id);
  }

  const currentChildren = layer.childIds;
  const groupIndex = currentChildren.indexOf(id);
  if (groupIndex === -1) {
    return validationError([
      { path: ['id'], rule: 'broken-reference', message: 'group is not listed in its layer' },
    ]);
  }

  // "Desagrupar substitui o grupo pelos filhos no mesmo ponto; os IDs são preservados (INPUT-08)"
  const nextChildren = [...currentChildren];
  nextChildren.splice(groupIndex, 1, ...node.childIds);

  draft.removeNode(id);
  draft.setLayerChildren(layerHeader.id, nextChildren);
  for (const memberId of node.childIds) draft.setParent(memberId, undefined);

  return undefined;
}
