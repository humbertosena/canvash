import {
  at,
  boolean,
  isFull,
  isPlainObject,
  isRecord,
  items,
  jsonObject,
  nonEmptyString,
  readAll,
  rejectUnknownKeys,
  report,
  RESERVED_KEY,
  type JsonObject,
  type Path,
} from './checks.js';
import { emptyNodes, SCHEMA_VERSION, type CanvasDocument, type Layer } from './document.js';
import { deepFreeze } from './freeze.js';
import {
  coordinateOverflow,
  resolveLimits,
  textLengthOverflow,
  type CanvasLimits,
} from './limits.js';
import {
  fail,
  limitError,
  ok,
  unsupportedVersionError,
  validationError,
  type Result,
  type ValidationIssue,
} from './result.js';
import { isBindingEndpoint, isZeroLengthArrow } from './arrows.js';
import { readStoredBoard } from './boards.js';
import { readStoredShape, type BoardNode, type CanvasNode } from './shapes.js';

/** Opções de {@link validateDocument}. */
export interface ValidateOptions {
  /** Limites a aplicar. O padrão são os limites máximos do core. */
  readonly limits?: CanvasLimits | undefined;
}

const NODES = at(undefined, 'nodes');
const LAYERS = at(undefined, 'layers');
const DOCUMENT_KEYS = ['schemaVersion', 'id', 'nodes', 'layers', 'metadata'];
const LAYER_KEYS = ['id', 'name', 'visible', 'locked', 'childIds', 'metadata'];

function readId(value: unknown, path: Path, issues: ValidationIssue[]): string {
  const id = nonEmptyString(value, path, issues);
  if (id === RESERVED_KEY) report(issues, path, 'reserved-id', `must not be "${RESERVED_KEY}"`);
  return id;
}

function readMetadata(
  input: Record<string, unknown>,
  path: Path,
  issues: ValidationIssue[],
): { metadata?: JsonObject } {
  const value = input['metadata'];
  return value === undefined ? {} : { metadata: jsonObject(value, at(path, 'metadata'), issues) };
}

/**
 * Confere um documento vindo de fora: de um arquivo, do armazenamento, de outra aplicação.
 * Devolve uma cópia própria, congelada e normalizada como a que os comandos produzem (cores em
 * minúsculas, rotação em `[-π, π)`), pronta para `replaceDocument`. A entrada não é alterada
 * nem guardada.
 *
 * Recusa: versão de schema que não é um inteiro positivo; `nodes` que não é um objeto literal
 * (um Map, por exemplo); campo ou tipo de nó desconhecido;
 * número não finito, dimensão não positiva e estilo fora da faixa; ID vazio, reservado ou
 * repetido; nó guardado sob chave diferente do próprio ID; camada que cita nó inexistente; nó
 * em mais de uma camada ou em nenhuma; documento sem camada; `metadata` que não é JSON, com
 * mais de 32 níveis ou com mais de 100.000 valores. Versão mais nova que
 * {@link SCHEMA_VERSION} devolve `UNSUPPORTED_VERSION` antes de qualquer outra conferência, e
 * documento acima dos limites devolve `LIMIT_EXCEEDED`.
 *
 * O que a própria entrada lança ao ser lida (um getter com defeito, um Proxy) chega a quem
 * chamou.
 *
 * @throws {TypeError} Se `options.limits` não for um objeto.
 * @throws {RangeError} Se `options.limits` trouxer um limite inválido ou acima do padrão.
 */
