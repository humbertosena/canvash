import { describe, expect, it } from 'vitest';
import { createCanvasSection } from './canvas-section.js';
import type { BoardNode } from './shapes.js';
import type { ValidationIssue } from './result.js';
import { patchBoard, readBoardInput } from './boards.js';

// O board como nó (spec boards, §3.1): criação com padrões, recusas e o patch dele.

const BOX = { x: 10, y: 20, width: 300, height: 200 } as const;

function sectionWith(extra: Record<string, unknown> = {}) {
  const section = createCanvasSection();
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id: 'b', type: 'board', ...BOX, ...extra },
  } as never);
  return { section, result };
}

const nodeOf = (section: ReturnType<typeof createCanvasSection>, id = 'b') =>
  section.getSnapshot().document.nodes[id] as BoardNode;

function issuesOf(result: { ok: boolean; error?: { details?: unknown } }): ValidationIssue[] {
  const details = result.error?.details as { issues?: ValidationIssue[] } | undefined;
  return details?.issues ?? [];
}

describe('shape.create de um board', () => {
  it('cria o board vazio com os padrões', () => {
    const { section, result } = sectionWith();

    expect(result.ok).toBe(true);
    expect(nodeOf(section)).toEqual({
      id: 'b',
      type: 'board',
      ...BOX,
      title: 'Board',
      style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
      childIds: [],
      visible: true,
      locked: false,
    });
  });

  it('o board entra na camada da frente, e o ID é gerado quando falta', () => {
    const section = createCanvasSection();
    section.dispatch({ type: 'shape.create', shape: { type: 'board', ...BOX } } as never);

    const { document } = section.getSnapshot();
    const [id] = Object.keys(document.nodes);
    expect(document.nodes[id!]).toMatchObject({ type: 'board', childIds: [] });
    expect(document.layers[0]!.childIds).toEqual([id]);
  });

  it('um estilo parcial só substitui os campos dados', () => {
    const { section } = sectionWith({ style: { fill: null, fillOpacity: 0.25 } });

    expect(nodeOf(section).style).toEqual({ fill: null, fillOpacity: 0.25, stroke: '#d4d4d8' });
  });

  it('aceita título, visible, locked e metadata', () => {
    const { section } = sectionWith({
      title: 'Planejamento',
      visible: false,
      locked: true,
      metadata: { app: { origem: 'teste' } },
    });

    expect(nodeOf(section)).toMatchObject({
      title: 'Planejamento',
      visible: false,
      locked: true,
      metadata: { app: { origem: 'teste' } },
    });
  });

  it.each([
    ['título vazio', { title: '' }, ['shape', 'title'], 'type'],
    ['título que não é texto', { title: 7 }, ['shape', 'title'], 'type'],
    ['título com 201 caracteres', { title: 'a'.repeat(201) }, ['shape', 'title'], 'range'],
    ['título com quebra de linha', { title: 'a\nb' }, ['shape', 'title'], 'format'],
    ['título com tags HTML', { title: '<b>x</b>' }, ['shape', 'title'], 'format'],
    [
      'fillOpacity acima de 1',
      { style: { fillOpacity: 1.5 } },
      ['shape', 'style', 'fillOpacity'],
      'range',
    ],
    [
      'fillOpacity negativa',
      { style: { fillOpacity: -0.1 } },
      ['shape', 'style', 'fillOpacity'],
      'range',
    ],
    ['largura zero', { width: 0 }, ['shape', 'width'], 'range'],
    ['altura negativa', { height: -5 }, ['shape', 'height'], 'range'],
    ['childIds no input', { childIds: [] }, ['shape', 'childIds'], 'unknown-field'],
    ['rotation no input', { rotation: 0 }, ['shape', 'rotation'], 'unknown-field'],
    [
      'strokeWidth no estilo',
      { style: { strokeWidth: 2 } },
      ['shape', 'style', 'strokeWidth'],
      'unknown-field',
    ],
    [
      'opacity no estilo',
      { style: { opacity: 1 } },
      ['shape', 'style', 'opacity'],
      'unknown-field',
    ],
  ])('recusa %s e não muda o documento', (_name, extra, path, rule) => {
    const section = createCanvasSection();
    const before = section.getSnapshot().revision;

    const result = section.dispatch({
      type: 'shape.create',
      shape: { id: 'b', type: 'board', ...BOX, ...extra },
    } as never);

    expect(result.ok).toBe(false);
    expect(issuesOf(result as never)).toContainEqual(expect.objectContaining({ path, rule }));
    expect(section.getSnapshot().revision).toBe(before);
    expect(section.getSnapshot().document.nodes['b']).toBeUndefined();
  });

  it('exige x, y, largura e altura', () => {
    const issues: ValidationIssue[] = [];

    readBoardInput({ type: 'board' }, undefined, issues);

    expect(issues.map((issue) => issue.path[0]).sort()).toEqual(['height', 'width', 'x', 'y']);
  });
});

