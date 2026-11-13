import {
  at,
  boolean,
  finite,
  isRecord,
  jsonObject,
  nonEmptyString,
  readSome,
  rejectUnknownKeys,
  report,
  type Check,
  type JsonObject,
  type Path,
} from './checks.js';
import type { CanvasDocument, Layer } from './document.js';
import type { Draft } from './draft.js';
import type { IdGenerator } from './ids.js';
import { must } from './invariant.js';
import { generateNewId, readNewId } from './new-ids.js';
import type { Placements } from './placement.js';
import {
  lockedError,
  notFoundError,
  validationError,
  type CanvasError,
  type ValidationIssue,
} from './result.js';
import type { BoardNode, CanvasNode, GroupNode } from './shapes.js';

/** Cria uma camada vazia. Todos os campos têm padrão. */
export interface CreateLayerCommand {
  readonly type: 'layer.create';
  readonly layer?:
    | {
        /** Sem ID, o canvas gera um. */
        readonly id?: string | undefined;
        /** O padrão é `Layer N`, com N contando as camadas. */
        readonly name?: string | undefined;
        readonly visible?: boolean | undefined;
        readonly locked?: boolean | undefined;
        readonly metadata?: JsonObject | undefined;
      }
    | undefined;
  /** Posição entre as camadas, do fundo (0) para a frente. O padrão é a frente. */
  readonly index?: number | undefined;
}

/** Altera campos de uma camada. Vale também em camada bloqueada: é assim que ela é desbloqueada. */
export interface UpdateLayerCommand {
  readonly type: 'layer.update';
  readonly id: string;
  readonly patch: {
    readonly name?: string | undefined;
    readonly visible?: boolean | undefined;
    readonly locked?: boolean | undefined;
    /** Substitui o metadata inteiro; `null` o remove. */
    readonly metadata?: JsonObject | null | undefined;
  };
}

/** Leva uma camada para outra posição entre as camadas. */
export interface ReorderLayerCommand {
  readonly type: 'layer.reorder';
  readonly id: string;
  /** Posição final, do fundo (0) para a frente: de 0 ao número de camadas menos 1. */
  readonly index: number;
}

/** Leva um nó para outra posição da camada dele, ou para outra camada. */
export interface ReorderNodeCommand {
  readonly type: 'node.reorder';
  readonly id: string;
  /**
   * Posição final entre os nós da camada de destino, do fundo (0) para a frente, contada sem
   * o próprio nó: de 0 ao número de outros nós da camada.
   */
  readonly index: number;
  /** Camada de destino. O padrão é a camada que já contém o nó. */
  readonly layerId?: string | undefined;
}

/** Onde um nó está e o que vale para ele, somadas as regras da camada. */
export interface NodeInfo {
  /** Camada que contém o nó. */
  readonly layerId: string;
  /** Posição do nó em `childIds` da camada, do fundo (0) para a frente. */
  readonly index: number;
  /** ID do board que contém o nó, caso seja filho dele ou membro de um grupo filho dele. */
  readonly boardId: string | undefined;
  /** O nó e a camada estão visíveis. */
  readonly visible: boolean;
  /** O nó ou a camada estão bloqueados: o nó não pode ser editado. */
  readonly locked: boolean;
}

type Handler = (
  draft: Draft,
  command: Record<string, unknown>,
  context: { readonly generateId: IdGenerator },
) => CanvasError | undefined;

const LAYER = at(undefined, 'layer');
const PATCH = at(undefined, 'patch');
const INDEX = at(undefined, 'index');
const ID = at(undefined, 'id');

const LAYER_FIELDS = { name: nonEmptyString, visible: boolean, locked: boolean };
const LAYER_PATCH_KEYS = [...Object.keys(LAYER_FIELDS), 'metadata'];

/** Posição inteira entre `0` e `max`. */
function position(max: number): Check<number> {
  return (value, path, issues) => {
    const before = issues.length;
    const index = finite(value, path, issues);
    if (issues.length === before && (!Number.isInteger(index) || index < 0 || index > max)) {
      report(issues, path, 'range', `must be an integer from 0 to ${max}`);
    }
    return index;
  };
}

/**
 * ID do que bloqueia a edição do nó: a camada dele, se estiver bloqueada, ou o próprio nó.
 * `undefined` quando o nó pode ser editado.
 */