export function validateDocument(
  input: unknown,
  options: ValidateOptions = {},
): Result<CanvasDocument> {
  const limits = resolveLimits(options.limits);
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    report(issues, undefined, 'type', 'document must be an object');
    return fail(validationError(issues));
  }

  // A versão vem primeiro: um documento mais novo pode ter campos e tipos que esta versão não
  // conhece, e o erro certo para ele é o de versão.
  const schemaVersion = input['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    report(issues, at(undefined, 'schemaVersion'), 'type', 'must be a positive integer');
    return fail(validationError(issues));
  }
  if (schemaVersion > SCHEMA_VERSION) {
    return fail(unsupportedVersionError(schemaVersion, SCHEMA_VERSION));
  }

  rejectUnknownKeys(input, DOCUMENT_KEYS, undefined, issues);
  const id = readId(input['id'], at(undefined, 'id'), issues);
  const metadata = readMetadata(input, undefined, issues);

  // Um Map ou um Set no lugar do dicionário não tem chaves próprias: seria lido como um
  // documento sem nós.
  const rawNodes = input['nodes'];
  if (!isRecord(rawNodes) || !isPlainObject(rawNodes)) {
    report(issues, NODES, 'type', 'must be an object of nodes by ID');
    return fail(validationError(issues));
  }
  // A lista de chaves é a única fonte de quais nós existem: uma chave que ela não traz (não
  // enumerável, ou inventada por um Proxy) não é nó do documento, mesmo que o objeto responda
  // por ela.
  const keys = Object.keys(rawNodes);
  if (keys.length > limits.maxNodes) {
    return fail(limitError('nodes', limits.maxNodes, keys.length));
  }
  const known = new Set(keys);

  const nodes = emptyNodes();
  let overflow: number | undefined;
  let overflowText: number | undefined;
  for (const key of keys) {
    if (isFull(issues)) break;
    const path = at(NODES, key);
    const raw = rawNodes[key];
    if (key === RESERVED_KEY) {
      report(issues, path, 'reserved-id', `must not be "${RESERVED_KEY}"`);
    } else if (!isRecord(raw)) {
      report(issues, path, 'type', 'must be an object');
    } else {
      const before = issues.length;
      const node =
        raw['type'] === 'board'
          ? readStoredBoard(raw, path, issues)
          : readStoredShape(raw, path, issues);
      if (node === undefined || issues.length > before) continue;
      if (node.id !== key) {
        report(issues, at(path, 'id'), 'id-mismatch', 'must be the key the node is stored under');
      } else if (key === id) {
        report(issues, at(path, 'id'), 'duplicate-id', 'is the ID of the document');
      } else {
        if (node.type !== 'group') {
          overflow ??= coordinateOverflow(node, limits.maxCoordinate);
          overflowText ??= textLengthOverflow(node, limits.maxTextLength);
        }
        nodes[key] = node;
      }
    }
  }

  for (const [key, node] of Object.entries(nodes)) {
    if (isFull(issues)) break;
    if (node.type === 'arrow') {
      const path = at(NODES, key);
      if (isBindingEndpoint(node.start)) {
        if (node.start.targetId === key) {
          report(issues, at(path, 'start'), 'broken-reference', 'cannot bind to itself');
        } else if (!known.has(node.start.targetId)) {
          report(issues, at(path, 'start'), 'broken-reference', 'target node does not exist');
        }
      }
      if (isBindingEndpoint(node.end)) {
        if (node.end.targetId === key) {
          report(issues, at(path, 'end'), 'broken-reference', 'cannot bind to itself');
        } else if (!known.has(node.end.targetId)) {
          report(issues, at(path, 'end'), 'broken-reference', 'target node does not exist');
        }
      }
      if (
        isZeroLengthArrow(node, (targetId) => {
          const target = nodes[targetId];
          return target && target.type !== 'group' && target.type !== 'board' ? target : undefined;
        })
      ) {
        report(issues, path, 'zero-length', 'start and end must differ');
      }
    }
    if (node.type === 'board') {
      const path = at(NODES, key);
      const boardChildIds = new Set<string>();
      for (let pos = 0; pos < node.childIds.length; pos++) {
        const childId = node.childIds[pos]!;
        const itemPath = at(at(path, 'childIds'), pos);
        if (!known.has(childId)) {
          report(issues, itemPath, 'broken-reference', 'target node does not exist');
        } else if (childId === key) {
          report(issues, itemPath, 'broken-reference', 'board cannot contain itself');
        } else {
          if (nodes[childId]?.type === 'board') {
            report(issues, itemPath, 'nested-board', 'boards cannot be inside boards');
          }
          if (boardChildIds.has(childId)) {
            report(issues, itemPath, 'duplicate-id', 'child node listed multiple times');
          }
          boardChildIds.add(childId);
        }
      }
    }
    if (node.type === 'group') {
      const path = at(NODES, key);
      const groupChildIds = new Set<string>();
      for (let pos = 0; pos < node.childIds.length; pos++) {
        const childId = node.childIds[pos]!;
        const itemPath = at(at(path, 'childIds'), pos);
        if (!known.has(childId)) {
          report(issues, itemPath, 'broken-reference', 'target node does not exist');
        } else if (childId === key) {
          report(issues, itemPath, 'broken-reference', 'group cannot contain itself');
        } else {
          const childNode = nodes[childId];
          if (childNode && childNode.type === 'group') {
            report(issues, itemPath, 'nested-group', 'groups cannot contain groups as children');
          }
          if (childNode && childNode.type === 'board') {
            report(issues, itemPath, 'board-in-group', 'boards cannot be inside groups');
          }
          if (groupChildIds.has(childId)) {
            report(issues, itemPath, 'duplicate-id', 'child node listed multiple times');
          }
          groupChildIds.add(childId);
        }
      }
    }
  }

  const rawLayers: unknown = input['layers'];
  const layers: Layer[] = [];
  const layerIds = new Set<string>();
  const placed = new Set<string>();
  if (!Array.isArray(rawLayers)) {
    report(issues, LAYERS, 'type', 'must be an array of layers');
  } else if (rawLayers.length === 0) {
    report(issues, LAYERS, 'range', 'must have at least one layer');
  } else {
    for (const [index, raw] of items(rawLayers)) {
      if (isFull(issues)) break;
      const path = at(LAYERS, index);
      if (!isRecord(raw)) {
        report(issues, path, 'type', 'must be an object');
        continue;
      }
      rejectUnknownKeys(raw, LAYER_KEYS, path, issues);
      const beforeId = issues.length;
      const layerId = readId(raw['id'], at(path, 'id'), issues);
      // Um ID recusado não entra na conta dos repetidos: o marcador dele casaria com o de
      // outro ID recusado.
      if (issues.length === beforeId) {
        if (layerId === id || layerIds.has(layerId) || known.has(layerId)) {
          report(issues, at(path, 'id'), 'duplicate-id', 'is already used in this document');
        }
        layerIds.add(layerId);
      }
      const fields = readAll(
        raw,
        { name: nonEmptyString, visible: boolean, locked: boolean },
        path,
        issues,
      );

      const childIds: string[] = [];
      const rawChildren: unknown = raw['childIds'];
      const childrenPath = at(path, 'childIds');
      if (!Array.isArray(rawChildren)) {
        report(issues, childrenPath, 'type', 'must be an array of node IDs');
      } else {
        for (const [position, child] of items(rawChildren)) {
          if (isFull(issues)) break;
          const childPath = at(childrenPath, position);
          if (typeof child !== 'string') {
            report(issues, childPath, 'type', 'must be a node ID');
          } else if (!known.has(child)) {
            report(
              issues,
              childPath,
              'broken-reference',
              'must be the ID of a node of the document',
            );
          } else if (placed.has(child)) {
            report(issues, childPath, 'multiple-parents', 'is already listed by a layer or group');
          } else {
            placed.add(child);
            childIds.push(child);
            const node = nodes[child];
            if (node && node.type === 'board') {
              countBoardChildren(node, child, nodes, placed, issues);
            }
            if (node && node.type === 'group') {
              for (let subPos = 0; subPos < node.childIds.length; subPos++) {
                const subChild = node.childIds[subPos]!;
                const subPath = at(at(at(NODES, child), 'childIds'), subPos);
                if (placed.has(subChild)) {
                  report(
                    issues,
                    subPath,
                    'multiple-parents',
                    'is already listed by a layer or group',
                  );
                } else {
                  placed.add(subChild);
                }
              }
            }
          }
        }
      }
      layers.push({ id: layerId, ...fields, childIds, ...readMetadata(raw, path, issues) });
    }
    for (const key of keys) {
      if (isFull(issues)) break;
      if (!placed.has(key) && key !== RESERVED_KEY) {
        report(
          issues,
          at(NODES, key),
          'missing-parent',
          'must be listed by exactly one layer or group',
        );
      }
    }
  }

  if (issues.length > 0) return fail(validationError(issues));
  if (overflow !== undefined) {
    return fail(limitError('coordinate', limits.maxCoordinate, overflow));
  }
  if (overflowText !== undefined) {
    return fail(limitError('text', limits.maxTextLength, overflowText));
  }
  return ok(deepFreeze({ schemaVersion, id, nodes, layers, ...metadata }));
}

