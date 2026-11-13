import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import { validateDocument } from './validate.js';

// Entradas e sequências que um consumidor bem-comportado não produz, mas que o canvas recebe
// como dado não confiável: nada do chamador pode ficar vivo dentro do documento, e uma falha
// no meio de uma operação não pode deixar o canvas em um estado parcial.

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const RECT = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } as const;

function create(id: string | undefined, extra: Record<string, unknown> = {}): CanvasCommand {
  return { type: 'shape.create', shape: { ...RECT, id, ...extra } } as CanvasCommand;
}

/** Nós que nenhuma camada lista: sinal de documento corrompido. */
function orphans(section: CanvasSectionApi): string[] {
  const { document } = section.getSnapshot();
  const placed = new Set(document.layers.flatMap((layer) => layer.childIds));
  return Object.keys(document.nodes).filter((id) => !placed.has(id));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('array hostil em metadata', () => {
  it('é copiado item a item, sem chamar métodos do array recebido', () => {
    const section = createCanvasSection({ generateId: counter() });
    const live = { n: 1 };
    const list: unknown[] = [0];
    Object.defineProperty(list, 'map', { value: () => Object.freeze([live]) });

    const result = section.dispatch(create('a', { metadata: { list } }));
    const before = JSON.stringify(section.getSnapshot());
    live.n = 2;

    expect(result.ok).toBe(true);
    expect(section.getSnapshot().document.nodes['a']?.metadata).toEqual({ list: [0] });
    expect(JSON.stringify(section.getSnapshot())).toBe(before);
  });

  it('com buraco é recusado como um undefined explícito', () => {
    const section = createCanvasSection({ generateId: counter() });
    const sparse = [1, 2, 3];
    delete sparse[1];

    const shape = section.dispatch(create('a', { metadata: { list: sparse } }));
    const layer = section.dispatch({
      type: 'layer.create',
      layer: { metadata: { list: new Array(2) } },
    } as CanvasCommand);

    expect(shape).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: { issues: [{ path: ['shape', 'metadata', 'list', 1], rule: 'type' }] },
      },
    });
    expect(layer).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(section.getSnapshot().revision).toBe(0);
  });
});

describe('array hostil no lugar de uma lista', () => {
  it('de comandos: a posição vazia é recusada, não pulada', () => {
    const section = createCanvasSection({ generateId: counter() });
    const commands = [undefined, { type: 'layer.create' }] as unknown as CanvasCommand[];
    delete (commands as unknown[])[0];

    const result = section.transact(commands);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { commandIndex: 0 } },
    });
    expect(section.getSnapshot().document.layers).toHaveLength(1);
  });

  it('de comandos: métodos trocados no array não mudam o que é executado', () => {
    const section = createCanvasSection({ generateId: counter() });
    const commands = [create('a')];
    Object.defineProperty(commands, 'entries', { value: () => [][Symbol.iterator]() });

    expect(section.transact(commands)).toMatchObject({ ok: true, value: { createdIds: ['a'] } });
  });

  it('de seleção: a posição vazia é recusada com o índice certo', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.dispatch(create('a'));
    const ids = ['a', 'a', 'a'];
    delete ids[1];

    expect(section.setSelection(ids)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path: [1], rule: 'type' }] } },
    });
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
  });

  it('é lida só até onde a conferência parou, sem copiar o comprimento dela', () => {
    // Um array esparso pode ter `length` de bilhões e caber em poucos bytes. A posição 500
    // denuncia quem a lê: a transação para no primeiro comando recusado, e as outras listas,
    // no teto de cem problemas.
    const watched = (): { list: unknown[]; wasRead: () => boolean } => {
      const list = new Array<unknown>(100_000);
      let read = false;
      Object.defineProperty(list, 500, {
        get: () => {
          read = true;
          return undefined;
        },
      });
      return { list, wasRead: () => read };
    };
    const section = createCanvasSection({ generateId: counter() });

    for (const attempt of [
      (list: unknown[]) => section.transact(list as CanvasCommand[]),
      (list: unknown[]) => section.setSelection(list as string[]),
      (list: unknown[]) => section.setPreview({ additions: list as never }),
      (list: unknown[]) => section.setPreview({ updates: list as never }),
    ]) {
      const { list, wasRead } = watched();

      const result = attempt(list);

      if (result.ok || result.error.code !== 'VALIDATION_ERROR') throw new Error('esperava erro');
      expect(result.error.details.issues.length).toBeLessThanOrEqual(100);
      expect(wasRead()).toBe(false);
    }
  });

  it('de shapes de preview e de camadas de um documento: a posição vazia é recusada', () => {
    const section = createCanvasSection({ generateId: counter() });
    const additions = [
      { ...RECT, id: 'n1' },
      { ...RECT, id: 'n2' },
    ];
    delete (additions as unknown[])[0];
    const layers = [
      { id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] },
      { id: 'l2', name: 'L2', visible: true, locked: false, childIds: [] },
    ];
    delete (layers as unknown[])[0];

    expect(section.setPreview({ additions })).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['additions', 0], rule: 'type' }] } },
    });
    expect(section.replaceDocument({ schemaVersion: 1, id: 'd', nodes: {}, layers })).toMatchObject(
      {
        ok: false,
        error: { details: { issues: [{ path: ['layers', 0], rule: 'type' }] } },
      },
    );
    expect(section.getPreview()).toBeNull();
  });
});

