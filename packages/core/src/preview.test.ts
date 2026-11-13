import { describe, expect, it, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import type { CanvasChange } from './events.js';
import type { PreviewInput } from './preview.js';
import type { FillStrokeStyle, RectangleNode } from './shapes.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const BASE = 'id-2';
const STYLE: FillStrokeStyle = { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 };

function node(id: string, x: number, y = 0): RectangleNode {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: 10,
    height: 10,
    rotation: 0,
    visible: true,
    locked: false,
    style: STYLE,
  };
}

function create(id: string, x: number, layerId?: string): CanvasCommand {
  return { type: 'shape.create', shape: node(id, x), layerId };
}

/** Canvas com os nós `a` em x = 0 e `b` em x = 100, e a camada `top` vazia à frente. */
function newSection(): CanvasSectionApi {
  const section = createCanvasSection({ generateId: counter() });
  section.transact([
    create('a', 0),
    create('b', 100),
    { type: 'layer.create', layer: { id: 'top' } },
  ]);
  return section;
}

function setUntyped(
  section: CanvasSectionApi,
  preview: unknown,
): ReturnType<CanvasSectionApi['setPreview']> {
  return section.setPreview(preview as PreviewInput);
}

const OK = { ok: true, value: undefined };
const WITH = { includePreview: true } as const;
const WITHOUT = { includePreview: false } as const;

