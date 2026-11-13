import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import { boundsIntersect, shapeBounds, type Bounds } from './geometry/bounds.js';
import { shapeInsideRect, shapeIntersectsRect } from './geometry/intersect.js';
import { pointInShape } from './geometry/shapes.js';
import type { Point, RectangleInput, ShapeInput } from './shapes.js';

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

const BASE = 'id-2';

function newSection(): CanvasSectionApi {
  return createCanvasSection({ generateId: counter() });
}

function rect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
): RectangleInput {
  return { type: 'rectangle', id, x, y, width, height, rotation };
}

function create(shape: ShapeInput, layerId?: string): CanvasCommand {
  return { type: 'shape.create', shape, layerId };
}

// As consultas deste arquivo olham só o documento; o preview tem os próprios testes.
type Options<Method extends keyof CanvasSectionApi> = Omit<
  Parameters<Extract<CanvasSectionApi[Method], (...args: never[]) => unknown>>[1],
  'includePreview'
>;

function hitTestOf(
  section: CanvasSectionApi,
  point: Point,
  options: Options<'hitTest'> = {},
): string | undefined {
  return section.hitTest(point, { includePreview: false, ...options });
}

function hitTestAllOf(
  section: CanvasSectionApi,
  point: Point,
  options: Options<'hitTestAll'> = {},
): readonly string[] {
  return section.hitTestAll(point, { includePreview: false, ...options });
}

function queryBoundsOf(
  section: CanvasSectionApi,
  bounds: Bounds,
  options: Options<'queryBounds'> = {},
): readonly string[] {
  return section.queryBounds(bounds, { includePreview: false, ...options });
}

function queryMarqueeOf(
  section: CanvasSectionApi,
  rect: Bounds,
  options: Options<'queryMarquee'>,
): readonly string[] {
  return section.queryMarquee(rect, { includePreview: false, ...options });
}

function getBoundsOf(
  section: CanvasSectionApi,
  ids: readonly string[],
  options: Options<'getBounds'> = {},
): Bounds | undefined {
  return section.getBounds(ids, { includePreview: false, ...options });
}

/** Gerador determinístico de números em [0, 1). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** IDs do documento em ordem visual, do fundo para a frente. */
function visualOrder(section: CanvasSectionApi): string[] {
  return section.getSnapshot().document.layers.flatMap((layer) => layer.childIds);
}