describe('shape.update de um board (patchBoard)', () => {
  it('US-BD.5: x e y mudam só o board', () => {
    const { section } = sectionWith();
    const before = nodeOf(section);

    const result = section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: { x: 50, y: 60 },
    } as never);

    expect(result.ok).toBe(true);
    expect(nodeOf(section)).toEqual({ ...before, x: 50, y: 60 });
  });

  it('muda tamanho, título, estilo parcial, visible, locked e metadata', () => {
    const { section } = sectionWith();

    const result = section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: {
        width: 400,
        height: 250,
        title: 'Novo',
        style: { fill: '#ff0000', fillOpacity: 0.5 },
        visible: false,
        metadata: { app: { a: 1 } },
      },
    } as never);

    expect(result.ok).toBe(true);
    expect(nodeOf(section)).toMatchObject({
      width: 400,
      height: 250,
      title: 'Novo',
      style: { fill: '#ff0000', fillOpacity: 0.5, stroke: '#d4d4d8' },
      visible: false,
      metadata: { app: { a: 1 } },
    });
  });

  it('o fundo e a borda aceitam null', () => {
    const { section } = sectionWith();

    section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: { style: { fill: null, stroke: null } },
    } as never);

    expect(nodeOf(section).style).toEqual({ fill: null, fillOpacity: 1, stroke: null });
  });

  it('null em metadata o remove', () => {
    const { section } = sectionWith({ metadata: { app: { a: 1 } } });

    section.dispatch({ type: 'shape.update', id: 'b', patch: { metadata: null } } as never);

    expect('metadata' in nodeOf(section)).toBe(false);
  });

  it.each([
    ['type', { type: 'rectangle' }, ['patch', 'type']],
    ['rotation', { rotation: 1 }, ['patch', 'rotation']],
    ['childIds', { childIds: ['x'] }, ['patch', 'childIds']],
    ['label', { label: { text: 'x' } }, ['patch', 'label']],
    ['text', { text: 'x' }, ['patch', 'text']],
    ['style.strokeWidth', { style: { strokeWidth: 2 } }, ['patch', 'style', 'strokeWidth']],
    ['style.opacity', { style: { opacity: 0.5 } }, ['patch', 'style', 'opacity']],
  ])('recusa %s com unknown-field e nada muda', (_name, patch, path) => {
    const { section } = sectionWith();
    const before = section.getSnapshot().revision;

    const result = section.dispatch({ type: 'shape.update', id: 'b', patch } as never);

    expect(result.ok).toBe(false);
    expect(issuesOf(result as never)).toContainEqual(
      expect.objectContaining({ path, rule: 'unknown-field' }),
    );
    expect(section.getSnapshot().revision).toBe(before);
  });

  it('valida título e fillOpacity no patch', () => {
    const { section } = sectionWith();

    const bad = section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: { title: '', style: { fillOpacity: 2 } },
    } as never);

    expect(issuesOf(bad as never)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['patch', 'title'], rule: 'type' }),
        expect.objectContaining({ path: ['patch', 'style', 'fillOpacity'], rule: 'range' }),
      ]),
    );
  });

  it('um board bloqueado só aceita o patch que o desbloqueia', () => {
    const { section } = sectionWith({ locked: true });

    const refused = section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: { x: 99 },
    } as never);
    const unlocked = section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: { locked: false },
    } as never);

    expect(refused).toMatchObject({ ok: false, error: { code: 'LOCKED' } });
    expect(unlocked.ok).toBe(true);
  });

  it('patchBoard devolve um nó novo e não muda o original', () => {
    const { section } = sectionWith();
    const original = nodeOf(section);
    const issues: ValidationIssue[] = [];

    const next = patchBoard(original, { title: 'Outro' }, undefined, issues);

    expect(issues).toEqual([]);
    expect(next).not.toBe(original);
    expect(next.title).toBe('Outro');
    expect(original.title).toBe('Board');
  });
});