describe('setPreview e getPreview', () => {
  it('começa sem preview', () => {
    expect(newSection().getPreview()).toBeNull();
  });

  it('guarda a geometria provisória de nós existentes, sem tocar em snapshot, revisão nem histórico', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.update', id: 'a', patch: { y: 5 } });
    section.undo();
    const before = section.getSnapshot();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const result = section.setPreview({ updates: [node('a', 500)] });

    expect(result).toEqual(OK);
    expect(section.getPreview()).toEqual({
      updates: { a: node('a', 500) },
      additions: [],
      marquee: null,
    });
    expect(section.getSnapshot()).toBe(before);
    expect(before.document.nodes['a']).toMatchObject({ x: 0 });
    expect(before.history).toEqual({ canUndo: true, canRedo: true });
    expect(changes).toEqual([
      { snapshot: before, origin: 'local', areas: ['preview'], affectedIds: [] },
    ]);
    expect(changes[0]?.snapshot).toBe(before);
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
  });

  it('guarda nós que ainda não existem, com os padrões materializados, e o retângulo de seleção', () => {
    const section = newSection();

    const result = section.setPreview({
      additions: [{ id: 'novo', type: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }],
      marquee: { x: 1, y: 2, width: 30, height: 40 },
    });

    expect(result).toEqual(OK);
    expect(section.getPreview()).toEqual({
      updates: {},
      additions: [
        {
          id: 'novo',
          type: 'line',
          start: { x: 0, y: 0 },
          end: { x: 5, y: 5 },
          visible: true,
          locked: false,
          style: { stroke: '#000000', strokeWidth: 1, opacity: 1 },
        },
      ],
      marquee: { x: 1, y: 2, width: 30, height: 40 },
    });
  });

  it('entrega congelado o evento de preview', () => {
    const section = newSection();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.setPreview({ marquee: { x: 0, y: 0, width: 1, height: 1 } });

    expect(changes).toHaveLength(1);
    expect(Object.isFrozen(changes[0])).toBe(true);
    expect(Object.isFrozen(changes[0]?.areas)).toBe(true);
    expect(Object.isFrozen(changes[0]?.affectedIds)).toBe(true);
  });

  it('devolve a mesma referência congelada até o preview mudar', () => {
    const section = newSection();
    section.setPreview({
      updates: [node('a', 5)],
      additions: [node('novo', 9)],
      marquee: { x: 0, y: 0, width: 1, height: 1 },
    });

    const preview = section.getPreview();

    expect(section.getPreview()).toBe(preview);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview?.updates)).toBe(true);
    expect(Object.isFrozen(preview?.updates['a']?.style)).toBe(true);
    expect(Object.isFrozen(preview?.additions)).toBe(true);
    expect(Object.isFrozen(preview?.additions[0])).toBe(true);
    expect(Object.isFrozen(preview?.marquee)).toBe(true);
    expect(Object.getPrototypeOf(preview?.updates)).toBeNull();
  });

  it('substitui o preview inteiro a cada chamada', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 5)], marquee: { x: 0, y: 0, width: 1, height: 1 } });

    section.setPreview({ updates: [node('b', 7)] });

    expect(section.getPreview()).toEqual({
      updates: { b: node('b', 7) },
      additions: [],
      marquee: null,
    });
  });

  it('guarda cópias: mexer depois no que foi passado não muda o preview', () => {
    const section = newSection();
    const style = { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 };
    const updates = [{ ...node('a', 5), style }];

    section.setPreview({ updates });
    style.opacity = 0;
    updates.push({ ...node('b', 1), style });

    expect(section.getPreview()?.updates).toEqual({ a: node('a', 5) });
  });

  it.each([
    ['null', null],
    ['um preview vazio', {}],
    ['listas vazias e marquee nulo', { updates: [], additions: [], marquee: null }],
  ])('limpa com %s, e emite um evento da área preview', (_label, input) => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 5)] });
    const snapshot = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    expect(setUntyped(section, input)).toEqual(OK);

    expect(section.getPreview()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      snapshot,
      origin: 'local',
      areas: ['preview'],
      affectedIds: [],
    });
  });

  it.each([
    ['limpar o que já está limpo', null, null],
    [
      'repetir o mesmo preview',
      { updates: [node('a', 5)], marquee: { x: 0, y: 0, width: 2, height: 2 } },
      { marquee: { x: 0, y: 0, width: 2, height: 2 }, updates: [node('a', 5)] },
    ],
  ])('não emite nada ao %s', (_label, first, second) => {
    const section = newSection();
    section.setPreview(first);
    const preview = section.getPreview();
    const listener = vi.fn();
    section.subscribe(listener);

    expect(section.setPreview(second)).toEqual(OK);
    expect(section.getPreview()).toBe(preview);
    expect(listener).not.toHaveBeenCalled();
  });

  it('nunca aparece no snapshot nem no documento', () => {
    const section = newSection();
    const before = section.getSnapshot();

    section.setPreview({ updates: [node('a', 500)], additions: [node('fantasma', 9)] });

    const after = section.getSnapshot();
    expect(after).toBe(before);
    expect(Object.keys(after)).toEqual(['document', 'session', 'history', 'revision']);
    expect(Object.keys(after.document.nodes)).toEqual(['a', 'b']);
    expect(JSON.stringify(after)).not.toContain('fantasma');
    expect(after.document.layers.flatMap((layer) => layer.childIds)).toEqual(['a', 'b']);
  });

  it('vale em modo somente leitura', () => {
    const section = newSection();
    section.setReadOnly(true);

    expect(section.setPreview({ marquee: { x: 0, y: 0, width: 5, height: 5 } })).toEqual(OK);
    expect(section.getPreview()?.marquee).toEqual({ x: 0, y: 0, width: 5, height: 5 });
  });

  it('devolve NOT_FOUND quando a geometria provisória é de um nó que não existe', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 5)] });
    const preview = section.getPreview();

    const result = section.setPreview({ updates: [node('b', 1), node('sumido', 2)] });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: { kind: 'node', id: 'sumido' },
      },
    });
    expect(section.getPreview()).toBe(preview);
  });

  it.each([
    ['um valor que não é objeto', 'preview', [], 'type'],
    ['campo desconhecido', { nodes: [] }, ['nodes'], 'unknown-field'],
    ['updates que não é lista', { updates: { a: node('a', 1) } }, ['updates'], 'type'],
    ['additions que não é lista', { additions: 'x' }, ['additions'], 'type'],
    ['nó que não é objeto', { updates: [null] }, ['updates', 0], 'type'],
    [
      'nó com dimensão inválida',
      { updates: [{ ...node('a', 1), width: 0 }] },
      ['updates', 0, 'width'],
      'range',
    ],
    [
      'nó com coordenada não finita',
      { additions: [{ ...node('n', Number.NaN) }] },
      ['additions', 0, 'x'],
      'finite',
    ],
    [
      'nó com campo desconhecido',
      { updates: [{ ...node('a', 1), layerId: BASE }] },
      ['updates', 0, 'layerId'],
      'unknown-field',
    ],
    [
      'nó sem ID',
      { additions: [{ type: 'rectangle', x: 0, y: 0, width: 1, height: 1, rotation: 0 }] },
      ['additions', 0, 'id'],
      'type',
    ],
    [
      'nó com o ID reservado',
      { additions: [{ ...node('__proto__', 1) }] },
      ['additions', 0, 'id'],
      'reserved-id',
    ],
    [
      'geometria provisória de outro tipo',
      { updates: [{ id: 'a', type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }] },
      ['updates', 0, 'type'],
      'type',
    ],
    [
      'nó novo com ID de um nó existente',
      { additions: [node('b', 1)] },
      ['additions', 0, 'id'],
      'duplicate-id',
    ],
    [
      'nó novo com ID de uma camada',
      { additions: [node(BASE, 1)] },
      ['additions', 0, 'id'],
      'duplicate-id',
    ],
    [
      'nó novo com o ID do documento',
      { additions: [node('id-1', 1)] },
      ['additions', 0, 'id'],
      'duplicate-id',
    ],
    [
      'dois nós novos com o mesmo ID',
      { additions: [node('n', 1), node('n', 2)] },
      ['additions', 1, 'id'],
      'duplicate-id',
    ],
    [
      'duas geometrias provisórias do mesmo nó',
      { updates: [node('a', 1), node('a', 2)] },
      ['updates', 1, 'id'],
      'duplicate-id',
    ],
    ['marquee que não é objeto', { marquee: [0, 0, 1, 1] }, ['marquee'], 'type'],
    [
      'marquee com largura negativa',
      { marquee: { x: 0, y: 0, width: -1, height: 1 } },
      ['marquee', 'width'],
      'range',
    ],
    [
      'marquee com altura negativa',
      { marquee: { x: 0, y: 0, width: 1, height: -1 } },
      ['marquee', 'height'],
      'range',
    ],
    [
      'marquee não finito',
      { marquee: { x: 0, y: Number.NaN, width: 1, height: 1 } },
      ['marquee', 'y'],
      'finite',
    ],
    [
      'marquee com campo a mais',
      { marquee: { x: 0, y: 0, width: 1, height: 1, z: 0 } },
      ['marquee', 'z'],
      'unknown-field',
    ],
  ])('recusa %s sem mudar o preview', (_label, input, path, rule) => {
    const section = newSection();
    section.setPreview({ marquee: { x: 0, y: 0, width: 9, height: 9 } });
    const preview = section.getPreview();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = setUntyped(section, input);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path, rule }] } },
    });
    expect(section.getPreview()).toBe(preview);
    expect(listener).not.toHaveBeenCalled();
  });

  it('cita cada problema na posição que o item tem na lista dada, mesmo depois de um item inválido', () => {
    const section = newSection();
    const issuesOf = (input: unknown): unknown => {
      const result = setUntyped(section, input);
      if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
      return result.error.details.issues.map(({ path, rule }) => ({ path, rule }));
    };
    const ellipseOfA = { type: 'ellipse', id: 'a', x: 0, y: 0, width: 1, height: 1, rotation: 0 };

    expect(issuesOf({ updates: [{ ...node('b', 1), width: -1 }, ellipseOfA] })).toEqual([
      { path: ['updates', 0, 'width'], rule: 'range' },
      { path: ['updates', 1, 'type'], rule: 'type' },
    ]);
    expect(issuesOf({ additions: [{ ...node('novo', 1), width: -1 }, node('a', 1)] })).toEqual([
      { path: ['additions', 0, 'width'], rule: 'range' },
      { path: ['additions', 1, 'id'], rule: 'duplicate-id' },
    ]);
  });

  it('não confere contra o documento o shape que já foi recusado', () => {
    const section = newSection();
    // Elipse no lugar do retângulo `a`, e ainda com largura zero: só a largura é citada.
    const retyped = { type: 'ellipse', id: 'a', x: 0, y: 0, width: 0, height: 1, rotation: 0 };

    const result = setUntyped(section, {
      updates: [retyped],
      additions: [{ ...node('b', 1), x: null }],
    });

    if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
    expect(result.error.details.issues.map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: ['updates', 0, 'width'], rule: 'range' },
      { path: ['additions', 0, 'x'], rule: 'type' },
    ]);
  });

  it('não relata como repetido o ID que já foi recusado por não ser texto', () => {
    const section = newSection();

    const result = setUntyped(section, {
      additions: [
        { ...node('x', 1), id: 7 },
        { ...node('x', 2), id: null },
      ],
      updates: [{ ...node('x', 3), id: '' }],
    });

    if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
    expect(result.error.details.issues.map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: ['updates', 0, 'id'], rule: 'type' },
      { path: ['additions', 0, 'id'], rule: 'type' },
      { path: ['additions', 1, 'id'], rule: 'type' },
    ]);
  });

  it('funcionam destacados do canvas', () => {
    const { setPreview, getPreview } = newSection();

    setPreview({ marquee: { x: 0, y: 0, width: 1, height: 1 } });

    expect(getPreview()?.marquee).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('limites no preview', () => {
  const limited = (): CanvasSectionApi => {
    const section = createCanvasSection({
      generateId: counter(),
      limits: { maxNodes: 3, maxCoordinate: 1000 },
    });
    section.dispatch(create('a', 0));
    return section;
  };

  it.each([
    ['coordenada', { ...node('p', 0), y: -1000.5 }, 1000.5],
    ['dimensão', { ...node('p', 0), width: 1001 }, 1001],
    ['largura de traço', { ...node('p', 0), style: { ...STYLE, strokeWidth: 5000 } }, 5000],
    ['valor que nenhuma caixa finita comporta', { ...node('p', 1.7e308), width: 1.7e308 }, 1.7e308],
  ])(
    'recusa %s além do limite do canvas, em nó novo e em geometria provisória',
    (_l, shape, actual) => {
      const section = limited();
      const refused = {
        ok: false,
        error: {
          code: 'LIMIT_EXCEEDED',
          message: expect.any(String),
          details: { limit: 'coordinate', max: 1000, actual },
        },
      };

      expect(section.setPreview({ additions: [shape] })).toEqual(refused);
      expect(section.setPreview({ updates: [{ ...shape, id: 'a' }] })).toEqual(refused);
      expect(section.getPreview()).toBeNull();
    },
  );

  it('aceita o shape exatamente no limite', () => {
    const section = limited();

    expect(section.setPreview({ additions: [{ ...node('p', -1000), width: 1000 }] })).toEqual(OK);
  });

  it('recusa nós novos que, somados aos do documento, passam do máximo de nós', () => {
    const section = limited();
    const additions = (count: number): RectangleNode[] =>
      Array.from({ length: count }, (_unused, index) => node(`p${index}`, 20 * index));

    expect(section.setPreview({ additions: additions(2) })).toEqual(OK);
    expect(section.setPreview({ additions: additions(3) })).toEqual({
      ok: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: expect.any(String),
        details: { limit: 'nodes', max: 3, actual: 4 },
      },
    });
    expect(section.getPreview()?.additions).toHaveLength(2);
  });

  it('relata o erro de validação e o de nó inexistente antes do de limite', () => {
    const section = limited();
    const far = node('p', 5000);

    expect(section.setPreview({ additions: [far, { ...node('q', 0), width: 0 }] })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(section.setPreview({ additions: [far], updates: [node('sumiu', 0)] })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('consultas com preview', () => {
  it('consulta um preview com milhares de nós novos sem custo quadrático', () => {
    const count = 30_000;
    const section = createCanvasSection({ generateId: counter() });
    const additions = Array.from({ length: count }, (_unused, index) =>
      node(`p${index}`, (index % 200) * 12, Math.floor(index / 200) * 12),
    );
    section.setPreview({ additions });
    const everything = { x: -100, y: -100, width: 10_000, height: 10_000 };

    // Procurar cada candidato na lista de nós novos seriam 450 milhões de comparações por
    // consulta: o prazo padrão do teste acusaria a volta do custo quadrático.
    expect(section.queryBounds(everything, WITH)).toHaveLength(count);
    expect(section.queryMarquee(everything, { ...WITH, mode: 'contain' })).toHaveLength(count);
    expect(
      section.getBounds(
        additions.map((shape) => shape.id),
        WITH,
      ),
    ).toEqual({ x: 0, y: 0, width: 199 * 12 + 10, height: 149 * 12 + 10 });
    expect(section.hitTestAll({ x: 5, y: 5 }, WITH)).toEqual(['p0']);
  });

  it('hitTest usa a geometria provisória só quando a consulta pede', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });

    expect(section.hitTest({ x: 5, y: 5 }, WITHOUT)).toBe('a');
    expect(section.hitTest({ x: 505, y: 5 }, WITHOUT)).toBeUndefined();
    expect(section.hitTest({ x: 5, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBe('a');
    expect(section.hitTestAll({ x: 505, y: 5 }, WITH)).toEqual(['a']);
  });

  it('trata a falta da opção como não considerar o preview', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });
    const hitTest = section.hitTest as (point: unknown, options?: unknown) => string | undefined;

    expect(hitTest({ x: 5, y: 5 })).toBe('a');
    expect(hitTest({ x: 5, y: 5 }, {})).toBe('a');
    expect(hitTest({ x: 505, y: 5 }, { includePreview: 1 })).toBeUndefined();
  });

  it('getBounds com opções que não dizem includePreview olha só o documento', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });
    const getBounds = section.getBounds as (ids: string[], options: unknown) => unknown;

    expect(getBounds(['a'], { stroke: false })).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(getBounds(['a'], { includePreview: 1 })).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('o nó com geometria provisória fica na posição visual do original', () => {
    const section = newSection();
    section.dispatch(create('c', 300, 'top'));
    // `a` é o mais ao fundo; levado para cima de `b` e de `c`, continua atrás dos dois.
    section.setPreview({ updates: [{ ...node('a', 95), width: 300 }] });

    expect(section.hitTestAll({ x: 105, y: 5 }, WITH)).toEqual(['b', 'a']);
    expect(section.hitTestAll({ x: 305, y: 5 }, WITH)).toEqual(['c', 'a']);
    expect(section.queryBounds({ x: 90, y: 0, width: 300, height: 10 }, WITH)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('os nós que ainda não existem ficam à frente de tudo, na ordem dada', () => {
    const section = newSection();
    section.dispatch(create('c', 100, 'top'));
    section.setPreview({ additions: [node('n1', 100), node('n2', 100)] });

    expect(section.hitTest({ x: 105, y: 5 }, WITH)).toBe('n2');
    expect(section.hitTestAll({ x: 105, y: 5 }, WITH)).toEqual(['n2', 'n1', 'c', 'b']);
    expect(section.hitTestAll({ x: 105, y: 5 }, WITHOUT)).toEqual(['c', 'b']);
    expect(section.queryBounds({ x: 100, y: 0, width: 5, height: 5 }, WITH)).toEqual([
      'b',
      'c',
      'n1',
      'n2',
    ]);
    expect(section.queryBounds({ x: 100, y: 0, width: 5, height: 5 }, WITHOUT)).toEqual(['b', 'c']);
  });

  it('queryBounds e queryMarquee seguem a geometria provisória', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)], additions: [node('novo', 700)] });
    const old = { x: -5, y: -5, width: 30, height: 30 };
    const moved = { x: 495, y: -5, width: 30, height: 30 };
    const added = { x: 695, y: -5, width: 30, height: 30 };

    expect(section.queryBounds(old, WITH)).toEqual([]);
    expect(section.queryBounds(old, WITHOUT)).toEqual(['a']);
    expect(section.queryBounds(moved, WITH)).toEqual(['a']);
    expect(section.queryBounds(added, WITH)).toEqual(['novo']);
    expect(section.queryMarquee(old, { mode: 'contain', includePreview: true })).toEqual([]);
    expect(section.queryMarquee(old, { mode: 'contain', includePreview: false })).toEqual(['a']);
    expect(section.queryMarquee(moved, { mode: 'contain', includePreview: true })).toEqual(['a']);
    expect(section.queryMarquee(added, { mode: 'intersect', includePreview: true })).toEqual([
      'novo',
    ]);
    expect(section.queryMarquee(added, { mode: 'intersect', includePreview: false })).toEqual([]);
  });

  it('getBounds usa a geometria provisória e os nós novos quando pedido', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)], additions: [node('novo', 700)] });

    expect(section.getBounds(['a'], { includePreview: false, stroke: false })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(section.getBounds(['a'], { includePreview: true, stroke: false })).toEqual({
      x: 500,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(section.getBounds(['a', 'novo'], WITH)).toEqual({
      x: 500,
      y: 0,
      width: 210,
      height: 10,
    });
    expect(section.getBounds(['novo'], WITHOUT)).toBeUndefined();
  });

  it('getBounds com preview dá a caixa do próprio nó quando ele não está no preview', () => {
    const section = newSection();
    section.setPreview({ additions: [node('novo', 700)] });

    expect(section.getBounds(['b'], WITH)).toEqual({ x: 100, y: 0, width: 10, height: 10 });
    expect(section.getBounds(['sumido'], WITH)).toBeUndefined();
  });

  it('getBounds esquece o nó novo de um preview anterior', () => {
    const section = newSection();
    section.setPreview({ additions: [node('antigo', 700)] });
    section.setPreview({ additions: [node('novo', 900)] });

    expect(section.getBounds(['antigo'], WITH)).toBeUndefined();
    expect(section.getBounds(['novo'], WITH)).toEqual({ x: 900, y: 0, width: 10, height: 10 });
  });

  it('respeita visibilidade e bloqueio do próprio preview e da camada do original', () => {
    const section = newSection();
    section.transact([
      create('c', 300, 'top'),
      { type: 'layer.update', id: 'top', patch: { visible: false } },
    ]);
    section.setPreview({
      updates: [{ ...node('a', 500), locked: true }, node('c', 600)],
      additions: [
        { ...node('oculto', 700), visible: false },
        { ...node('travado', 800), locked: true },
      ],
    });

    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 505, y: 5 }, { includePreview: true, includeLocked: true })).toBe(
      'a',
    );
    expect(
      section.hitTest({ x: 605, y: 5 }, { includePreview: true, includeLocked: true }),
    ).toBeUndefined();
    expect(
      section.hitTest({ x: 705, y: 5 }, { includePreview: true, includeLocked: true }),
    ).toBeUndefined();
    expect(section.hitTest({ x: 805, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 805, y: 5 }, { includePreview: true, includeLocked: true })).toBe(
      'travado',
    );
    expect(
      section.queryBounds(
        { x: 595, y: 0, width: 200, height: 10 },
        { includePreview: true, includeHidden: true },
      ),
    ).toEqual(['c', 'oculto']);
  });

  it('em camada bloqueada, o nó com geometria provisória só responde com includeLocked', () => {
    const section = newSection();
    section.dispatch({ type: 'layer.update', id: BASE, patch: { locked: true } });
    section.setPreview({ updates: [node('a', 500)] });
    const around = { x: 490, y: -10, width: 30, height: 30 };

    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 505, y: 5 }, { ...WITH, includeLocked: true })).toBe('a');
    expect(section.queryMarquee(around, { ...WITH, mode: 'contain' })).toEqual([]);
    expect(section.queryMarquee(around, { ...WITH, mode: 'contain', includeLocked: true })).toEqual(
      ['a'],
    );
  });

  it('a geometria provisória com visible: false esconde o nó nas consultas com preview', () => {
    const section = newSection();
    section.setPreview({ updates: [{ ...node('a', 500), visible: false }] });
    const around = { x: 490, y: -10, width: 30, height: 30 };

    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBeUndefined();
    expect(section.queryMarquee(around, { ...WITH, mode: 'intersect' })).toEqual([]);
    expect(section.queryBounds(around, WITH)).toEqual([]);
    expect(section.queryBounds(around, { ...WITH, includeHidden: true })).toEqual(['a']);
    // Sem o preview, o nó continua visível onde está no documento.
    expect(section.hitTest({ x: 5, y: 5 }, WITHOUT)).toBe('a');
  });

  it('mantém entre os nós novos a ordem da lista, mesmo quando o índice os acha em outra', () => {
    const section = newSection();
    // O primeiro da lista fica mais longe, em outra célula da grade do índice.
    section.setPreview({ additions: [node('primeiro', 600), node('segundo', 300)] });
    const everything = { x: -10, y: -10, width: 700, height: 30 };

    expect(section.queryBounds(everything, WITH)).toEqual(['a', 'b', 'primeiro', 'segundo']);
    expect(section.queryMarquee(everything, { ...WITH, mode: 'contain' })).toEqual([
      'a',
      'b',
      'primeiro',
      'segundo',
    ]);
  });

  it('acha o shape de preview pela faixa do traço, fora da geometria', () => {
    const section = newSection();
    const wide = { ...STYLE, stroke: '#000000', strokeWidth: 40 };
    section.setPreview({
      additions: [{ ...node('novo', 300), style: wide }],
      updates: [{ ...node('a', 600), style: wide }],
    });
    // A geometria do nó novo vai de 300 a 310, e o traço, de 280 a 330; a do nó `a`, 300 adiante.
    const beside = { x: 322, y: 0, width: 5, height: 5 };
    const besideUpdate = { x: 622, y: 0, width: 5, height: 5 };

    expect(section.queryBounds(beside, WITH)).toEqual(['novo']);
    expect(section.hitTest({ x: 325, y: 5 }, { ...WITH, tolerance: 0 })).toBe('novo');
    expect(section.queryMarquee(beside, { ...WITH, mode: 'intersect' })).toEqual(['novo']);
    expect(section.queryBounds(besideUpdate, WITH)).toEqual(['a']);
    expect(section.hitTest({ x: 625, y: 5 }, { ...WITH, tolerance: 0 })).toBe('a');
  });

  it('deixam de ver o preview depois que ele é limpo ou trocado', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)], additions: [node('novo', 700)] });

    section.setPreview({ updates: [node('a', 900)] });
    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 705, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 905, y: 5 }, WITH)).toBe('a');

    section.setPreview(null);
    expect(section.hitTest({ x: 905, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 5, y: 5 }, WITH)).toBe('a');
  });
});