describe('hitTest', () => {
  it('devolve o nó mais à frente sob o ponto, e hitTestAll todos, da frente para o fundo', () => {
    const section = newSection();
    section.transact([
      create(rect('fundo', 0, 0, 100, 100)),
      create(rect('meio', 20, 20, 100, 100)),
      { type: 'layer.create', layer: { id: 'top' } },
      create(rect('frente', 40, 40, 100, 100), 'top'),
      create(rect('longe', 500, 500, 10, 10), 'top'),
    ]);

    expect(hitTestOf(section, { x: 50, y: 50 })).toBe('frente');
    expect(hitTestAllOf(section, { x: 50, y: 50 })).toEqual(['frente', 'meio', 'fundo']);
    expect(hitTestAllOf(section, { x: 30, y: 30 })).toEqual(['meio', 'fundo']);
    expect(hitTestOf(section, { x: 10, y: 10 })).toBe('fundo');
  });

  it('devolve undefined e lista vazia quando nada está sob o ponto', () => {
    const section = newSection();
    section.dispatch(create(rect('a', 0, 0, 10, 10)));

    expect(hitTestOf(section, { x: 300, y: 300 })).toBeUndefined();
    expect(hitTestAllOf(section, { x: 300, y: 300 })).toEqual([]);
  });

  it('segue a ordem do documento depois de reordenar nós e camadas', () => {
    const section = newSection();
    section.transact([
      create(rect('a', 0, 0, 100, 100)),
      create(rect('b', 0, 0, 100, 100)),
      { type: 'layer.create', layer: { id: 'top' } },
      create(rect('c', 0, 0, 100, 100), 'top'),
    ]);
    const point = { x: 50, y: 50 };
    expect(hitTestAllOf(section, point)).toEqual(['c', 'b', 'a']);

    section.dispatch({ type: 'node.reorder', id: 'a', index: 1 });
    expect(hitTestAllOf(section, point)).toEqual(['c', 'a', 'b']);

    section.dispatch({ type: 'layer.reorder', id: 'top', index: 0 });
    expect(hitTestAllOf(section, point)).toEqual(['a', 'b', 'c']);

    section.dispatch({ type: 'node.reorder', id: 'b', index: 1, layerId: 'top' });
    expect(hitTestAllOf(section, point)).toEqual(['a', 'b', 'c']);
    expect(visualOrder(section)).toEqual(['c', 'b', 'a']);
  });

  it('respeita a rotação do shape', () => {
    const section = newSection();
    // Retângulo 200×20 centrado em (100, 100), girado um quarto de volta: fica em pé.
    section.dispatch(create(rect('pilar', 0, 90, 200, 20, Math.PI / 2)));

    expect(hitTestOf(section, { x: 100, y: 20 }, { tolerance: 0 })).toBe('pilar');
    expect(hitTestOf(section, { x: 100, y: 180 }, { tolerance: 0 })).toBe('pilar');
    expect(hitTestOf(section, { x: 20, y: 100 }, { tolerance: 0 })).toBeUndefined();
    expect(hitTestOf(section, { x: 180, y: 100 }, { tolerance: 0 })).toBeUndefined();
  });

  it('atinge o canto alargado pela tolerância de um retângulo girado', () => {
    const section = newSection();
    // Quadrado de lado 100 centrado na origem, girado 45°: o canto de cima fica em (0, -70,71).
    // Com folga de 6 nos eixos do quadrado, o canto alargado chega a (0, -79,19), mais longe
    // que a caixa do shape mais 6.
    section.dispatch(
      create({ ...rect('losango', -50, -50, 100, 100, Math.PI / 4), style: { stroke: null } }),
    );

    expect(hitTestOf(section, { x: 0, y: -78.5 })).toBe('losango');
    expect(hitTestOf(section, { x: 0, y: -80 })).toBeUndefined();
  });

  it('considera a largura do contorno', () => {
    const section = newSection();
    section.dispatch(create({ ...rect('a', 0, 0, 100, 100), style: { strokeWidth: 20 } }));

    expect(hitTestOf(section, { x: -9, y: 50 }, { tolerance: 0 })).toBe('a');
    expect(hitTestOf(section, { x: -11, y: 50 }, { tolerance: 0 })).toBeUndefined();
  });

  it('em forma sem preenchimento, só o contorno captura', () => {
    const section = newSection();
    section.transact([
      create({ ...rect('moldura', 0, 0, 100, 100), style: { fill: null, strokeWidth: 4 } }),
      create({
        type: 'ellipse',
        id: 'anel',
        x: 200,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: null, strokeWidth: 4 },
      }),
      create({ ...rect('nada', 400, 0, 100, 100), style: { fill: null, stroke: null } }),
    ]);

    expect(hitTestOf(section, { x: 50, y: 50 }, { tolerance: 0 })).toBeUndefined();
    expect(hitTestOf(section, { x: 1, y: 50 }, { tolerance: 0 })).toBe('moldura');
    expect(hitTestOf(section, { x: 250, y: 50 }, { tolerance: 0 })).toBeUndefined();
    expect(hitTestOf(section, { x: 201, y: 50 }, { tolerance: 0 })).toBe('anel');
    expect(hitTestOf(section, { x: 400, y: 0 })).toBeUndefined();
  });

  it('atinge a linha pela distância ao segmento', () => {
    const section = newSection();
    section.dispatch(
      create({
        type: 'line',
        id: 'l',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        style: { strokeWidth: 2 },
      }),
    );

    expect(hitTestOf(section, { x: 50, y: 50 }, { tolerance: 0 })).toBe('l');
    expect(hitTestOf(section, { x: 50, y: 56 })).toBe('l');
    expect(hitTestOf(section, { x: 50, y: 70 })).toBeUndefined();
  });

  it.each([
    [1, 5, 7],
    [2, 2.9, 3.5],
    [0.5, 11.5, 12.5],
    [16, 0.3, 0.45],
    [0.05, 110, 125],
  ])(
    'usa tolerância de 6 px de tela: com zoom %d, %d de distância atinge e %d não',
    (zoom, near, far) => {
      const section = newSection();
      section.dispatch(create({ ...rect('a', 0, 0, 1000, 1000), style: { stroke: null } }));
      section.setViewport({ x: 0, y: 0, zoom });

      expect(hitTestOf(section, { x: -near, y: 500 })).toBe('a');
      expect(hitTestOf(section, { x: -far, y: 500 })).toBeUndefined();
    },
  );

  it('aceita outra tolerância, em px de tela', () => {
    const section = newSection();
    section.dispatch(create({ ...rect('a', 0, 0, 100, 100), style: { stroke: null } }));
    section.setViewport({ x: 0, y: 0, zoom: 2 });

    expect(hitTestOf(section, { x: -9, y: 50 }, { tolerance: 20 })).toBe('a');
    expect(hitTestOf(section, { x: -11, y: 50 }, { tolerance: 20 })).toBeUndefined();
    expect(hitTestOf(section, { x: -0.1, y: 50 }, { tolerance: 0 })).toBeUndefined();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'trata a tolerância %d como a padrão',
    (tolerance) => {
      const section = newSection();
      section.dispatch(create({ ...rect('a', 0, 0, 100, 100), style: { stroke: null } }));

      expect(hitTestOf(section, { x: -5, y: 50 }, { tolerance })).toBe('a');
      expect(hitTestOf(section, { x: -7, y: 50 }, { tolerance })).toBeUndefined();
    },
  );

  it('com tolerância finita enorme atinge tudo, em qualquer zoom', () => {
    const section = newSection();
    section.transact([create(rect('a', 0, 0, 10, 10)), create(rect('b', 5e6, -5e6, 10, 10))]);

    for (const zoom of [1, 0.05, 16]) {
      section.setViewport({ x: 0, y: 0, zoom });
      for (const tolerance of [1e300, 1e307, Number.MAX_VALUE]) {
        expect(hitTestAllOf(section, { x: 5, y: 5 }, { tolerance })).toEqual(['b', 'a']);
      }
    }
  });

  it('atinge o canto do próprio retângulo quando as coordenadas não são exatas em binário', () => {
    const section = newSection();
    // 0,1 + 0,1 é exatamente 0,2, mas (0,1 + 0,05) + 0,05 não: a caixa não pode vir do centro.
    section.dispatch(create({ ...rect('s', 0.1, 0.1, 0.1, 33.3), style: { stroke: null } }));

    expect(hitTestAllOf(section, { x: 0.2, y: 0.1 }, { tolerance: 0 })).toEqual(['s']);
  });

  it('atinge no canto de um retângulo girado o ponto que a caixa dele, por arredondamento, deixa de fora', () => {
    const section = newSection();
    section.dispatch(
      create({ ...rect('girado', -166.2, 42.2, 93.6, 27.6, 0.5), style: { stroke: null } }),
    );
    const node = section.getSnapshot().document.nodes['girado'];
    if (node === undefined || node.type === 'group' || node.type === 'board')
      throw new Error('esperava o nó');
    // O vértice girado em torno do centro. A caixa, calculada pelo centro e pelas extensões,
    // termina dois bits antes dele.
    const corner = { x: -71.71306367079255, y: 66.32647585258957 };

    expect(pointInShape(node, corner, 0)).toBe(true);
    expect(boundsIntersect(shapeBounds(node), { ...corner, width: 0, height: 0 })).toBe(false);
    expect(hitTestAllOf(section, corner, { tolerance: 0 })).toEqual(['girado']);
  });

  it('em elipse girada sem preenchimento, decide certo o ponto sobre o eixo maior', () => {
    const section = newSection();
    // Elipse 200 × 40 girada um quarto de volta, com centro em (3, 4): o eixo maior é a reta
    // x = 3. O ponto (3, -16) está no miolo vazio, a 19,6 do contorno.
    section.dispatch(
      create({
        type: 'ellipse',
        id: 'e',
        x: -97,
        y: -16,
        width: 200,
        height: 40,
        rotation: Math.PI / 2,
        style: { fill: null, strokeWidth: 2 },
      }),
    );

    expect(hitTestOf(section, { x: 3.001, y: -16 })).toBeUndefined();
    expect(hitTestOf(section, { x: 3, y: -16 })).toBeUndefined();
    expect(hitTestOf(section, { x: 3.001, y: 14 }, { tolerance: 25 })).toBe('e');
    expect(hitTestOf(section, { x: 3, y: 14 }, { tolerance: 25 })).toBe('e');
    // O retângulo de seleção dentro do miolo, com um canto sobre o eixo, não toca o traço.
    expect(
      queryMarqueeOf(section, { x: 3, y: -16, width: 2, height: 2 }, { mode: 'intersect' }),
    ).toEqual([]);
  });

  it('não atinge nó oculto nem nó de camada oculta: o que está atrás aparece', () => {
    const section = newSection();
    section.transact([
      create(rect('atras', 0, 0, 100, 100)),
      create({ ...rect('oculto', 0, 0, 100, 100), visible: false }),
      { type: 'layer.create', layer: { id: 'escondida', visible: false } },
      create(rect('na-escondida', 0, 0, 100, 100), 'escondida'),
    ]);

    expect(hitTestAllOf(section, { x: 50, y: 50 })).toEqual(['atras']);
    expect(hitTestAllOf(section, { x: 50, y: 50 }, { includeLocked: true })).toEqual(['atras']);
  });

  it('só atinge nó bloqueado ou de camada bloqueada com a opção explícita', () => {
    const section = newSection();
    section.transact([
      create(rect('livre', 0, 0, 100, 100)),
      create({ ...rect('travado', 0, 0, 100, 100), locked: true }),
      { type: 'layer.create', layer: { id: 'travada' } },
      create(rect('na-travada', 0, 0, 100, 100), 'travada'),
      { type: 'layer.update', id: 'travada', patch: { locked: true } },
    ]);
    const point = { x: 50, y: 50 };

    expect(hitTestOf(section, point)).toBe('livre');
    expect(hitTestAllOf(section, point)).toEqual(['livre']);
    expect(hitTestAllOf(section, point, { includeLocked: false })).toEqual(['livre']);
    expect(hitTestOf(section, point, { includeLocked: true })).toBe('na-travada');
    expect(hitTestAllOf(section, point, { includeLocked: true })).toEqual([
      'na-travada',
      'travado',
      'livre',
    ]);
  });

  it('acompanha criação, alteração, remoção, undo e redo', () => {
    const section = newSection();
    const at = (x: number): string | undefined => hitTestOf(section, { x, y: 5 }, { tolerance: 0 });

    section.dispatch(create(rect('a', 0, 0, 10, 10)));
    expect([at(5), at(1005)]).toEqual(['a', undefined]);

    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 1000 } });
    expect([at(5), at(1005)]).toEqual([undefined, 'a']);

    section.undo();
    expect([at(5), at(1005)]).toEqual(['a', undefined]);

    section.redo();
    expect([at(5), at(1005)]).toEqual([undefined, 'a']);

    section.dispatch({ type: 'shape.remove', id: 'a' });
    expect([at(5), at(1005)]).toEqual([undefined, undefined]);

    section.undo();
    expect([at(5), at(1005)]).toEqual([undefined, 'a']);

    section.undo();
    section.undo();
    section.undo();
    expect([at(5), at(1005)]).toEqual([undefined, undefined]);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
  });

  it.each([
    [{ x: Number.NaN, y: 0 }],
    [{ x: 0, y: Number.POSITIVE_INFINITY }],
    [{ x: '5', y: 5 }],
    [null],
    [undefined],
  ])('não atinge nada com o ponto %j', (point) => {
    const section = newSection();
    section.dispatch(create(rect('a', -1000, -1000, 2000, 2000)));

    expect(hitTestOf(section, point as unknown as Point)).toBeUndefined();
    expect(hitTestAllOf(section, point as unknown as Point)).toEqual([]);
  });

  it('funciona destacado do canvas', () => {
    const { hitTest, hitTestAll, queryBounds, getBounds, dispatch } = newSection();
    dispatch(create(rect('a', 0, 0, 10, 10)));

    const options = { includePreview: false };

    expect(hitTest({ x: 5, y: 5 }, options)).toBe('a');
    expect(hitTestAll({ x: 5, y: 5 }, options)).toEqual(['a']);
    expect(queryBounds({ x: 0, y: 0, width: 1, height: 1 }, options)).toEqual(['a']);
    expect(getBounds(['a'], { ...options, stroke: false })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });
});

