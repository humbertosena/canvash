import { describe, expect, it, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import { computeSiblingReorderIndex } from './layers.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

/** A camada com que todo canvas nasce. */
const BASE = 'id-2';
const RECTANGLE = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;

function newSection(): CanvasSectionApi {
  return createCanvasSection({ generateId: counter() });
}

function createShape(id: string, layerId?: string): CanvasCommand {
  return { type: 'shape.create', shape: { ...RECTANGLE, id }, layerId };
}

function createLayer(id: string, index?: number): CanvasCommand {
  return { type: 'layer.create', layer: { id }, index };
}

function untyped(
  section: CanvasSectionApi,
  command: unknown,
): ReturnType<CanvasSectionApi['dispatch']> {
  return section.dispatch(command as CanvasCommand);
}

function layerIds(section: CanvasSectionApi): string[] {
  return section.getSnapshot().document.layers.map((layer) => layer.id);
}

function childIds(section: CanvasSectionApi, layerId: string): readonly string[] | undefined {
  return section.getSnapshot().document.layers.find((layer) => layer.id === layerId)?.childIds;
}

/** Canvas com as camadas `BASE`, `mid` e `top`, do fundo para a frente, e nós `a`, `b`, `c` em `BASE`. */
function sectionWithLayers(): CanvasSectionApi {
  const section = newSection();
  section.transact([
    createLayer('mid'),
    createLayer('top'),
    createShape('a', BASE),
    createShape('b', BASE),
    createShape('c', BASE),
  ]);
  return section;
}

describe('layer.create', () => {
  it('cria uma camada vazia à frente das demais, com padrões materializados', () => {
    const section = newSection();

    const result = section.dispatch({ type: 'layer.create' });

    expect(result).toEqual({
      ok: true,
      value: { revision: 1, changed: true, affectedIds: ['id-3'], createdIds: ['id-3'] },
    });
    expect(section.getSnapshot().document.layers).toEqual([
      { id: BASE, name: 'Layer 1', visible: true, locked: false, childIds: [] },
      { id: 'id-3', name: 'Layer 2', visible: true, locked: false, childIds: [] },
    ]);
  });

  it('usa ID, nome, visibilidade, bloqueio, metadata e posição dados', () => {
    const section = newSection();

    const result = section.dispatch({
      type: 'layer.create',
      index: 0,
      layer: { id: 'fundo', name: 'Fundo', visible: false, locked: true, metadata: { 'app:k': 1 } },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { affectedIds: ['fundo', BASE], createdIds: ['fundo'] },
    });
    expect(section.getSnapshot().document.layers).toEqual([
      {
        id: 'fundo',
        name: 'Fundo',
        visible: false,
        locked: true,
        childIds: [],
        metadata: { 'app:k': 1 },
      },
      { id: BASE, name: 'Layer 1', visible: true, locked: false, childIds: [] },
    ]);
  });

  it('aceita como posição explícita o fim da lista de camadas', () => {
    const section = newSection();

    const result = section.dispatch({ type: 'layer.create', layer: { id: 'frente' }, index: 1 });

    expect(result).toMatchObject({ ok: true, value: { affectedIds: ['frente'] } });
    expect(layerIds(section)).toEqual([BASE, 'frente']);
  });

  it('passa a receber os shapes criados sem camada explícita quando é a mais à frente', () => {
    const section = newSection();

    section.transact([
      createLayer('nova'),
      createShape('a'),
      createLayer('fundo', 0),
      createShape('b'),
    ]);

    expect(childIds(section, 'nova')).toEqual(['a', 'b']);
    expect(childIds(section, BASE)).toEqual([]);
    expect(layerIds(section)).toEqual(['fundo', BASE, 'nova']);
  });

  it('é desfeita e refeita pelo histórico', () => {
    const section = newSection();
    const before = section.getSnapshot().document;
    section.dispatch(createLayer('nova', 0));
    const created = section.getSnapshot().document;

    const undo = section.undo();
    const undone = section.getSnapshot().document;
    section.redo();

    expect(undo).toMatchObject({ ok: true, value: { affectedIds: ['nova', BASE] } });
    expect(undone).toEqual(before);
    expect(undone.layers[0]).toBe(before.layers[0]);
    expect(section.getSnapshot().document).toEqual(created);
  });

  it.each([
    ['camada que não é objeto', { type: 'layer.create', layer: 'x' }, ['layer'], 'type'],
    ['camada nula', { type: 'layer.create', layer: null }, ['layer'], 'type'],
    ['nome vazio', { type: 'layer.create', layer: { name: '' } }, ['layer', 'name'], 'type'],
    [
      'nome que não é texto',
      { type: 'layer.create', layer: { name: 3 } },
      ['layer', 'name'],
      'type',
    ],
    [
      'visible que não é booleano',
      { type: 'layer.create', layer: { visible: 1 } },
      ['layer', 'visible'],
      'type',
    ],
    [
      'metadata que não é objeto',
      { type: 'layer.create', layer: { metadata: [] } },
      ['layer', 'metadata'],
      'type',
    ],
    [
      'campo desconhecido na camada',
      { type: 'layer.create', layer: { childIds: [] } },
      ['layer', 'childIds'],
      'unknown-field',
    ],
    [
      'campo desconhecido no comando',
      { type: 'layer.create', name: 'x' },
      ['name'],
      'unknown-field',
    ],
    ['ID vazio', { type: 'layer.create', layer: { id: '' } }, ['layer', 'id'], 'type'],
    [
      'ID reservado',
      { type: 'layer.create', layer: { id: '__proto__' } },
      ['layer', 'id'],
      'reserved-id',
    ],
    [
      'ID de outra camada',
      { type: 'layer.create', layer: { id: BASE } },
      ['layer', 'id'],
      'duplicate-id',
    ],
    ['ID de um nó', { type: 'layer.create', layer: { id: 'a' } }, ['layer', 'id'], 'duplicate-id'],
    ['posição nula', { type: 'layer.create', index: null }, ['index'], 'type'],
    ['ID nulo', { type: 'layer.create', layer: { id: null } }, ['layer', 'id'], 'type'],
    [
      'metadata nulo',
      { type: 'layer.create', layer: { metadata: null } },
      ['layer', 'metadata'],
      'type',
    ],
    ['posição negativa', { type: 'layer.create', index: -1 }, ['index'], 'range'],
    ['posição além do fim', { type: 'layer.create', index: 2 }, ['index'], 'range'],
    ['posição fracionária', { type: 'layer.create', index: 0.5 }, ['index'], 'range'],
    ['posição que não é número', { type: 'layer.create', index: '0' }, ['index'], 'type'],
  ])('recusa %s', (_label, command, path, rule) => {
    const section = newSection();
    section.dispatch(createShape('a'));
    const before = section.getSnapshot();

    const result = untyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0, issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('layer.update', () => {
  it('altera só os campos dados', () => {
    const section = sectionWithLayers();

    const result = section.dispatch({
      type: 'layer.update',
      id: BASE,
      patch: { name: 'Base', visible: false },
    });

    expect(result).toEqual({
      ok: true,
      value: { revision: 2, changed: true, affectedIds: [BASE], createdIds: [] },
    });
    expect(section.getSnapshot().document.layers[0]).toEqual({
      id: BASE,
      name: 'Base',
      visible: false,
      locked: false,
      childIds: ['a', 'b', 'c'],
    });
  });

  it('reaproveita a lista de filhos da camada quando só os campos dela mudam', () => {
    const section = sectionWithLayers();
    const before = section.getSnapshot().document;

    section.dispatch({ type: 'layer.update', id: BASE, patch: { name: 'Base' } });

    const after = section.getSnapshot().document;
    expect(after.layers[0]?.childIds).toBe(before.layers[0]?.childIds);
    expect(after.layers[1]).toBe(before.layers[1]);
    expect(after.nodes).toBe(before.nodes);
  });

  it('substitui o metadata e o remove com null', () => {
    const section = sectionWithLayers();

    section.dispatch({ type: 'layer.update', id: 'mid', patch: { metadata: { 'app:k': [1] } } });
    const withMetadata = section.getSnapshot().document.layers[1];
    section.dispatch({ type: 'layer.update', id: 'mid', patch: { metadata: null } });
    const removed = section.getSnapshot().document.layers[1];

    expect(withMetadata?.metadata).toEqual({ 'app:k': [1] });
    expect(removed && 'metadata' in removed).toBe(false);
  });

  it('mantém o metadata quando o patch não fala dele', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'layer.update', id: 'mid', patch: { metadata: { 'app:k': 1 } } });

    section.dispatch({ type: 'layer.update', id: 'mid', patch: { name: 'Meio' } });

    expect(section.getSnapshot().document.layers[1]).toEqual({
      id: 'mid',
      name: 'Meio',
      visible: true,
      locked: false,
      childIds: [],
      metadata: { 'app:k': 1 },
    });
  });

  it('vale em camada bloqueada: é assim que ela é desbloqueada', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'layer.update', id: BASE, patch: { locked: true } });

    const rename = section.dispatch({ type: 'layer.update', id: BASE, patch: { name: 'Travada' } });
    const unlock = section.dispatch({ type: 'layer.update', id: BASE, patch: { locked: false } });

    expect(rename.ok).toBe(true);
    expect(unlock.ok).toBe(true);
    expect(section.getSnapshot().document.layers[0]).toMatchObject({
      name: 'Travada',
      locked: false,
    });
  });

  it.each([
    ['os mesmos valores', { name: 'Layer 1', visible: true, locked: false }],
    ['um patch vazio', {}],
    ['metadata null em camada sem metadata', { metadata: null }],
  ])('não gera revisão nem evento com %s', (_label, patch) => {
    const section = sectionWithLayers();
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = untyped(section, { type: 'layer.update', id: BASE, patch });

    expect(result).toMatchObject({ ok: true, value: { changed: false } });
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['uma camada que não existe', 'sumida'],
    ['o ID de um nó', 'a'],
  ])('devolve NOT_FOUND para %s', (_label, id) => {
    const section = sectionWithLayers();

    const result = section.dispatch({ type: 'layer.update', id, patch: { name: 'x' } });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: { kind: 'layer', id, commandIndex: 0 },
      },
    });
  });

  it.each([
    ['patch ausente', { type: 'layer.update', id: BASE }, ['patch'], 'type'],
    ['ID ausente', { type: 'layer.update', patch: {} }, ['id'], 'type'],
    [
      'nome vazio',
      { type: 'layer.update', id: BASE, patch: { name: '' } },
      ['patch', 'name'],
      'type',
    ],
    [
      'troca de ID',
      { type: 'layer.update', id: BASE, patch: { id: 'x' } },
      ['patch', 'id'],
      'unknown-field',
    ],
    [
      'childIds no patch',
      { type: 'layer.update', id: BASE, patch: { childIds: [] } },
      ['patch', 'childIds'],
      'unknown-field',
    ],
    [
      'locked que não é booleano',
      { type: 'layer.update', id: BASE, patch: { locked: 'no' } },
      ['patch', 'locked'],
      'type',
    ],
    [
      'metadata inválido',
      { type: 'layer.update', id: BASE, patch: { metadata: 3 } },
      ['patch', 'metadata'],
      'type',
    ],
    [
      'campo desconhecido no comando',
      { type: 'layer.update', id: BASE, patch: {}, index: 0 },
      ['index'],
      'unknown-field',
    ],
  ])('recusa %s', (_label, command, path, rule) => {
    const section = sectionWithLayers();
    const before = section.getSnapshot();

    const result = untyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0, issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('layer.reorder', () => {
  it.each([
    ['para a frente', BASE, 2, ['mid', 'top', BASE], [BASE, 'mid', 'top']],
    ['para o fundo', 'top', 0, ['top', BASE, 'mid'], ['top', BASE, 'mid']],
    ['uma posição', 'mid', 2, [BASE, 'top', 'mid'], ['top', 'mid']],
  ])(
    'move a camada %s e cita as camadas que mudaram de posição',
    (_label, id, index, order, affected) => {
      const section = sectionWithLayers();
      const before = section.getSnapshot().document;

      const result = section.dispatch({ type: 'layer.reorder', id, index });

      expect(result).toMatchObject({ ok: true, value: { revision: 2, createdIds: [] } });
      expect(result.ok && [...result.value.affectedIds].sort()).toEqual([...affected].sort());
      expect(layerIds(section)).toEqual(order);
      expect(section.getSnapshot().document.nodes).toBe(before.nodes);
      expect(section.getSnapshot().document.layers.find((layer) => layer.id === BASE)).toBe(
        before.layers[0],
      );
    },
  );

  it('não gera revisão quando a camada já está na posição', () => {
    const section = sectionWithLayers();
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'layer.reorder', id: 'mid', index: 1 });

    expect(result).toMatchObject({ ok: true, value: { changed: false } });
    expect(section.getSnapshot()).toBe(before);
  });

  it('é desfeita e refeita pelo histórico', () => {
    const section = sectionWithLayers();

    section.dispatch({ type: 'layer.reorder', id: BASE, index: 2 });
    const undo = section.undo();
    const undone = layerIds(section);
    section.redo();

    expect(undo.ok && [...undo.value.affectedIds].sort()).toEqual([BASE, 'mid', 'top'].sort());
    expect(undone).toEqual([BASE, 'mid', 'top']);
    expect(layerIds(section)).toEqual(['mid', 'top', BASE]);
  });

  it('vale para camada bloqueada', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'layer.update', id: BASE, patch: { locked: true } });

    expect(section.dispatch({ type: 'layer.reorder', id: BASE, index: 1 }).ok).toBe(true);
    expect(layerIds(section)).toEqual(['mid', BASE, 'top']);
  });

  it('devolve NOT_FOUND para camada que não existe', () => {
    const section = sectionWithLayers();

    const result = section.dispatch({ type: 'layer.reorder', id: 'a', index: 0 });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { kind: 'layer', id: 'a', commandIndex: 0 } },
    });
  });

  it.each([
    ['posição ausente', { type: 'layer.reorder', id: BASE }, ['index'], 'type'],
    [
      'posição igual ao número de camadas',
      { type: 'layer.reorder', id: BASE, index: 3 },
      ['index'],
      'range',
    ],
    ['posição negativa', { type: 'layer.reorder', id: BASE, index: -1 }, ['index'], 'range'],
    ['posição fracionária', { type: 'layer.reorder', id: BASE, index: 1.2 }, ['index'], 'range'],
    ['ID ausente', { type: 'layer.reorder', index: 0 }, ['id'], 'type'],
    [
      'campo desconhecido',
      { type: 'layer.reorder', id: BASE, index: 0, layerId: 'x' },
      ['layerId'],
      'unknown-field',
    ],
  ])('recusa %s', (_label, command, path, rule) => {
    const section = sectionWithLayers();
    const before = section.getSnapshot();

    const result = untyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0, issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('node.reorder', () => {
  it.each([
    ['para o fundo', 'c', 0, ['c', 'a', 'b']],
    ['para a frente', 'a', 2, ['b', 'c', 'a']],
    ['para o meio', 'a', 1, ['b', 'a', 'c']],
  ])('move o nó %s da própria camada', (_label, id, index, order) => {
    const section = sectionWithLayers();
    const before = section.getSnapshot().document;

    const result = section.dispatch({ type: 'node.reorder', id, index });

    expect(result).toEqual({
      ok: true,
      value: { revision: 2, changed: true, affectedIds: [id, BASE], createdIds: [] },
    });
    expect(childIds(section, BASE)).toEqual(order);
    expect(section.getSnapshot().document.nodes).toBe(before.nodes);
  });

  it('move o nó para outra camada, em uma revisão, e ele fica em uma camada só', () => {
    const section = sectionWithLayers();
    section.dispatch(createShape('x', 'top'));
    const listener = vi.fn();
    section.subscribe(listener);

    const result = section.dispatch({ type: 'node.reorder', id: 'b', layerId: 'top', index: 0 });

    expect(result).toEqual({
      ok: true,
      value: { revision: 3, changed: true, affectedIds: ['b', BASE, 'top'], createdIds: [] },
    });
    expect(childIds(section, BASE)).toEqual(['a', 'c']);
    expect(childIds(section, 'top')).toEqual(['b', 'x']);
    expect(childIds(section, 'mid')).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(section.getNodeInfo('b')).toMatchObject({ layerId: 'top', index: 0 });
  });

  it('aceita como posição o fim da camada de destino', () => {
    const section = sectionWithLayers();
    section.dispatch(createShape('x', 'top'));

    section.dispatch({ type: 'node.reorder', id: 'a', layerId: 'top', index: 1 });

    expect(childIds(section, 'top')).toEqual(['x', 'a']);
  });

  it('é desfeito e refeito pelo histórico, nas duas camadas de uma vez', () => {
    const section = sectionWithLayers();
    const before = section.getSnapshot().document;
    section.dispatch({ type: 'node.reorder', id: 'b', layerId: 'mid', index: 0 });
    const moved = section.getSnapshot().document;

    const undo = section.undo();
    const undone = section.getSnapshot().document;
    const infoAfterUndo = section.getNodeInfo('b');
    const redo = section.redo();

    expect(undo).toMatchObject({ ok: true, value: { affectedIds: ['b', BASE, 'mid'] } });
    expect(redo).toMatchObject({ ok: true, value: { affectedIds: ['b', BASE, 'mid'] } });
    expect(undone).toEqual(before);
    expect(infoAfterUndo).toMatchObject({ layerId: BASE, index: 1 });
    expect(section.getSnapshot().document).toEqual(moved);
    expect(section.getNodeInfo('b')).toMatchObject({ layerId: 'mid', index: 0 });
  });

  it.each([
    ['na própria camada', { type: 'node.reorder', id: 'b', index: 1 }],
    ['com a própria camada explícita', { type: 'node.reorder', id: 'b', index: 1, layerId: BASE }],
  ])('não gera revisão quando o nó já está na posição, %s', (_label, command) => {
    const section = sectionWithLayers();
    const before = section.getSnapshot();

    const result = untyped(section, command);

    expect(result).toEqual({
      ok: true,
      value: { revision: 1, changed: false, affectedIds: [], createdIds: [] },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['nó que não existe', { type: 'node.reorder', id: 'sumido', index: 0 }, 'node', 'sumido'],
    [
      'o ID de uma camada no lugar do nó',
      { type: 'node.reorder', id: 'mid', index: 0 },
      'node',
      'mid',
    ],
    [
      'camada de destino que não existe',
      { type: 'node.reorder', id: 'a', index: 0, layerId: 'sumida' },
      'layer',
      'sumida',
    ],
  ])('devolve NOT_FOUND para %s', (_label, command, kind, id) => {
    const section = sectionWithLayers();
    const before = section.getSnapshot();

    const result = untyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { kind, id, commandIndex: 0 } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['posição ausente', { type: 'node.reorder', id: 'a' }, ['index'], 'type'],
    [
      'posição igual ao tamanho da própria camada',
      { type: 'node.reorder', id: 'a', index: 3 },
      ['index'],
      'range',
    ],
    [
      'posição além do fim da camada de destino',
      { type: 'node.reorder', id: 'a', index: 1, layerId: 'mid' },
      ['index'],
      'range',
    ],
    ['posição negativa', { type: 'node.reorder', id: 'a', index: -1 }, ['index'], 'range'],
    ['posição fracionária', { type: 'node.reorder', id: 'a', index: 0.5 }, ['index'], 'range'],
    [
      'posição não finita',
      { type: 'node.reorder', id: 'a', index: Number.NaN },
      ['index'],
      'finite',
    ],
    [
      'layerId nulo',
      { type: 'node.reorder', id: 'a', index: 0, layerId: null },
      ['layerId'],
      'type',
    ],
    [
      'layerId vazio',
      { type: 'node.reorder', id: 'a', index: 0, layerId: '' },
      ['layerId'],
      'type',
    ],
    ['ID ausente', { type: 'node.reorder', index: 0 }, ['id'], 'type'],
    [
      'campo desconhecido',
      { type: 'node.reorder', id: 'a', index: 0, before: 'b' },
      ['before'],
      'unknown-field',
    ],
  ])('recusa %s', (_label, command, path, rule) => {
    const section = sectionWithLayers();
    const before = section.getSnapshot();

    const result = untyped(section, command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0, issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('bloqueio', () => {
  const lockLayer: CanvasCommand = { type: 'layer.update', id: BASE, patch: { locked: true } };
  const lockNode: CanvasCommand = { type: 'shape.update', id: 'a', patch: { locked: true } };

  it.each([
    ['alterar', { type: 'shape.update', id: 'a', patch: { x: 5 } }, 'a'],
    ['desbloquear', { type: 'shape.update', id: 'a', patch: { locked: false } }, 'a'],
    ['remover', { type: 'shape.remove', id: 'a' }, 'a'],
    ['reordenar', { type: 'node.reorder', id: 'a', index: 2 }, 'a'],
    ['mover para outra camada', { type: 'node.reorder', id: 'a', index: 0, layerId: 'mid' }, 'a'],
    ['criar nela, por ser a camada pedida', createShape('novo', BASE), BASE],
  ] as const)('camada bloqueada impede %s um nó dela', (_label, command, id) => {
    const section = sectionWithLayers();
    section.dispatch(lockLayer);
    const before = section.getSnapshot();

    const result = section.dispatch(command);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'LOCKED',
        message: expect.any(String),
        details: { id, lockedBy: BASE, commandIndex: 0 },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('camada bloqueada impede criar nela quando é a mais à frente', () => {
    const section = newSection();
    section.dispatch(lockLayer);

    const result = section.dispatch(createShape('novo'));

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { id: BASE, lockedBy: BASE } },
    });
  });

  it('camada de destino bloqueada impede receber um nó', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'layer.update', id: 'mid', patch: { locked: true } });

    const result = section.dispatch({ type: 'node.reorder', id: 'a', index: 0, layerId: 'mid' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { id: 'a', lockedBy: 'mid', commandIndex: 0 } },
    });
  });

  it.each([
    ['alterar', { type: 'shape.update', id: 'a', patch: { x: 5 } }],
    ['alterar o estilo', { type: 'shape.update', id: 'a', patch: { style: { opacity: 0 } } }],
    ['remover', { type: 'shape.remove', id: 'a' }],
    ['reordenar', { type: 'node.reorder', id: 'a', index: 2 }],
    ['mover para outra camada', { type: 'node.reorder', id: 'a', index: 0, layerId: 'top' }],
  ] as const)('nó bloqueado não deixa %s', (_label, command) => {
    const section = sectionWithLayers();
    section.dispatch(lockNode);
    const before = section.getSnapshot();

    const result = section.dispatch(command);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { id: 'a', lockedBy: 'a', commandIndex: 0 } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['repete o bloqueio', { locked: true, x: 99 }],
    ['traz locked indefinido', { locked: undefined, x: 99 }],
  ])('nó bloqueado recusa o patch que %s', (_label, patch) => {
    const section = sectionWithLayers();
    section.dispatch(lockNode);
    const before = section.getSnapshot();

    const result = section.dispatch({ type: 'shape.update', id: 'a', patch });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { id: 'a', lockedBy: 'a' } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('nó bloqueado em camada bloqueada: quem bloqueia é a camada, e nem o desbloqueio passa', () => {
    const section = sectionWithLayers();
    section.transact([lockNode, lockLayer]);
    const before = section.getSnapshot();

    const results = [
      section.dispatch({ type: 'shape.update', id: 'a', patch: { locked: false } }),
      section.dispatch({ type: 'shape.update', id: 'a', patch: { locked: false, x: 5 } }),
      section.dispatch({ type: 'shape.remove', id: 'a' }),
      section.dispatch({ type: 'node.reorder', id: 'a', index: 1 }),
    ];

    for (const result of results) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'LOCKED', details: { id: 'a', lockedBy: BASE } },
      });
    }
    expect(section.getSnapshot()).toBe(before);
  });

  it('a validação vem antes do bloqueio: entrada inválida para item bloqueado devolve VALIDATION_ERROR', () => {
    const section = sectionWithLayers();
    section.transact([lockNode, lockLayer]);

    const results = [
      section.dispatch({ type: 'shape.update', id: 'a', patch: { width: 0 } }),
      section.dispatch({ type: 'shape.update', id: 'b', patch: { width: 0 } }),
      section.dispatch({ type: 'node.reorder', id: 'a', index: 99 }),
      section.dispatch({ type: 'node.reorder', id: 'b', index: 99 }),
    ];

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('nó bloqueado aceita o patch que o desbloqueia, com as outras alterações do mesmo patch', () => {
    const section = sectionWithLayers();
    section.dispatch(lockNode);

    const result = section.dispatch({
      type: 'shape.update',
      id: 'a',
      patch: { locked: false, x: 5 },
    });

    expect(result).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ locked: false, x: 5 });
  });

  it('bloquear e alterar no mesmo patch vale, e o nó sai bloqueado', () => {
    const section = sectionWithLayers();

    const result = section.dispatch({
      type: 'shape.update',
      id: 'a',
      patch: { locked: true, x: 5 },
    });

    expect(result.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ locked: true, x: 5 });
  });

  it('não impede os irmãos desbloqueados nem a reordenação deles', () => {
    const section = sectionWithLayers();
    section.dispatch(lockNode);

    expect(section.dispatch({ type: 'shape.update', id: 'b', patch: { x: 1 } }).ok).toBe(true);
    expect(section.dispatch({ type: 'node.reorder', id: 'c', index: 0 }).ok).toBe(true);
    expect(childIds(section, BASE)).toEqual(['c', 'a', 'b']);
  });

  it('vale o estado de bloqueio de cada passo dentro da transação', () => {
    const section = sectionWithLayers();

    const lockedMidway = section.transact([
      lockLayer,
      { type: 'shape.update', id: 'a', patch: { x: 5 } },
    ]);
    section.dispatch(lockLayer);
    const unlockedMidway = section.transact([
      { type: 'layer.update', id: BASE, patch: { locked: false } },
      { type: 'shape.update', id: 'a', patch: { x: 5 } },
      lockLayer,
    ]);

    expect(lockedMidway).toMatchObject({
      ok: false,
      error: { code: 'LOCKED', details: { id: 'a', lockedBy: BASE, commandIndex: 1 } },
    });
    // A camada termina a transação como começou, bloqueada: só o nó conta como alterado.
    expect(unlockedMidway).toMatchObject({ ok: true, value: { affectedIds: ['a'] } });
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ x: 5 });
    expect(section.getSnapshot().document.layers[0]).toMatchObject({ locked: true });
  });

  it('comando inválido para nó bloqueado devolve o erro de validação', () => {
    const section = sectionWithLayers();
    section.dispatch(lockNode);

    const result = section.dispatch({ type: 'shape.update', id: 'a', patch: { width: 0 } });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('undo e redo atravessam o bloqueio: restauram o documento, não editam o nó', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 5 } });
    section.dispatch(lockNode);
    section.dispatch(lockLayer);

    expect(section.undo().ok).toBe(true);
    expect(section.undo().ok).toBe(true);
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ x: 0, locked: false });
  });
});

