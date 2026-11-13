import { emptyNodes, type CanvasDocument, type Layer } from './document.js';
import { jsonEqual } from './equal.js';
import { deepFreeze } from './freeze.js';
import { must } from './invariant.js';
import type { BoardNode, CanvasNode } from './shapes.js';

/** Valor de um item do documento antes e depois de uma alteração. `undefined` é "não existe". */
export interface EntityChange<T> {
  readonly before: T | undefined;
  readonly after: T | undefined;
}

/**
 * Diferença entre dois documentos. Aplicar o lado `after` refaz a alteração e aplicar o lado
 * `before` a desfaz: é o que o histórico guarda.
 */
export interface DocumentPatch {
  /** Nós que mudaram de valor, na ordem em que foram tocados. */
  readonly nodes: ReadonlyMap<string, EntityChange<CanvasNode>>;
  /** Camadas que mudaram de valor (inclusive de `childIds`), na ordem em que foram tocadas. */
  readonly layers: ReadonlyMap<string, EntityChange<Layer>>;
  /** IDs das camadas do fundo para a frente, quando a ordem mudou. */
  readonly layerOrder:
    { readonly before: readonly string[]; readonly after: readonly string[] } | undefined;
  /** Nós reposicionados: mudaram de posição ou de camada, sem necessariamente mudar de valor. */
  readonly moved: readonly string[];
}

/** Diz o ID da camada de um nó do documento de partida. Um `Map` serve. */
export interface ParentLookup {
  get(nodeId: string): string | undefined;
  /**
   * O pai direto do nó no documento de partida: o grupo ou o board que o lista, ou `undefined`
   * para o nó de nível superior. Sem esta consulta, o rascunho a deriva do documento, uma vez.
   */
  parentOf?(nodeId: string): string | undefined;
  /** Quantos nós o documento de partida tem. */
  readonly size: number;
}

/** Documento resultante de um rascunho, com a diferença em relação ao documento de partida. */
export interface DraftOutcome {
  readonly document: CanvasDocument;
  readonly patch: DocumentPatch;
  /** IDs dos nós e das camadas que o rascunho criou e que continuam existindo, na ordem de criação. */
  readonly createdIds: readonly string[];
}

/** Uma camada sem a lista de filhos: o que basta para saber quem ela é e se está bloqueada. */
export type LayerHeader = Omit<Layer, 'childIds'>;

/**
 * Cópia de trabalho de um documento. Os comandos de uma transação alteram o rascunho, e o
 * documento de partida só é substituído se todos passarem: descartar o rascunho é o rollback.
 *
 * A lista de filhos de uma camada tocada fica em um array de trabalho próprio do rascunho, e a
 * remoção de um filho é só anotada, para ser aplicada de uma vez quando a lista for lida.
 * Assim, criar ou remover milhares de nós em uma transação custa proporcional ao número de
 * comandos, e não ao número de comandos vezes o tamanho da camada.
 */
export class Draft {
  readonly #base: CanvasDocument;
  readonly #baseParents: ParentLookup;
  // Só o que o rascunho tocou. `undefined` marca o que foi removido.
  readonly #nodes = new Map<string, CanvasNode | undefined>();
  // Registro de cada camada tocada. O `childIds` do registro pode estar defasado: quando a
  // camada tem lista de trabalho, vale a lista.
  readonly #layers = new Map<string, Layer>();
  readonly #children = new Map<string, string[]>();
  // Filhos removidos de cada lista de trabalho e ainda não tirados dela.
  readonly #dropped = new Map<string, Set<string>>();
  readonly #parents = new Map<string, string | undefined>();
  // O pai direto (grupo ou board) dos nós que o rascunho tocou. `undefined` é nível superior.
  readonly #direct = new Map<string, string | undefined>();
  #derivedParents: Map<string, string> | undefined;
  readonly #moved = new Set<string>();
  readonly #created: string[] = [];
  #order: string[] | undefined;
  #nodeCount: number;