describe('queryBounds', () => {
  it('devolve, em ordem visual, os nós visíveis cuja caixa toca a consulta', () => {
    const section = newSection();
    section.transact([
      create(rect('a', 0, 0, 10, 10)),
      create(rect('b', 5, 5, 10, 10)),
      create(rect('longe', 1000, 1000, 10, 10)),
      { type: 'layer.create', layer: { id: 'top' } },
      create(rect('c', 8, 8, 10, 10), 'top'),
      create({ ...rect('travado', 9, 9, 1, 1), locked: true }, 'top'),
    ]);

    expect(queryBoundsOf(section, { x: 9, y: 9, width: 1, height: 1 })).toEqual([
      'a',
      'b',
      'c',
      'travado',
    ]);
    expect(queryBoundsOf(section, { x: -5, y: -5, width: 6, height: 6 })).toEqual(['a']);
    expect(queryBoundsOf(section, { x: 500, y: 500, width: 10, height: 10 })).toEqual([]);
    expect(queryBoundsOf(section, { x: -1e7, y: -1e7, width: 2e7, height: 2e7 })).toEqual([
      'a',
      'b',
      'longe',
      'c',
      'travado',
    ]);
  });

  it('usa a caixa com rotação e contorno', () => {
    const section = newSection();
    section.transact([
      // Quadrado de lado 100 centrado em (50, 50), girado 45°: a caixa vai de cerca de -20,7 a 120,7.
      create({ ...rect('losango', 0, 0, 100, 100, Math.PI / 4), style: { stroke: null } }),
      create({ ...rect('grosso', 300, 0, 100, 100), style: { strokeWidth: 40 } }),
    ]);

    expect(queryBoundsOf(section, { x: -20, y: 45, width: 1, height: 1 })).toEqual(['losango']);
    expect(queryBoundsOf(section, { x: -25, y: 45, width: 1, height: 1 })).toEqual([]);
    expect(queryBoundsOf(section, { x: 281, y: 50, width: 1, height: 1 })).toEqual(['grosso']);
    expect(queryBoundsOf(section, { x: 270, y: 50, width: 1, height: 1 })).toEqual([]);
  });

  it('deixa de fora o que está oculto, salvo com a opção explícita', () => {
    const section = newSection();
    section.transact([
      create(rect('visivel', 0, 0, 10, 10)),
      create({ ...rect('oculto', 0, 0, 10, 10), visible: false }),
      { type: 'layer.create', layer: { id: 'escondida', visible: false } },
      create(rect('na-escondida', 0, 0, 10, 10), 'escondida'),
    ]);
    const query = { x: 0, y: 0, width: 5, height: 5 };

    expect(queryBoundsOf(section, query)).toEqual(['visivel']);
    expect(queryBoundsOf(section, query, { includeHidden: false })).toEqual(['visivel']);
    expect(queryBoundsOf(section, query, { includeHidden: true })).toEqual([
      'visivel',
      'oculto',
      'na-escondida',
    ]);
  });

  it('acompanha undo e redo', () => {
    const section = newSection();
    const query = { x: 0, y: 0, width: 5, height: 5 };
    section.dispatch(create(rect('a', 0, 0, 10, 10)));

    section.undo();
    expect(queryBoundsOf(section, query)).toEqual([]);
    section.redo();
    expect(queryBoundsOf(section, query)).toEqual(['a']);
  });

  it.each([
    [{ x: 0, y: 0, width: -1, height: 5 }],
    [{ x: 0, y: 0, width: 5, height: Number.NaN }],
    [{ x: Number.NEGATIVE_INFINITY, y: 0, width: 5, height: 5 }],
    [{ x: 0, y: 0 }],
    [null],
  ])('devolve lista vazia para a consulta inválida %j', (bounds) => {
    const section = newSection();
    section.dispatch(create(rect('a', 0, 0, 10, 10)));

    expect(queryBoundsOf(section, bounds as unknown as Bounds)).toEqual([]);
  });

  it.each([
    ['largura negativa', -1, 3],
    ['altura negativa', 3, -1],
    ['largura infinita', Number.POSITIVE_INFINITY, 3],
    ['altura infinita', 3, Number.POSITIVE_INFINITY],
  ])(
    'devolve lista vazia para %s, mesmo com o canto da caixa em cima de um nó',
    (_l, width, height) => {
      // A caixa parte de dentro do nó: sem a conferência, o índice o devolveria.
      const section = newSection();
      section.dispatch(create(rect('a', 0, 0, 10, 10)));

      expect(queryBoundsOf(section, { x: 5, y: 5, width, height })).toEqual([]);
      expect(queryMarqueeOf(section, { x: 5, y: 5, width, height }, { mode: 'intersect' })).toEqual(
        [],
      );
      expect(queryBoundsOf(section, { x: 5, y: 5, width: 3, height: 3 })).toEqual(['a']);
    },
  );

  it.each([[{ x: 5, y: '5' }], [{ x: '5', y: 5 }], [{ x: 5 }], [{ x: 5, y: Number.NaN }]])(
    'o hit-test devolve lista vazia para o ponto inválido %j',
    (point) => {
      const section = newSection();
      section.dispatch(create(rect('a', 0, 0, 10, 10)));

      expect(hitTestAllOf(section, point as unknown as Point)).toEqual([]);
      expect(hitTestAllOf(section, { x: 5, y: 5 })).toEqual(['a']);
    },
  );
});

