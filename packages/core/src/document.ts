import type { JsonObject } from './checks.js';
import { nextId, type IdGenerator } from './ids.js';
import type { CanvasNode } from './shapes.js';

/** Versão do schema dos documentos que esta versão do core cria e aceita carregar. */
export const SCHEMA_VERSION = 1;

// Nome fixo, sem depender de idioma: o documento padrão precisa ser o mesmo em qualquer
// ambiente. O host pode renomear a camada.
const DEFAULT_LAYER_NAME = 'Layer 1';

/**
 * Camada do documento. A ordem visual dos nós é a de `childIds`, do fundo para a frente.
 */
export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  /** IDs dos nós da camada, do fundo para a frente. */
  readonly childIds: readonly string[];
  /** Dados do consumidor, só com valores JSON. O core guarda uma cópia e nunca os interpreta. */
  readonly metadata?: JsonObject;
}

/**
 * Documento editado por um canvas. Contém só valores JSON e é somente leitura: toda alteração
 * passa pelo canvas e produz um documento novo.
 */
export interface CanvasDocument {
  /** Versão do schema do documento. Não é a revisão do snapshot. */
  readonly schemaVersion: number;
  readonly id: string;
  /**
   * Nós do documento, indexados por ID. Nunca derive ordem deste mapa: a ordem é a de
   * `layers` e `childIds`. O objeto não herda de `Object.prototype`: buscar um ID que não
   * existe devolve `undefined`, mesmo que o ID seja `constructor` ou `toString`.
   */
  readonly nodes: Readonly<Record<string, CanvasNode>>;
  /** Camadas, do fundo para a frente. */
  readonly layers: readonly Layer[];
  /**
   * Dados do consumidor sobre o documento, só com valores JSON. Entram com o documento
   * carregado e são preservados; nenhum comando os altera.
   */
  readonly metadata?: JsonObject;
}

/**
 * Cria o documento padrão: nenhum nó e uma camada vazia. O gerador é chamado duas vezes,
 * primeiro para o documento e depois para a camada.
 *
 * @throws {TypeError} Se o gerador devolver algo que não seja uma string não vazia, devolver
 * o ID reservado `__proto__` ou repetir o ID do documento na camada.
 */
export function createDefaultDocument(generateId: IdGenerator): CanvasDocument {
  const id = nextId(generateId);
  const layerId = nextId(generateId);
  if (layerId === id) {
    throw new TypeError('generateId must return a different ID on each call');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    nodes: emptyNodes(),
    layers: [{ id: layerId, name: DEFAULT_LAYER_NAME, visible: true, locked: false, childIds: [] }],
  };
}

/** Mapa de nós vazio, sem protótipo: nenhuma chave herdada passa por nó. */
export function emptyNodes(): Record<string, CanvasNode> {
  return Object.create(null) as Record<string, CanvasNode>;
}