describe('chamada ao canvas de dentro de uma operação em andamento', () => {
  it('pelo gerador de IDs é recusada, e o documento continua válido', () => {
    let count = 0;
    let nested: unknown;
    const section: CanvasSectionApi = createCanvasSection({
      generateId: () => {
        count += 1;
        // O terceiro ID é o do primeiro shape criado sem ID: o gerador reentra no canvas.
        if (count === 3) nested = section.dispatch(create('nested'));
        return `id-${count}`;
      },
    });

    const outer = section.dispatch(create(undefined));

    expect(nested).toMatchObject({ ok: false, error: { code: 'REENTRANT_DISPATCH' } });
    expect(outer).toMatchObject({ ok: true, value: { revision: 1, createdIds: ['id-3'] } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['id-3']);
    section.undo();
    section.redo();
    expect(orphans(section)).toEqual([]);
    expect(section.getNodeInfo('id-3')).toMatchObject({ index: 0 });
  });

  it('por um getter do comando é recusada: sessão, preview, undo e carga também', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.dispatch(create('a'));
    const nested: unknown[] = [];
    const shape = {
      ...RECT,
      id: 'b',
      get x() {
        nested.push(
          section.undo(),
          section.setSelection(['a']),
          section.setTool('hand'),
          section.setPreview({ marquee: { x: 0, y: 0, width: 1, height: 1 } }),
          section.setPreview(null),
          section.replaceDocument({ schemaVersion: 1, id: 'd', nodes: {}, layers: [] }),
        );
        return 5;
      },
    };

    const outer = section.dispatch({ type: 'shape.create', shape });

    expect(outer.ok).toBe(true);
    expect(nested.length).toBeGreaterThan(0);
    for (const result of nested) {
      expect(result).toMatchObject({ ok: false, error: { code: 'REENTRANT_DISPATCH' } });
    }
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['a', 'b']);
    expect(section.getSnapshot().session.activeTool).toBe('select');
    expect(section.getPreview()).toBeNull();
  });

  it('volta a aceitar chamadas quando a operação termina, mesmo com exceção', () => {
    const values = ['doc', 'layer', 'layer'];
    const section = createCanvasSection({ generateId: () => values.shift() ?? 'ok' });

    expect(() => section.dispatch(create(undefined))).toThrow(TypeError);

    expect(section.dispatch(create(undefined))).toMatchObject({ ok: true });
    expect(section.setTool('hand')).toMatchObject({ ok: true });
  });

  it('destroy chamado pelo gerador de IDs cancela a operação em andamento', () => {
    let count = 0;
    const section: CanvasSectionApi = createCanvasSection({
      generateId: () => {
        count += 1;
        if (count === 3) section.destroy();
        return `id-${count}`;
      },
    });
    const before = section.getSnapshot();

    const result = section.dispatch(create(undefined));

    expect(result).toMatchObject({ ok: false, error: { code: 'DISPOSED' } });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('destroy chamado pela própria entrada de uma operação', () => {
  /** Array cuja leitura do tamanho destrói o canvas: a operação em andamento não pode publicar. */
  function destroying<T>(section: CanvasSectionApi, list: T[]): T[] {
    return new Proxy(list, {
      get(target, key, receiver) {
        if (key === 'length') section.destroy();
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
  }

  it('setSelection, setPreview e replaceDocument devolvem DISPOSED sem publicar nada', () => {
    const results: unknown[] = [];
    for (const attempt of [
      (section: CanvasSectionApi) => section.setSelection(destroying(section, ['a'])),
      (section: CanvasSectionApi) =>
        section.setPreview({ additions: destroying(section, [{ ...RECT, id: 'n' }]) }),
      (section: CanvasSectionApi) =>
        section.replaceDocument({
          schemaVersion: 1,
          id: 'd',
          nodes: {},
          layers: destroying(section, [
            { id: 'l', name: 'L', visible: true, locked: false, childIds: [] },
          ]),
        }),
    ]) {
      const section = createCanvasSection({ generateId: counter() });
      section.dispatch(create('a'));
      const before = section.getSnapshot();
      const listener = vi.fn();
      section.subscribe(listener);

      results.push(attempt(section));

      expect(section.getSnapshot()).toBe(before);
      expect(section.getPreview()).toBeNull();
      expect(listener).not.toHaveBeenCalled();
    }

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'DISPOSED' } });
    }
  });
});

describe('exceção lançada pela própria entrada', () => {
  /** Objeto em que a leitura de `key` lança, como um getter com defeito ou um Proxy. */
  function throwing(key: string, base: Record<string, unknown> = {}): Record<string, unknown> {
    return Object.defineProperty({ ...base }, key, {
      enumerable: true,
      get: () => {
        throw new Error('getter boom');
      },
    });
  }

  function revoked(): never {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return proxy as never;
  }

  it('chega ao chamador, e o canvas continua intacto e utilizável', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.dispatch(create('a'));
    section.setPreview({ marquee: { x: 0, y: 0, width: 1, height: 1 } });
    const before = section.getSnapshot();
    const preview = section.getPreview();
    const listener = vi.fn();
    section.subscribe(listener);
    const emptyDocument = { schemaVersion: 1, id: 'd', nodes: {} };

    for (const attempt of [
      () => section.dispatch(throwing('type') as never),
      () => section.dispatch({ type: 'shape.create', shape: throwing('width', RECT) } as never),
      () => section.transact([create('b'), throwing('type') as never]),
      () => section.replaceDocument(throwing('layers', emptyDocument)),
      () => section.setPreview(throwing('marquee')),
      () => section.setViewport(throwing('zoom', { x: 0, y: 0 }) as never),
      () => validateDocument(throwing('layers', emptyDocument)),
    ]) {
      expect(attempt).toThrow('getter boom');
    }
    for (const attempt of [
      () => section.setPreview(revoked()),
      () => section.hitTestAll(revoked(), { includePreview: false }),
      () => section.queryBounds(revoked(), { includePreview: false }),
      () => validateDocument(revoked()),
    ]) {
      expect(attempt).toThrow(TypeError);
    }

    expect(section.getSnapshot()).toBe(before);
    expect(section.getPreview()).toBe(preview);
    expect(listener).not.toHaveBeenCalled();
    // A operação interrompida não deixa o canvas travado.
    expect(section.setTool('hand')).toMatchObject({ ok: true });
    expect(section.dispatch(create('b'))).toMatchObject({ ok: true, value: { revision: 2 } });
  });
});

describe('falha no meio de um commit', () => {
  it('não deixa no histórico uma alteração que não foi publicada', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.dispatch(create('z'));
    // O ponto de admissão é o único código de fora que roda entre o cálculo e a publicação;
    // aqui a falha vem do congelamento de um objeto que se recusa a ser congelado.
    const realFreeze = Object.freeze;
    const freeze = vi.spyOn(Object, 'freeze').mockImplementation((value: unknown) => {
      // Falha ao congelar o documento novo, como falharia um objeto que se recusa a ser congelado.
      if (typeof value === 'object' && value !== null && 'schemaVersion' in value) {
        throw new Error('no freeze');
      }
      return realFreeze(value);
    });

    expect(() => section.dispatch(create('a'))).toThrow('no freeze');
    freeze.mockRestore();

    expect(section.getSnapshot().revision).toBe(1);
    expect(section.getSnapshot().history).toEqual({ canUndo: true, canRedo: false });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(section.undo()).toMatchObject({ ok: true, value: { changed: false } });
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
    expect(section.hitTest({ x: 5, y: 5 }, { includePreview: false })).toBeUndefined();
  });
});