describe('queryMarquee', () => {
  const contain = { mode: 'contain' } as const;
  const intersect = { mode: 'intersect' } as const;

  it('no modo contain devolve só o que cabe inteiro; no intersect, tudo o que o retângulo toca', () => {
    const section = newSection();
    section.transact([
      create({ ...rect('dentro', 10, 10, 20, 20), style: { stroke: null } }),
      create({ ...rect('cruzando', 80, 10, 40, 20), style: { stroke: null } }),
      create({ ...rect('fora', 200, 200, 20, 20), style: { stroke: null } }),
    ]);
    const marquee = { x: 0, y: 0, width: 100, height: 100 };

    expect(queryMarqueeOf(section, marquee, contain)).toEqual(['dentro']);
    expect(queryMarqueeOf(section, marquee, intersect)).toEqual(['dentro', 'cruzando']);
  });

  it('não devolve a forma girada cuja caixa toca o retângulo sem que ela toque (CORE-06)', () => {
    const section = newSection();
    section.transact([
      // Quadrado de lado 100 centrado em (50, 50), girado 45°: um losango com pontas em
      // (-20,7, 50), (50, -20,7), (120,7, 50) e (50, 120,7). A caixa dele cobre os cantos vazios.
      create({ ...rect('losango', 0, 0, 100, 100, Math.PI / 4), style: { stroke: null } }),
      create({
        type: 'ellipse',
        id: 'oval',
        x: 300,
        y: 0,
        width: 200,
        height: 20,
        rotation: Math.PI / 4,
        style: { stroke: null },
      }),
      create({
        type: 'line',
        id: 'diagonal',
        start: { x: 600, y: 0 },
        end: { x: 700, y: 100 },
        style: { strokeWidth: 2 },
      }),
    ]);
    const emptyCorner = { x: -20, y: -20, width: 25, height: 25 };
    const ovalCorner = { x: 330, y: 60, width: 20, height: 20 };
    const lineCorner = { x: 660, y: 5, width: 30, height: 30 };

    expect(queryBoundsOf(section, emptyCorner)).toEqual(['losango']);
    expect(queryMarqueeOf(section, emptyCorner, intersect)).toEqual([]);
    expect(queryBoundsOf(section, ovalCorner)).toEqual(['oval']);
    expect(queryMarqueeOf(section, ovalCorner, intersect)).toEqual([]);
    expect(queryBoundsOf(section, lineCorner)).toEqual(['diagonal']);
    expect(queryMarqueeOf(section, lineCorner, intersect)).toEqual([]);

    expect(queryMarqueeOf(section, { x: -20, y: -20, width: 45, height: 45 }, intersect)).toEqual([
      'losango',
    ]);
    expect(queryMarqueeOf(section, { x: 390, y: 0, width: 20, height: 20 }, intersect)).toEqual([
      'oval',
    ]);
    expect(queryMarqueeOf(section, { x: 640, y: 40, width: 20, height: 20 }, intersect)).toEqual([
      'diagonal',
    ]);
  });

  it('no modo contain exige que o contorno e a forma girada caibam', () => {
    const section = newSection();
    section.transact([
      create({ ...rect('fino', 10, 10, 80, 80), style: { strokeWidth: 2 } }),
      create({ ...rect('grosso', 210, 10, 80, 80), style: { strokeWidth: 30 } }),
      create({ ...rect('girado', 410, 10, 80, 80, Math.PI / 4), style: { stroke: null } }),
    ]);

    expect(queryMarqueeOf(section, { x: 0, y: 0, width: 100, height: 100 }, contain)).toEqual([
      'fino',
    ]);
    expect(queryMarqueeOf(section, { x: 200, y: 0, width: 100, height: 100 }, contain)).toEqual([]);
    expect(queryMarqueeOf(section, { x: 190, y: -10, width: 120, height: 120 }, contain)).toEqual([
      'grosso',
    ]);
    expect(queryMarqueeOf(section, { x: 400, y: 0, width: 100, height: 100 }, contain)).toEqual([]);
    expect(queryMarqueeOf(section, { x: 390, y: -10, width: 120, height: 120 }, contain)).toEqual([
      'girado',
    ]);
  });

  it('forma sem preenchimento só é tocada no contorno, mas é contida inteira', () => {
    const section = newSection();
    section.dispatch(
      create({ ...rect('moldura', 0, 0, 100, 100), style: { fill: null, strokeWidth: 4 } }),
    );

    expect(queryMarqueeOf(section, { x: 40, y: 40, width: 20, height: 20 }, intersect)).toEqual([]);
    expect(queryMarqueeOf(section, { x: -10, y: 40, width: 20, height: 20 }, intersect)).toEqual([
      'moldura',
    ]);
    expect(queryMarqueeOf(section, { x: -10, y: -10, width: 120, height: 120 }, contain)).toEqual([
      'moldura',
    ]);
  });

  it('no modo contain, contém o shape cuja caixa coincide com o retângulo, com qualquer coordenada', () => {
    const section = newSection();
    section.transact([
      create({ ...rect('s', 0.1, 0.1, 0.1, 1.1), style: { stroke: null } }),
      create({ type: 'ellipse', id: 'e', x: 7.3, y: 0.7, width: 0.3, height: 2.9, rotation: 0 }),
      create(rect('girado', 40.1, 0.3, 3.3, 1.7, 0.7)),
    ]);
    const boxOf = (id: string): Bounds => {
      const box = getBoundsOf(section, [id]);
      if (box === undefined) throw new Error('esperava a caixa');
      return box;
    };

    expect(
      queryMarqueeOf(section, { x: 0.1, y: 0.1, width: 0.1, height: 1.1 }, { mode: 'contain' }),
    ).toEqual(['s']);
    expect(queryMarqueeOf(section, boxOf('e'), { mode: 'contain' })).toEqual(['e']);
    expect(queryMarqueeOf(section, boxOf('girado'), { mode: 'contain' })).toEqual(['girado']);
  });

  it('aceita retângulo sem largura ou sem altura: é o marquee no instante em que começa', () => {
    const section = newSection();
    section.dispatch(create({ ...rect('a', 0, 0, 10, 10), style: { stroke: null } }));

    for (const marquee of [
      { x: 5, y: -20, width: 0, height: 40 },
      { x: -20, y: 5, width: 40, height: 0 },
      { x: 5, y: 5, width: 0, height: 0 },
    ]) {
      expect(queryBoundsOf(section, marquee)).toEqual(['a']);
      expect(queryMarqueeOf(section, marquee, { mode: 'intersect' })).toEqual(['a']);
      expect(queryMarqueeOf(section, marquee, { mode: 'contain' })).toEqual([]);
    }
  });

  it('devolve a linha válida de comprimento ínfimo, como o hit-test e o queryBounds', () => {
    const section = newSection();
    section.dispatch(
      create({
        type: 'line',
        id: 'curta',
        start: { x: 0, y: 0 },
        end: { x: 1e-200, y: 0 },
        style: { strokeWidth: 4 },
      }),
    );
    const around = { x: -10, y: -10, width: 20, height: 20 };

    expect(queryBoundsOf(section, around)).toEqual(['curta']);
    expect(hitTestOf(section, { x: 0, y: 0 })).toBe('curta');
    expect(queryMarqueeOf(section, around, { mode: 'contain' })).toEqual(['curta']);
    expect(queryMarqueeOf(section, around, { mode: 'intersect' })).toEqual(['curta']);
  });

  it('devolve em ordem visual, do fundo para a frente', () => {
    const section = newSection();
    section.transact([
      create(rect('a', 0, 0, 10, 10)),
      { type: 'layer.create', layer: { id: 'top' } },
      create(rect('c', 0, 0, 10, 10), 'top'),
      create(rect('b', 0, 0, 10, 10), BASE),
    ]);

    expect(queryMarqueeOf(section, { x: -5, y: -5, width: 30, height: 30 }, contain)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('respeita visibilidade e bloqueio como o hit-test', () => {
    const section = newSection();
    section.transact([
      create(rect('livre', 0, 0, 10, 10)),
      create({ ...rect('oculto', 0, 0, 10, 10), visible: false }),
      create({ ...rect('travado', 0, 0, 10, 10), locked: true }),
      { type: 'layer.create', layer: { id: 'escondida', visible: false } },
      create(rect('na-escondida', 0, 0, 10, 10), 'escondida'),
      { type: 'layer.create', layer: { id: 'travada' } },
      create(rect('na-travada', 0, 0, 10, 10), 'travada'),
      { type: 'layer.update', id: 'travada', patch: { locked: true } },
    ]);
    const marquee = { x: -5, y: -5, width: 30, height: 30 };

    for (const mode of ['contain', 'intersect'] as const) {
      expect(queryMarqueeOf(section, marquee, { mode })).toEqual(['livre']);
      expect(queryMarqueeOf(section, marquee, { mode, includeLocked: true })).toEqual([
        'livre',
        'travado',
        'na-travada',
      ]);
    }
  });

  it('trabalha em coordenadas de mundo: o zoom não muda o resultado', () => {
    const section = newSection();
    section.transact([
      create({ ...rect('a', 0, 0, 10, 10), style: { stroke: null } }),
      create({ ...rect('b', 10.5, 0, 10, 10), style: { stroke: null } }),
    ]);
    const marquee = { x: 0, y: 0, width: 10, height: 10 };

    for (const zoom of [0.05, 1, 16]) {
      section.setViewport({ x: 123, y: -45, zoom });

      expect(queryMarqueeOf(section, marquee, contain)).toEqual(['a']);
      expect(queryMarqueeOf(section, marquee, intersect)).toEqual(['a']);
    }
  });

  it('acompanha alteração, undo e redo', () => {
    const section = newSection();
    const marquee = { x: 0, y: 0, width: 50, height: 50 };
    section.dispatch(create(rect('a', 10, 10, 10, 10)));

    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 500 } });
    expect(queryMarqueeOf(section, marquee, intersect)).toEqual([]);
    section.undo();
    expect(queryMarqueeOf(section, marquee, intersect)).toEqual(['a']);
    section.redo();
    expect(queryMarqueeOf(section, marquee, intersect)).toEqual([]);
  });

  it.each([
    ['retângulo com largura negativa', { x: 0, y: 0, width: -1, height: 5 }, { mode: 'contain' }],
    ['retângulo não finito', { x: Number.NaN, y: 0, width: 5, height: 5 }, { mode: 'contain' }],
    ['retângulo nulo', null, { mode: 'intersect' }],
    ['modo desconhecido', { x: -5, y: -5, width: 30, height: 30 }, { mode: 'touch' }],
    ['modo ausente', { x: -5, y: -5, width: 30, height: 30 }, {}],
    ['opções ausentes', { x: -5, y: -5, width: 30, height: 30 }, undefined],
  ])('devolve lista vazia com %s', (_label, marquee, options) => {
    const section = newSection();
    section.dispatch(create(rect('a', 0, 0, 10, 10)));

    const query = section.queryMarquee as (rect: unknown, options: unknown) => readonly string[];

    expect(query(marquee, options)).toEqual([]);
  });

  it('funciona destacado do canvas', () => {
    const { queryMarquee: detached, dispatch } = newSection();
    dispatch(create(rect('a', 0, 0, 10, 10)));

    expect(
      detached({ x: -5, y: -5, width: 30, height: 30 }, { ...contain, includePreview: false }),
    ).toEqual(['a']);
  });
});

