import { describe, expect, it } from 'vitest';
import { emptyNodes, type CanvasDocument } from './document.js';
import { Draft, type DraftOutcome } from './draft.js';
import type { BoardNode, GroupNode, LineNode } from './shapes.js';

function line(id: string): LineNode {
  return {
    id,
    type: 'line',
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    visible: true,
    locked: false,
    style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
  };
}

/** Documento com duas camadas; a do fundo já tem um nó. */
function twoLayers(): CanvasDocument {
  return {
    schemaVersion: 1,
    id: 'doc',
    nodes: Object.assign(emptyNodes(), { old: line('old') }),
    layers: [
      { id: 'back', name: 'Back', visible: true, locked: false, childIds: ['old'] },
      { id: 'front', name: 'Front', visible: true, locked: false, childIds: [] },
    ],
  };
}

const PARENTS: ReadonlyMap<string, string> = new Map([['old', 'back']]);

function finished(draft: Draft): DraftOutcome {
  const outcome = draft.finish();
  if (outcome === undefined) throw new Error('o rascunho deveria ter alterações');
  return outcome;
}

describe('Draft', () => {
  it('enxerga os IDs do documento, das camadas e dos nós, inclusive os que ele mesmo criou', () => {
    const draft = new Draft(twoLayers(), PARENTS);

    draft.addNode(line('new'), 'front');

    expect(['doc', 'back', 'front', 'old', 'new'].map((id) => draft.hasId(id))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(draft.hasId('other')).toBe(false);
    expect(draft.hasId('constructor')).toBe(false);
  });

  it('entrega como camada da frente a versão já alterada no próprio rascunho', () => {
    const base = twoLayers();
    const draft = new Draft(base, PARENTS);
    expect(draft.frontLayer()).toBe(base.layers[1]);

    draft.addNode(line('new'), 'front');

    expect(draft.frontLayer().id).toBe('front');
    expect(draft.getLayer('front')?.childIds).toEqual(['new']);
  });

  it('fecha com o documento novo e o que mudou, sem tocar no documento de partida', () => {
    const base = twoLayers();
    const draft = new Draft(base, PARENTS);

    draft.addNode(line('a'), 'back');
    draft.addNode(line('b'), 'back');
    const { document, patch } = finished(draft);

    expect(document.layers.map((layer) => layer.childIds)).toEqual([['old', 'a', 'b'], []]);
    expect(Object.keys(document.nodes)).toEqual(['old', 'a', 'b']);
    expect([...patch.nodes]).toEqual([
      ['a', { before: undefined, after: line('a') }],
      ['b', { before: undefined, after: line('b') }],
    ]);
    expect([...patch.layers]).toEqual([
      ['back', { before: base.layers[0], after: document.layers[0] }],
    ]);
    expect(base).toEqual(twoLayers());
  });

  it('reaproveita no documento novo o que não foi tocado', () => {
    const base = twoLayers();
    const draft = new Draft(base, PARENTS);

    draft.addNode(line('a'), 'back');
    const { document } = finished(draft);

    expect(document.layers[1]).toBe(base.layers[1]);
    expect(document.nodes['old']).toBe(base.nodes['old']);
    expect(document.layers[0]).not.toBe(base.layers[0]);
    expect(Object.getPrototypeOf(document.nodes)).toBeNull();
  });

  it('lança erro de defeito interno ao criar nó em camada que não existe', () => {
    const draft = new Draft(twoLayers(), PARENTS);

    expect(() => draft.addNode(line('a'), 'gone')).toThrow('Canvash internal error');
  });

  it('substitui um nó sem mexer na camada dele', () => {
    const base = twoLayers();
    const draft = new Draft(base, PARENTS);
    const moved = { ...line('old'), end: { x: 9, y: 9 } };

    draft.replaceNode(moved);
    const { document, patch } = finished(draft);

    expect(draft.getNode('old')).toBe(moved);
    expect(document.nodes['old']).toBe(moved);
    expect(document.layers).toBe(base.layers);
    expect([...patch.nodes]).toEqual([['old', { before: base.nodes['old'], after: moved }]]);
    expect(patch.layers.size).toBe(0);
  });

  it('remove um nó do documento e da camada, e deixa o ID livre', () => {
    const base = twoLayers();
    const draft = new Draft(base, PARENTS);

    draft.removeNode('old');
    const { document, patch } = finished(draft);

    expect(draft.getNode('old')).toBeUndefined();
    expect(draft.hasId('old')).toBe(false);
    expect(Object.keys(document.nodes)).toEqual([]);
    expect(document.layers[0]?.childIds).toEqual([]);
    expect(document.layers[1]).toBe(base.layers[1]);
    expect([...patch.nodes]).toEqual([['old', { before: base.nodes['old'], after: undefined }]]);
    expect([...patch.layers.keys()]).toEqual(['back']);
  });

  it('acha a camada de um nó do documento e de um nó criado no próprio rascunho', () => {
    const draft = new Draft(twoLayers(), PARENTS);

    draft.addNode(line('new'), 'front');

    expect(draft.layerOf('old').id).toBe('back');
    expect(draft.layerOf('new').id).toBe('front');
    expect(draft.getLayer(draft.layerOf('new').id)?.childIds).toEqual(['new']);
  });

  it('lança erro de defeito interno ao procurar a camada de um nó removido ou inexistente', () => {
    const draft = new Draft(twoLayers(), PARENTS);
    draft.removeNode('old');

    expect(() => draft.layerOf('old')).toThrow('Canvash internal error');
    expect(() => draft.layerOf('never')).toThrow('Canvash internal error');
  });

  it('fecha sem resultado quando nada mudou de valor', () => {
    const untouched = new Draft(twoLayers(), PARENTS);
    const rewritten = new Draft(twoLayers(), PARENTS);
    const undone = new Draft(twoLayers(), PARENTS);

    rewritten.replaceNode(line('old'));
    undone.addNode(line('new'), 'front');
    undone.removeNode('new');

    expect(untouched.finish()).toBeUndefined();
    expect(rewritten.finish()).toBeUndefined();
    expect(undone.finish()).toBeUndefined();
  });

  it('deixa fora do patch o item reescrito com o mesmo valor', () => {
    const draft = new Draft(twoLayers(), PARENTS);

    draft.replaceNode(line('old'));
    draft.addNode(line('new'), 'front');
    const { patch } = finished(draft);

    expect([...patch.nodes.keys()]).toEqual(['new']);
    expect([...patch.layers.keys()]).toEqual(['front']);
  });

  it('só conta como reposicionado o nó que já existia, continua existindo e mudou de lugar', () => {
    const base: CanvasDocument = {
      ...twoLayers(),
      nodes: Object.assign(emptyNodes(), {
        old: line('old'),
        other: line('other'),
        gone: line('gone'),
      }),
      layers: [
        {
          id: 'back',
          name: 'Back',
          visible: true,
          locked: false,
          childIds: ['old', 'other', 'gone'],
        },
        { id: 'front', name: 'Front', visible: true, locked: false, childIds: [] },
      ],
    };
    const parents = new Map([
      ['old', 'back'],
      ['other', 'back'],
      ['gone', 'back'],
    ]);
    const draft = new Draft(base, parents);

    // Criado e movido na mesma transação: é criação, não reposicionamento.
    draft.addNode(line('new'), 'back');
    draft.moveNode('new', 'front', 0);
    // Movido e depois removido: é remoção.
    draft.moveNode('gone', 'front', 0);
    draft.removeNode('gone');
    // Levado e trazido de volta: não mudou de lugar.
    draft.moveNode('old', 'front', 0);
    draft.moveNode('old', 'back', 0);
    // Este mudou de camada.
    draft.moveNode('other', 'front', 1);
    const { patch, createdIds } = finished(draft);

    expect(patch.moved).toEqual(['other']);
    expect(createdIds).toEqual(['new']);
    expect([...patch.nodes.keys()].sort()).toEqual(['gone', 'new']);
  });

  it('lê a lista de filhos com as remoções e criações da transação já aplicadas', () => {
    const base: CanvasDocument = {
      ...twoLayers(),
      nodes: Object.assign(emptyNodes(), { a: line('a'), b: line('b'), c: line('c') }),
      layers: [
        { id: 'back', name: 'Back', visible: true, locked: false, childIds: ['a', 'b', 'c'] },
      ],
    };
    const draft = new Draft(
      base,
      new Map([
        ['a', 'back'],
        ['b', 'back'],
        ['c', 'back'],
      ]),
    );

    draft.removeNode('a');
    draft.removeNode('c');
    expect(draft.getLayer('back')?.childIds).toEqual(['b']);

    draft.addNode(line('d'), 'back');
    draft.removeNode('b');
    draft.addNode(line('e'), 'back');
    expect(draft.getLayer('back')?.childIds).toEqual(['d', 'e']);
    expect(draft.nodeCount).toBe(2);
    expect(base.layers[0]?.childIds).toEqual(['a', 'b', 'c']);
  });

  it('o ID removido e criado de novo na transação volta uma vez só, no fim da camada', () => {
    const base: CanvasDocument = {
      ...twoLayers(),
      nodes: Object.assign(emptyNodes(), { a: line('a'), b: line('b') }),
      layers: [{ id: 'back', name: 'Back', visible: true, locked: false, childIds: ['a', 'b'] }],
    };
    const draft = new Draft(
      base,
      new Map([
        ['a', 'back'],
        ['b', 'back'],
      ]),
    );

    draft.removeNode('a');
    draft.addNode(line('a'), 'back');
    const { document, createdIds } = finished(draft);

    expect(document.layers[0]?.childIds).toEqual(['b', 'a']);
    expect(createdIds).toEqual(['a']);
  });

  it('entrega ao documento uma cópia da lista de filhos, que o rascunho não altera depois', () => {
    const draft = new Draft(twoLayers(), PARENTS);
    draft.addNode(line('a'), 'front');
    const { document } = finished(draft);

    draft.addNode(line('b'), 'front');

    expect(document.layers[1]?.childIds).toEqual(['a']);
    expect(Object.isFrozen(document.layers[1]?.childIds)).toBe(true);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.nodes['a'])).toBe(true);
  });

  it('mantém a ordem quando criações e remoções se alternam na mesma camada', () => {
    const base: CanvasDocument = {
      ...twoLayers(),
      nodes: Object.assign(emptyNodes(), { a: line('a'), b: line('b'), c: line('c') }),
      layers: [
        { id: 'back', name: 'Back', visible: true, locked: false, childIds: ['a', 'b', 'c'] },
      ],
    };
    const draft = new Draft(
      base,
      new Map([
        ['a', 'back'],
        ['b', 'back'],
        ['c', 'back'],
      ]),
    );

    // O nó criado com remoção pendente entra no fim; o ID removido e criado de novo também,
    // sem levar junto a posição antiga.
    draft.removeNode('a');
    draft.addNode(line('x'), 'back');
    draft.removeNode('c');
    draft.addNode(line('y'), 'back');
    draft.addNode(line('a'), 'back');
    draft.removeNode('x');
    draft.addNode(line('z'), 'back');
    const { document, createdIds } = finished(draft);

    expect(document.layers[0]?.childIds).toEqual(['b', 'y', 'a', 'z']);
    expect(Object.keys(document.nodes).sort()).toEqual(['a', 'b', 'y', 'z']);
    expect(createdIds).toEqual(['y', 'a', 'z']);
    expect(draft.nodeCount).toBe(4);
  });

  it('troca milhares de nós, alternando remoção e criação, sem custo quadrático', () => {
    const count = 40_000;
    const draft = new Draft(twoLayers(), PARENTS);
    for (let index = 0; index < count; index += 1) draft.addNode(line(`n${index}`), 'front');

    for (let index = 0; index < count / 2; index += 1) {
      draft.removeNode(`n${index}`);
      draft.addNode(line(`m${index}`), 'front');
    }
    const { document } = finished(draft);

    // Aplicar as remoções pendentes a cada criação filtraria a lista inteira 20 mil vezes, 800
    // milhões de comparações: o prazo padrão do teste acusaria a volta do custo quadrático.
    const childIds = document.layers[1]?.childIds ?? [];
    expect(childIds).toHaveLength(count);
    expect(childIds.slice(0, 2)).toEqual([`n${count / 2}`, `n${count / 2 + 1}`]);
    expect(childIds.slice(count / 2, count / 2 + 2)).toEqual(['m0', 'm1']);
    expect(childIds.at(-1)).toBe(`m${count / 2 - 1}`);
  });

  it('cria e remove milhares de nós em uma transação sem custo quadrático', () => {
    const count = 20_000;
    const draft = new Draft(twoLayers(), PARENTS);

    for (let index = 0; index < count; index += 1) draft.addNode(line(`n${index}`), 'front');
    for (let index = 0; index < count; index += 2) draft.removeNode(`n${index}`);
    const { document } = finished(draft);

    // Com a cópia da lista a cada comando seriam 400 milhões de cópias de ID; o teste está
    // aqui pelo resultado, e o prazo padrão do teste acusaria a volta do custo quadrático.
    expect(document.layers[1]?.childIds).toHaveLength(count / 2);
    expect(document.layers[1]?.childIds.slice(0, 3)).toEqual(['n1', 'n3', 'n5']);
    expect(Object.keys(document.nodes)).toHaveLength(count / 2 + 1);
  });
});

