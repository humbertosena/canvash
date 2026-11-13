import type { CanvasDocument, Layer } from './document.js';
import type { CanvasNode } from './shapes.js';

/** Onde um nó está na ordem do documento. */
export interface Placement {
  /** Camada que contém o nó. */
  readonly layer: Layer;
  /** Posição do nó em `childIds` da camada. */
  readonly index: number;
  /** Posição do nó na ordem visual do documento inteiro, do fundo (0) para a frente. */
  readonly rank: number;
  /** ID do grupo que contém o nó, caso pertença a um grupo. */
  readonly groupId?: string | undefined;
  /**
   * ID do board que contém o nó, caso seja filho dele ou membro de um grupo filho dele. O índice
   * e a camada são os do board, que é quem está em `Layer.childIds`.
   */
  readonly boardId?: string | undefined;
}

/** Posição de cada nó de um documento, por ID. */
export type Placements = ReadonlyMap<string, Placement>;

/** Registra um nó de camada ou filho de board e, se for grupo, os membros logo depois dele. */
function addNode(
  next: Map<string, Placement>,
  document: CanvasDocument,
  id: string,
  layer: Layer,
  index: number,
  boardId: string | undefined,
): void {
  const node = document.nodes[id];
  const inBoard = boardId === undefined ? {} : { boardId };
  next.set(id, { layer, index, rank: next.size, ...inBoard });
  if (node && node.type === 'group') {
    for (const childId of node.childIds) {
      next.set(childId, { layer, index, rank: next.size, groupId: id, ...inBoard });
    }
  }
}

/**
 * Cria a consulta de posições de um canvas. O documento só guarda a ordem na direção
 * camada → nós; este índice dá a direção inversa. É derivado: é refeito quando `layers` ou `nodes` mudam
 * de referência, e reaproveitado enquanto isso não acontece.
 */
export function createPlacements(): (document: CanvasDocument) => Placements {
  let indexedLayers: readonly Layer[] | undefined;
  let indexedNodes: Readonly<Record<string, CanvasNode>> | undefined;
  let placements: Placements = new Map();

  return (document) => {
    if (document.layers !== indexedLayers || document.nodes !== indexedNodes) {
      const next = new Map<string, Placement>();
      for (const layer of document.layers) {
        for (const [index, id] of layer.childIds.entries()) {
          const node = document.nodes[id];
          if (node && node.type === 'board') {
            // O board vem antes dos filhos: o fundo fica atrás deles pela própria ordem visual.
            next.set(id, { layer, index, rank: next.size });
            for (const childId of node.childIds) {
              addNode(next, document, childId, layer, index, id);
            }
          } else {
            addNode(next, document, id, layer, index, undefined);
          }
        }
      }
      indexedLayers = document.layers;
      indexedNodes = document.nodes;
      placements = next;
    }
    return placements;
  };
}
