import { describe, expect, it, vi } from 'vitest';
import {
  createCanvasSection,
  createCanvasSectionWith,
  type CanvasSectionApi,
  type CommitCandidate,
} from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import type { CanvasChange } from './events.js';
import { validationError } from './result.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const LAYER_ID = 'id-2';
const RECTANGLE = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;
const LINE = { type: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } } as const;

function newSection(): CanvasSectionApi {
  return createCanvasSection({ generateId: counter() });
}

function create(id: string): CanvasCommand {
  return { type: 'shape.create', shape: { ...RECTANGLE, id } };
}

/** Executa uma transação que o tipo recusaria, como chega de um consumidor JavaScript. */
function transactUntyped(
  section: CanvasSectionApi,
  commands: unknown,
): ReturnType<CanvasSectionApi['transact']> {
  return section.transact(commands as CanvasCommand[]);
}

describe('transact', () => {
  it('aplica todos os comandos em uma revisão e um evento, com todos os IDs afetados', () => {
    const section = newSection();
    section.dispatch(create('a'));
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const result = section.transact([
      create('b'),
      { type: 'shape.create', shape: LINE },
      { type: 'shape.update', id: 'a', patch: { x: 7 } },
    ]);

    expect(result).toEqual({
      ok: true,
      value: {
        revision: 2,
        changed: true,
        affectedIds: ['b', 'id-3', 'a', LAYER_ID],
        createdIds: ['b', 'id-3'],
      },
    });
    expect(changes).toEqual([
      {
        snapshot: section.getSnapshot(),
        origin: 'local',
        areas: ['document'],
        affectedIds: ['b', 'id-3', 'a', LAYER_ID],
      },
    ]);
    const { document, revision } = section.getSnapshot();
    expect(revision).toBe(2);
    expect(document.layers[0]?.childIds).toEqual(['a', 'b', 'id-3']);
    expect(document.nodes['a']).toMatchObject({ x: 7 });
  });

  it('deixa um comando enxergar o que o anterior da mesma transação fez', () => {
    const section = newSection();

    const result = section.transact([
      create('a'),
      { type: 'shape.update', id: 'a', patch: { width: 99 } },
      create('b'),
      { type: 'shape.remove', id: 'a' },
      { type: 'shape.create', shape: { ...LINE, id: 'a' } },
    ]);

    expect(result).toMatchObject({ ok: true, value: { revision: 1, createdIds: ['a', 'b'] } });
    const { document } = section.getSnapshot();
    expect(document.layers[0]?.childIds).toEqual(['b', 'a']);
    expect(document.nodes['a']).toMatchObject({ type: 'line' });
  });

  it('lista os IDs criados na ordem de criação, camadas e nós misturados', () => {
    const section = newSection();

    const result = section.transact([
      { type: 'shape.create', shape: RECTANGLE },
      { type: 'layer.create' },
      { type: 'shape.create', shape: RECTANGLE },
      { type: 'layer.create', layer: { id: 'fundo' }, index: 0 },
      { type: 'shape.create', shape: { ...RECTANGLE, id: 'efemero' } },
      { type: 'shape.remove', id: 'efemero' },
    ]);

    expect(result).toMatchObject({
      ok: true,
      value: { createdIds: ['id-3', 'id-4', 'id-5', 'fundo'] },
    });
  });

  it('lista o ID recriado na mesma transação em que foi removido', () => {
    const section = newSection();
    section.dispatch(create('a'));

    const result = section.transact([
      { type: 'shape.remove', id: 'a' },
      { type: 'shape.create', shape: { ...LINE, id: 'a' } },
    ]);

    expect(result).toMatchObject({ ok: true, value: { createdIds: ['a'], affectedIds: ['a'] } });
  });

  it('não cita como afetado o nó de uma reordenação sem efeito', () => {
    const section = newSection();
    section.transact([create('a'), create('b')]);

    const withLayer = section.transact([
      { type: 'node.reorder', id: 'a', index: 0 },
      { type: 'layer.create', layer: { id: 'nova' } },
    ]);
    const withShape = section.transact([
      { type: 'node.reorder', id: 'b', index: 1 },
      { type: 'shape.create', shape: { ...RECTANGLE, id: 'c' }, layerId: LAYER_ID },
    ]);
    const roundTrip = section.transact([
      { type: 'node.reorder', id: 'a', index: 2 },
      { type: 'node.reorder', id: 'a', index: 0 },
      { type: 'node.reorder', id: 'c', index: 1 },
    ]);

    expect(withLayer).toMatchObject({ ok: true, value: { affectedIds: ['nova'] } });
    expect(withShape).toMatchObject({ ok: true, value: { affectedIds: ['c', LAYER_ID] } });
    // `a` foi e voltou; `c` trocou de lugar com `b`, que nenhum comando moveu.
    expect(roundTrip).toMatchObject({ ok: true, value: { affectedIds: ['c', LAYER_ID] } });
    expect(section.getSnapshot().document.layers[0]?.childIds).toEqual(['a', 'c', 'b']);
  });

  it('cita uma vez o item alterado mais de uma vez', () => {
    const section = newSection();
    section.dispatch(create('a'));

    const result = section.transact([
      { type: 'shape.update', id: 'a', patch: { x: 1 } },
      { type: 'shape.update', id: 'a', patch: { x: 2 } },
    ]);

    expect(result).toMatchObject({ ok: true, value: { affectedIds: ['a'], createdIds: [] } });
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ x: 2 });
  });

  it.each([
    [
      'inválido no meio',
      [create('a'), { type: 'shape.create', shape: { ...RECTANGLE, width: 0 } }, create('c')],
      1,
      'VALIDATION_ERROR',
    ],
    [
      'inválido no fim',
      [create('a'), create('b'), { type: 'shape.update', id: 'b', patch: { x: Number.NaN } }],
      2,
      'VALIDATION_ERROR',
    ],
    [
      'para ID que não existe',
      [create('a'), { type: 'shape.remove', id: 'sumido' }],
      1,
      'NOT_FOUND',
    ],
    [
      'que repete um ID criado na própria transação',
      [create('a'), create('a')],
      1,
      'VALIDATION_ERROR',
    ],
    ['de tipo desconhecido', [create('a'), { type: 'shape.explode' }], 1, 'VALIDATION_ERROR'],
    ['que não é objeto', [create('a'), null], 1, 'VALIDATION_ERROR'],
  ])(
    'com um comando %s, não altera documento nem revisão e não publica nada (CORE-03)',
    (_label, commands, index, code) => {
      const section = newSection();
      section.dispatch(create('antes'));
      const before = section.getSnapshot();
      const listener = vi.fn();
      section.subscribe(listener);

      const result = transactUntyped(section, commands);

      expect(result).toMatchObject({
        ok: false,
        error: { code, details: { commandIndex: index } },
      });
      expect(section.getSnapshot()).toBe(before);
      expect(before.revision).toBe(1);
      expect(Object.keys(before.document.nodes)).toEqual(['antes']);
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('desfaz por inteiro a transação recusada: o ID dela continua livre', () => {
    const section = newSection();

    section.transact([create('a'), { type: 'shape.remove', id: 'sumido' }]);
    const result = section.transact([create('a')]);

    expect(result).toMatchObject({ ok: true, value: { revision: 1, createdIds: ['a'] } });
  });

  it('não altera nada quando o gerador de IDs falha no meio da transação', () => {
    const values = ['doc', 'layer', 'novo', 'novo'];
    const section = createCanvasSection({ generateId: () => values.shift() ?? '' });
    const before = section.getSnapshot();
    const createAnonymous: CanvasCommand = { type: 'shape.create', shape: RECTANGLE };

    expect(() => section.transact([createAnonymous, createAnonymous])).toThrow(TypeError);
    expect(section.getSnapshot()).toBe(before);
  });

  it.each([
    ['uma transação vazia', []],
    ['comandos que se anulam', [create('a'), { type: 'shape.remove', id: 'a' }]],
    ['comandos sem efeito', [{ type: 'shape.update', id: 'antes', patch: {} }]],
  ])('não gera revisão, snapshot nem evento com %s', (_label, commands) => {
    const section = newSection();
    section.dispatch(create('antes'));
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = transactUntyped(section, commands);

    expect(result).toEqual({
      ok: true,
      value: { revision: 1, changed: false, affectedIds: [], createdIds: [] },
    });
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['um objeto', { type: 'shape.create', shape: RECTANGLE }],
    ['undefined', undefined],
    ['um texto', 'shape.create'],
  ])('recusa %s no lugar da lista de comandos', (_label, commands) => {
    const section = newSection();
    const before = section.getSnapshot();

    const result = transactUntyped(section, commands);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        details: { issues: [{ path: [], rule: 'type', message: expect.any(String) }] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('não altera a lista de comandos recebida', () => {
    const section = newSection();
    const commands = Object.freeze([create('a'), create('b')]);

    expect(section.transact(commands).ok).toBe(true);
    expect(commands).toEqual([create('a'), create('b')]);
  });

  it('devolve REENTRANT_DISPATCH quando chamado de dentro de um listener', () => {
    const section = newSection();
    const inner: unknown[] = [];
    section.subscribe(() => inner.push(section.transact([create('dentro')])));

    section.transact([create('fora')]);

    expect(inner).toEqual([
      {
        ok: false,
        error: { code: 'REENTRANT_DISPATCH', message: expect.any(String), details: {} },
      },
    ]);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['fora']);
  });

  it('funciona destacado do canvas', () => {
    const { transact, getSnapshot } = newSection();

    expect(transact([create('a')]).ok).toBe(true);
    expect(getSnapshot().revision).toBe(1);
  });
});

describe('dispatch', () => {
  it('percorre o mesmo pipeline que uma transação de um comando só', () => {
    const commands: CanvasCommand[] = [
      create('a'),
      { type: 'shape.create', shape: LINE },
      { type: 'shape.update', id: 'a', patch: { rotation: 4 } },
      { type: 'shape.update', id: 'a', patch: { rotation: 4 } },
      { type: 'shape.remove', id: 'sumido' },
      { type: 'shape.remove', id: 'a' },
    ];
    const dispatched = newSection();
    const transacted = newSection();
    const dispatchedChanges: CanvasChange[] = [];
    const transactedChanges: CanvasChange[] = [];
    dispatched.subscribe((change) => dispatchedChanges.push(change));
    transacted.subscribe((change) => transactedChanges.push(change));

    const dispatchResults = commands.map((command) => dispatched.dispatch(command));
    const transactResults = commands.map((command) => transacted.transact([command]));

    expect(dispatchResults).toEqual(transactResults);
    expect(dispatchResults.map((result) => result.ok)).toEqual([
      true,
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(dispatched.getSnapshot()).toEqual(transacted.getSnapshot());
    expect(dispatchedChanges).toEqual(transactedChanges);
    expect(dispatchedChanges).toHaveLength(4);
  });
});

describe('admissão do commit', () => {
  const REFUSAL = validationError([{ path: [], rule: 'range', message: 'refused by the gate' }]);

  it('recebe a alteração calculada, com origem, documentos e patch, antes da publicação', () => {
    const candidates: CommitCandidate[] = [];
    const seenRevisions: number[] = [];
    const section = createCanvasSectionWith({ generateId: counter() }, (candidate) => {
      candidates.push(candidate);
      seenRevisions.push(section.getSnapshot().revision);
      return undefined;
    });
    const before = section.getSnapshot();

    section.transact([create('a'), create('b')]);

    expect(candidates).toHaveLength(1);
    expect(seenRevisions).toEqual([0]);
    expect(candidates[0]?.origin).toBe('local');
    expect(candidates[0]?.before).toBe(before.document);
    expect(candidates[0]?.after).toEqual(section.getSnapshot().document);
    expect([...(candidates[0]?.patch?.nodes.keys() ?? [])]).toEqual(['a', 'b']);
    expect([...(candidates[0]?.patch?.layers.keys() ?? [])]).toEqual([LAYER_ID]);
  });

  it('recusa o commit inteiro: sem revisão, snapshot nem evento', () => {
    const section = createCanvasSectionWith({ generateId: counter() }, ({ patch }) =>
      patch?.nodes.has('recusado') ? REFUSAL : undefined,
    );
    section.dispatch(create('antes'));
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    const result = section.transact([create('aceito'), create('recusado')]);

    expect(result).toEqual({ ok: false, error: REFUSAL });
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(section.dispatch(create('aceito'))).toMatchObject({ ok: true, value: { revision: 2 } });
  });

  it('recusada, deixa intactos a posição dos nós e o índice das consultas', () => {
    let open = true;
    const section = createCanvasSectionWith({ generateId: counter() }, () =>
      open ? undefined : REFUSAL,
    );
    section.transact([create('a'), create('b'), { type: 'layer.create', layer: { id: 'top' } }]);
    open = false;

    const moved = section.dispatch({ type: 'node.reorder', id: 'a', index: 0, layerId: 'top' });
    const removed = section.dispatch({ type: 'shape.remove', id: 'b' });
    const shifted = section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 900 } });

    expect([moved.ok, removed.ok, shifted.ok]).toEqual([false, false, false]);
    expect(section.getNodeInfo('a')).toEqual({
      layerId: LAYER_ID,
      index: 0,
      visible: true,
      locked: false,
    });
    expect(section.getNodeInfo('b')).toEqual({
      layerId: LAYER_ID,
      index: 1,
      visible: true,
      locked: false,
    });
    expect(section.hitTestAll({ x: 5, y: 5 }, { includePreview: false })).toEqual(['b', 'a']);
    expect(section.hitTest({ x: 905, y: 5 }, { includePreview: false })).toBeUndefined();
  });

  it('não é consultada quando os comandos são recusados ou não mudam nada', () => {
    const admit = vi.fn(() => undefined);
    const section = createCanvasSectionWith({ generateId: counter() }, admit);

    section.transact([]);
    section.transact([create('a'), { type: 'shape.remove', id: 'a' }]);
    section.transact([{ type: 'shape.remove', id: 'sumido' }]);

    expect(admit).not.toHaveBeenCalled();
  });
});
