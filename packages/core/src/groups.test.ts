import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import type { GroupNode } from './shapes.js';
import { isGroupNode } from './groups.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const LAYER_ID = 'id-2';

const RECT_A = {
  id: 'box-a',
  type: 'rectangle',
  x: 100,
  y: 100,
  width: 100,
  height: 50,
  rotation: 0,
  visible: true,
  locked: false,
  style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
} as const;

const RECT_B = {
  id: 'box-b',
  type: 'rectangle',
  x: 250,
  y: 100,
  width: 100,
  height: 50,
  rotation: 0,
  visible: true,
  locked: false,
  style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
} as const;

const RECT_C = {
  id: 'box-c',
  type: 'rectangle',
  x: 400,
  y: 100,
  width: 100,
  height: 50,
  rotation: 0,
  visible: true,
  locked: false,
  style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
} as const;

const RECT_D = {
  id: 'box-d',
  type: 'rectangle',
  x: 550,
  y: 100,
  width: 100,
  height: 50,
  rotation: 0,
  visible: true,
  locked: false,
  style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
} as const;

function setupSectionWithShapes(): CanvasSectionApi {
  const section = createCanvasSection({ generateId: counter() });
  section.dispatch({ type: 'shape.create', shape: RECT_A });
  section.dispatch({ type: 'shape.create', shape: RECT_B });
  section.dispatch({ type: 'shape.create', shape: RECT_C });
  section.dispatch({ type: 'shape.create', shape: RECT_D });
  return section;
}

function dispatchUntyped(
  section: CanvasSectionApi,
  command: unknown,
): ReturnType<CanvasSectionApi['dispatch']> {
  return section.dispatch(command as CanvasCommand);
}

describe('group.create', () => {
  it('agrupa ao menos dois shapes da mesma camada e insere o grupo na posição do membro mais à frente', () => {
    const section = setupSectionWithShapes();
    // Camada inicial tem childIds: ['box-a', 'box-b', 'box-c', 'box-d'] (índices 0, 1, 2, 3)
    // Agrupando 'box-b' e 'box-d' (membro mais à frente é 'box-d' no índice 3):
    const res = section.dispatch({
      type: 'group.create',
      id: 'grp-1',
      childIds: ['box-d', 'box-b'], // Ordem de entrada invertida deve preservar a ordem interna original ['box-b', 'box-d']
    });

    expect(res).toMatchObject({
      ok: true,
      value: {
        changed: true,
        createdIds: ['grp-1'],
      },
    });

    const doc = section.getSnapshot().document;
    const groupNode = doc.nodes['grp-1'] as GroupNode;
    expect(groupNode).toBeDefined();
    expect(isGroupNode(groupNode)).toBe(true);
    expect(groupNode.type).toBe('group');
    // Preserva a ordem interna relativa dos membros:
    expect(groupNode.childIds).toEqual(['box-b', 'box-d']);

    // O grupo entra na posição do membro selecionado mais à frente ('box-d'):
    // Posições originais: a(0), b(1), c(2), d(3).
    // Membros restantes: a(0), c(1).
    // Novo índice do grupo: 2.
    // childIds resultante da camada: ['box-a', 'box-c', 'grp-1']
    expect(doc.layers[0]!.childIds).toEqual(['box-a', 'box-c', 'grp-1']);
  });

  it('gera ID automaticamente quando id for omitido', () => {
    const section = setupSectionWithShapes();
    const res = section.dispatch({
      type: 'group.create',
      childIds: ['box-a', 'box-b'],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const createdId = res.value.createdIds[0]!;
    expect(createdId).toBeDefined();
    expect(section.getSnapshot().document.nodes[createdId]?.type).toBe('group');
  });

  it('rejeita agrupamento com menos de dois membros', () => {
    const section = setupSectionWithShapes();
    const res0 = dispatchUntyped(section, { type: 'group.create', childIds: [] });
    expect(res0.ok).toBe(false);

    const res1 = dispatchUntyped(section, { type: 'group.create', childIds: ['box-a'] });
    expect(res1.ok).toBe(false);
  });

  it('rejeita agrupamento com IDs repetidos', () => {
    const section = setupSectionWithShapes();
    const res = dispatchUntyped(section, { type: 'group.create', childIds: ['box-a', 'box-a'] });
    expect(res.ok).toBe(false);
  });

  it('rejeita se algum nó membro não existir', () => {
    const section = setupSectionWithShapes();
    const res = section.dispatch({ type: 'group.create', childIds: ['box-a', 'inexistente'] });
    expect(res.ok).toBe(false);
  });

  it('rejeita grupos aninhados (rejeita grupo existente como filho)', () => {
    const section = setupSectionWithShapes();
    // Cria grupo 1
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });

    // Tenta agrupar grupo 1 com box-c
    const res = section.dispatch({ type: 'group.create', childIds: ['grp-1', 'box-c'] });
    expect(res.ok).toBe(false);
  });

  it('rejeita se algum nó já fizer parte de outro grupo (restrição de 1 nível)', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });

    // Tenta agrupar box-b (já agrupado) com box-c
    const res = section.dispatch({ type: 'group.create', childIds: ['box-b', 'box-c'] });
    expect(res.ok).toBe(false);
  });

  it('rejeita agrupamento de membros em camadas diferentes', () => {
    const section = setupSectionWithShapes();
    // Cria segunda camada e move box-c para ela
    section.dispatch({ type: 'layer.create', layer: { id: 'layer-2' } });
    section.dispatch({ type: 'node.reorder', id: 'box-c', layerId: 'layer-2', index: 0 });

    const res = section.dispatch({ type: 'group.create', childIds: ['box-a', 'box-c'] });
    expect(res.ok).toBe(false);
  });

  it('rejeita se algum membro ou a camada estiverem bloqueados', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'shape.update', id: 'box-b', patch: { locked: true } });

    const res = section.dispatch({ type: 'group.create', childIds: ['box-a', 'box-b'] });
    expect(res.ok).toBe(false);
  });
});

