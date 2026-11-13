import { describe, expect, it, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import type { CanvasChange } from './events.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const BASE = 'id-2';
const RECTANGLE = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;

function create(id: string, layerId?: string): CanvasCommand {
  return { type: 'shape.create', shape: { ...RECTANGLE, id }, layerId };
}

/** Canvas com os nós `a`, `b` e `c` na camada base e `x` na camada `other`. */
function newSection(): CanvasSectionApi {
  const section = createCanvasSection({ generateId: counter() });
  section.transact([
    create('a'),
    create('b'),
    create('c'),
    { type: 'layer.create', layer: { id: 'other' } },
    create('x', 'other'),
  ]);
  return section;
}

/** Chama um método com um argumento que o tipo recusaria. */
function callUntyped(method: (argument: never) => unknown, argument: unknown): unknown {
  return method(argument as never);
}

const OK = { ok: true, value: undefined };

describe('sessão inicial', () => {
  it('começa sem seleção, com viewport na origem e zoom 1, ferramenta select e edição liberada', () => {
    const { session } = createCanvasSection().getSnapshot();

    expect(session).toEqual({
      selectedIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      activeTool: 'select',
      readOnly: false,
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.selectedIds)).toBe(true);
    expect(Object.isFrozen(session.viewport)).toBe(true);
  });
});

describe('setSelection', () => {
  it('seleciona os nós dados, sem alterar documento, histórico nem revisão', () => {
    const section = newSection();
    const before = section.getSnapshot();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const result = section.setSelection(['c', 'a']);

    const after = section.getSnapshot();
    expect(result).toEqual(OK);
    expect(after).not.toBe(before);
    expect(after.session.selectedIds).toEqual(['c', 'a']);
    expect(after.revision).toBe(before.revision);
    expect(after.document).toBe(before.document);
    expect(after.history).toBe(before.history);
    expect(after.session.viewport).toBe(before.session.viewport);
    expect(Object.isFrozen(after.session.selectedIds)).toBe(true);
    expect(changes).toEqual([
      { snapshot: after, origin: 'local', areas: ['selection'], affectedIds: [] },
    ]);
  });

  it('não congela nem guarda a lista do chamador', () => {
    const section = newSection();
    const ids = ['a', 'b'];

    section.setSelection(ids);
    ids.push('c');

    expect(Object.isFrozen(ids)).toBe(false);
    expect(section.getSnapshot().session.selectedIds).toEqual(['a', 'b']);
    expect(section.getSnapshot().session.selectedIds).not.toBe(ids);
  });

  it('entrega congelado o evento de mudança de sessão', () => {
    const section = newSection();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.setSelection(['a']);
    section.setViewport({ x: 1, y: 1, zoom: 2 });
    section.setTool('hand');
    section.setReadOnly(true);

    expect(changes).toHaveLength(4);
    for (const change of changes) {
      expect(Object.isFrozen(change)).toBe(true);
      expect(Object.isFrozen(change.areas)).toBe(true);
      expect(Object.isFrozen(change.affectedIds)).toBe(true);
    }
  });

  it('ignora repetições e guarda uma cópia da lista recebida', () => {
    const section = newSection();
    const ids = ['b', 'a', 'b'];

    section.setSelection(ids);
    ids.push('c');

    expect(section.getSnapshot().session.selectedIds).toEqual(['b', 'a']);
  });

  it('aceita nó bloqueado e nó em camada bloqueada', () => {
    const section = newSection();
    section.transact([
      { type: 'shape.update', id: 'a', patch: { locked: true } },
      { type: 'layer.update', id: 'other', patch: { locked: true } },
    ]);

    expect(section.setSelection(['a', 'x'])).toEqual(OK);
    expect(section.getSnapshot().session.selectedIds).toEqual(['a', 'x']);
  });

  it('limpa a seleção com uma lista vazia', () => {
    const section = newSection();
    section.setSelection(['a']);

    expect(section.setSelection([])).toEqual(OK);
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
  });

  it.each([
    ['a mesma seleção', ['a', 'b'], ['a', 'b']],
    ['a mesma seleção com repetições', ['a', 'b'], ['a', 'b', 'a']],
    ['uma lista vazia sobre seleção vazia', [], []],
  ])('não publica snapshot nem evento com %s', (_label, first, second) => {
    const section = newSection();
    section.setSelection(first);
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    expect(section.setSelection(second)).toEqual(OK);
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('trata a mesma seleção em outra ordem como mudança', () => {
    const section = newSection();
    section.setSelection(['a', 'b']);
    const before = section.getSnapshot();

    section.setSelection(['b', 'a']);

    expect(section.getSnapshot()).not.toBe(before);
    expect(section.getSnapshot().session.selectedIds).toEqual(['b', 'a']);
  });

  it.each([
    ['um nó que não existe', 'sumido'],
    ['o ID de uma camada', BASE],
  ])('devolve NOT_FOUND para %s, sem mudar a seleção', (_label, id) => {
    const section = newSection();
    section.setSelection(['a']);
    const before = section.getSnapshot();

    const result = section.setSelection(['b', id]);

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: expect.any(String), details: { kind: 'node', id } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('cita o primeiro ID inexistente, e a inexistência vem antes da visibilidade', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.update', id: 'b', patch: { visible: false } });

    const result = section.setSelection(['b', 'sumido-1', 'a', 'sumido-2']);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { kind: 'node', id: 'sumido-1' } },
    });
  });

  it('cita cada nó oculto pela posição em que foi dado', () => {
    const section = newSection();
    section.transact([
      { type: 'shape.update', id: 'a', patch: { visible: false } },
      { type: 'shape.update', id: 'c', patch: { visible: false } },
    ]);

    const result = section.setSelection(['b', 'c', 'b', 'a']);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: {
          issues: [
            { path: [1], rule: 'not-visible' },
            { path: [3], rule: 'not-visible' },
          ],
        },
      },
    });
  });

  it('não cita mais de cem nós ocultos', () => {
    const section = createCanvasSection({ generateId: counter() });
    const ids = Array.from({ length: 150 }, (_unused, index) => `oculto-${index}`);
    section.transact(
      ids.map((id) => ({ type: 'shape.create', shape: { ...RECTANGLE, id, visible: false } })),
    );

    const result = section.setSelection(ids);

    if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
    expect(result.error.details.issues).toHaveLength(100);
    expect(result.error.details.issues[99]).toMatchObject({ path: [99], rule: 'not-visible' });
  });

  it.each([
    ['nó oculto', { type: 'shape.update', id: 'b', patch: { visible: false } }, 'b'],
    ['nó em camada oculta', { type: 'layer.update', id: 'other', patch: { visible: false } }, 'x'],
  ] as const)('recusa %s', (_label, hide, id) => {
    const section = newSection();
    section.dispatch(hide);
    const before = section.getSnapshot();

    const result = section.setSelection(['a', id]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        details: { issues: [{ path: [1], rule: 'not-visible', message: expect.any(String) }] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['um texto', 'a', []],
    ['undefined', undefined, []],
    ['um objeto', { 0: 'a' }, []],
    ['um ID que não é texto', ['a', 7], [1]],
    ['um ID vazio', [''], [0]],
  ])('recusa %s no lugar da lista de IDs', (_label, ids, path) => {
    const section = newSection();
    const before = section.getSnapshot();

    const result = callUntyped(section.setSelection, ids);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path, rule: 'type' }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('setViewport', () => {
  it('define deslocamento e zoom, sem alterar documento, histórico nem revisão', () => {
    const section = newSection();
    const before = section.getSnapshot();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const result = section.setViewport({ x: -120.5, y: 40, zoom: 2 });

    const after = section.getSnapshot();
    expect(result).toEqual(OK);
    expect(after.session.viewport).toEqual({ x: -120.5, y: 40, zoom: 2 });
    expect(Object.isFrozen(after.session.viewport)).toBe(true);
    expect(after.revision).toBe(before.revision);
    expect(after.document).toBe(before.document);
    expect(after.history).toBe(before.history);
    expect(after.session.selectedIds).toBe(before.session.selectedIds);
    expect(changes).toEqual([
      { snapshot: after, origin: 'local', areas: ['viewport'], affectedIds: [] },
    ]);
  });

  it.each([
    [100, 16],
    [16.0001, 16],
    [16, 16],
    [0.05, 0.05],
    [0.049, 0.05],
    [1e-9, 0.05],
  ])('mantém o zoom em [0.05, 16]: %d vira %d', (zoom, expected) => {
    const section = newSection();

    expect(section.setViewport({ x: 3, y: 4, zoom })).toEqual(OK);
    expect(section.getSnapshot().session.viewport).toEqual({ x: 3, y: 4, zoom: expected });
  });

  it('guarda zero no lugar de zero negativo', () => {
    const section = newSection();

    section.setViewport({ x: -0, y: -0, zoom: 2 });

    const { viewport } = section.getSnapshot().session;
    expect(Object.is(viewport.x, 0) && Object.is(viewport.y, 0)).toBe(true);
  });

  it.each([
    ['o mesmo viewport', { x: 5, y: 6, zoom: 2 }, { x: 5, y: 6, zoom: 2 }],
    ['um zoom que o limite leva ao atual', { x: 5, y: 6, zoom: 16 }, { x: 5, y: 6, zoom: 50 }],
  ])('não publica snapshot nem evento com %s', (_label, first, second) => {
    const section = newSection();
    section.setViewport(first);
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    expect(section.setViewport(second)).toEqual(OK);
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['x não finito', { x: Number.NaN, y: 0, zoom: 1 }, ['x'], 'finite'],
    ['y infinito', { x: 0, y: Number.POSITIVE_INFINITY, zoom: 1 }, ['y'], 'finite'],
    ['zoom não finito', { x: 0, y: 0, zoom: Number.POSITIVE_INFINITY }, ['zoom'], 'finite'],
    ['zoom zero', { x: 0, y: 0, zoom: 0 }, ['zoom'], 'range'],
    ['zoom negativo', { x: 0, y: 0, zoom: -1 }, ['zoom'], 'range'],
    ['zoom ausente', { x: 0, y: 0 }, ['zoom'], 'type'],
    ['x que não é número', { x: '0', y: 0, zoom: 1 }, ['x'], 'type'],
    ['campo desconhecido', { x: 0, y: 0, zoom: 1, rotation: 0 }, ['rotation'], 'unknown-field'],
    ['um valor que não é objeto', 2, [], 'type'],
    ['null', null, [], 'type'],
  ])('recusa %s sem mudar o viewport', (_label, viewport, path, rule) => {
    const section = newSection();
    const before = section.getSnapshot();

    const result = callUntyped(section.setViewport, viewport);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('setTool', () => {
  it('troca a ferramenta ativa e emite um evento da área tool', () => {
    const section = newSection();
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = section.setTool('rectangle');

    const after = section.getSnapshot();
    expect(result).toEqual(OK);
    expect(after.session.activeTool).toBe('rectangle');
    expect(after.revision).toBe(before.revision);
    expect(after.document).toBe(before.document);
    expect(listener).toHaveBeenCalledWith({
      snapshot: after,
      origin: 'local',
      areas: ['tool'],
      affectedIds: [],
    });
  });

  it('aceita o ID de uma ferramenta que o core não conhece', () => {
    const section = newSection();

    expect(section.setTool('app:stamp')).toEqual(OK);
    expect(section.getSnapshot().session.activeTool).toBe('app:stamp');
  });

  it('não publica nada quando a ferramenta já é a ativa', () => {
    const section = newSection();
    const before = section.getSnapshot();

    expect(section.setTool('select')).toEqual(OK);
    expect(section.getSnapshot()).toBe(before);
  });

  it.each(['', 7, null, undefined])('recusa %j como ferramenta', (tool) => {
    const section = newSection();
    const before = section.getSnapshot();

    const result = callUntyped(section.setTool, tool);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path: [], rule: 'type' }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('setReadOnly', () => {
  it('bloqueia comandos, transações, undo e redo com READ_ONLY', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 5 } });
    section.undo();
    section.setReadOnly(true);
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    const results = [
      section.dispatch(create('novo')),
      section.transact([{ type: 'shape.remove', id: 'a' }]),
      section.transact([]),
      section.undo(),
      section.redo(),
    ];

    for (const result of results) {
      expect(result).toEqual({
        ok: false,
        error: { code: 'READ_ONLY', message: expect.any(String), details: {} },
      });
    }
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('é conferido antes do comando: entrada inválida também devolve READ_ONLY, e nenhum ID é gasto', () => {
    const section = newSection();
    section.setReadOnly(true);

    const invalid = section.dispatch({ type: 'shape.remove', id: 'sumido' });
    const garbage = section.transact('lixo' as unknown as CanvasCommand[]);
    const refused = section.dispatch({ type: 'shape.create', shape: RECTANGLE });
    section.setReadOnly(false);
    const created = section.dispatch({ type: 'shape.create', shape: RECTANGLE });

    for (const result of [invalid, garbage, refused]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    }
    // O canvas de teste nasce com os IDs até id-2; o shape recusado não gastou o id-3.
    expect(created).toMatchObject({ ok: true, value: { createdIds: ['id-3'] } });
  });

  it('mantém seleção, pan, zoom e ferramenta funcionando', () => {
    const section = newSection();
    section.setReadOnly(true);

    expect(section.setSelection(['a'])).toEqual(OK);
    expect(section.setViewport({ x: 10, y: 10, zoom: 3 })).toEqual(OK);
    expect(section.setTool('hand')).toEqual(OK);
    expect(section.getSnapshot().session).toEqual({
      selectedIds: ['a'],
      viewport: { x: 10, y: 10, zoom: 3 },
      activeTool: 'hand',
      readOnly: true,
    });
  });

  it('desligado, devolve a edição com o histórico como estava', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 5 } });
    section.setReadOnly(true);

    section.setReadOnly(false);

    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.dispatch(create('novo')).ok).toBe(true);
  });

  it('emite um evento da área readOnly, sem avançar a revisão', () => {
    const section = newSection();
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    expect(section.setReadOnly(true)).toEqual(OK);

    const after = section.getSnapshot();
    expect(after.session.readOnly).toBe(true);
    expect(after.revision).toBe(before.revision);
    expect(listener).toHaveBeenCalledWith({
      snapshot: after,
      origin: 'local',
      areas: ['readOnly'],
      affectedIds: [],
    });
  });

  it('não publica nada quando o valor já é o atual', () => {
    const section = newSection();
    const before = section.getSnapshot();

    expect(section.setReadOnly(false)).toEqual(OK);
    expect(section.getSnapshot()).toBe(before);
  });

  it.each(['true', 1, null, undefined])('recusa %j', (value) => {
    const section = newSection();

    const result = callUntyped(section.setReadOnly, value);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path: [], rule: 'type' }] } },
    });
    expect(section.getSnapshot().session.readOnly).toBe(false);
  });
});