describe('getNodeInfo', () => {
  it('diz a camada, a posição e a visibilidade e o bloqueio efetivos de um nó', () => {
    const section = sectionWithLayers();

    expect(section.getNodeInfo('a')).toEqual({
      layerId: BASE,
      index: 0,
      visible: true,
      locked: false,
    });
    expect(section.getNodeInfo('c')).toEqual({
      layerId: BASE,
      index: 2,
      visible: true,
      locked: false,
    });
  });

  it.each([
    [
      'o próprio nó oculto',
      [{ type: 'shape.update', id: 'a', patch: { visible: false } }],
      false,
      false,
    ],
    [
      'a camada oculta',
      [{ type: 'layer.update', id: BASE, patch: { visible: false } }],
      false,
      false,
    ],
    [
      'o próprio nó bloqueado',
      [{ type: 'shape.update', id: 'a', patch: { locked: true } }],
      true,
      true,
    ],
    [
      'a camada bloqueada',
      [{ type: 'layer.update', id: BASE, patch: { locked: true } }],
      true,
      true,
    ],
    [
      'nó oculto em camada bloqueada',
      [
        { type: 'shape.update', id: 'a', patch: { visible: false } },
        { type: 'layer.update', id: BASE, patch: { locked: true } },
      ],
      false,
      true,
    ],
  ] as const)('considera %s', (_label, commands, visible, locked) => {
    const section = sectionWithLayers();

    section.transact(commands);

    expect(section.getNodeInfo('a')).toMatchObject({ visible, locked });
  });

  it('devolve undefined para ID que não é de um nó', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'shape.remove', id: 'b' });

    expect(section.getNodeInfo('sumido')).toBeUndefined();
    expect(section.getNodeInfo('b')).toBeUndefined();
    expect(section.getNodeInfo(BASE)).toBeUndefined();
    expect(section.getNodeInfo('constructor')).toBeUndefined();
  });

  it('funciona destacado do canvas', () => {
    const { getNodeInfo } = sectionWithLayers();

    expect(getNodeInfo('b')).toMatchObject({ layerId: BASE, index: 1 });
  });
});

