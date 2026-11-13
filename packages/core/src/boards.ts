import {
  at,
  colorOrNull,
  finite,
  nonEmptyString,
  positive,
  readAll,
  readSome,
  rejectUnknownKeys,
  report,
  unitInterval,
  type Check,
  type Path,
} from './checks.js';
import type { Draft } from './draft.js';
import { lockOf } from './layers.js';
import {
  lockedError,
  notFoundError,
  validationError,
  type CanvasError,
  type ValidationIssue,
} from './result.js';
import {
  FLAGS,
  patchMetadata,
  readMetadata,
  readStoredStyle,
  readStyle,
  type BoardNode,
  type BoardStyle,
} from './shapes.js';
import { containsHtmlTags } from './text.js';

/** Monta o board quando o ID é conhecido. O ID só é gerado depois que a entrada inteira passou. */
export type BoardFactory = (id: string) => BoardNode;

/** Maior título aceito, em caracteres. */
const MAX_BOARD_TITLE_LENGTH = 200;

/** O título que o board ganha quando o input não dá um. */
const DEFAULT_BOARD_TITLE = 'Board';

const DEFAULT_BOARD_STYLE: BoardStyle = { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' };

const BOARD_GEOMETRY = { x: finite, y: finite, width: positive, height: positive };
const BOARD_STYLE_SPEC = { fill: colorOrNull, fillOpacity: unitInterval, stroke: colorOrNull };

const BOARD_PATCH_KEYS = [
  ...Object.keys(BOARD_GEOMETRY),
  'title',
  'style',
  'visible',
  'locked',
  'metadata',
];
const BOARD_INPUT_KEYS = ['type', 'id', ...BOARD_PATCH_KEYS];

/** Uma linha, de 1 a 200 caracteres, sem tags HTML. */
const boardTitleCheck: Check<string> = (value, path, issues) => {
  if (typeof value !== 'string' || value === '') {
    report(issues, path, 'type', 'must be a non-empty string');
    return DEFAULT_BOARD_TITLE;
  }
  if (value.length > MAX_BOARD_TITLE_LENGTH) {
    report(issues, path, 'range', `must have at most ${MAX_BOARD_TITLE_LENGTH} characters`);
  }
  if (/[\r\n\u2028\u2029]/.test(value)) {
    report(issues, path, 'format', 'must be a single line');
  }
  if (containsHtmlTags(value)) {
    report(issues, path, 'format', 'must not contain HTML tags');
  }
  return value;
};

/**
 * Confere a entrada de um board novo e materializa os padrões. O board nasce sem filhos: a
 * pertença muda só pelos comandos `board.attach` e `board.detach`.
 */
export function readBoardInput(
  input: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): BoardFactory {
  rejectUnknownKeys(input, BOARD_INPUT_KEYS, path, issues);
  const geometry = readAll(input, BOARD_GEOMETRY, path, issues);
  const title =
    input['title'] === undefined
      ? DEFAULT_BOARD_TITLE
      : boardTitleCheck(input['title'], at(path, 'title'), issues);
  const style: BoardStyle = {
    ...DEFAULT_BOARD_STYLE,
    ...readStyle(input['style'], BOARD_STYLE_SPEC, at(path, 'style'), issues),
  };
  const flags = { visible: true, locked: false, ...readSome(input, FLAGS, path, issues) };
  const metadata = readMetadata(input, path, issues);
  return (id) => ({
    id,
    type: 'board',
    ...geometry,
    title,
    style,
    childIds: [],
    ...flags,
    ...metadata,
  });
}

const BOARD_STORED_KEYS = [
  'id',
  'type',
  ...Object.keys(BOARD_GEOMETRY),
  'title',
  'style',
  'childIds',
  'visible',
  'locked',
  'metadata',
];

/**
 * Confere um board já materializado, como o de um documento carregado: todo campo é obrigatório,
 * menos `metadata`. Só olha o próprio nó; que os filhos existam e que ninguém tenha dois pais é
 * conferência do documento (`validateDocument`).
 */
export function readStoredBoard(
  value: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): BoardNode {
  rejectUnknownKeys(value, BOARD_STORED_KEYS, path, issues);
  const id = nonEmptyString(value['id'], at(path, 'id'), issues);
  const geometry = readAll(value, BOARD_GEOMETRY, path, issues);
  const title = boardTitleCheck(value['title'], at(path, 'title'), issues);
  const style = readStoredStyle(value['style'], BOARD_STYLE_SPEC, at(path, 'style'), issues);
  const flags = readAll(value, FLAGS, path, issues);
  const metadata = readMetadata(value, path, issues);

  const childIds: string[] = [];
  const rawChildren = value['childIds'];
  const childrenPath = at(path, 'childIds');
  if (!Array.isArray(rawChildren)) {
    report(issues, childrenPath, 'type', 'must be an array of node IDs');
  } else {
    for (const [index, child] of rawChildren.entries()) {
      if (typeof child !== 'string' || child === '') {
        report(issues, at(childrenPath, index), 'type', 'must be a non-empty string');
      } else {
        childIds.push(child);
      }
    }
  }
  return { id, type: 'board', ...geometry, title, style, childIds, ...flags, ...metadata };
}

/**
 * Aplica um patch a um board: posição, tamanho, título, estilo (`fill`, `fillOpacity` e `stroke`),
 * `visible`, `locked` e `metadata`. Qualquer outro campo, como `type`, `rotation` ou `childIds`,
 * é recusado com `unknown-field`. Mover o board por aqui não move os descendentes: quem os leva
 * junto é a interação.
 */
export function patchBoard(
  node: BoardNode,
  patch: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): BoardNode {
  rejectUnknownKeys(patch, BOARD_PATCH_KEYS, path, issues);
  const geometry = readSome(patch, BOARD_GEOMETRY, path, issues);
  const title =
    patch['title'] === undefined
      ? node.title
      : boardTitleCheck(patch['title'], at(path, 'title'), issues);
  const style: BoardStyle = {
    ...node.style,
    ...readStyle(patch['style'], BOARD_STYLE_SPEC, at(path, 'style'), issues),
  };
  const flags = readSome(patch, FLAGS, path, issues);
  return patchMetadata({ ...node, ...geometry, title, style, ...flags }, patch, path, issues);
}

/** Põe nós no board, à frente dos filhos atuais, na ordem visual em que estavam. */
export interface AttachToBoardCommand {
  readonly type: 'board.attach';
  readonly boardId: string;
  /** Nós de nível superior da camada do board, ou filhos de outro board da mesma camada. */
  readonly ids: readonly string[];
}

/** Tira filhos dos boards deles e os põe na camada, logo à frente do board de origem. */
export interface DetachFromBoardCommand {
  readonly type: 'board.detach';
  readonly ids: readonly string[];
}

const IDS = at(undefined, 'ids');

/** Lê `ids`: uma lista de pelo menos um ID de nó, sem repetição. */
function readIds(value: unknown, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value)) {
    report(issues, IDS, 'type', 'must be an array of node IDs');
    return [];
  }
  if (value.length === 0) {
    report(issues, IDS, 'range', 'requires at least one node ID');
    return [];
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const itemPath = at(IDS, index);
    const id = nonEmptyString(raw, itemPath, issues);
    if (id === '') continue;
    if (seen.has(id)) report(issues, itemPath, 'duplicate-id', 'node listed multiple times');
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Primeiro bloqueio entre os nós, ou `undefined` se todos podem mudar de pai. */
function firstLock(draft: Draft, ids: readonly string[]): CanvasError | undefined {
  for (const id of ids) {
    const lockedBy = lockOf(draft, draft.getNode(id)!);
    if (lockedBy !== undefined) return lockedError(id, lockedBy);
  }
  return undefined;
}

/** Executa `board.attach`: a lista explícita de filhos muda, e os nós saem de onde estavam. */
export function attachToBoard(
  draft: Draft,
  command: Record<string, unknown>,
): CanvasError | undefined {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'boardId', 'ids'], undefined, issues);
  const boardId = nonEmptyString(command['boardId'], at(undefined, 'boardId'), issues);
  const ids = readIds(command['ids'], issues);
  if (issues.length > 0) return validationError(issues);

  const board = draft.getNode(boardId);
  if (board === undefined) return notFoundError('node', boardId);
  if (board.type !== 'board') {
    return validationError([{ path: ['boardId'], rule: 'type', message: 'node is not a board' }]);
  }
  for (const id of ids) {
    const node = draft.getNode(id);
    if (node === undefined) return notFoundError('node', id);
    if (node.type === 'board') {
      return validationError([
        { path: ['ids'], rule: 'nested-board', message: 'boards cannot be inside boards' },
      ]);
    }
  }
  const layerId = draft.layerOf(boardId).id;
  for (const id of ids) {
    const parent = draft.parentOf(id);
    if (parent !== undefined && draft.getNode(parent)?.type === 'group') {
      return validationError([
        {
          path: ['ids'],
          rule: 'multiple-parents',
          message: 'node is a member of a group; attach the group instead',
        },
      ]);
    }
    if (draft.layerOf(id).id !== layerId) {
      return validationError([
        {
          path: ['ids'],
          rule: 'multiple-parents',
          message: 'all nodes must belong to the layer of the board',
        },
      ]);
    }
  }
  const locked = firstLock(draft, [boardId, ...ids]);
  if (locked !== undefined) return locked;

  // A ordem visual de hoje: a posição do nó (ou do board dele) na camada e, dentro do board, a
  // posição entre os irmãos.
  const layer = draft.getLayer(layerId)!;
  const layerIndex = new Map(layer.childIds.map((childId, index) => [childId, index]));
  const keyOf = (id: string): [number, number] => {
    const parent = draft.parentOf(id);
    if (parent === undefined) return [layerIndex.get(id)!, -1];
    const parentBoard = draft.getNode(parent) as BoardNode;
    return [layerIndex.get(parent)!, parentBoard.childIds.indexOf(id)];
  };
  const ordered = [...ids].sort((a, b) => {
    const [layerA, siblingA] = keyOf(a);
    const [layerB, siblingB] = keyOf(b);
    return layerA - layerB || siblingA - siblingB;
  });
  draft.attachToBoard(boardId, ordered);
  return undefined;
}

/** Executa `board.detach`: os filhos voltam para a camada, logo à frente do board de origem. */
export function detachFromBoard(
  draft: Draft,
  command: Record<string, unknown>,
): CanvasError | undefined {
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(command, ['type', 'ids'], undefined, issues);
  const ids = readIds(command['ids'], issues);
  if (issues.length > 0) return validationError(issues);

  for (const id of ids) {
    if (draft.getNode(id) === undefined) return notFoundError('node', id);
  }
  for (const id of ids) {
    const parent = draft.parentOf(id);
    if (parent === undefined || draft.getNode(parent)?.type !== 'board') {
      return validationError([
        { path: ['ids'], rule: 'missing-parent', message: 'node is not a child of a board' },
      ]);
    }
  }
  const locked = firstLock(draft, ids);
  if (locked !== undefined) return locked;

  draft.detachFromBoard(ids);
  return undefined;
}