describe('limites do board', () => {
  it('coordenada acima do limite dá LIMIT_EXCEEDED', () => {
    const section = createCanvasSection({ limits: { maxCoordinate: 1000 } });

    const result = section.dispatch({
      type: 'shape.create',
      shape: { type: 'board', x: 0, y: 0, width: 5000, height: 10 },
    } as never);

    expect(result).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
  });

  it('título acima de maxTextLength dá LIMIT_EXCEEDED', () => {
    const section = createCanvasSection({ limits: { maxTextLength: 5 } });

    const result = section.dispatch({
      type: 'shape.create',
      shape: { type: 'board', ...BOX, title: 'abcdefgh' },
    } as never);

    expect(result).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
  });
});

// ---------------------------------------------------------------------------------------------
// board.attach e board.detach (spec boards, §3.2) e o que a pertença muda no resto do core.
// ---------------------------------------------------------------------------------------------

type Section = ReturnType<typeof createCanvasSection>;

function rectInput(id: string, x = 0): Record<string, unknown> {
  return { id, type: 'rectangle', x, y: 0, width: 10, height: 10, rotation: 0 };
}

/** Camada com o board `b` e os retângulos r1, r2, r3 e r4 na ordem; nenhum é filho ainda. */
function organized(): Section {
  const section = createCanvasSection();
  const created = section.transact([
    { type: 'shape.create', shape: { id: 'b', type: 'board', ...BOX } },
    ...['r1', 'r2', 'r3', 'r4'].map((id) => ({ type: 'shape.create', shape: rectInput(id) })),
  ] as never);
  if (!created.ok) throw new Error('fixture recusada');
  return section;
}

const attach = (section: Section, ids: string[], boardId = 'b') =>
  section.dispatch({ type: 'board.attach', boardId, ids } as never);
const detach = (section: Section, ids: string[]) =>
  section.dispatch({ type: 'board.detach', ids } as never);
const layerIds = (section: Section) => section.getSnapshot().document.layers[0]!.childIds;
const childrenOf = (section: Section, id = 'b') => nodeOf(section, id).childIds;

