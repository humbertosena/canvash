import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createCanvasSection, type CanvasSnapshot } from './canvas-section.js';

/** O mesmo tipo JSON com `readonly` em toda propriedade e em todo array, em todos os níveis. */
type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** Gerador determinístico: devolve os IDs dados, na ordem. */
function sequence(...ids: string[]): () => string {
  let next = 0;
  return () => ids[next++] ?? `extra-${next}`;
}

describe('createCanvasSection', () => {
  it('cria o documento padrão com schemaVersion 1, sem nós e com uma camada vazia', () => {
    const { document, revision } = createCanvasSection().getSnapshot();

    expect(document.schemaVersion).toBe(1);
    expect(document.nodes).toEqual({});
    expect(document.layers).toEqual([
      { id: expect.any(String), name: 'Layer 1', visible: true, locked: false, childIds: [] },
    ]);
    expect(document.id).not.toBe('');
    expect(document.layers[0]?.id).not.toBe('');
    expect(document.layers[0]?.id).not.toBe(document.id);
    expect(revision).toBe(0);
  });

  it('usa o gerador de IDs injetado, primeiro para o documento e depois para a camada', () => {
    const section = createCanvasSection({ generateId: sequence('doc-1', 'layer-1') });

    const { document } = section.getSnapshot();

    expect(document.id).toBe('doc-1');
    expect(document.layers.map((layer) => layer.id)).toEqual(['layer-1']);
  });

  it('produz snapshots idênticos para o mesmo gerador de IDs', () => {
    const first = createCanvasSection({ generateId: sequence('a', 'b') }).getSnapshot();
    const second = createCanvasSection({ generateId: sequence('a', 'b') }).getSnapshot();

    expect(second).toEqual(first);
  });

  it('lê o relógio injetado para gerar os IDs padrão', () => {
    const now = vi.fn(() => 1_700_000_000_000);

    createCanvasSection({ now });

    expect(now).toHaveBeenCalled();
  });

  it('não lê o relógio quando o gerador de IDs é injetado', () => {
    const now = vi.fn(() => 1_700_000_000_000);

    createCanvasSection({ now, generateId: sequence('a', 'b') });

    expect(now).not.toHaveBeenCalled();
  });

  it('não compartilha estado entre instâncias', () => {
    const first = createCanvasSection().getSnapshot();
    const second = createCanvasSection().getSnapshot();

    expect(second.document.id).not.toBe(first.document.id);
    expect(second.document.layers[0]?.id).not.toBe(first.document.layers[0]?.id);
    expect(second.document.nodes).not.toBe(first.document.nodes);
    expect(second.document.layers).not.toBe(first.document.layers);
  });

  // O valor inválido aparece uma única vez, ao lado de um ID válido: com um gerador constante
  // a checagem de ID repetido lançaria o mesmo TypeError e o teste passaria sem a validação.
  it.each([
    ['uma string vazia para o documento', ['', 'layer-1']],
    ['um número para o documento', [42, 'layer-1']],
    ['undefined para o documento', [undefined, 'layer-1']],
    ['uma string vazia para a camada', ['doc-1', '']],
    ['um número para a camada', ['doc-1', 42]],
    ['undefined para a camada', ['doc-1', undefined]],
  ])('lança TypeError quando o gerador injetado devolve %s', (_label, values) => {
    let next = 0;
    const generateId = (() => values[next++]) as () => string;

    expect(() => createCanvasSection({ generateId })).toThrow(TypeError);
  });

  it('lança TypeError quando o gerador injetado repete o ID do documento na camada', () => {
    expect(() => createCanvasSection({ generateId: () => 'repetido' })).toThrow(TypeError);
  });
});

describe('getSnapshot', () => {
  it('devolve a mesma referência enquanto nada muda', () => {
    const section = createCanvasSection();

    expect(section.getSnapshot()).toBe(section.getSnapshot());
  });

  it('funciona destacado do canvas', () => {
    const { getSnapshot } = createCanvasSection({ generateId: sequence('doc-1', 'layer-1') });

    expect(getSnapshot().document.id).toBe('doc-1');
  });

  it('só contém dados JSON', () => {
    const snapshot = createCanvasSection().getSnapshot();

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('tem tipo somente leitura em toda propriedade e em todo array', () => {
    expectTypeOf<CanvasSnapshot>().toEqualTypeOf<DeepReadonly<CanvasSnapshot>>();
  });

  it('é somente leitura em todos os níveis, no tipo e em execução', () => {
    const snapshot = createCanvasSection({
      generateId: sequence('doc-1', 'layer-1'),
    }).getSnapshot();
    const layer = snapshot.document.layers[0];
    if (!layer) throw new Error('o documento padrão tem uma camada');

    // Cada atribuição precisa ser erro de tipo (senão o @ts-expect-error reprova o typecheck)
    // e também falhar em execução, porque consumidores JavaScript não têm o tipo.
    expect(() => {
      // @ts-expect-error -- `revision` é somente leitura
      snapshot.revision = 1;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- `document` é somente leitura
      snapshot.document = createCanvasSection().getSnapshot().document;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- `id` é somente leitura
      snapshot.document.id = 'outro';
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- `nodes` não aceita chaves novas
      snapshot.document.nodes['novo'] = {};
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- `layers` é um array somente leitura
      snapshot.document.layers.push(layer);
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- `name` é somente leitura
      layer.name = 'outro';
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- `childIds` é um array somente leitura
      layer.childIds.push('novo');
    }).toThrow(TypeError);

    expect(snapshot).toEqual({
      document: {
        schemaVersion: 1,
        id: 'doc-1',
        nodes: {},
        layers: [{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false, childIds: [] }],
      },
      session: {
        selectedIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        activeTool: 'select',
        readOnly: false,
      },
      history: { canUndo: false, canRedo: false },
      revision: 0,
    });
  });
});