describe('ordem do documento', () => {
  it('mantém cada nó em exatamente uma camada ao longo de criações, movimentos e undos', () => {
    const section = sectionWithLayers();
    section.transact([
      { type: 'node.reorder', id: 'a', index: 0, layerId: 'top' },
      { type: 'node.reorder', id: 'b', index: 1, layerId: 'top' },
      { type: 'node.reorder', id: 'a', index: 0, layerId: 'mid' },
      { type: 'layer.reorder', id: 'top', index: 0 },
      createShape('d'),
    ]);
    section.dispatch({ type: 'shape.remove', id: 'c' });
    section.undo();
    section.dispatch({ type: 'node.reorder', id: 'c', index: 0, layerId: 'mid' });

    const { document } = section.getSnapshot();
    const placed = document.layers.flatMap((layer) => layer.childIds);

    expect([...placed].sort()).toEqual(Object.keys(document.nodes).sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(document.layers.map((layer) => [layer.id, layer.childIds])).toEqual([
      ['top', ['b']],
      [BASE, []],
      ['mid', ['c', 'a', 'd']],
    ]);
    for (const id of placed) {
      const info = section.getNodeInfo(id);
      expect(
        document.layers.find((layer) => layer.id === info?.layerId)?.childIds[info?.index ?? -1],
      ).toBe(id);
    }
  });
});

describe('reordenação entre irmãos e grupos (INPUT-08)', () => {
  it('reordena nós entre irmãos dentro de um grupo', () => {
    const section = sectionWithLayers();
    // Nós a, b, c estão em BASE. Agrupa a e b
    section.dispatch({ type: 'group.create', id: 'grp-ab', childIds: ['a', 'b'] });
    const docBefore = section.getSnapshot().document;
    const grpBefore = docBefore.nodes['grp-ab'];
    expect(grpBefore && 'childIds' in grpBefore ? grpBefore.childIds : []).toEqual(['a', 'b']);

    // Reordena 'a' para a posição 1 dentro do grupo
    const res = section.dispatch({ type: 'node.reorder', id: 'a', index: 1 });
    expect(res.ok).toBe(true);
    const docAfter = section.getSnapshot().document;
    const grpAfter = docAfter.nodes['grp-ab'];
    expect(grpAfter && 'childIds' in grpAfter ? grpAfter.childIds : []).toEqual(['b', 'a']);
  });

  it('rejeita mover nó pertencente a um grupo diretamente para outra camada', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'group.create', id: 'grp-ab', childIds: ['a', 'b'] });

    const res = section.dispatch({ type: 'node.reorder', id: 'a', layerId: 'top', index: 0 });
    expect(res.ok).toBe(false);
  });

  it('mover grupo para outra camada atualiza parentesco dos filhos atomicamente', () => {
    const section = sectionWithLayers();
    section.dispatch({ type: 'group.create', id: 'grp-ab', childIds: ['a', 'b'] });

    // Move grp-ab para a camada 'top'
    const res = section.dispatch({ type: 'node.reorder', id: 'grp-ab', layerId: 'top', index: 0 });
    expect(res.ok).toBe(true);

    expect(childIds(section, 'top')).toEqual(['grp-ab']);
    expect(childIds(section, BASE)).toEqual(['c']);

    // Verifica que o getNodeInfo de todos os filhos do grupo aponta para 'top'
    expect(section.getNodeInfo('a')?.layerId).toBe('top');
    expect(section.getNodeInfo('b')?.layerId).toBe('top');
    expect(section.getNodeInfo('grp-ab')?.layerId).toBe('top');
  });

  describe('computeSiblingReorderIndex', () => {
    it('calcula índices corretos para nós em camada', () => {
      const section = sectionWithLayers(); // BASE tem ['a', 'b', 'c']
      const doc = section.getSnapshot().document;

      // 'a' está no índice 0
      expect(computeSiblingReorderIndex(doc, 'a', 'bringToFront')).toBe(2);
      expect(computeSiblingReorderIndex(doc, 'a', 'sendToBack')).toBe(0);
      expect(computeSiblingReorderIndex(doc, 'a', 'bringForward')).toBe(1);
      expect(computeSiblingReorderIndex(doc, 'a', 'moveUp')).toBe(1);
      expect(computeSiblingReorderIndex(doc, 'a', 'sendBackward')).toBe(0);
      expect(computeSiblingReorderIndex(doc, 'a', 'moveDown')).toBe(0);

      // 'b' está no índice 1
      expect(computeSiblingReorderIndex(doc, 'b', 'bringForward')).toBe(2);
      expect(computeSiblingReorderIndex(doc, 'b', 'sendBackward')).toBe(0);

      // 'c' está no índice 2
      expect(computeSiblingReorderIndex(doc, 'c', 'bringToFront')).toBe(2);
      expect(computeSiblingReorderIndex(doc, 'c', 'sendToBack')).toBe(0);
      expect(computeSiblingReorderIndex(doc, 'c', 'bringForward')).toBe(2);
      expect(computeSiblingReorderIndex(doc, 'c', 'sendBackward')).toBe(1);
    });

    it('calcula índices corretos para nós dentro de um grupo', () => {
      const section = sectionWithLayers();
      section.dispatch({ type: 'group.create', id: 'grp-abc', childIds: ['a', 'b', 'c'] });
      const doc = section.getSnapshot().document;

      expect(computeSiblingReorderIndex(doc, 'a', 'bringToFront')).toBe(2);
      expect(computeSiblingReorderIndex(doc, 'c', 'sendToBack')).toBe(0);
      expect(computeSiblingReorderIndex(doc, 'b', 'moveUp')).toBe(2);
      expect(computeSiblingReorderIndex(doc, 'b', 'moveDown')).toBe(0);
    });

    it('retorna undefined para IDs inexistentes', () => {
      const section = sectionWithLayers();
      const doc = section.getSnapshot().document;
      expect(computeSiblingReorderIndex(doc, 'inexistente', 'bringToFront')).toBeUndefined();
    });
  });
});