describe('board.attach', () => {
  it('põe os nós no fim de childIds, na ordem visual em que estavam, e os tira da camada', () => {
    const section = organized();

    const result = attach(section, ['r3', 'r1']);

    expect(result.ok).toBe(true);
    expect(childrenOf(section)).toEqual(['r1', 'r3']);
    expect(layerIds(section)).toEqual(['b', 'r2', 'r4']);
  });

  it('entra à frente dos filhos que o board já tinha', () => {
    const section = organized();
    attach(section, ['r2']);

    attach(section, ['r1', 'r4']);

    expect(childrenOf(section)).toEqual(['r2', 'r1', 'r4']);
  });

  it('um filho de outro board da mesma camada passa para este', () => {
    const section = organized();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'b2', type: 'board', x: 600, y: 0, width: 100, height: 100 },
    } as never);
    attach(section, ['r1', 'r2'], 'b2');

    const result = attach(section, ['r1']);

    expect(result.ok).toBe(true);
    expect(childrenOf(section, 'b')).toEqual(['r1']);
    expect(childrenOf(section, 'b2')).toEqual(['r2']);
  });

  it('a ordem visual vale também para filhos de outro board misturados com nós da camada', () => {
    const section = organized();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'b2', type: 'board', x: 600, y: 0, width: 100, height: 100 },
    } as never);
    attach(section, ['r4'], 'b2');

    // r3 está na camada, antes do b2; r4 é filho do b2, logo depois dele.
    const result = attach(section, ['r4', 'r3', 'r1']);

    expect(result.ok).toBe(true);
    expect(childrenOf(section)).toEqual(['r1', 'r3', 'r4']);
    expect(childrenOf(section, 'b2')).toEqual([]);
  });

  it('ids que não é uma lista dá VALIDATION_ERROR com type', () => {
    const section = organized();

    const result = section.dispatch({ type: 'board.attach', boardId: 'b', ids: 'r1' } as never);

    expect(issuesOf(result as never)).toContainEqual(
      expect.objectContaining({ path: ['ids'], rule: 'type' }),
    );
  });

  it('um grupo entra inteiro, e os membros continuam nele', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['r1', 'r2'] });

    const result = attach(section, ['g']);

    expect(result.ok).toBe(true);
    expect(childrenOf(section)).toEqual(['g']);
    expect(
      (section.getSnapshot().document.nodes['g'] as unknown as { childIds: string[] }).childIds,
    ).toEqual(['r1', 'r2']);
    expect(layerIds(section)).toEqual(['b', 'r3', 'r4']);
  });

  it('attach do mesmo filho de novo o leva ao fim', () => {
    const section = organized();
    attach(section, ['r1', 'r2']);

    attach(section, ['r1']);

    expect(childrenOf(section)).toEqual(['r2', 'r1']);
  });

  it.each([
    ['boardId inexistente', { boardId: 'nada', ids: ['r1'] }, 'NOT_FOUND', undefined],
    ['id inexistente', { boardId: 'b', ids: ['nada'] }, 'NOT_FOUND', undefined],
    ['boardId que não é board', { boardId: 'r1', ids: ['r2'] }, 'VALIDATION_ERROR', 'type'],
    ['um board entre os ids', { boardId: 'b', ids: ['b2'] }, 'VALIDATION_ERROR', 'nested-board'],
    ['ids vazio', { boardId: 'b', ids: [] }, 'VALIDATION_ERROR', 'range'],
    ['id repetido', { boardId: 'b', ids: ['r1', 'r1'] }, 'VALIDATION_ERROR', 'duplicate-id'],
    [
      'campo desconhecido',
      { boardId: 'b', ids: ['r1'], x: 1 },
      'VALIDATION_ERROR',
      'unknown-field',
    ],
  ])('recusa %s e não muda o documento', (_name, extra, code, rule) => {
    const section = organized();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'b2', type: 'board', x: 600, y: 0, width: 100, height: 100 },
    } as never);
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'board.attach', ...extra } as never);

    expect(result).toMatchObject({ ok: false, error: { code } });
    if (rule !== undefined) {
      expect(issuesOf(result as never)).toContainEqual(expect.objectContaining({ rule }));
    }
    expect(section.getSnapshot().revision).toBe(before.revision);
    expect(section.getSnapshot().document).toBe(before.document);
  });

  it('um membro de grupo não entra sozinho: é o grupo que entra', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['r1', 'r2'] });
    const before = section.getSnapshot().document;

    const result = attach(section, ['r1']);

    expect(issuesOf(result as never)).toContainEqual(
      expect.objectContaining({ rule: 'multiple-parents' }),
    );
    expect(section.getSnapshot().document).toBe(before);
  });

  it('um nó de outra camada é recusado com multiple-parents', () => {
    const section = organized();
    section.dispatch({ type: 'layer.create', layer: { id: 'l2' } });
    section.dispatch({ type: 'shape.create', shape: rectInput('far'), layerId: 'l2' } as never);
    const before = section.getSnapshot().document;

    const result = attach(section, ['far']);

    expect(issuesOf(result as never)).toContainEqual(
      expect.objectContaining({ rule: 'multiple-parents' }),
    );
    expect(section.getSnapshot().document).toBe(before);
  });

  it.each([
    [
      'nó bloqueado',
      (s: Section) =>
        s.dispatch({ type: 'shape.update', id: 'r1', patch: { locked: true } } as never),
    ],
    [
      'board bloqueado',
      (s: Section) =>
        s.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never),
    ],
    [
      'camada bloqueada',
      (s: Section) =>
        s.dispatch({
          type: 'layer.update',
          id: s.getSnapshot().document.layers[0]!.id,
          patch: { locked: true },
        }),
    ],
  ])('%s dá LOCKED e nada muda', (_name, lock) => {
    const section = organized();
    lock(section);
    const before = section.getSnapshot().document;

    const result = attach(section, ['r1']);

    expect(result).toMatchObject({ ok: false, error: { code: 'LOCKED' } });
    expect(section.getSnapshot().document).toBe(before);
  });

  it('um undo devolve a camada e o board ao que eram, e um redo refaz', () => {
    const section = organized();
    const before = section.getSnapshot().document;
    attach(section, ['r2', 'r3']);
    const after = section.getSnapshot().document;

    section.undo();
    expect(section.getSnapshot().document).toEqual(before);
    section.redo();
    expect(section.getSnapshot().document).toEqual(after);
  });
});

