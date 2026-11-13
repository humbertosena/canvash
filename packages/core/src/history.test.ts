import { describe, expect, it, vi } from 'vitest';
import {
  createCanvasSection,
  createCanvasSectionWith,
  type CanvasSectionApi,
  type CreateCanvasSectionOptions,
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

function newSection(options: CreateCanvasSectionOptions = {}): CanvasSectionApi {
  return createCanvasSection({ generateId: counter(), ...options });
}

function create(id: string): CanvasCommand {
  return { type: 'shape.create', shape: { ...RECTANGLE, id } };
}

function move(id: string, x: number): CanvasCommand {
  return { type: 'shape.update', id, patch: { x } };
}

/** A i-ésima de uma sequência de alterações que mistura criar, alterar e remover. */
function nthChange(index: number): CanvasCommand {
  const group = Math.floor(index / 4);
  switch (index % 4) {
    case 0:
      return create(`s${group}`);
    case 1:
      return move(`s${group}`, index);
    case 2:
      return { type: 'shape.update', id: `s${group}`, patch: { style: { opacity: 0.5 } } };
    default:
      return group % 2 === 0
        ? { type: 'shape.remove', id: `s${group}` }
        : move(`s${group}`, -index);
  }
}

describe('undo e redo', () => {
  it('100 alterações e 100 undos restauram o documento inicial; 100 redos, o final (CORE-04)', () => {
    const section = newSection();
    const initial = section.getSnapshot().document;
    for (let index = 0; index < 100; index++) {
      expect(section.dispatch(nthChange(index))).toMatchObject({
        ok: true,
        value: { changed: true },
      });
    }
    const final = section.getSnapshot().document;

    for (let index = 0; index < 100; index++) {
      expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    }
    const undone = section.getSnapshot();

    expect(undone.document).toEqual(initial);
    expect(Object.keys(undone.document.nodes)).toEqual([]);
    expect(undone.document.layers[0]?.id).toBe(LAYER_ID);
    expect(undone.revision).toBe(200);
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });

    for (let index = 0; index < 100; index++) {
      expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
    }
    const redone = section.getSnapshot();

    expect(redone.document).toEqual(final);
    expect(JSON.stringify(redone.document)).toBe(JSON.stringify(final));
    expect(redone.revision).toBe(300);
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: false } });
  });

  it('um comando novo depois de um undo elimina o redo (CORE-04)', () => {
    const section = newSection();
    section.dispatch(create('a'));
    section.dispatch(create('b'));

    section.undo();
    section.dispatch(create('c'));
    const redo = section.redo();

    expect(redo).toEqual({ ok: true, value: { revision: 4, changed: false, affectedIds: [] } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['a', 'c']);
  });

  it('avança a revisão e emite um evento de origem history com os IDs afetados', () => {
    const section = newSection();
    section.dispatch(create('a'));
    section.dispatch(move('a', 5));
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    const undo = section.undo();
    const redo = section.redo();

    expect(undo).toEqual({ ok: true, value: { revision: 3, changed: true, affectedIds: ['a'] } });
    expect(redo).toEqual({ ok: true, value: { revision: 4, changed: true, affectedIds: ['a'] } });
    expect(changes).toEqual([
      {
        snapshot: expect.objectContaining({ revision: 3 }),
        origin: 'history',
        areas: ['document', 'history'],
        affectedIds: ['a'],
      },
      {
        snapshot: expect.objectContaining({ revision: 4 }),
        origin: 'history',
        areas: ['document', 'history'],
        affectedIds: ['a'],
      },
    ]);
    expect(changes[0]?.snapshot.document.nodes['a']).toMatchObject({ x: 0 });
    expect(changes[1]?.snapshot).toBe(section.getSnapshot());
  });

  it('restaura exatamente os nós anteriores, na mesma posição da camada', () => {
    const section = newSection();
    section.transact([create('a'), create('b'), create('c')]);
    const before = section.getSnapshot().document;

    section.dispatch({ type: 'shape.remove', id: 'b' });
    const undo = section.undo();

    const after = section.getSnapshot().document;
    expect(undo).toMatchObject({ ok: true, value: { affectedIds: ['b', LAYER_ID] } });
    expect(after).toEqual(before);
    expect(after.layers[0]?.childIds).toEqual(['a', 'b', 'c']);
    expect(after.nodes['b']).toBe(before.nodes['b']);
    expect(after.nodes['a']).toBe(before.nodes['a']);
    expect(Object.isFrozen(after.nodes)).toBe(true);
  });

  it('desfaz e refaz uma transação inteira de uma vez', () => {
    const section = newSection();
    section.dispatch(create('a'));

    section.transact([create('b'), move('a', 9), create('c')]);
    section.undo();
    const undone = section.getSnapshot().document;
    section.redo();
    const redone = section.getSnapshot().document;

    expect(Object.keys(undone.nodes)).toEqual(['a']);
    expect(undone.nodes['a']).toMatchObject({ x: 0 });
    expect(redone.layers[0]?.childIds).toEqual(['a', 'b', 'c']);
    expect(redone.nodes['a']).toMatchObject({ x: 9 });
  });

  it.each(['undo', 'redo'] as const)(
    '%s com histórico vazio devolve sucesso sem mudar nada',
    (method) => {
      const section = newSection();
      const before = section.getSnapshot();
      const listener = vi.fn();
      section.subscribe(listener);

      const result = section[method]();

      expect(result).toEqual({ ok: true, value: { revision: 0, changed: false, affectedIds: [] } });
      expect(section.getSnapshot()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('comando sem efeito não entra no histórico nem elimina o redo', () => {
    const section = newSection();
    section.dispatch(create('a'));
    section.dispatch(move('a', 5));
    section.undo();

    section.dispatch(move('a', 0));
    section.transact([]);
    const redo = section.redo();

    expect(redo).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ x: 5 });
  });

  it('comando recusado preserva o histórico (CORE-03)', () => {
    const section = newSection();
    section.dispatch(create('a'));
    section.dispatch(move('a', 5));
    section.undo();

    section.dispatch({ type: 'shape.remove', id: 'sumido' });
    section.transact([create('b'), { type: 'shape.update', id: 'b', patch: { width: 0 } }]);

    expect(section.getSnapshot().history).toEqual({ canUndo: true, canRedo: true });
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
  });

  it('devolve REENTRANT_DISPATCH quando chamado de dentro de um listener', () => {
    const section = newSection();
    section.dispatch(create('a'));
    const inner: unknown[] = [];
    const unsubscribe = section.subscribe(() => inner.push(section.undo(), section.redo()));

    section.dispatch(create('b'));
    unsubscribe();

    expect(inner).toEqual([
      { ok: false, error: expect.objectContaining({ code: 'REENTRANT_DISPATCH' }) },
      { ok: false, error: expect.objectContaining({ code: 'REENTRANT_DISPATCH' }) },
    ]);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['a', 'b']);
  });

  it('funcionam destacados do canvas', () => {
    const { dispatch, undo, redo, getSnapshot } = newSection();
    dispatch(create('a'));

    expect(undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(redo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(Object.keys(getSnapshot().document.nodes)).toEqual(['a']);
  });

  it('desfaz e refaz a conversão entre retângulo e quadrado restaurando tipos e dimensões', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'r1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        rotation: 0,
      },
    });

    // Converte para square: min(100, 60) = 60, x vira 10 + 20 = 30, y vira 20
    section.dispatch({
      type: 'shape.update',
      id: 'r1',
      patch: { type: 'square' },
    });

    const sqNode = section.getSnapshot().document.nodes['r1'];
    expect(sqNode?.type).toBe('square');
    if (sqNode?.type === 'square') {
      expect(sqNode.width).toBe(60);
      expect(sqNode.height).toBe(60);
      expect(sqNode.x).toBe(30);
    }

    // Desfaz: deve voltar a ser retângulo com 100x60 na posição original (10, 20)
    const undoRes = section.undo();
    expect(undoRes.ok).toBe(true);
    const restoredRect = section.getSnapshot().document.nodes['r1'];
    expect(restoredRect?.type).toBe('rectangle');
    if (restoredRect?.type === 'rectangle') {
      expect(restoredRect.width).toBe(100);
      expect(restoredRect.height).toBe(60);
      expect(restoredRect.x).toBe(10);
      expect(restoredRect.y).toBe(20);
    }

    // Refaz: deve voltar a ser quadrado com 60x60 em (30, 20)
    const redoRes = section.redo();
    expect(redoRes.ok).toBe(true);
    const redoneSq = section.getSnapshot().document.nodes['r1'];
    expect(redoneSq?.type).toBe('square');
    if (redoneSq?.type === 'square') {
      expect(redoneSq.width).toBe(60);
      expect(redoneSq.height).toBe(60);
      expect(redoneSq.x).toBe(30);
      expect(redoneSq.y).toBe(20);
    }
  });
});