describe('sessão e histórico', () => {
  it('seleção, pan, zoom, ferramenta e somente leitura não entram no histórico nem eliminam o redo', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 5 } });
    section.undo();
    const history = section.getSnapshot().history;

    section.setSelection(['a', 'b']);
    section.setViewport({ x: 1, y: 2, zoom: 3 });
    section.setTool('hand');
    section.setReadOnly(true);
    section.setReadOnly(false);

    expect(section.getSnapshot().history).toBe(history);
    expect(history).toEqual({ canUndo: true, canRedo: true });
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ x: 5 });
  });

  it('undo e redo não mexem em viewport, ferramenta nem em seleção que continua válida', () => {
    const section = newSection();
    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 5 } });
    section.setSelection(['a']);
    section.setViewport({ x: 1, y: 2, zoom: 3 });
    const session = section.getSnapshot().session;

    section.undo();

    expect(section.getSnapshot().session).toBe(session);
  });
});

describe('seleção depois de alterações do documento', () => {
  function selected(section: CanvasSectionApi): readonly string[] {
    return section.getSnapshot().session.selectedIds;
  }

  it.each([
    ['removido', { type: 'shape.remove', id: 'b' }, ['a', 'x']],
    ['ocultado', { type: 'shape.update', id: 'b', patch: { visible: false } }, ['a', 'x']],
    [
      'de camada ocultada',
      { type: 'layer.update', id: 'other', patch: { visible: false } },
      ['a', 'b'],
    ],
  ] as const)('perde o nó %s, no mesmo evento do commit', (_label, command, remaining) => {
    const section = newSection();
    section.setSelection(['a', 'b', 'x']);
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.dispatch(command);

    expect(selected(section)).toEqual(remaining);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.areas).toEqual(['document', 'selection']);
    expect(changes[0]?.snapshot.session.selectedIds).toEqual(remaining);
  });

  it('perde o nó levado para uma camada oculta', () => {
    const section = newSection();
    section.dispatch({ type: 'layer.update', id: 'other', patch: { visible: false } });
    section.setSelection(['a', 'b']);

    section.dispatch({ type: 'node.reorder', id: 'a', index: 0, layerId: 'other' });

    expect(selected(section)).toEqual(['b']);
  });

  it('perde o nó que um undo remove, e o redo não o seleciona de volta', () => {
    const section = newSection();
    section.dispatch(create('novo'));
    section.setSelection(['novo', 'a']);
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.undo();
    const afterUndo = selected(section);
    section.redo();

    expect(afterUndo).toEqual(['a']);
    expect(selected(section)).toEqual(['a']);
    expect(changes.map((change) => change.areas)).toEqual([
      ['document', 'selection', 'history'],
      ['document', 'history'],
    ]);
  });

  it('continua a mesma, com a mesma referência, quando o commit não a invalida', () => {
    const section = newSection();
    section.setSelection(['a', 'x']);
    const session = section.getSnapshot().session;
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.transact([
      { type: 'shape.update', id: 'a', patch: { x: 9, locked: true } },
      { type: 'shape.remove', id: 'b' },
      { type: 'layer.update', id: 'other', patch: { locked: true } },
    ]);

    expect(section.getSnapshot().session).toBe(session);
    expect(changes[0]?.areas).toEqual(['document']);
  });
});