describe('Draft.parentOf', () => {
  const group = (id: string, childIds: string[]): GroupNode => ({
    id,
    type: 'group',
    childIds,
    visible: true,
    locked: false,
  });
  const board = (id: string, childIds: string[]): BoardNode => ({
    id,
    type: 'board',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    title: id,
    style: { fill: '#ffffff', fillOpacity: 1, stroke: null },
    childIds,
    visible: true,
    locked: false,
  });

  /** Camada com `top`, um grupo `g` (m1, m2) e um board `b` (c1, e o grupo `bg` com m3). */
  function nested(): CanvasDocument {
    return {
      schemaVersion: 1,
      id: 'doc',
      nodes: Object.assign(emptyNodes(), {
        top: line('top'),
        g: group('g', ['m1', 'm2']),
        m1: line('m1'),
        m2: line('m2'),
        b: board('b', ['c1', 'bg']),
        c1: line('c1'),
        bg: group('bg', ['m3']),
        m3: line('m3'),
      }),
      layers: [{ id: 'l', name: 'L', visible: true, locked: false, childIds: ['top', 'g', 'b'] }],
    };
  }
  const LAYER_OF = new Map(
    ['top', 'g', 'm1', 'm2', 'b', 'c1', 'bg', 'm3'].map((id) => [id, 'l'] as const),
  );

  it('dá o pai direto: grupo, board ou nada para o nó de nível superior', () => {
    const draft = new Draft(nested(), LAYER_OF);

    expect(draft.parentOf('top')).toBeUndefined();
    expect(draft.parentOf('g')).toBeUndefined();
    expect(draft.parentOf('m1')).toBe('g');
    expect(draft.parentOf('c1')).toBe('b');
    expect(draft.parentOf('bg')).toBe('b');
    expect(draft.parentOf('m3')).toBe('bg');
  });

  it('usa o pai direto do documento de partida quando o chamador o fornece', () => {
    const lookup = Object.assign(new Map(LAYER_OF), {
      parentOf: (id: string) => (id === 'c1' ? 'dado-por-fora' : undefined),
    });
    const draft = new Draft(nested(), lookup);

    expect(draft.parentOf('c1')).toBe('dado-por-fora');
  });

  it('acompanha o que o rascunho muda: nó removido não tem pai, nó movido de camada o mantém', () => {
    const draft = new Draft(nested(), LAYER_OF);

    draft.removeNode('c1');
    draft.moveNode('b', 'l', 0);

    expect(draft.parentOf('c1')).toBeUndefined();
    expect(draft.parentOf('bg')).toBe('b');
  });

  it('moveNode de um board leva a camada dos filhos e dos membros dos grupos dentro dele', () => {
    const base = nested();
    const doc: CanvasDocument = {
      ...base,
      layers: [
        ...base.layers,
        { id: 'other', name: 'Other', visible: true, locked: false, childIds: [] },
      ],
    };
    const draft = new Draft(doc, LAYER_OF);

    draft.moveNode('b', 'other', 0);

    for (const id of ['b', 'c1', 'bg', 'm3']) expect(draft.layerOf(id).id).toBe('other');
    expect(draft.layerOf('top').id).toBe('l');
  });

  it('attachToBoard tira o nó da camada, põe no fim do board e muda o pai', () => {
    const draft = new Draft(nested(), LAYER_OF);

    draft.attachToBoard('b', ['top']);

    expect(draft.parentOf('top')).toBe('b');
    expect(draft.getLayer('l')!.childIds).toEqual(['g', 'b']);
    expect((draft.getNode('b') as BoardNode).childIds).toEqual(['c1', 'bg', 'top']);
  });

  it('detachFromBoard devolve o filho à camada logo à frente do board', () => {
    const draft = new Draft(nested(), LAYER_OF);

    draft.detachFromBoard(['c1']);

    expect(draft.parentOf('c1')).toBeUndefined();
    expect(draft.getLayer('l')!.childIds).toEqual(['top', 'g', 'b', 'c1']);
    expect((draft.getNode('b') as BoardNode).childIds).toEqual(['bg']);
  });
});
