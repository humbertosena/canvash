import { describe, expect, it, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const RECT = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;
const WITHOUT = { includePreview: false } as const;
const WITH = { includePreview: true } as const;

function create(id: string, x = 0): CanvasCommand {
  return { type: 'shape.create', shape: { ...RECT, id, x } };
}

/** Canvas com dois nós, uma alteração desfeita, seleção e preview. */
function busySection(): CanvasSectionApi {
  const section = createCanvasSection({ generateId: counter() });
  section.dispatch(create('a'));
  section.dispatch(create('b', 100));
  section.undo();
  section.setSelection(['a']);
  section.setPreview({ updates: [{ ...RECT, id: 'a', x: 500 }] });
  return section;
}

const DISPOSED = {
  ok: false,
  error: { code: 'DISPOSED', message: expect.any(String), details: {} },
};

describe('destroy', () => {
  it('pode ser chamado mais de uma vez', () => {
    const section = busySection();

    section.destroy();

    expect(() => section.destroy()).not.toThrow();
  });

  it('deixa as leituras devolvendo o último estado', () => {
    const section = busySection();
    const last = section.getSnapshot();

    section.destroy();

    expect(section.getSnapshot()).toBe(last);
    expect(section.getSnapshot().session.selectedIds).toEqual(['a']);
    expect(section.getNodeInfo('a')).toEqual({
      layerId: 'id-2',
      index: 0,
      visible: true,
      locked: false,
    });
    expect(section.hitTest({ x: 5, y: 5 }, WITHOUT)).toBe('a');
    expect(section.queryBounds({ x: 0, y: 0, width: 5, height: 5 }, WITHOUT)).toEqual(['a']);
    expect(
      section.queryMarquee(
        { x: -5, y: -5, width: 30, height: 30 },
        { mode: 'contain', includePreview: false },
      ),
    ).toEqual(['a']);
    expect(section.getBounds(['a'], { includePreview: false, stroke: false })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it('libera o preview, sem emitir evento', () => {
    const section = busySection();
    const listener = vi.fn();
    section.subscribe(listener);

    section.destroy();

    expect(section.getPreview()).toBeNull();
    expect(section.hitTest({ x: 505, y: 5 }, WITH)).toBeUndefined();
    expect(section.hitTest({ x: 5, y: 5 }, WITH)).toBe('a');
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['dispatch', (section: CanvasSectionApi) => section.dispatch(create('novo'))],
    [
      'dispatch de comando inválido',
      (section: CanvasSectionApi) => section.dispatch({ type: 'shape.remove', id: 'sumido' }),
    ],
    ['transact', (section: CanvasSectionApi) => section.transact([create('novo')])],
    ['transact vazio', (section: CanvasSectionApi) => section.transact([])],
    ['undo', (section: CanvasSectionApi) => section.undo()],
    ['redo', (section: CanvasSectionApi) => section.redo()],
    ['setSelection', (section: CanvasSectionApi) => section.setSelection([])],
    ['setViewport', (section: CanvasSectionApi) => section.setViewport({ x: 1, y: 1, zoom: 2 })],
    ['setTool', (section: CanvasSectionApi) => section.setTool('hand')],
    ['setReadOnly', (section: CanvasSectionApi) => section.setReadOnly(true)],
    [
      'setPreview com um preview',
      (section: CanvasSectionApi) =>
        section.setPreview({ marquee: { x: 0, y: 0, width: 1, height: 1 } }),
    ],
    ['setPreview para limpar', (section: CanvasSectionApi) => section.setPreview(null)],
    [
      'replaceDocument',
      (section: CanvasSectionApi) =>
        section.replaceDocument({
          schemaVersion: 1,
          id: 'd',
          nodes: {},
          layers: [{ id: 'l', name: 'L', visible: true, locked: false, childIds: [] }],
        }),
    ],
    [
      'replaceDocument com entrada inválida',
      (section: CanvasSectionApi) => section.replaceDocument('lixo'),
    ],
  ])('faz %s devolver DISPOSED sem mudar nada', (_label, mutate) => {
    const section = busySection();
    const last = section.getSnapshot();
    section.destroy();

    expect(mutate(section)).toEqual(DISPOSED);
    expect(section.getSnapshot()).toBe(last);
  });

  it('tem precedência sobre o modo somente leitura', () => {
    const section = busySection();
    section.setReadOnly(true);
    section.destroy();

    expect(section.dispatch(create('novo'))).toEqual(DISPOSED);
    expect(section.undo()).toEqual(DISPOSED);
  });

  it('impede notificações futuras aos listeners que havia (CORE-07)', () => {
    const section = busySection();
    const listener = vi.fn();
    const unsubscribe = section.subscribe(listener);

    section.destroy();
    section.dispatch(create('novo'));
    section.setTool('hand');

    expect(listener).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('faz novas inscrições devolverem um cancelamento inerte', () => {
    const section = busySection();
    section.destroy();
    const listener = vi.fn();

    const unsubscribe = section.subscribe(listener);
    section.dispatch(create('novo'));

    expect(listener).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
    expect(() => section.subscribe('nada' as unknown as () => void)).toThrow(TypeError);
  });

  it('chamado de dentro de um listener, interrompe a entrega aos listeners seguintes', () => {
    const section = busySection();
    const log: string[] = [];
    section.subscribe((change) => {
      log.push(`primeiro: ${change.areas.join('+')}`);
      section.setPreview(null);
      section.destroy();
      log.push(`depois do destroy: ${JSON.stringify(section.dispatch(create('x')).ok)}`);
    });
    section.subscribe((change) => log.push(`segundo: ${change.areas.join('+')}`));

    section.setTool('hand');

    expect(log).toEqual(['primeiro: tool', 'depois do destroy: false']);
    expect(section.getSnapshot().session.activeTool).toBe('hand');
    expect(section.getPreview()).toBeNull();
  });

  it('chamado de dentro de um listener, faz as chamadas seguintes devolverem DISPOSED, não REENTRANT_DISPATCH', () => {
    // REENTRANT_DISPATCH diria ao chamador para tentar de novo fora do listener, em um canvas
    // que não existe mais.
    const section = busySection();
    const codes: string[] = [];
    const codeOf = (result: { ok: true } | { ok: false; error: { code: string } }): string =>
      result.ok ? 'ok' : result.error.code;
    section.subscribe(() => {
      section.destroy();
      codes.push(
        codeOf(section.dispatch(create('x'))),
        codeOf(section.undo()),
        codeOf(section.setTool('pen')),
        codeOf(section.replaceDocument({ schemaVersion: 1, id: 'd', nodes: {}, layers: [] })),
        codeOf(section.setPreview({ marquee: { x: 0, y: 0, width: 1, height: 1 } })),
        codeOf(section.setPreview(null)),
      );
    });

    section.setTool('hand');

    expect(codes).toEqual(Array.from({ length: 6 }, () => 'DISPOSED'));
  });

  it('funciona destacado do canvas', () => {
    const { destroy, dispatch } = busySection();

    destroy();

    expect(dispatch(create('novo'))).toEqual(DISPOSED);
  });
});

describe('duas instâncias', () => {
  it('não compartilham documento, sessão, histórico, preview, índice nem listeners (CORE-07)', () => {
    const first = createCanvasSection({ generateId: counter() });
    const second = createCanvasSection({ generateId: counter() });
    const secondInitial = second.getSnapshot();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    first.subscribe(firstListener);
    second.subscribe(secondListener);

    first.dispatch(create('a'));
    first.dispatch({ type: 'layer.create', layer: { id: 'top' } });
    first.setSelection(['a']);
    first.setViewport({ x: 9, y: 9, zoom: 4 });
    first.setTool('hand');
    first.setReadOnly(true);
    first.setPreview({ marquee: { x: 0, y: 0, width: 1, height: 1 } });

    expect(firstListener).toHaveBeenCalledTimes(7);
    expect(secondListener).not.toHaveBeenCalled();
    expect(second.getSnapshot()).toBe(secondInitial);
    expect(second.getSnapshot().document.nodes).toEqual({});
    expect(second.getPreview()).toBeNull();
    expect(second.hitTest({ x: 5, y: 5 }, WITHOUT)).toBeUndefined();
    expect(second.getNodeInfo('a')).toBeUndefined();
    expect(second.undo()).toMatchObject({ ok: true, value: { changed: false } });
    // Os dois canvas usam geradores iguais: o mesmo ID existe em cada um, sem conflito.
    expect(second.dispatch(create('a', 300))).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(first.getSnapshot().document.nodes['a']).toMatchObject({ x: 0 });
    expect(first.getSnapshot().revision).toBe(2);
  });

  it('a trava de reentrância é de cada instância: o listener de uma pode alterar a outra', () => {
    const first = createCanvasSection({ generateId: counter() });
    const second = createCanvasSection({ generateId: counter() });
    const results: unknown[] = [];
    first.subscribe(() => results.push(second.dispatch(create('espelho'))));

    first.dispatch(create('a'));

    expect(results).toEqual([expect.objectContaining({ ok: true })]);
    expect(Object.keys(second.getSnapshot().document.nodes)).toEqual(['espelho']);
  });

  it('a fila de eventos é de cada instância: a alterada dentro do listener da outra notifica na hora', () => {
    const first = createCanvasSection({ generateId: counter() });
    const second = createCanvasSection({ generateId: counter() });
    const log: string[] = [];
    second.subscribe((change) => log.push(`segunda: revisão ${change.snapshot.revision}`));
    first.subscribe(() => {
      second.dispatch(create('espelho'));
      log.push('listener da primeira terminou');
    });

    first.dispatch(create('a'));

    expect(log).toEqual(['segunda: revisão 1', 'listener da primeira terminou']);
  });

  it('destruir uma não afeta a outra', () => {
    const first = busySection();
    const second = busySection();
    const listener = vi.fn();
    second.subscribe(listener);

    first.destroy();

    expect(second.dispatch(create('novo'))).toMatchObject({ ok: true });
    expect(second.getPreview()).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