describe('argumentos que não são o que o tipo promete', () => {
  it('getNodeInfo devolve undefined para o que não é texto, mesmo que vire o ID de um nó', () => {
    const section = createCanvasSection({ generateId: counter() });
    section.dispatch(create('1'));
    const getNodeInfo = section.getNodeInfo as (id: unknown) => unknown;

    expect(getNodeInfo(1)).toBeUndefined();
    expect(getNodeInfo(['1'])).toBeUndefined();
    expect(getNodeInfo(null)).toBeUndefined();
    expect(getNodeInfo('1')).toMatchObject({ index: 0 });
  });

  it.each([123, 'log', {}, null])(
    'createCanvasSection lança TypeError quando onError é %j',
    (onError) => {
      expect(() => createCanvasSection({ onError: onError as never })).toThrow(TypeError);
    },
  );

  it.each([42, 'opções', true, null, [[]]])(
    'createCanvasSection lança TypeError quando as opções são %j',
    (options) => {
      expect(() => createCanvasSection(options as never)).toThrow(TypeError);
    },
  );

  it.each([
    ['generateId', { generateId: 'id' }],
    ['generateId', { generateId: null }],
    ['now', { now: 0 }],
    ['now', { now: {} }],
  ])('createCanvasSection lança TypeError quando %s não é função', (_name, options) => {
    expect(() => createCanvasSection(options as never)).toThrow(TypeError);
  });

  it('o listener não recebe nada do canvas como this', () => {
    const section = createCanvasSection({ generateId: counter() });
    const receivers: unknown[] = [];
    section.subscribe(function (this: unknown) {
      receivers.push(this);
    });

    section.dispatch(create('a'));

    expect(receivers).toEqual([undefined]);
  });
});