describe('board.detach', () => {
  it('devolve os filhos à camada, logo à frente do board de origem, na ordem deles', () => {
    const section = organized();
    attach(section, ['r1', 'r2', 'r3']);

    const result = detach(section, ['r3', 'r1']);

    expect(result.ok).toBe(true);
    expect(childrenOf(section)).toEqual(['r2']);
    expect(layerIds(section)).toEqual(['b', 'r1', 'r3', 'r4']);
  });

  it('filhos de dois boards voltam cada um logo depois do seu board', () => {
    const section = organized();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'b2', type: 'board', x: 600, y: 0, width: 100, height: 100 },
    } as never);
    attach(section, ['r1']);
    attach(section, ['r2'], 'b2');

    const result = detach(section, ['r1', 'r2']);

    expect(result.ok).toBe(true);
    expect(layerIds(section)).toEqual(['b', 'r1', 'r3', 'r4', 'b2', 'r2']);
  });

  it('um grupo filho volta inteiro', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['r1', 'r2'] });
    attach(section, ['g']);

    detach(section, ['g']);

    expect(layerIds(section)).toEqual(['b', 'g', 'r3', 'r4']);
  });

  it.each([
    ['um nó da camada', ['r1'], 'VALIDATION_ERROR', 'missing-parent'],
    ['um board', ['b'], 'VALIDATION_ERROR', 'missing-parent'],
    ['um ID inexistente', ['nada'], 'NOT_FOUND', undefined],
    ['ids vazio', [], 'VALIDATION_ERROR', 'range'],
  ])('recusa %s e não muda o documento', (_name, ids, code, rule) => {
    const section = organized();
    attach(section, ['r2']);
    const before = section.getSnapshot();

    const result = detach(section, ids);

    expect(result).toMatchObject({ ok: false, error: { code } });
    if (rule !== undefined) {
      expect(issuesOf(result as never)).toContainEqual(expect.objectContaining({ rule }));
    }
    expect(section.getSnapshot().document).toBe(before.document);
  });

  it('um membro de grupo dentro do board não sai sozinho', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['r1', 'r2'] });
    attach(section, ['g']);

    const result = detach(section, ['r1']);

    expect(issuesOf(result as never)).toContainEqual(
      expect.objectContaining({ rule: 'missing-parent' }),
    );
  });

  it('board ou camada bloqueados dão LOCKED', () => {
    const section = organized();
    attach(section, ['r2']);
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

    const result = detach(section, ['r2']);

    expect(result).toMatchObject({ ok: false, error: { code: 'LOCKED' } });
    expect(childrenOf(section)).toEqual(['r2']);
  });

  it('um undo devolve o filho ao board, e um redo o tira', () => {
    const section = organized();
    attach(section, ['r2', 'r3']);
    const attached = section.getSnapshot().document;
    detach(section, ['r2']);
    const detached = section.getSnapshot().document;

    section.undo();
    expect(section.getSnapshot().document).toEqual(attached);
    section.redo();
    expect(section.getSnapshot().document).toEqual(detached);
  });
});

describe('o board nas informações do nó e no bloqueio', () => {
  it('getNodeInfo do filho traz boardId, a camada e o índice do board', () => {
    const section = organized();
    attach(section, ['r2']);

    expect(section.getNodeInfo('r2')).toMatchObject({
      layerId: section.getSnapshot().document.layers[0]!.id,
      boardId: 'b',
      index: 0,
    });
    expect(section.getNodeInfo('r3')!.boardId).toBeUndefined();
    expect(section.getNodeInfo('b')!.boardId).toBeUndefined();
  });

  it('um board oculto oculta os filhos, e um board locked os bloqueia', () => {
    const section = organized();
    attach(section, ['r2']);

    section.dispatch({ type: 'shape.update', id: 'b', patch: { visible: false } } as never);
    expect(section.getNodeInfo('r2')).toMatchObject({ visible: false, locked: false });
    section.dispatch({
      type: 'shape.update',
      id: 'b',
      patch: { visible: true, locked: true },
    } as never);

    expect(section.getNodeInfo('r2')).toMatchObject({ visible: true, locked: true });
  });

  it('remover um filho de board locked dá LOCKED com o board em lockedBy', () => {
    const section = organized();
    attach(section, ['r2']);
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

    const result = section.dispatch({ type: 'shape.remove', id: 'r2' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { id: 'r2', lockedBy: 'b' } },
    });
  });

  it('o membro de um grupo dentro de board locked também fica bloqueado para remover', () => {
    const section = organized();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['r1', 'r2'] });
    attach(section, ['g']);
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

    const result = section.dispatch({ type: 'shape.remove', id: 'r1' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { lockedBy: 'b' } },
    });
  });
});