describe('getBounds', () => {
  it('devolve a caixa que cobre os nós dados, com o contorno por padrão', () => {
    const section = newSection();
    section.transact([
      create({ ...rect('a', 0, 0, 10, 10), style: { strokeWidth: 2 } }),
      create({ ...rect('b', 100, 50, 20, 20), style: { strokeWidth: 4 } }),
    ]);

    expect(getBoundsOf(section, ['a'])).toEqual({ x: -1, y: -1, width: 12, height: 12 });
    expect(getBoundsOf(section, ['a', 'b'])).toEqual({ x: -1, y: -1, width: 123, height: 73 });
    expect(getBoundsOf(section, ['a', 'b'], { stroke: false })).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 70,
    });
  });

  it('sem traço e sem rotação, devolve a própria caixa do shape, sem erro de arredondamento', () => {
    const section = newSection();
    const own = { x: 0.1, y: 0.1, width: 0.1, height: 33.3 };
    section.transact([
      create({ ...rect('r', own.x, own.y, own.width, own.height), style: { strokeWidth: 0.7 } }),
      create({ type: 'ellipse', id: 'e', ...own, rotation: 0 }),
    ]);

    expect(getBoundsOf(section, ['r'], { stroke: false })).toEqual(own);
    expect(getBoundsOf(section, ['e'], { stroke: false })).toEqual(own);
    expect(getBoundsOf(section, ['r'])).toEqual({
      x: own.x - 0.35,
      y: own.y - 0.35,
      width: own.width + 0.7,
      height: own.height + 0.7,
    });
  });

  it('ignora IDs que não são de nós e devolve undefined quando não sobra nenhum', () => {
    const section = newSection();
    section.dispatch(create({ ...rect('a', 0, 0, 10, 10), style: { stroke: null } }));

    expect(getBoundsOf(section, ['sumido', 'a', BASE])).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(getBoundsOf(section, ['sumido'])).toBeUndefined();
    expect(getBoundsOf(section, [])).toBeUndefined();
    expect(getBoundsOf(section, 'a' as unknown as string[])).toBeUndefined();
  });
});