describe('preview depois de alterações do documento', () => {
  it('perde a geometria provisória do nó removido e o nó novo cujo ID passou a existir', () => {
    const section = newSection();
    section.setPreview({
      updates: [node('a', 500), node('b', 600)],
      additions: [node('novo', 700), node('outro', 800)],
    });
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.transact([{ type: 'shape.remove', id: 'a' }, create('novo', 5)]);

    expect(section.getPreview()).toEqual({
      updates: { b: node('b', 600) },
      additions: [node('outro', 800)],
      marquee: null,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.areas).toEqual(['document', 'preview']);
    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 705, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 605, y: 5 }, WITH)).toBe('b');
  });

  it('perde a geometria provisória do nó que a alteração troca por outro de outro tipo', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const swapped = section.transact([
      { type: 'shape.remove', id: 'a' },
      { type: 'shape.create', shape: { ...node('a', 0), type: 'ellipse' } },
    ]);

    expect(swapped.ok).toBe(true);
    expect(section.getPreview()).toBeNull();
    expect(changes.map((change) => change.areas)).toEqual([['document', 'preview']]);
    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBeUndefined();
  });

  it('fica sem preview quando a alteração invalida tudo o que havia nele', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });

    section.dispatch({ type: 'shape.remove', id: 'a' });

    expect(section.getPreview()).toBeNull();
  });

  it('perde a geometria provisória do nó que um undo remove', () => {
    const section = newSection();
    section.dispatch(create('c', 300));
    section.setPreview({ updates: [node('c', 900)], marquee: { x: 0, y: 0, width: 1, height: 1 } });

    section.undo();

    expect(section.getPreview()).toEqual({
      updates: {},
      additions: [],
      marquee: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it('continua o mesmo, com a mesma referência, quando a alteração não o invalida', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)], additions: [node('novo', 700)] });
    const preview = section.getPreview();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.dispatch({ type: 'shape.update', id: 'a', patch: { y: 3 } });
    section.dispatch({ type: 'shape.remove', id: 'b' });
    section.undo();

    expect(section.getPreview()).toBe(preview);
    expect(changes.every((change) => !change.areas.includes('preview'))).toBe(true);
  });
});