describe('limite do histórico', () => {
  it('guarda por padrão as 100 transações mais recentes e descarta as mais antigas', () => {
    const section = newSection();
    section.dispatch(create('a'));
    for (let x = 1; x <= 101; x++) section.dispatch(move('a', x));

    let undone = 0;
    while (section.getSnapshot().history.canUndo) {
      section.undo();
      undone += 1;
    }

    expect(undone).toBe(100);
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ x: 1 });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });
  });

  it('é configurável', () => {
    const section = newSection({ historyLimit: 2 });
    section.dispatch(create('a'));
    section.dispatch(move('a', 1));
    section.dispatch(move('a', 2));

    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });
    expect(section.getSnapshot().document.nodes['a']).toMatchObject({ x: 0 });
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: false } });
  });

  it('com limite zero não guarda nada', () => {
    const section = newSection({ historyLimit: 0 });

    section.dispatch(create('a'));

    expect(section.getSnapshot().history).toEqual({ canUndo: false, canRedo: false });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['a']);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null])(
    'createCanvasSection lança RangeError quando historyLimit é %j',
    (historyLimit) => {
      expect(() => newSection({ historyLimit: historyLimit as number })).toThrow(RangeError);
    },
  );
});

describe('estado do histórico no snapshot', () => {
  it('diz se há o que desfazer e o que refazer', () => {
    const section = newSection();
    const states = [section.getSnapshot().history];

    section.dispatch(create('a'));
    states.push(section.getSnapshot().history);
    section.dispatch(create('b'));
    states.push(section.getSnapshot().history);
    section.undo();
    states.push(section.getSnapshot().history);
    section.undo();
    states.push(section.getSnapshot().history);
    section.redo();
    states.push(section.getSnapshot().history);
    section.dispatch(create('c'));
    states.push(section.getSnapshot().history);

    expect(states).toEqual([
      { canUndo: false, canRedo: false },
      { canUndo: true, canRedo: false },
      { canUndo: true, canRedo: false },
      { canUndo: true, canRedo: true },
      { canUndo: false, canRedo: true },
      { canUndo: true, canRedo: true },
      { canUndo: true, canRedo: false },
    ]);
    expect(states[2]).toBe(states[1]);
    expect(states[6]).toBe(states[1]);
    expect(states[5]).toBe(states[3]);
    expect(Object.isFrozen(states[0])).toBe(true);
  });

  it('só entra nas áreas do evento quando um dos dois valores muda', () => {
    const section = newSection();
    const areas: (readonly string[])[] = [];
    section.subscribe((change) => areas.push(change.areas));

    section.dispatch(create('a'));
    section.dispatch(create('b'));
    section.undo();
    section.undo();
    section.redo();
    section.dispatch(move('a', 3));
    section.dispatch(move('a', 4));

    expect(areas).toEqual([
      ['document', 'history'],
      ['document'],
      ['document', 'history'],
      ['document', 'history'],
      ['document', 'history'],
      ['document', 'history'],
      ['document'],
    ]);
  });
});