describe('node.reorder com boards (spec boards, US-BD.4)', () => {
  /** Board `b` com os filhos c1, c2, c3; `before` e `after` ficam na camada, antes e depois dele. */
  function organized(): CanvasSectionApi {
    const section = newSection();
    const created = section.transact([
      createShape('before'),
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 500, height: 300 },
      },
      createShape('c1'),
      createShape('c2'),
      createShape('c3'),
      createShape('after'),
      { type: 'board.attach', boardId: 'b', ids: ['c1', 'c2', 'c3'] },
    ] as CanvasCommand[]);
    if (!created.ok) throw new Error('fixture recusada');
    return section;
  }
  const nodeOf = (section: CanvasSectionApi, id: string) =>
    section.getSnapshot().document.nodes[id] as unknown as { childIds: string[] };

  it('"levar para trás" um filho o põe em childIds[0], ainda dentro do board', () => {
    const section = organized();

    const result = untyped(section, { type: 'node.reorder', id: 'c3', index: 0 });

    expect(result).toMatchObject({ ok: true });
    expect(nodeOf(section, 'b').childIds).toEqual(['c3', 'c1', 'c2']);
    expect(childIds(section, BASE)).toEqual(['before', 'b', 'after']);
  });

  it('"trazer à frente" um filho o põe no fim de childIds, e não à frente dos nós de fora', () => {
    const section = organized();

    untyped(section, { type: 'node.reorder', id: 'c1', index: 2 });

    expect(nodeOf(section, 'b').childIds).toEqual(['c2', 'c3', 'c1']);
    expect(childIds(section, BASE)).toEqual(['before', 'b', 'after']);
  });

  it('a posição é conferida contra os irmãos do board', () => {
    const section = organized();

    const result = untyped(section, { type: 'node.reorder', id: 'c1', index: 3 });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('com layerId diferente, o filho é recusado com multiple-parents', () => {
    const section = organized();
    section.dispatch(createLayer('other'));
    const before = section.getSnapshot().document;

    const result = untyped(section, { type: 'node.reorder', id: 'c1', index: 0, layerId: 'other' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ rule: 'multiple-parents' }] } },
    });
    expect(section.getSnapshot().document).toBe(before);
  });

  it('um filho de board locked é recusado com LOCKED', () => {
    const section = organized();
    section.dispatch({ type: 'shape.update', id: 'b', patch: { locked: true } } as never);

    const result = untyped(section, { type: 'node.reorder', id: 'c1', index: 0 });

    expect(result).toMatchObject({ ok: false, error: { code: 'LOCKED' } });
  });

  it('mover o board para a frente da camada mantém os filhos dentro dele, à frente do fundo', () => {
    const section = organized();

    untyped(section, { type: 'node.reorder', id: 'b', index: 2 });

    expect(childIds(section, BASE)).toEqual(['before', 'after', 'b']);
    expect(nodeOf(section, 'b').childIds).toEqual(['c1', 'c2', 'c3']);
  });

  it('mover o board para outra camada leva os descendentes, e getNodeInfo traz a camada nova', () => {
    const section = organized();
    section.dispatch(createLayer('other'));
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['before', 'after'] });
    section.dispatch({ type: 'board.attach', boardId: 'b', ids: ['g'] });

    const result = untyped(section, { type: 'node.reorder', id: 'b', index: 0, layerId: 'other' });

    expect(result).toMatchObject({ ok: true });
    expect(childIds(section, 'other')).toEqual(['b']);
    for (const id of ['b', 'c1', 'c2', 'c3', 'g', 'before', 'after']) {
      expect(section.getNodeInfo(id)).toMatchObject({ layerId: 'other' });
    }
  });

  describe('computeSiblingReorderIndex com boards', () => {
    it('acha os irmãos no board, e não na camada', () => {
      const section = organized();
      const { document } = section.getSnapshot();

      expect(computeSiblingReorderIndex(document, 'c2', 'bringToFront')).toBe(2);
      expect(computeSiblingReorderIndex(document, 'c2', 'sendToBack')).toBe(0);
      expect(computeSiblingReorderIndex(document, 'c2', 'moveUp')).toBe(2);
      expect(computeSiblingReorderIndex(document, 'c2', 'moveDown')).toBe(0);
      expect(computeSiblingReorderIndex(document, 'c3', 'bringForward')).toBe(2);
    });

    it('o board continua entre os irmãos da camada', () => {
      const section = organized();
      const { document } = section.getSnapshot();

      expect(computeSiblingReorderIndex(document, 'b', 'bringToFront')).toBe(2);
      expect(computeSiblingReorderIndex(document, 'b', 'moveDown')).toBe(0);
    });

    it('um grupo dentro do board acha os irmãos dele no board', () => {
      const section = organized();
      section.dispatch({ type: 'group.create', id: 'g', childIds: ['before', 'after'] });
      section.dispatch({ type: 'board.attach', boardId: 'b', ids: ['g'] });
      const { document } = section.getSnapshot();

      expect(computeSiblingReorderIndex(document, 'g', 'sendToBack')).toBe(0);
      expect(computeSiblingReorderIndex(document, 'g', 'bringToFront')).toBe(3);
    });
  });
});