describe('consultas chamadas sem as opções', () => {
  it('olham só o documento e usam os padrões', () => {
    const section = newSection();
    section.dispatch(create({ ...rect('a', 0, 0, 10, 10), style: { strokeWidth: 2 } }));
    const untyped = section as unknown as Record<string, (...args: unknown[]) => unknown>;

    expect(untyped['hitTest']?.({ x: 5, y: 5 })).toBe('a');
    expect(untyped['hitTestAll']?.({ x: 5, y: 5 }, null)).toEqual(['a']);
    expect(untyped['queryBounds']?.({ x: 0, y: 0, width: 1, height: 1 })).toEqual(['a']);
    expect(untyped['getBounds']?.(['a'])).toEqual({ x: -1, y: -1, width: 12, height: 12 });
  });
});

describe('consultas contra a varredura completa', () => {
  it('dão o mesmo resultado que testar todos os nós, em cenas geradas', () => {
    const random = lcg(4242);
    const section = newSection();
    const commands: CanvasCommand[] = [
      { type: 'layer.create', layer: { id: 'l2' } },
      { type: 'layer.create', layer: { id: 'l3' } },
    ];
    const layers = [BASE, 'l2', 'l3'];
    for (let i = 0; i < 400; i++) {
      const layerId = layers[i % 3];
      const x = (random() - 0.5) * 4000;
      const y = (random() - 0.5) * 4000;
      const size = 5 + random() * 600;
      const flags = { visible: random() > 0.15, locked: random() > 0.85 };
      const style = { fill: random() > 0.3 ? '#336699' : null, strokeWidth: random() * 30 };
      const kind = i % 3;
      commands.push(
        kind === 2
          ? create(
              {
                type: 'line',
                id: `n${i}`,
                start: { x, y },
                end: { x: x + size, y: y - size * random() },
                ...flags,
                style: { strokeWidth: style.strokeWidth },
              },
              layerId,
            )
          : create(
              {
                type: kind === 0 ? 'rectangle' : 'ellipse',
                id: `n${i}`,
                x,
                y,
                width: size,
                height: 5 + size * random(),
                rotation: random() * 6 - 3,
                ...flags,
                style,
              },
              layerId,
            ),
      );
    }
    commands.push({ type: 'layer.update', id: 'l3', patch: { locked: true } });
    expect(section.transact(commands).ok).toBe(true);
    // Mexe na cena depois de indexada: move, remove e desfaz.
    for (let i = 0; i < 60; i++) {
      const id = `n${Math.floor(random() * 400)}`;
      const node = section.getSnapshot().document.nodes[id];
      if (node === undefined || section.getNodeInfo(id)?.locked) continue;
      if (i % 4 === 0) section.dispatch({ type: 'shape.remove', id });
      else if (node.type !== 'line')
        section.dispatch({ type: 'shape.update', id, patch: { x: (random() - 0.5) * 4000 } });
      if (i % 9 === 0) section.undo();
    }

    for (const zoom of [0.05, 1, 16]) {
      section.setViewport({ x: 0, y: 0, zoom });
      const { document } = section.getSnapshot();
      const order = visualOrder(section);
      for (let q = 0; q < 150; q++) {
        const point = { x: (random() - 0.5) * 4400, y: (random() - 0.5) * 4400 };
        const includeLocked = q % 2 === 0;
        const expected = order
          .filter((id) => {
            const node = document.nodes[id];
            const info = section.getNodeInfo(id);
            if (
              node === undefined ||
              node.type === 'group' ||
              node.type === 'board' ||
              info === undefined ||
              !info.visible
            )
              return false;
            if (info.locked && !includeLocked) return false;
            return pointInShape(node, point, 6 / zoom);
          })
          .reverse();

        expect(hitTestAllOf(section, point, { includeLocked })).toEqual(expected);
        expect(hitTestOf(section, point, { includeLocked })).toBe(expected[0]);

        const size = 10 ** (random() * 3.5);
        const query = { x: point.x, y: point.y, width: size, height: size * random() };
        const includeHidden = q % 3 === 0;
        const inBounds = order.filter((id) => {
          const node = document.nodes[id];
          if (node === undefined || node.type === 'group' || node.type === 'board') return false;
          if (!includeHidden && !section.getNodeInfo(id)?.visible) return false;
          return boundsIntersect(shapeBounds(node), query);
        });

        expect(queryBoundsOf(section, query, { includeHidden })).toEqual(inBounds);

        for (const [mode, matches] of [
          ['contain', shapeInsideRect],
          ['intersect', shapeIntersectsRect],
        ] as const) {
          const selected = order.filter((id) => {
            const node = document.nodes[id];
            const info = section.getNodeInfo(id);
            if (
              node === undefined ||
              node.type === 'group' ||
              node.type === 'board' ||
              info === undefined ||
              !info.visible
            )
              return false;
            if (info.locked && !includeLocked) return false;
            return matches(node, query);
          });

          expect(queryMarqueeOf(section, query, { mode, includeLocked })).toEqual(selected);
        }
      }
    }
    // Milhares de consultas, cada uma conferida contra todos os nós.
  }, 30_000);
});