export function lockOf(draft: Draft, node: CanvasNode): string | undefined {
  const layer = draft.layerOf(node.id);
  if (layer.locked) return layer.id;
  // Sobe pelos pais diretos (membro → grupo → board): um pai bloqueado bloqueia o que está nele.
  for (let parentId = draft.parentOf(node.id), depth = 0; parentId !== undefined; depth += 1) {
    const parent = draft.getNode(parentId);
    if (parent === undefined || depth >= MAX_PARENT_DEPTH) break;
    if (parent.locked) return parent.id;
    parentId = draft.parentOf(parentId);
  }
  return node.locked ? node.id : undefined;
}

// Membro → grupo → board: nenhum documento válido passa de três níveis; o teto protege de um ciclo.
const MAX_PARENT_DEPTH = 8;

/** Diz onde o nó está e o que vale para ele. `undefined` se o ID não é de um nó. */
export function nodeInfo(
  document: CanvasDocument,
  placements: Placements,
  id: string,
): NodeInfo | undefined {
  // Um valor que não é texto viraria texto ao indexar `nodes` e passaria por ID de um nó.
  const node = typeof id === 'string' ? document.nodes[id] : undefined;
  if (node === undefined) return undefined;
  const placement = must(placements.get(id), 'the placement of a node');
  const group = placement.groupId ? document.nodes[placement.groupId] : undefined;
  const board = placement.boardId ? document.nodes[placement.boardId] : undefined;
  const parentsVisible = (group ? group.visible : true) && (board ? board.visible : true);
  const parentsLocked = (group ? group.locked : false) || (board ? board.locked : false);
  return {
    layerId: placement.layer.id,
    index: placement.index,
    boardId: placement.boardId,
    visible: node.visible && parentsVisible && placement.layer.visible,
    locked: node.locked || parentsLocked || placement.layer.locked,
  };
}

function readMetadata(
  input: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): { metadata?: JsonObject } {
  const value = input['metadata'];
  return value === undefined ? {} : { metadata: jsonObject(value, at(path, 'metadata'), issues) };
}

export const createLayer: Handler = (draft, command, context) => {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'layer', 'index'], undefined, issues);
  const count = draft.layerIds().length;
  const index =
    command['index'] === undefined ? count : position(count)(command['index'], INDEX, issues);

  const input = command['layer'] === undefined ? {} : command['layer'];
  if (!isRecord(input)) {
    report(issues, LAYER, 'type', 'must be an object');
    return validationError(issues);
  }
  rejectUnknownKeys(input, ['id', ...LAYER_PATCH_KEYS], LAYER, issues);
  const fields = readSome(input, LAYER_FIELDS, LAYER, issues);
  const metadata = readMetadata(input, LAYER, issues);
  const givenId =
    input['id'] === undefined ? undefined : readNewId(draft, input['id'], at(LAYER, 'id'), issues);
  if (issues.length > 0) return validationError(issues);

  const layer: Layer = {
    id: givenId ?? generateNewId(draft, context.generateId),
    name: fields.name ?? `Layer ${count + 1}`,
    visible: fields.visible ?? true,
    locked: fields.locked ?? false,
    childIds: [],
    ...metadata,
  };
  draft.addLayer(layer, index);
  return undefined;
};

export const updateLayer: Handler = (draft, command) => {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'id', 'patch'], undefined, issues);
  const id = nonEmptyString(command['id'], ID, issues);
  const patch = command['patch'];
  if (!isRecord(patch)) {
    report(issues, PATCH, 'type', 'must be an object');
    return validationError(issues);
  }
  rejectUnknownKeys(patch, LAYER_PATCH_KEYS, PATCH, issues);
  const fields = readSome(patch, LAYER_FIELDS, PATCH, issues);
  // `null` remove o metadata; ele é tratado à parte para não passar pela conferência de objeto.
  const metadata = patch['metadata'] === null ? {} : readMetadata(patch, PATCH, issues);
  if (issues.length > 0) return validationError(issues);

  const layer = draft.getLayer(id);
  if (layer === undefined) return notFoundError('layer', id);
  const { metadata: previous, ...rest } = layer;
  const kept =
    patch['metadata'] === undefined && previous !== undefined ? { metadata: previous } : {};
  draft.replaceLayer({ ...rest, ...fields, ...kept, ...metadata });
  return undefined;
};