describe('admissão do commit no histórico', () => {
  const REFUSAL = validationError([{ path: [], rule: 'range', message: 'refused by the gate' }]);

  it('commit recusado não entra no histórico', () => {
    const section = createCanvasSectionWith({ generateId: counter() }, ({ patch }) =>
      patch?.nodes.has('recusado') ? REFUSAL : undefined,
    );
    section.dispatch(create('a'));

    section.dispatch(create('recusado'));

    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });
  });

  it('undo e redo recusados não alteram documento, revisão nem as pilhas', () => {
    let open = true;
    const origins: string[] = [];
    const section = createCanvasSectionWith({ generateId: counter() }, ({ origin }) => {
      origins.push(origin);
      return open ? undefined : REFUSAL;
    });
    section.dispatch(create('a'));
    section.dispatch(create('b'));
    section.undo();
    const before = section.getSnapshot();
    const listener = vi.fn();
    section.subscribe(listener);

    open = false;
    const undo = section.undo();
    const redo = section.redo();
    open = true;

    expect(undo).toEqual({ ok: false, error: REFUSAL });
    expect(redo).toEqual({ ok: false, error: REFUSAL });
    expect(section.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(origins).toEqual(['local', 'local', 'history', 'history', 'history']);
    expect(section.redo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
  });

  it('um undo ou redo recusado sozinho deixa a entrada onde estava: o seguinte trata a mesma alteração', () => {
    // Recusar um undo e logo um redo esconderia a entrada que trocou de pilha: ela voltaria.
    let open = true;
    const section = createCanvasSectionWith({ generateId: counter() }, () =>
      open ? undefined : REFUSAL,
    );
    section.dispatch(create('a'));
    section.dispatch(create('b'));

    open = false;
    expect(section.undo()).toEqual({ ok: false, error: REFUSAL });
    open = true;

    expect(section.getSnapshot().history).toEqual({ canUndo: true, canRedo: false });
    expect(section.undo()).toMatchObject({ ok: true, value: { affectedIds: ['b', LAYER_ID] } });

    open = false;
    expect(section.redo()).toEqual({ ok: false, error: REFUSAL });
    open = true;

    expect(section.getSnapshot().history).toEqual({ canUndo: true, canRedo: true });
    expect(section.redo()).toMatchObject({ ok: true, value: { affectedIds: ['b', LAYER_ID] } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['a', 'b']);
  });

  it('undo e redo restauram tipo e dimensões na conversão elipse ⇄ círculo', () => {
    const section = newSection();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'el', type: 'ellipse', x: 100, y: 50, width: 200, height: 100, rotation: 0 },
    });
    section.dispatch({
      type: 'shape.update',
      id: 'el',
      patch: { type: 'circle' },
    });

    expect(section.getSnapshot().document.nodes['el']).toMatchObject({
      type: 'circle',
      x: 150,
      y: 50,
      width: 100,
      height: 100,
    });

    expect(section.undo().ok).toBe(true);
    expect(section.getSnapshot().document.nodes['el']).toMatchObject({
      type: 'ellipse',
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });

    expect(section.redo().ok).toBe(true);
    expect(section.getSnapshot().document.nodes['el']).toMatchObject({
      type: 'circle',
      x: 150,
      y: 50,
      width: 100,
      height: 100,
    });
  });
});