describe('preview dentro de listener', () => {
  it('definir um preview devolve REENTRANT_DISPATCH', () => {
    const section = newSection();
    const inner: unknown[] = [];
    const unsubscribe = section.subscribe(() =>
      inner.push(section.setPreview({ updates: [node('a', 5)] })),
    );

    section.dispatch(create('c', 300));
    unsubscribe();

    expect(inner).toEqual([
      { ok: false, error: expect.objectContaining({ code: 'REENTRANT_DISPATCH' }) },
    ]);
    expect(section.getPreview()).toBeNull();
  });

  it('limpar vale na hora, e o evento do preview sai depois da notificação em curso', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });
    const log: string[] = [];
    section.subscribe((change) => {
      log.push(`primeiro: ${change.areas.join('+')}`);
      if (change.areas.includes('tool')) {
        log.push(`limpar: ${JSON.stringify(section.setPreview(null))}`);
        log.push(`preview durante a notificação: ${JSON.stringify(section.getPreview())}`);
      }
    });
    section.subscribe((change) => log.push(`segundo: ${change.areas.join('+')}`));

    section.setTool('hand');

    expect(log).toEqual([
      'primeiro: tool',
      'limpar: {"ok":true}',
      'preview durante a notificação: null',
      'segundo: tool',
      'primeiro: preview',
      'segundo: preview',
    ]);
    expect(section.getPreview()).toBeNull();
    expect(section.setTool('select')).toEqual(OK);
  });

  it('limpar é aceito em qualquer listener da notificação, não só no primeiro', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });
    const inner: unknown[] = [];
    const clear = (change: { readonly areas: readonly string[] }): void => {
      if (change.areas.includes('tool')) inner.push(section.setPreview(null));
    };
    section.subscribe(clear);
    section.subscribe(clear);

    section.setTool('hand');

    expect(inner).toEqual([OK, OK]);
    expect(section.getPreview()).toBeNull();
  });

  it('limpar um preview já limpo dentro de listener não gera evento nem laço', () => {
    const section = newSection();
    section.setPreview({ updates: [node('a', 500)] });
    const areas: (readonly string[])[] = [];
    section.subscribe((change) => {
      areas.push(change.areas);
      section.setPreview(null);
    });

    section.setTool('hand');

    expect(areas).toEqual([['tool'], ['preview']]);
  });
});