export const reorderLayer: Handler = (draft, command) => {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'id', 'index'], undefined, issues);
  const id = nonEmptyString(command['id'], ID, issues);
  const index = position(draft.layerIds().length - 1)(command['index'], INDEX, issues);
  if (issues.length > 0) return validationError(issues);
  if (draft.layerHeader(id) === undefined) return notFoundError('layer', id);

  draft.moveLayer(id, index);
  return undefined;
};

export const reorderNode: Handler = (draft, command) => {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'id', 'index', 'layerId'], undefined, issues);
  const id = nonEmptyString(command['id'], ID, issues);
  const layerId =
    command['layerId'] === undefined
      ? undefined
      : nonEmptyString(command['layerId'], at(undefined, 'layerId'), issues);
  // A posição só pode ser conferida contra a camada de destino; aqui vale o tipo.
  finite(command['index'], INDEX, issues);
  if (issues.length > 0) return validationError(issues);

  const node = draft.getNode(id);
  if (node === undefined) return notFoundError('node', id);
  const source = draft.layerOf(id);
  const targetId = layerId ?? source.id;
  const target = draft.getLayer(targetId);
  if (target === undefined) return notFoundError('layer', targetId);

  // Um membro de grupo e um filho de board só se reordenam entre os irmãos do pai deles.
  const parentId = draft.parentOf(id);
  const parentNode = parentId === undefined ? undefined : draft.getNode(parentId);
  const group =
    parentNode !== undefined && (parentNode.type === 'group' || parentNode.type === 'board')
      ? parentNode
      : undefined;

  if (group !== undefined) {
    if (layerId !== undefined && layerId !== source.id) {
      return validationError([
        {
          path: ['layerId'],
          rule: 'multiple-parents',
          message: `node is inside a ${group.type} and cannot be moved to another layer directly`,
        },
      ]);
    }
    const others = group.childIds.length - 1;
    const index = position(others)(command['index'], INDEX, issues);
    if (issues.length > 0) return validationError(issues);

    const lockedBy = lockOf(draft, node) ?? (target.locked ? target.id : undefined);
    if (lockedBy !== undefined) return lockedError(id, lockedBy);

    const nextChildren = [...group.childIds];
    nextChildren.splice(nextChildren.indexOf(id), 1);
    nextChildren.splice(index, 0, id);
    draft.replaceNode({ ...group, childIds: nextChildren });
    return undefined;
  }

  const others = target.childIds.length - (target.id === source.id ? 1 : 0);
  const index = position(others)(command['index'], INDEX, issues);
  if (issues.length > 0) return validationError(issues);

  const lockedBy = lockOf(draft, node) ?? (target.locked ? target.id : undefined);
  if (lockedBy !== undefined) return lockedError(id, lockedBy);

  draft.moveNode(id, target.id, index);
  return undefined;
};

export type SiblingReorderAction =
  'bringToFront' | 'sendToBack' | 'bringForward' | 'sendBackward' | 'moveUp' | 'moveDown';

/** O grupo ou o board que lista o nó como filho direto. */
function findParentOfNode(document: CanvasDocument, id: string): GroupNode | BoardNode | undefined {
  for (const candidate of Object.values(document.nodes)) {
    if (
      (candidate.type === 'group' || candidate.type === 'board') &&
      candidate.childIds.includes(id)
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Calcula o índice de destino para operações de reordenação entre irmãos
 * (dentro do mesmo grupo ou board, ou dentro da mesma camada).
 * Retorna `undefined` se o nó não for encontrado.
 */
export function computeSiblingReorderIndex(
  document: CanvasDocument,
  id: string,
  action: SiblingReorderAction,
): number | undefined {
  const node = document.nodes[id];
  if (!node) return undefined;

  const parent = findParentOfNode(document, id);
  const siblings = parent
    ? parent.childIds
    : document.layers.find((l) => l.childIds.includes(id))?.childIds;
  if (!siblings) return undefined;

  const currentIndex = siblings.indexOf(id);
  if (currentIndex === -1) return undefined;

  const maxIndex = siblings.length - 1;
  switch (action) {
    case 'bringToFront':
      return maxIndex;
    case 'sendToBack':
      return 0;
    case 'bringForward':
    case 'moveUp':
      return Math.min(maxIndex, currentIndex + 1);
    case 'sendBackward':
    case 'moveDown':
      return Math.max(0, currentIndex - 1);
  }
}