describe('histórico do texto da forma (US-SL.9)', () => {
  const labelOf = (section: CanvasSectionApi) =>
    (section.getSnapshot().document.nodes['s'] as { label?: { text: string } }).label;

  it('a primeira edição é uma entrada, e desfazer remove o label que ela criou', () => {
    const section = newSection();
    section.dispatch(create('s'));
    const before = section.getSnapshot().revision;

    section.dispatch({ type: 'shape.update', id: 's', patch: { label: { text: 'Olá' } } });

    expect(section.getSnapshot().revision).toBe(before + 1);
    expect(labelOf(section)).toMatchObject({ text: 'Olá' });
    section.undo();
    expect(section.getSnapshot().revision).toBe(before + 2);
    expect(labelOf(section)).toBeUndefined();
    section.redo();
    expect(labelOf(section)).toMatchObject({ text: 'Olá' });
  });

  it('uma mudança do painel em várias formas é uma entrada só', () => {
    const section = newSection();
    section.transact([create('s'), create('t')]);

    section.transact([
      { type: 'shape.update', id: 's', patch: { label: { verticalAlign: 'top' } } },
      { type: 'shape.update', id: 't', patch: { label: { verticalAlign: 'top' } } },
    ]);
    section.undo();

    expect(
      (section.getSnapshot().document.nodes['s'] as { label?: unknown }).label,
    ).toBeUndefined();
    expect(
      (section.getSnapshot().document.nodes['t'] as { label?: unknown }).label,
    ).toBeUndefined();
  });
});