/**
 * Conta os filhos de um board entre os nós já listados por algum pai e recusa os que têm dois.
 * Cada filho entra uma vez por board e, se for grupo, os membros vêm logo depois dele. O que a
 * conferência dos filhos já recusou (inexistente, o próprio board, outro board, repetido) não
 * é recusado de novo aqui.
 */
function countBoardChildren(
  board: BoardNode,
  boardId: string,
  nodes: Record<string, CanvasNode>,
  placed: Set<string>,
  issues: ValidationIssue[],
): void {
  const childrenPath = at(at(NODES, boardId), 'childIds');
  const seen = new Set<string>();
  for (const [pos, childId] of board.childIds.entries()) {
    const child = nodes[childId];
    if (child === undefined || childId === boardId || seen.has(childId)) continue;
    seen.add(childId);
    if (placed.has(childId)) {
      report(
        issues,
        at(childrenPath, pos),
        'multiple-parents',
        'is already listed by a layer, group or board',
      );
      continue;
    }
    placed.add(childId);
    if (child.type !== 'group') continue;
    for (const [memberPos, memberId] of child.childIds.entries()) {
      if (placed.has(memberId)) {
        report(
          issues,
          at(at(at(NODES, childId), 'childIds'), memberPos),
          'multiple-parents',
          'is already listed by a layer, group or board',
        );
      } else {
        placed.add(memberId);
      }
    }
  }
}