describe('group.ungroup', () => {
  it('substitui o grupo pelos filhos no mesmo ponto exato preservando IDs e ordem interna', () => {
    const section = setupSectionWithShapes();
    // Camada: ['box-a', 'box-b', 'box-c', 'box-d']
    // Agrupa b e c -> Camada: ['box-a', 'grp-bc', 'box-d']
    section.dispatch({ type: 'group.create', id: 'grp-bc', childIds: ['box-b', 'box-c'] });

    const docBefore = section.getSnapshot().document;
    expect(docBefore.layers[0]!.childIds).toEqual(['box-a', 'grp-bc', 'box-d']);

    // Desagrupa grp-bc
    const res = section.dispatch({ type: 'group.ungroup', id: 'grp-bc' });
    expect(res.ok).toBe(true);

    const docAfter = section.getSnapshot().document;
    // O grupo foi substituído pelos filhos no mesmo ponto exato:
    expect(docAfter.layers[0]!.childIds).toEqual(['box-a', 'box-b', 'box-c', 'box-d']);
    expect(docAfter.nodes['grp-bc']).toBeUndefined();
    // Filhos mantiveram seus IDs e geometrias intactos:
    expect(docAfter.nodes['box-b']).toEqual(RECT_B);
    expect(docAfter.nodes['box-c']).toEqual(RECT_C);
  });

  it('rejeita desagrupar ID inexistente ou nó que não é grupo', () => {
    const section = setupSectionWithShapes();
    const res1 = section.dispatch({ type: 'group.ungroup', id: 'inexistente' });
    expect(res1.ok).toBe(false);

    const res2 = section.dispatch({ type: 'group.ungroup', id: 'box-a' });
    expect(res2.ok).toBe(false);
  });

  it('rejeita desagrupar grupo bloqueado', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });
    // Bloqueia a camada
    section.dispatch({ type: 'layer.update', id: LAYER_ID, patch: { locked: true } });

    const res = section.dispatch({ type: 'group.ungroup', id: 'grp-1' });
    expect(res.ok).toBe(false);
  });
});