describe('índice espacial', () => {
  it('não aparece na API: o canvas só tem os métodos documentados e o snapshot só dados', () => {
    const section = newSection();
    section.dispatch(create(rect('a', 0, 0, 10, 10)));
    hitTestOf(section, { x: 5, y: 5 });

    expect(Object.keys(section).sort()).toEqual(
      [
        'destroy',
        'dispatch',
        'getBounds',
        'getNodeInfo',
        'getPeerLock',
        'getPeers',
        'getPreview',
        'getSnapshot',
        'hitTest',
        'hitTestAll',
        'queryBounds',
        'queryMarquee',
        'redo',
        'replaceDocument',
        'setPeers',
        'setPreview',
        'setReadOnly',
        'setSelection',
        'setTool',
        'setViewport',
        'subscribe',
        'transact',
        'undo',
      ].sort(),
    );
    expect(Object.values(section).every((value) => typeof value === 'function')).toBe(true);
    expect(Object.keys(section.getSnapshot()).sort()).toEqual([
      'document',
      'history',
      'revision',
      'session',
    ]);
    expect(JSON.parse(JSON.stringify(section.getSnapshot()))).toEqual(section.getSnapshot());
  });
});

describe('Losango (diamond) — hit-test e marquee pelo contorno (Tarefa 101)', () => {
  it('atinge o centro e as arestas, mas não atinge os cantos vazios da caixa (com e sem preenchimento, com e sem rotação)', () => {
    const section = newSection();
    // Losango preenchido em (0, 0) 100x100: vértices (50, 0), (100, 50), (50, 100), (0, 50)
    section.dispatch(
      create({
        type: 'diamond',
        id: 'dm-filled',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: '#ffaa00', stroke: '#000000', strokeWidth: 2, opacity: 1 },
      }),
    );

    // Centro e vértices atingem
    expect(hitTestOf(section, { x: 50, y: 50 }, { tolerance: 0 })).toBe('dm-filled');
    expect(hitTestOf(section, { x: 50, y: 0 }, { tolerance: 0 })).toBe('dm-filled');
    // Canto vazio da caixa (5, 5): x + y = 10 < 50 -> fora do losango
    expect(hitTestOf(section, { x: 5, y: 5 }, { tolerance: 0 })).toBeUndefined();
    expect(hitTestOf(section, { x: 95, y: 95 }, { tolerance: 0 })).toBeUndefined();

    // Marquee no canto vazio não seleciona no modo intersect
    expect(
      queryMarqueeOf(section, { x: 0, y: 0, width: 15, height: 15 }, { mode: 'intersect' }),
    ).toEqual([]);
    // Marquee cruzando uma aresta seleciona no modo intersect
    expect(
      queryMarqueeOf(section, { x: 20, y: 20, width: 20, height: 20 }, { mode: 'intersect' }),
    ).toEqual(['dm-filled']);

    // Losango sem preenchimento (hollow)
    section.dispatch(
      create({
        type: 'diamond',
        id: 'dm-hollow',
        x: 200,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        style: { fill: null, stroke: '#000000', strokeWidth: 4, opacity: 1 },
      }),
    );
    // Centro vazio não atinge
    expect(hitTestOf(section, { x: 250, y: 50 }, { tolerance: 0 })).toBeUndefined();
    // Sobre a aresta (225, 25) atinge
    expect(hitTestOf(section, { x: 225, y: 25 }, { tolerance: 0 })).toBe('dm-hollow');
    // Marquee inteiro no miolo vazio não seleciona
    expect(
      queryMarqueeOf(section, { x: 245, y: 45, width: 10, height: 10 }, { mode: 'intersect' }),
    ).toEqual([]);
    // Marquee tocando o vértice/aresta seleciona
    expect(
      queryMarqueeOf(section, { x: 248, y: -2, width: 4, height: 4 }, { mode: 'intersect' }),
    ).toEqual(['dm-hollow']);

    // Losango rotacionado (Math.PI / 6)
    section.dispatch(
      create({
        type: 'diamond',
        id: 'dm-rot',
        x: 400,
        y: 0,
        width: 100,
        height: 100,
        rotation: Math.PI / 6,
        style: { fill: '#00aaff', stroke: '#000000', strokeWidth: 2, opacity: 1 },
      }),
    );
    expect(hitTestOf(section, { x: 450, y: 50 }, { tolerance: 0 })).toBe('dm-rot');
    expect(hitTestOf(section, { x: 402, y: 2 }, { tolerance: 0 })).toBeUndefined();
    const boundsRot = getBoundsOf(section, ['dm-rot']);
    expect(boundsRot).toBeDefined();
    expect(queryMarqueeOf(section, boundsRot!, { mode: 'contain' })).toEqual(['dm-rot']);
  });
});