describe('mudança de sessão dentro de listener', () => {
  it('devolve REENTRANT_DISPATCH e não altera a sessão', () => {
    const section = newSection();
    const inner: unknown[] = [];
    const unsubscribe = section.subscribe(() => {
      inner.push(
        section.setSelection(['a']),
        section.setViewport({ x: 1, y: 1, zoom: 1 }),
        section.setTool('hand'),
        section.setReadOnly(true),
      );
    });

    section.dispatch(create('novo'));
    unsubscribe();

    expect(inner).toHaveLength(4);
    for (const result of inner) {
      expect(result).toMatchObject({ ok: false, error: { code: 'REENTRANT_DISPATCH' } });
    }
    expect(section.getSnapshot().session).toEqual({
      selectedIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      activeTool: 'select',
      readOnly: false,
    });
  });

  it('é recusada antes de a entrada ser lida: valor inválido também devolve REENTRANT_DISPATCH', () => {
    const section = newSection();
    const inner: unknown[] = [];
    const unsubscribe = section.subscribe(() => {
      inner.push(
        section.setSelection(['não existe']),
        section.setViewport({ x: 0, y: 0, zoom: -1 }),
        section.setTool(''),
        section.setReadOnly('sim' as unknown as boolean),
      );
    });

    section.dispatch(create('novo'));
    unsubscribe();

    expect(inner).toHaveLength(4);
    for (const result of inner) {
      expect(result).toMatchObject({ ok: false, error: { code: 'REENTRANT_DISPATCH' } });
    }
  });
});

describe('métodos de sessão', () => {
  it('funcionam destacados do canvas', () => {
    const { setSelection, setViewport, setTool, setReadOnly, getSnapshot } = newSection();

    setSelection(['a']);
    setViewport({ x: 1, y: 2, zoom: 4 });
    setTool('line');
    setReadOnly(true);

    expect(getSnapshot().session).toEqual({
      selectedIds: ['a'],
      viewport: { x: 1, y: 2, zoom: 4 },
      activeTool: 'line',
      readOnly: true,
    });
  });
});