describe('Histórico: Undo e Redo de grupos', () => {
  it('desfazer criação de grupo restaura a ordem e posicionamento original dos membros', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-b', 'box-c'] });

    expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['box-a', 'grp-1', 'box-d']);

    // Undo
    const undoRes = section.undo();
    expect(undoRes.ok).toBe(true);

    const docUndo = section.getSnapshot().document;
    expect(docUndo.layers[0]!.childIds).toEqual(['box-a', 'box-b', 'box-c', 'box-d']);
    expect(docUndo.nodes['grp-1']).toBeUndefined();

    // Redo
    const redoRes = section.redo();
    expect(redoRes.ok).toBe(true);

    const docRedo = section.getSnapshot().document;
    expect(docRedo.layers[0]!.childIds).toEqual(['box-a', 'grp-1', 'box-d']);
    expect(docRedo.nodes['grp-1']).toBeDefined();
  });

  it('desfazer desagrupamento restaura o grupo na mesma posição', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-b', 'box-c'] });
    section.dispatch({ type: 'group.ungroup', id: 'grp-1' });

    expect(section.getSnapshot().document.layers[0]!.childIds).toEqual([
      'box-a',
      'box-b',
      'box-c',
      'box-d',
    ]);

    // Undo do ungroup restaura o grupo
    section.undo();
    const docUndo = section.getSnapshot().document;
    expect(docUndo.layers[0]!.childIds).toEqual(['box-a', 'grp-1', 'box-d']);
    expect(docUndo.nodes['grp-1']).toBeDefined();

    // Redo do ungroup dissolve novamente
    section.redo();
    const docRedo = section.getSnapshot().document;
    expect(docRedo.layers[0]!.childIds).toEqual(['box-a', 'box-b', 'box-c', 'box-d']);
    expect(docRedo.nodes['grp-1']).toBeUndefined();
  });
});

describe('Derivação de Bounds de Grupo', () => {
  it('bounds de grupo é derivado atomicamente como a união dos bounds dos membros', () => {
    const section = setupSectionWithShapes();
    // box-a: (100, 100, w: 100, h: 50) -> x: 100..200, y: 100..150
    // box-b: (250, 100, w: 100, h: 50) -> x: 250..350, y: 100..150
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });

    const bounds = section.getBounds(['grp-1'], { includePreview: false, stroke: false });
    expect(bounds).toBeDefined();
    expect(bounds).toEqual({
      x: 100,
      y: 100,
      width: 250, // 350 - 100
      height: 50,
    });
  });
});

describe('Consultas de nós e hierarquia (nodeInfo)', () => {
  it('nó filho herda visible e locked do grupo e da camada', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });

    // Inicialmente visível e desbloqueado
    const infoA = section.getNodeInfo('box-a');
    expect(infoA).toBeDefined();
    expect(infoA?.visible).toBe(true);
    expect(infoA?.locked).toBe(false);

    // Se o grupo for bloqueado via patch/replace, o filho também é reportado como bloqueado
    const doc = section.getSnapshot().document;
    const groupNode = doc.nodes['grp-1']!;
    section.replaceDocument({
      ...doc,
      nodes: {
        ...doc.nodes,
        'grp-1': { ...groupNode, locked: true },
      },
    });

    const infoALocked = section.getNodeInfo('box-a');
    expect(infoALocked?.locked).toBe(true);
  });
});