  /**
   * @param base Documento de partida.
   * @param parents Camada de cada nó de `base`, por ID do nó.
   */
  constructor(base: CanvasDocument, parents: ParentLookup) {
    this.#base = base;
    this.#baseParents = parents;
    this.#nodeCount = parents.size;
  }

  /** Quantos nós o documento tem neste ponto do rascunho. */
  get nodeCount(): number {
    return this.#nodeCount;
  }

  /** Diz se o ID já pertence ao documento, a uma camada ou a um nó. */
  hasId(id: string): boolean {
    return (
      id === this.#base.id || this.layerHeader(id) !== undefined || this.getNode(id) !== undefined
    );
  }

  getNode(id: string): CanvasNode | undefined {
    return this.#nodes.has(id) ? this.#nodes.get(id) : this.#base.nodes[id];
  }

  /** Itera sobre todos os nós atualmente presentes no rascunho. */
  *allNodes(): IterableIterator<CanvasNode> {
    const seen = new Set<string>();
    for (const [id, node] of this.#nodes) {
      seen.add(id);
      if (node !== undefined) yield node;
    }
    for (const [id, node] of Object.entries(this.#base.nodes)) {
      if (!seen.has(id)) yield node;
    }
  }

  /** A camada, sem garantir a lista de filhos em dia. Não custa nada: serve a quem só precisa saber se ela existe ou está bloqueada. */
  layerHeader(id: string): LayerHeader | undefined {
    return this.#layers.get(id) ?? this.#base.layers.find((layer) => layer.id === id);
  }

  /** A camada com a lista de filhos em dia. */
  getLayer(id: string): Layer | undefined {
    const header = this.layerHeader(id);
    return header && { ...header, childIds: this.#childIdsOf(id) };
  }

  /** IDs das camadas, do fundo para a frente. */
  layerIds(): readonly string[] {
    return this.#order ?? this.#base.layers.map((layer) => layer.id);
  }

  /** A camada mais à frente, que recebe o que é criado sem camada explícita. */
  frontLayer(): LayerHeader {
    const frontId = must(this.layerIds().at(-1), 'a layer in the document');
    return must(this.layerHeader(frontId), 'the front layer');
  }

  /** A camada que contém o nó. */
  layerOf(nodeId: string): LayerHeader {
    const layerId = this.#parents.has(nodeId)
      ? this.#parents.get(nodeId)
      : this.#baseParents.get(nodeId);
    return must(this.layerHeader(must(layerId, 'the layer of a node')), 'the layer of a node');
  }

  /**
   * O pai direto do nó: o grupo ou o board que o lista, ou `undefined` quando o nó está direto
   * na camada (ou não existe).
   */
  parentOf(nodeId: string): string | undefined {
    if (this.#direct.has(nodeId)) return this.#direct.get(nodeId);
    const lookup = this.#baseParents;
    if (lookup.parentOf !== undefined) return lookup.parentOf(nodeId);
    return (this.#derivedParents ??= deriveParents(this.#base)).get(nodeId);
  }

  /** Diz que o pai direto do nó passou a ser `parentId`, ou a camada se for `undefined`. */
  setParent(nodeId: string, parentId: string | undefined): void {
    this.#direct.set(nodeId, parentId);
  }

  /** Acrescenta um nó à frente dos demais da camada. */
  addNode(node: CanvasNode, layerId: string): void {
    // Um ID removido nesta transação e criado de novo: a remoção é aplicada antes, para o nó
    // recriado não ser levado junto. Nos outros casos o nó entra direto no fim, e as remoções
    // continuam pendentes: aplicá-las a cada criação filtraria a lista inteira a cada comando.
    const recreated = this.#dropped.get(layerId)?.has(node.id) === true;
    (recreated ? this.#materialize(layerId) : this.#working(layerId)).push(node.id);
    this.#nodes.set(node.id, node);
    this.#parents.set(node.id, layerId);
    this.#direct.set(node.id, undefined);
    this.#nodeCount += 1;
    this.#created.push(node.id);
  }

  /** Registra um nó no mapa de nós e no histórico de criação sem alterar a lista de filhos da camada. */
  registerNode(node: CanvasNode, layerId: string): void {
    this.#nodes.set(node.id, node);
    this.#parents.set(node.id, layerId);
    this.#direct.set(node.id, undefined);
    this.#nodeCount += 1;
    this.#created.push(node.id);
  }

  /** Substitui um nó que já existe, sem mudar de camada nem de posição. */
  replaceNode(node: CanvasNode): void {
    this.#nodes.set(node.id, node);
  }

  /** Remove um nó do documento e da camada que o contém. */
  removeNode(id: string): void {
    const layerId = this.layerOf(id).id;
    this.#working(layerId);
    let dropped = this.#dropped.get(layerId);
    if (dropped === undefined) {
      dropped = new Set();
      this.#dropped.set(layerId, dropped);
    }
    dropped.add(id);
    this.#nodes.set(id, undefined);
    this.#parents.set(id, undefined);
    this.#direct.set(id, undefined);
    this.#nodeCount -= 1;
  }

  /**
   * Leva um nó para a posição `index` da camada `layerId`, que pode ser a que já o contém.
   * `index` é a posição final, contada com o nó já fora da posição antiga.
   */
  moveNode(id: string, layerId: string, index: number): void {
    const source = this.#materialize(this.layerOf(id).id);
    source.splice(source.indexOf(id), 1);
    this.#materialize(layerId).splice(index, 0, id);
    this.#parents.set(id, layerId);
    this.#moved.add(id);

    const node = this.getNode(id);
    if (node && (node.type === 'group' || node.type === 'board')) {
      for (const childId of node.childIds) {
        this.#parents.set(childId, layerId);
        this.#moved.add(childId);
        // Num board, o filho pode ser um grupo, e os membros dele vão junto.
        const child = this.getNode(childId);
        if (node.type === 'board' && child && child.type === 'group') {
          for (const memberId of child.childIds) {
            this.#parents.set(memberId, layerId);
            this.#moved.add(memberId);
          }
        }
      }
    }
  }

  /**
   * Põe os nós no fim de `childIds` do board, na ordem dada, e os tira de onde estavam: da lista
   * da camada ou de outro board. O chamador já conferiu que os nós são da camada do board.
   */
  attachToBoard(boardId: string, ids: readonly string[]): void {
    const layerId = this.layerOf(boardId).id;
    const moving = new Set(ids);
    const fromBoards = new Set<string>();
    let fromLayer = false;
    for (const id of ids) {
      const parent = this.parentOf(id);
      if (parent === undefined) fromLayer = true;
      else fromBoards.add(parent);
    }
    if (fromLayer) {
      this.setLayerChildren(
        layerId,
        this.#materialize(layerId).filter((childId) => !moving.has(childId)),
      );
    }
    fromBoards.add(boardId);
    for (const otherId of fromBoards) {
      const other = this.getNode(otherId) as BoardNode;
      this.replaceNode({
        ...other,
        childIds: other.childIds.filter((childId) => !moving.has(childId)),
      });
    }
    const board = this.getNode(boardId) as BoardNode;
    this.replaceNode({ ...board, childIds: [...board.childIds, ...ids] });
    for (const id of ids) this.setParent(id, boardId);
  }

  /**
   * Tira os nós do board que os lista e os devolve à lista da camada, logo à frente do board de
   * origem, na ordem em que estavam nele. O chamador já conferiu que todos são filhos de board.
   */
  detachFromBoard(ids: readonly string[]): void {
    const byBoard = new Map<string, Set<string>>();
    for (const id of ids) {
      const boardId = this.parentOf(id) as string;
      let group = byBoard.get(boardId);
      if (group === undefined) byBoard.set(boardId, (group = new Set()));
      group.add(id);
    }
    for (const [boardId, leaving] of byBoard) {
      const board = this.getNode(boardId) as BoardNode;
      const layerId = this.layerOf(boardId).id;
      const children = this.#materialize(layerId);
      const returned = board.childIds.filter((childId) => leaving.has(childId));
      const at = children.indexOf(boardId) + 1;
      this.setLayerChildren(layerId, [
        ...children.slice(0, at),
        ...returned,
        ...children.slice(at),
      ]);
      this.replaceNode({
        ...board,
        childIds: board.childIds.filter((childId) => !leaving.has(childId)),
      });
      for (const id of returned) this.setParent(id, undefined);
    }
  }

  /** Acrescenta uma camada na posição `index` da ordem das camadas. */
  addLayer(layer: Layer, index: number): void {
    this.#layers.set(layer.id, layer);
    this.#children.set(layer.id, [...layer.childIds]);
    this.#order = inserted(this.layerIds(), layer.id, index);
    this.#created.push(layer.id);
  }

  /** Substitui os campos de uma camada que já existe. A posição e os filhos dela não mudam. */
  replaceLayer(layer: Layer): void {
    this.#layers.set(layer.id, layer);
  }

  /** Leva uma camada para a posição `index`, contada com ela já fora da posição antiga. */
  moveLayer(id: string, index: number): void {
    this.#order = inserted(without(this.layerIds(), id), id, index);
  }

  /** Substitui a lista de filhos de uma camada. */
  setLayerChildren(layerId: string, childIds: readonly string[]): void {
    this.#working(layerId);
    this.#children.set(layerId, [...childIds]);
    this.#dropped.delete(layerId);
  }

  /** A lista de trabalho dos filhos de uma camada, criada na primeira alteração dela. */
  #working(layerId: string): string[] {
    let working = this.#children.get(layerId);
    if (working === undefined) {
      const header = must(this.layerHeader(layerId), 'a layer to change');
      working = [...(header as Layer).childIds];
      this.#children.set(layerId, working);
      // O registro entra na lista das camadas tocadas, na ordem em que foram tocadas.
      this.#layers.set(layerId, header as Layer);
    }
    return working;
  }

  /** A lista de trabalho, com as remoções pendentes aplicadas. */
  #materialize(layerId: string): string[] {
    const working = this.#working(layerId);
    const dropped = this.#dropped.get(layerId);
    if (dropped === undefined || dropped.size === 0) return working;
    const kept = working.filter((id) => !dropped.has(id));
    dropped.clear();
    this.#children.set(layerId, kept);
    return kept;
  }

  #childIdsOf(layerId: string): readonly string[] {
    if (this.#children.has(layerId)) return this.#materialize(layerId);
    return (must(this.layerHeader(layerId), 'a layer of the document') as Layer).childIds;
  }

  /**
   * Fecha o rascunho: devolve o documento novo e o que mudou em relação ao de partida, ou
   * `undefined` quando nada mudou de valor.
   */
  finish(): DraftOutcome | undefined {
    const base = this.#base;
    const nodes = new Map<string, EntityChange<CanvasNode>>();
    for (const [id, after] of this.#nodes) {
      const before = base.nodes[id];
      if (!jsonEqual(before, after)) nodes.set(id, { before, after });
    }
    const layers = new Map<string, EntityChange<Layer>>();
    for (const [id, record] of this.#layers) {
      const before = base.layers.find((layer) => layer.id === id);
      // A lista de trabalho continua sendo do rascunho: o documento recebe uma cópia. Camada
      // que só teve campos trocados mantém a lista que já tinha.
      const after = this.#children.has(id)
        ? { ...record, childIds: [...this.#materialize(id)] }
        : record;
      if (!jsonEqual(before, after)) layers.set(id, { before, after });
    }
    const beforeOrder = base.layers.map((layer) => layer.id);
    const layerOrder =
      this.#order !== undefined && !jsonEqual(beforeOrder, this.#order)
        ? { before: beforeOrder, after: this.#order }
        : undefined;
    if (nodes.size === 0 && layers.size === 0 && layerOrder === undefined) return undefined;

    // Reposicionado é o nó que já existia, continua existindo e terminou em outra camada ou em
    // outra posição da mesma. O nó levado e trazido de volta não conta.
    const positions = new Map<readonly string[], Map<string, number>>();
    const positionIn = (childIds: readonly string[], id: string): number | undefined => {
      let byId = positions.get(childIds);
      if (byId === undefined) {
        byId = new Map(childIds.map((childId, index) => [childId, index]));
        positions.set(childIds, byId);
      }
      return byId.get(id);
    };
    const moved = [...this.#moved].filter((id) => {
      const fromId = this.#baseParents.get(id);
      const from = base.layers.find((layer) => layer.id === fromId);
      if (from === undefined || this.getNode(id) === undefined) return false;
      const to = this.layerOf(id);
      return (
        to.id !== from.id ||
        positionIn(this.#childIdsOf(to.id), id) !== positionIn(from.childIds, id)
      );
    });
    const patch: DocumentPatch = { nodes, layers, layerOrder, moved };
    // Criado é o que um comando criou e existe no fim: o que foi criado e removido na mesma
    // transação fica de fora, e o ID removido e criado de novo conta, uma vez.
    const createdIds = [...new Set(this.#created)].filter((id) => this.hasId(id));
    return { patch, document: applyPatch(base, patch), createdIds };
  }
}

/** Pai direto de cada nó do documento: o grupo ou o board que o lista. */
function deriveParents(document: CanvasDocument): Map<string, string> {
  const parents = new Map<string, string>();
  for (const node of Object.values(document.nodes)) {
    if (node.type !== 'group' && node.type !== 'board') continue;
    for (const childId of node.childIds) parents.set(childId, node.id);
  }
  return parents;
}

function without(ids: readonly string[], id: string): string[] {
  return ids.filter((other) => other !== id);
}

function inserted(ids: readonly string[], id: string, index: number): string[] {
  return [...ids.slice(0, index), id, ...ids.slice(index)];
}

/**
 * Devolve o documento com o lado `after` do patch aplicado, já congelado. O documento recebido
 * precisa estar congelado e não muda. O que o patch não toca é reaproveitado, e só o que ele
 * traz de novo é percorrido para congelar: o custo acompanha o tamanho da alteração, salvo a
 * cópia do mapa de nós.
 */
export function applyPatch(document: CanvasDocument, patch: DocumentPatch): CanvasDocument {
  let nodes = document.nodes;
  if (patch.nodes.size > 0) {
    const next = Object.assign(emptyNodes(), document.nodes);
    for (const [id, change] of patch.nodes) {
      if (change.after === undefined) delete next[id];
      else next[id] = deepFreeze(change.after);
    }
    nodes = Object.freeze(next);
  }

  let layers = document.layers;
  if (patch.layers.size > 0 || patch.layerOrder !== undefined) {
    const byId = new Map(document.layers.map((layer) => [layer.id, layer]));
    for (const [id, change] of patch.layers) {
      if (change.after !== undefined) byId.set(id, deepFreeze(change.after));
    }
    const order = patch.layerOrder?.after ?? document.layers.map((layer) => layer.id);
    layers = Object.freeze(
      order.map((id) => must(byId.get(id), 'a layer listed in the layer order')),
    );
  }
  return Object.freeze({ ...document, nodes, layers });
}

/** O patch que desfaz `patch`: os mesmos itens, com antes e depois trocados. */
export function invertPatch(patch: DocumentPatch): DocumentPatch {
  const swap = <T>(changes: ReadonlyMap<string, EntityChange<T>>): Map<string, EntityChange<T>> =>
    new Map([...changes].map(([id, { before, after }]) => [id, { before: after, after: before }]));
  return {
    nodes: swap(patch.nodes),
    layers: swap(patch.layers),
    layerOrder: patch.layerOrder && {
      before: patch.layerOrder.after,
      after: patch.layerOrder.before,
    },
    moved: patch.moved,
  };
}

/**
 * IDs do que o patch criou, alterou, removeu ou reposicionou: primeiro os nós, depois as
 * camadas, cada grupo na ordem em que foi tocado. Camada que só mudou de posição também entra.
 */
export function affectedIds(patch: DocumentPatch): string[] {
  const ids = new Set([...patch.nodes.keys(), ...patch.moved, ...patch.layers.keys()]);
  if (patch.layerOrder !== undefined) {
    const { before, after } = patch.layerOrder;
    for (const [index, id] of after.entries()) {
      if (before[index] !== id) ids.add(id);
    }
  }
  return [...ids];
}
