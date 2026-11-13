import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCanvasSection,
  type CanvasSectionApi,
  type CreateCanvasSectionOptions,
} from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import type { CanvasChange } from './events.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const LAYER_ID = 'id-2';
const RECTANGLE = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;
const CREATE: CanvasCommand = { type: 'shape.create', shape: RECTANGLE };

function newSection(options: CreateCanvasSectionOptions = {}): CanvasSectionApi {
  return createCanvasSection({ generateId: counter(), ...options });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('subscribe', () => {
  it('entrega um evento por commit, com snapshot posterior, IDs afetados, áreas e origem local', () => {
    const section = newSection();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.dispatch(CREATE);
    section.dispatch(CREATE);

    expect(changes).toEqual([
      {
        snapshot: expect.objectContaining({ revision: 1 }),
        origin: 'local',
        areas: ['document', 'history'],
        affectedIds: ['id-3', LAYER_ID],
      },
      {
        snapshot: expect.objectContaining({ revision: 2 }),
        origin: 'local',
        areas: ['document'],
        affectedIds: ['id-4', LAYER_ID],
      },
    ]);
    expect(changes[1]?.snapshot).toBe(section.getSnapshot());
    expect(Object.keys(changes[0]?.snapshot.document.nodes ?? {})).toEqual(['id-3']);
  });

  it('notifica de forma síncrona, depois do commit e antes de dispatch devolver', () => {
    const section = newSection();
    const log: string[] = [];
    section.subscribe((change) => {
      log.push(`evento ${change.snapshot.revision}, snapshot ${section.getSnapshot().revision}`);
    });

    const result = section.dispatch(CREATE);
    log.push(`dispatch devolveu ${result.ok ? result.value.revision : 'erro'}`);

    expect(log).toEqual(['evento 1, snapshot 1', 'dispatch devolveu 1']);
  });

  it('não gera evento quando o comando é recusado', () => {
    const section = newSection();
    const listener = vi.fn();
    section.subscribe(listener);

    section.dispatch({ type: 'shape.create', shape: { ...RECTANGLE, width: 0 } });
    section.dispatch({ type: 'shape.create', shape: RECTANGLE, layerId: 'sumida' });

    expect(listener).not.toHaveBeenCalled();
    expect(section.getSnapshot().revision).toBe(0);
  });

  it('chama os listeners na ordem de inscrição, todos com o mesmo evento', () => {
    const section = newSection();
    const seen: [string, CanvasChange][] = [];
    section.subscribe((change) => seen.push(['primeiro', change]));
    section.subscribe((change) => seen.push(['segundo', change]));

    section.dispatch(CREATE);

    expect(seen.map(([name]) => name)).toEqual(['primeiro', 'segundo']);
    expect(seen[1]?.[1]).toBe(seen[0]?.[1]);
  });

  it('entrega o evento congelado', () => {
    const section = newSection();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.dispatch(CREATE);

    const change = changes[0];
    expect(Object.isFrozen(change)).toBe(true);
    expect(Object.isFrozen(change?.affectedIds)).toBe(true);
    expect(Object.isFrozen(change?.areas)).toBe(true);
  });

  it('funciona destacado do canvas', () => {
    const { subscribe, dispatch } = newSection();
    const listener = vi.fn();

    const unsubscribe = subscribe(listener);
    dispatch(CREATE);
    unsubscribe();
    dispatch(CREATE);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, 'listener', {}])('lança TypeError quando o listener é %j', (value) => {
    const section = newSection();

    expect(() => section.subscribe(value as unknown as () => void)).toThrow(TypeError);
  });
});

describe('unsubscribe', () => {
  it('impede novas chamadas do listener', () => {
    const section = newSection();
    const kept = vi.fn();
    const removed = vi.fn();
    section.subscribe(kept);
    const unsubscribe = section.subscribe(removed);

    section.dispatch(CREATE);
    unsubscribe();
    section.dispatch(CREATE);

    expect(removed).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledTimes(2);
  });

  it('pode ser chamado mais de uma vez sem remover outra inscrição', () => {
    const section = newSection();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = section.subscribe(first);
    section.subscribe(second);

    unsubscribeFirst();
    unsubscribeFirst();
    section.dispatch(CREATE);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('trata cada inscrição da mesma função em separado', () => {
    const section = newSection();
    const listener = vi.fn();
    const unsubscribeFirst = section.subscribe(listener);
    section.subscribe(listener);

    section.dispatch(CREATE);
    unsubscribeFirst();
    section.dispatch(CREATE);

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('feito por outro listener durante a notificação já vale para o evento em curso', () => {
    const section = newSection();
    const later = vi.fn();
    let unsubscribeLater = (): void => {};
    section.subscribe(() => unsubscribeLater());
    unsubscribeLater = section.subscribe(later);

    section.dispatch(CREATE);

    expect(later).not.toHaveBeenCalled();
  });

  it('listener inscrito durante a notificação só recebe o evento seguinte', () => {
    const section = newSection();
    const late = vi.fn();
    let subscribed = false;
    section.subscribe(() => {
      if (!subscribed) section.subscribe(late);
      subscribed = true;
    });

    section.dispatch(CREATE);
    expect(late).not.toHaveBeenCalled();

    section.dispatch(CREATE);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch dentro de listener', () => {
  it('devolve REENTRANT_DISPATCH sem alterar documento nem revisão', () => {
    const section = newSection();
    const inner: unknown[] = [];
    const listener = vi.fn(() => inner.push(section.dispatch(CREATE)));
    section.subscribe(listener);

    const outer = section.dispatch(CREATE);

    expect(outer).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(inner).toEqual([
      {
        ok: false,
        error: { code: 'REENTRANT_DISPATCH', message: expect.any(String), details: {} },
      },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(section.getSnapshot().revision).toBe(1);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['id-3']);
  });

  it('vale para todos os listeners da mesma notificação, não só para o primeiro', () => {
    const section = newSection();
    const inner: unknown[] = [];
    // Cada listener só reage ao primeiro evento: se a trava falhasse, o comando aceito geraria
    // outro evento, e o teste entraria em laço em vez de falhar.
    const once = (attempt: () => unknown) => (change: CanvasChange) => {
      if (change.snapshot.revision === 1) inner.push(attempt());
    };
    section.subscribe(once(() => section.dispatch(CREATE)));
    section.subscribe(once(() => section.dispatch(CREATE)));
    section.subscribe(once(() => section.transact([CREATE])));

    section.dispatch(CREATE);

    expect(inner).toHaveLength(3);
    for (const result of inner) {
      expect(result).toMatchObject({ ok: false, error: { code: 'REENTRANT_DISPATCH' } });
    }
    expect(section.getSnapshot().revision).toBe(1);
  });

  it('volta a aceitar comandos quando a notificação termina, mesmo com listener que lança', () => {
    const section = newSection({ onError: () => {} });
    section.subscribe(() => {
      throw new Error('falha do listener');
    });

    section.dispatch(CREATE);
    const next = section.dispatch(CREATE);

    expect(next).toMatchObject({ ok: true, value: { revision: 2 } });
  });
});

describe('exceção de listener', () => {
  it('não impede o commit nem os demais listeners e vai para o onError do host', () => {
    const failure = new Error('falha do listener');
    const onError = vi.fn();
    const section = newSection({ onError });
    const after = vi.fn();
    section.subscribe(() => {
      throw failure;
    });
    section.subscribe(after);

    const result = section.dispatch(CREATE);

    expect(result).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('sem onError, vira uma rejeição de promise não tratada em vez de sumir', () => {
    const failure = new Error('falha do listener');
    const reject = vi.spyOn(Promise, 'reject').mockReturnValue(undefined as never);
    const section = newSection();
    section.subscribe(() => {
      throw failure;
    });

    const result = section.dispatch(CREATE);

    expect(result.ok).toBe(true);
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith(failure);
  });

  it('do próprio onError também é isolada e vira rejeição não tratada', () => {
    const handlerFailure = new Error('falha do onError');
    const reject = vi.spyOn(Promise, 'reject').mockReturnValue(undefined as never);
    const section = newSection({
      onError: () => {
        throw handlerFailure;
      },
    });
    const after = vi.fn();
    section.subscribe(() => {
      throw new Error('falha do listener');
    });
    section.subscribe(after);

    const result = section.dispatch(CREATE);

    expect(result.ok).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith(handlerFailure);
  });
});