describe('shape.remove em grupos', () => {
  it('remover nó de grupo remove o grupo e seus filhos em cascata', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });

    // Exclui o grupo
    const removeRes = section.dispatch({ type: 'shape.remove', id: 'grp-1' });
    expect(removeRes.ok).toBe(true);

    const docAfter = section.getSnapshot().document;
    expect(docAfter.nodes['grp-1']).toBeUndefined();
    expect(docAfter.nodes['box-a']).toBeUndefined();
    expect(docAfter.nodes['box-b']).toBeUndefined();
    expect(docAfter.layers[0]!.childIds).toEqual(['box-c', 'box-d']);

    // Undo restaura grupo e filhos
    section.undo();
    const docUndo = section.getSnapshot().document;
    expect(docUndo.nodes['grp-1']).toBeDefined();
    expect(docUndo.nodes['box-a']).toBeDefined();
    expect(docUndo.nodes['box-b']).toBeDefined();
    expect(docUndo.layers[0]!.childIds).toEqual(['grp-1', 'box-c', 'box-d']);
  });

  it('remover membro de grupo com 2 nós dissolve o grupo automaticamente', () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });

    // Exclui box-a (membro do grupo grp-1)
    const removeRes = section.dispatch({ type: 'shape.remove', id: 'box-a' });
    expect(removeRes.ok).toBe(true);

    const docAfter = section.getSnapshot().document;
    // O grupo grp-1 foi dissolvido pois restou apenas 1 membro (box-b)
    expect(docAfter.nodes['grp-1']).toBeUndefined();
    expect(docAfter.nodes['box-a']).toBeUndefined();
    expect(docAfter.nodes['box-b']).toBeDefined();
    // box-b substituiu grp-1 na camada
    expect(docAfter.layers[0]!.childIds).toEqual(['box-b', 'box-c', 'box-d']);
  });
});

describe('validateDocument com grupos', () => {
  it('valida documento com grupos e hierarquia de 1 nível', async () => {
    const section = setupSectionWithShapes();
    section.dispatch({ type: 'group.create', id: 'grp-1', childIds: ['box-a', 'box-b'] });

    const doc = section.getSnapshot().document;
    const { validateDocument } = await import('./validate.js');
    const valRes = validateDocument(doc);
    expect(valRes.ok).toBe(true);
  });

  it('rejeita documento com grupos aninhados', async () => {
    const { validateDocument } = await import('./validate.js');
    const invalidDoc = {
      schemaVersion: 1,
      id: 'doc-1',
      nodes: {
        'box-a': RECT_A,
        'box-b': RECT_B,
        'grp-child': {
          id: 'grp-child',
          type: 'group',
          childIds: ['box-a', 'box-b'],
          visible: true,
          locked: false,
        },
        'box-c': RECT_C,
        'grp-parent': {
          id: 'grp-parent',
          type: 'group',
          childIds: ['grp-child', 'box-c'], // Inválido: aninhamento
          visible: true,
          locked: false,
        },
      },
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          childIds: ['grp-parent'],
        },
      ],
    };

    const valRes = validateDocument(invalidDoc);
    expect(valRes.ok).toBe(false);
  });

  it('rejeita documento com nó contido em mais de um grupo ou camada (múltiplos pais)', async () => {
    const { validateDocument } = await import('./validate.js');
    const invalidDoc = {
      schemaVersion: 1,
      id: 'doc-1',
      nodes: {
        'box-a': RECT_A,
        'box-b': RECT_B,
        'grp-1': {
          id: 'grp-1',
          type: 'group',
          childIds: ['box-a', 'box-b'],
          visible: true,
          locked: false,
        },
      },
      layers: [
        {
          id: 'layer-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          childIds: ['grp-1', 'box-a'], // Inválido: box-a já está em grp-1
        },
      ],
    };

    const valRes = validateDocument(invalidDoc);
    expect(valRes.ok).toBe(false);
  });
});

