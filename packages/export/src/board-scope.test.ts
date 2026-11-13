import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { prepareBoardExportContext, prepareExportContext, resolveExportContext } from './bounds.js';

// O escopo { board } (spec board-export, §3, §4.1 e §4.4; US-BE.1, 3 e 4).

const STYLE = { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 };
const rect = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x,
  y,
  width: 40,
  height: 30,
  rotation: 0,
  style: STYLE,
  ...extra,
});

/** O board de referência (100, 50, 300 × 200) com um filho dentro, e um nó que só o sobrepõe. */
function setup(
  board: Record<string, unknown> = {},
  extra: unknown[] = [],
  attach: string[] = ['child'],
): CanvasSectionApi {
  const section = createCanvasSection();
  const result = section.transact([
    {
      type: 'shape.create',
      shape: { id: 'b1', type: 'board', x: 100, y: 50, width: 300, height: 200, ...board },
    },
    { type: 'shape.create', shape: rect('child', 120, 80) },
    { type: 'shape.create', shape: rect('over', 150, 100) },
    ...extra,
    ...(attach.length > 0 ? [{ type: 'board.attach', boardId: 'b1', ids: attach }] : []),
  ] as never);
  expect(result.ok).toBe(true);
  return section;
}

function ctxOf(section: CanvasSectionApi, options: Record<string, unknown> = {}) {
  const result = prepareBoardExportContext(section, 'b1', options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('contexto recusado');
  return result.value;
}

describe('prepareBoardExportContext: área, recorte e conteúdo', () => {
  it('a área é o retângulo mais meia borda, e o recorte é o retângulo', () => {
    const ctx = ctxOf(setup());

    expect(ctx.bounds).toEqual({ x: 99.5, y: 49.5, width: 301, height: 201 });
    expect(ctx.clip).toEqual({ x: 100, y: 50, width: 300, height: 200 });
    expect(ctx.boardId).toBe('b1');
  });

  it('com padding a área cresce, e o recorte não muda', () => {
    const ctx = ctxOf(setup(), { padding: 10 });

    expect(ctx.bounds).toEqual({ x: 89.5, y: 39.5, width: 321, height: 221 });
    expect(ctx.clip).toEqual({ x: 100, y: 50, width: 300, height: 200 });
  });

  it('padding negativo vale 0', () => {
    expect(ctxOf(setup(), { padding: -5 }).bounds).toEqual({
      x: 99.5,
      y: 49.5,
      width: 301,
      height: 201,
    });
  });

  it('sem borda não há meia largura', () => {
    const ctx = ctxOf(setup({ style: { fill: '#ffffff', fillOpacity: 1, stroke: null } }));

    expect(ctx.bounds).toEqual({ x: 100, y: 50, width: 300, height: 200 });
  });

  it('a faixa do título fica fora da área', () => {
    const ctx = ctxOf(setup());

    expect(ctx.bounds.y).toBeGreaterThan(50 - 24);
    expect(ctx.clip!.y).toBe(50);
  });

  it('candidateIds leva o board e os filhos, e não o nó que só se sobrepõe', () => {
    const ctx = ctxOf(setup());

    expect([...ctx.candidateIds!].sort()).toEqual(['b1', 'child']);
  });

  it('um filho oculto fica fora, e um filho locked entra', () => {
    const section = setup(
      {},
      [
        { type: 'shape.create', shape: rect('hidden', 200, 100) },
        { type: 'shape.create', shape: rect('locked', 260, 100) },
      ],
      ['child', 'hidden', 'locked'],
    );
    section.dispatch({ type: 'shape.update', id: 'hidden', patch: { visible: false } });
    section.dispatch({ type: 'shape.update', id: 'locked', patch: { locked: true } });

    expect([...ctxOf(section).candidateIds!].sort()).toEqual(['b1', 'child', 'locked']);
  });

  it('um grupo filho entra com os membros', () => {
    const section = setup(
      {},
      [
        { type: 'shape.create', shape: rect('m1', 200, 100) },
        { type: 'shape.create', shape: rect('m2', 250, 100) },
        { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      ],
      ['child', 'g'],
    );

    expect([...ctxOf(section).candidateIds!].sort()).toEqual(['b1', 'child', 'm1', 'm2']);
  });

  it('funciona com o CanvasDocument, sem a sessão', () => {
    const section = setup();

    const result = prepareBoardExportContext(section.getSnapshot().document, 'b1');

    expect(result.ok && result.value.bounds).toEqual({ x: 99.5, y: 49.5, width: 301, height: 201 });
  });

  it('a área tem no mínimo 1 de largura e de altura', () => {
    const section = setup({ width: 1, height: 1 }, [], []);

    const ctx = ctxOf(section, {});

    expect(ctx.bounds.width).toBeGreaterThanOrEqual(1);
    expect(ctx.bounds.height).toBeGreaterThanOrEqual(1);
  });
});

describe('prepareBoardExportContext: erros', () => {
  const reason = (section: CanvasSectionApi, id: unknown, options = {}) => {
    const result = prepareBoardExportContext(section, id, options);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava erro');
    expect(result.error.code).toBe('INVALID_SCOPE');
    return result.error.details as { reason: string; id?: string };
  };

  it('ID inexistente dá not-found com o id', () => {
    expect(reason(setup(), 'nope')).toEqual({ reason: 'not-found', id: 'nope' });
  });

  it('ID de um nó que não é board dá not-a-board com o id', () => {
    expect(reason(setup(), 'child')).toEqual({ reason: 'not-a-board', id: 'child' });
  });

  it('chaves herdadas do objeto não contam como nó', () => {
    expect(reason(setup(), '__proto__')).toEqual({ reason: 'not-found', id: '__proto__' });
    expect(reason(setup(), 'constructor')).toEqual({ reason: 'not-found', id: 'constructor' });
  });

  it('board oculto dá hidden', () => {
    expect(reason(setup({ visible: false }), 'b1')).toEqual({ reason: 'hidden', id: 'b1' });
  });

  it('board numa camada oculta dá hidden', () => {
    const section = setup();
    const layerId = section.getSnapshot().document.layers[0]!.id;
    section.dispatch({ type: 'layer.update', id: layerId, patch: { visible: false } });

    expect(reason(section, 'b1')).toEqual({ reason: 'hidden', id: 'b1' });
  });

  it.each([42, '', null, undefined, {}, ['b1']])('o ID %j dá malformed', (id) => {
    expect(reason(setup(), id)).toEqual({ reason: 'malformed' });
  });

  it('os erros não mudam a revisão nem o histórico', () => {
    const section = setup();
    const before = section.getSnapshot();

    for (const id of ['nope', 'child', 42, '']) prepareBoardExportContext(section, id);
    prepareBoardExportContext(section, 'b1');

    const after = section.getSnapshot();
    expect(after.revision).toBe(before.revision);
    expect(after.history).toEqual(before.history);
    expect(after.document).toBe(before.document);
  });
});

describe('resolveExportContext: a discriminação do escopo (§3)', () => {
  const resolve = (scope: unknown) => resolveExportContext(setup(), { scope } as never);

  it('sem escopo, document e selection seguem como hoje', () => {
    for (const scope of [undefined, 'document', 'selection']) {
      const result = resolve(scope);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.boardId).toBeUndefined();
    }
  });

  it('{ board } vai para o contexto do board', () => {
    const result = resolve({ board: 'b1' });

    expect(result.ok && result.value.boardId).toBe('b1');
  });

  it('{ board } com outra chave é malformed, antes da regra de Bounds', () => {
    const result = resolve({ board: 'b1', x: 0, width: 10 });

    expect(!result.ok && result.error.details).toEqual({ reason: 'malformed' });
  });

  it('Bounds segue como hoje', () => {
    const result = resolve({ x: 0, y: 0, width: 50, height: 40 });

    expect(result.ok && result.value.bounds).toEqual({ x: 0, y: 0, width: 50, height: 40 });
    expect(result.ok && result.value.boardId).toBeUndefined();
  });

  it.each([{}, null, 'outra', 7, true, { x: 1 }, { width: 1 }])(
    'o escopo %j é malformed, e não exporta o documento inteiro',
    (scope) => {
      const result = resolve(scope);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_SCOPE');
        expect(result.error.details).toEqual({ reason: 'malformed' });
      }
    },
  );
});

describe('prepareExportContext com escopo de board', () => {
  it('lança TypeError e orienta a usar prepareBoardExportContext', () => {
    expect(() => prepareExportContext(setup(), { scope: { board: 'b1' } } as never)).toThrow(
      new TypeError('Use prepareBoardExportContext for board scope'),
    );
  });

  it('com document, selection e Bounds devolve o mesmo de antes', () => {
    const section = setup();
    section.setSelection(['child']);

    expect(prepareExportContext(section, { scope: 'selection' }).bounds).toEqual({
      x: 120,
      y: 80,
      width: 40,
      height: 30,
    });
    expect(
      prepareExportContext(section, { scope: { x: 1, y: 2, width: 3, height: 4 } }).bounds,
    ).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(prepareExportContext(section, {}).boardId).toBeUndefined();
  });
});