describe('hitTest com o texto da forma (US-SL.11)', () => {
  const NONE = { fill: null, stroke: null, strokeWidth: 0, opacity: 1 } as const;
  const LABEL = { text: 'Olá' };
  const hollow = (
    type: 'ellipse' | 'rectangle',
    id: string,
    label?: { text: string },
  ): RectangleInput =>
    ({
      type,
      id,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      style: NONE,
      ...(label ? { label } : {}),
    }) as RectangleInput;
  const MIDDLE = { x: 100, y: 50 };

  it('sem preenchimento, o texto torna a forma clicável, e sem texto o ponto não a atinge', () => {
    const section = newSection();
    section.dispatch(create(hollow('ellipse', 'com', LABEL)));
    section.dispatch(create({ ...hollow('rectangle', 'sem'), x: 400 }));
    section.dispatch(create({ ...hollow('rectangle', 'com-rect', LABEL), x: 800 }));

    expect(hitTestOf(section, MIDDLE)).toBe('com');
    expect(hitTestOf(section, { x: 500, y: 50 })).toBeUndefined();
    expect(hitTestOf(section, { x: 900, y: 50 })).toBe('com-rect');
  });

  it('labelAreas: true atinge a forma elegível sem texto, em hitTest e hitTestAll', () => {
    const section = newSection();
    section.dispatch(create(hollow('rectangle', 'vazia')));

    expect(hitTestOf(section, MIDDLE)).toBeUndefined();
    expect(hitTestOf(section, MIDDLE, { labelAreas: true })).toBe('vazia');
    expect(hitTestAllOf(section, MIDDLE)).toEqual([]);
    expect(hitTestAllOf(section, MIDDLE, { labelAreas: true })).toEqual(['vazia']);
  });

  it('com a forma girada em 30°, a opção também vale', () => {
    const section = newSection();
    section.dispatch(create({ ...hollow('rectangle', 'girada'), rotation: Math.PI / 6 }));

    expect(hitTestOf(section, MIDDLE, { labelAreas: true })).toBe('girada');
    expect(hitTestOf(section, MIDDLE)).toBeUndefined();
  });

  it('a marquee não muda com o texto', () => {
    const marquee = { x: 90, y: 40, width: 20, height: 20 };
    const withText = newSection();
    withText.dispatch(create(hollow('rectangle', 'a', LABEL)));
    const without = newSection();
    without.dispatch(create(hollow('rectangle', 'a')));
    const options = { mode: 'intersect', includePreview: false } as const;

    expect(withText.queryMarquee(marquee, options)).toEqual(without.queryMarquee(marquee, options));
    expect(withText.queryMarquee(marquee, { ...options, mode: 'contain' })).toEqual(
      without.queryMarquee(marquee, { ...options, mode: 'contain' }),
    );
  });
});