describe('limite do texto da forma no preview (US-SL.3)', () => {
  const limited = (): CanvasSectionApi => {
    const section = createCanvasSection({ generateId: counter(), limits: { maxTextLength: 10 } });
    section.dispatch(create('a', 0));
    return section;
  };
  const labelled = (text: string) => ({ ...node('p', 0), label: { text } });

  it('recusa um nó novo e uma geometria provisória com label acima do limite', () => {
    const section = limited();
    const refused = {
      ok: false,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: expect.any(String),
        details: { limit: 'text', max: 10, actual: 11 },
      },
    };

    expect(section.setPreview({ additions: [labelled('x'.repeat(11))] })).toEqual(refused);
    expect(section.setPreview({ updates: [{ ...labelled('x'.repeat(11)), id: 'a' }] })).toEqual(
      refused,
    );
    expect(section.getPreview()).toBeNull();
  });

  it('aceita o label exatamente no limite', () => {
    const section = limited();

    expect(section.setPreview({ additions: [labelled('x'.repeat(10))] })).toEqual(OK);
  });
});

describe('PreviewBoard (spec boards, §5.1 e §5.5)', () => {
  const board = (extra: Record<string, unknown> = {}) => ({
    id: 'nb',
    type: 'board',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    ...extra,
  });

  it('aceita um board em additions, com o título e o estilo dados, sem filhos', () => {
    const section = newSection();

    const res = setUntyped(section, { additions: [board({ title: 'Board 3' })] });

    expect(res.ok).toBe(true);
    expect(section.getPreview()!.additions[0]).toMatchObject({
      id: 'nb',
      type: 'board',
      title: 'Board 3',
      childIds: [],
      style: { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' },
    });
  });

  it('aceita o board do documento em updates, com a geometria provisória', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'bd', type: 'board', x: 0, y: 0, width: 100, height: 100 },
    } as never);

    const res = setUntyped(section, { updates: [board({ id: 'bd', x: 50, y: 60 })] });

    expect(res.ok).toBe(true);
    expect(section.getPreview()!.updates['bd']).toMatchObject({ type: 'board', x: 50, y: 60 });
  });

  it.each([
    ['título vazio', { title: '' }, 'type'],
    ['título com quebra de linha', { title: 'a\nb' }, 'format'],
    ['título com mais de 200 caracteres', { title: 'a'.repeat(201) }, 'range'],
    ['fillOpacity fora de [0, 1]', { style: { fillOpacity: 3 } }, 'range'],
    ['largura zero', { width: 0 }, 'range'],
    ['rotation', { rotation: 0 }, 'unknown-field'],
    ['childIds', { childIds: ['a'] }, 'unknown-field'],
  ])('recusa um PreviewBoard com %s', (_name, extra, rule) => {
    const section = newSection();

    const res = setUntyped(section, { additions: [board(extra)] });

    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(
      (res as unknown as { error: { details: { issues: { rule: string }[] } } }).error.details
        .issues,
    ).toContainEqual(expect.objectContaining({ rule }));
    expect(section.getPreview()).toBeNull();
  });

  it('um board em updates mantém o tipo: trocar um retângulo por board é recusado', () => {
    const section = newSection();

    const res = setUntyped(section, { updates: [board({ id: 'a' })] });

    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('a prévia do board não entra no documento, na revisão nem no histórico', () => {
    const section = newSection();
    const before = section.getSnapshot();

    setUntyped(section, { additions: [board()] });

    expect(section.getSnapshot().document).toBe(before.document);
    expect(section.getSnapshot().revision).toBe(before.revision);
    expect(section.getSnapshot().history).toEqual(before.history);
  });

  it('o board em additions entra nas consultas com includePreview', () => {
    const section = newSection();
    setUntyped(section, { additions: [board()] });

    expect(section.hitTestAll({ x: 100, y: 100 }, { includePreview: true, tolerance: 0 })).toEqual([
      'nb',
    ]);
    expect(section.hitTestAll({ x: 100, y: 100 }, { includePreview: false, tolerance: 0 })).toEqual(
      [],
    );
  });

  it('o board em additions respeita o limite de coordenada', () => {
    const section = createCanvasSection({ limits: { maxCoordinate: 1000 } });

    const res = setUntyped(section, { additions: [board({ x: 5000 })] });

    expect(res).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
  });
});