describe('grupos dentro de board (spec boards, US-BD.9)', () => {
  const rect = (id: string, x: number) => ({
    type: 'rectangle',
    id,
    x,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
  });

  /** Board `b` com c1, c2, c3 e c4; `r1` e `r2` ficam na camada, e `b2` é outro board vazio. */
  function organized(): CanvasSectionApi {
    const section = createCanvasSection({ generateId: counter() });
    const created = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 500, height: 300 },
      },
      {
        type: 'shape.create',
        shape: { id: 'b2', type: 'board', x: 600, y: 0, width: 100, height: 100 },
      },
      ...['c1', 'c2', 'c3', 'c4', 'r1', 'r2'].map((id, index) => ({
        type: 'shape.create',
        shape: rect(id, index * 20),
      })),
      { type: 'board.attach', boardId: 'b', ids: ['c1', 'c2', 'c3', 'c4'] },
    ] as CanvasCommand[]);
    if (!created.ok) throw new Error('fixture recusada');
    return section;
  }
  const board = (section: CanvasSectionApi, id = 'b') =>
    section.getSnapshot().document.nodes[id] as unknown as { childIds: string[] };
  const layerChildren = (section: CanvasSectionApi) =>
    section.getSnapshot().document.layers[0]!.childIds;

  it('agrupar dois filhos do mesmo board cria o grupo dentro dele, na posição do membro mais à frente', () => {
    const section = organized();

    const result = section.dispatch({ type: 'group.create', id: 'g', childIds: ['c1', 'c3'] });

    expect(result.ok).toBe(true);
    expect(board(section).childIds).toEqual(['c2', 'g', 'c4']);
    expect((section.getSnapshot().document.nodes['g'] as unknown as GroupNode).childIds).toEqual([
      'c1',
      'c3',
    ]);
    expect(layerChildren(section)).toEqual(['b', 'b2', 'r1', 'r2']);
    expect(section.getNodeInfo('g')).toMatchObject({ boardId: 'b' });
    expect(section.getNodeInfo('c1')).toMatchObject({ boardId: 'b' });
  });

  it('um board entre os membros é recusado com board-in-group', () => {
    const section = organized();
    const before = section.getSnapshot().document;

    const result = section.dispatch({ type: 'group.create', childIds: ['b', 'r1'] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ rule: 'board-in-group' }] } },
    });
    expect(section.getSnapshot().document).toBe(before);
  });

  it.each([
    ['um filho de board e um nó da camada', ['c1', 'r1']],
    ['filhos de dois boards', ['c1', 'x1']],
  ])('%s é recusado com multiple-parents', (_name, childIds) => {
    const section = organized();
    section.dispatch({ type: 'shape.create', shape: rect('x1', 700) } as never);
    section.dispatch({ type: 'board.attach', boardId: 'b2', ids: ['x1'] });
    const before = section.getSnapshot().document;

    const result = section.dispatch({ type: 'group.create', childIds });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ rule: 'multiple-parents' }] } },
    });
    expect(section.getSnapshot().document).toBe(before);
  });

  it('um filho de board locked não entra num grupo: LOCKED com o board', () => {
    const section = organized();
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

    const result = section.dispatch({ type: 'group.create', childIds: ['c1', 'c2'] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { lockedBy: 'b' } },
    });
  });

  it('desagrupar um grupo dentro do board devolve os membros ao board, no lugar do grupo', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['c2', 'c3'] });
    expect(board(section).childIds).toEqual(['c1', 'g', 'c4']);

    const result = section.dispatch({ type: 'group.ungroup', id: 'g' });

    expect(result.ok).toBe(true);
    expect(board(section).childIds).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(section.getSnapshot().document.nodes['g']).toBeUndefined();
    expect(layerChildren(section)).toEqual(['b', 'b2', 'r1', 'r2']);
    expect(section.getNodeInfo('c2')).toMatchObject({ boardId: 'b' });
  });

  it('desagrupar um grupo de board locked é recusado', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['c2', 'c3'] });
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

    const result = section.dispatch({ type: 'group.ungroup', id: 'g' });

    expect(result).toMatchObject({ ok: false, error: { code: 'LOCKED' } });
  });

  it('um undo desfaz o agrupamento dentro do board, e um redo o refaz', () => {
    const section = organized();
    const before = section.getSnapshot().document;
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['c1', 'c4'] });
    const grouped = section.getSnapshot().document;

    section.undo();
    expect(section.getSnapshot().document).toEqual(before);
    section.redo();
    expect(section.getSnapshot().document).toEqual(grouped);
  });

  it('o grupo que contém um filho de board já agrupado continua recusado como nested-group', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['c1', 'c2'] });

    const result = section.dispatch({ type: 'group.create', childIds: ['c1', 'c3'] });

    expect(result).toMatchObject({
      ok: false,
      error: { details: { issues: [{ rule: 'nested-group' }] } },
    });
  });
});
