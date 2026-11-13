import type { CanvasDocument, CanvasSnapshot, ShapeNode } from '@canvash/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CandidateIdFilter,
  ProjectSceneOptions,
  ProjectedScene,
  RenderableArrow,
  RenderableBezier,
  RenderableBoard,
  RenderableCircle,
  RenderableDiamond,
  RenderableEllipse,
  RenderableInk,
  RenderableItem,
  RenderableLine,
  RenderableBrace,
  RenderableChevron,
  RenderableCross,
  RenderablePolygon,
  RenderableRectangle,
  RenderableSquare,
  RenderableSticky,
  RenderableStyle,
  RenderableText,
  RenderableTriangle,
} from './index.js';
import { projectScene } from './index.js';

type IsAny<T> = 0 extends 1 & T ? true : false;
type HasAny<T, Depth extends unknown[] = []> = Depth['length'] extends 8
  ? false
  : IsAny<T> extends true
    ? true
    : T extends (...args: infer Args) => infer Return
      ? HasAny<Args, [...Depth, 0]> extends true
        ? true
        : HasAny<Return, [...Depth, 0]>
      : T extends object
        ? true extends { [Key in keyof T]: HasAny<T[Key], [...Depth, 0]> }[keyof T]
          ? true
          : false
        : false;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

describe('contrato de tipos da projeção de cena', () => {
  it('nenhum tipo da API contém any', () => {
    expectTypeOf<HasAny<ProjectedScene>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<RenderableItem>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<RenderableStyle>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<CandidateIdFilter>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<ProjectSceneOptions>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<typeof projectScene>>().toEqualTypeOf<false>();
  });

  it('todos os tipos são profundamente somente leitura', () => {
    expectTypeOf<ProjectedScene>().toEqualTypeOf<DeepReadonly<ProjectedScene>>();
    expectTypeOf<RenderableItem>().toEqualTypeOf<DeepReadonly<RenderableItem>>();
    expectTypeOf<RenderableRectangle>().toEqualTypeOf<DeepReadonly<RenderableRectangle>>();
    expectTypeOf<RenderableSquare>().toEqualTypeOf<DeepReadonly<RenderableSquare>>();
    expectTypeOf<RenderableEllipse>().toEqualTypeOf<DeepReadonly<RenderableEllipse>>();
    expectTypeOf<RenderableCircle>().toEqualTypeOf<DeepReadonly<RenderableCircle>>();
    expectTypeOf<RenderableDiamond>().toEqualTypeOf<DeepReadonly<RenderableDiamond>>();
    expectTypeOf<RenderableTriangle>().toEqualTypeOf<DeepReadonly<RenderableTriangle>>();
    expectTypeOf<RenderablePolygon>().toEqualTypeOf<DeepReadonly<RenderablePolygon>>();
    expectTypeOf<RenderableCross>().toEqualTypeOf<DeepReadonly<RenderableCross>>();
    expectTypeOf<RenderableChevron>().toEqualTypeOf<DeepReadonly<RenderableChevron>>();
    expectTypeOf<RenderableBrace>().toEqualTypeOf<DeepReadonly<RenderableBrace>>();
    expectTypeOf<RenderableSticky>().toEqualTypeOf<DeepReadonly<RenderableSticky>>();
    expectTypeOf<RenderableInk>().toEqualTypeOf<DeepReadonly<RenderableInk>>();
    expectTypeOf<RenderableLine>().toEqualTypeOf<DeepReadonly<RenderableLine>>();
    expectTypeOf<RenderableBezier>().toEqualTypeOf<DeepReadonly<RenderableBezier>>();
    expectTypeOf<RenderableText>().toEqualTypeOf<DeepReadonly<RenderableText>>();
    expectTypeOf<RenderableArrow>().toEqualTypeOf<DeepReadonly<RenderableArrow>>();
    expectTypeOf<RenderableStyle>().toEqualTypeOf<DeepReadonly<RenderableStyle>>();
  });

  it('RenderableItem estreita por type', () => {
    const check = (item: RenderableItem): string => {
      switch (item.type) {
        case 'rectangle':
          expectTypeOf(item).toEqualTypeOf<RenderableRectangle>();
          return item.id;
        case 'square':
          expectTypeOf(item).toEqualTypeOf<RenderableSquare>();
          return item.id;
        case 'ellipse':
          expectTypeOf(item).toEqualTypeOf<RenderableEllipse>();
          return item.id;
        case 'circle':
          expectTypeOf(item).toEqualTypeOf<RenderableCircle>();
          return item.id;
        case 'diamond':
          expectTypeOf(item).toEqualTypeOf<RenderableDiamond>();
          return item.id;
        case 'triangle':
          expectTypeOf(item).toEqualTypeOf<RenderableTriangle>();
          return item.id;
        case 'polygon':
          expectTypeOf(item).toEqualTypeOf<RenderablePolygon>();
          return item.id;
        case 'cross':
          expectTypeOf(item).toEqualTypeOf<RenderableCross>();
          return item.id;
        case 'chevron':
          expectTypeOf(item).toEqualTypeOf<RenderableChevron>();
          return item.id;
        case 'brace':
          expectTypeOf(item).toEqualTypeOf<RenderableBrace>();
          return item.id;
        case 'sticky':
          expectTypeOf(item).toEqualTypeOf<RenderableSticky>();
          return item.id;
        case 'ink':
          expectTypeOf(item).toEqualTypeOf<RenderableInk>();
          return item.id;
        case 'line':
          expectTypeOf(item).toEqualTypeOf<RenderableLine>();
          return item.id;
        case 'bezier':
          expectTypeOf(item).toEqualTypeOf<RenderableBezier>();
          return item.id;
        case 'text':
          expectTypeOf(item).toEqualTypeOf<RenderableText>();
          return item.id;
        case 'arrow':
          expectTypeOf(item).toEqualTypeOf<RenderableArrow>();
          return item.id;
        case 'board':
          expectTypeOf(item).toEqualTypeOf<RenderableBoard>();
          return item.id;
      }
    };

    expectTypeOf(check).toBeFunction();
  });
});

describe('ordenação e visibilidade de cena (RENDER-01)', () => {
  const documentFixture: CanvasDocument = {
    id: 'doc-1',
    schemaVersion: 1,
    layers: [
      {
        id: 'layer-bottom',
        name: 'Fundo',
        visible: true,
        locked: false,
        childIds: ['rect-1', 'line-1', 'hidden-node'],
      },
      {
        id: 'layer-hidden',
        name: 'Oculta',
        visible: false,
        locked: false,
        childIds: ['rect-hidden-layer'],
      },
      {
        id: 'layer-top',
        name: 'Frente',
        visible: true,
        locked: false,
        childIds: ['ellipse-1'],
      },
    ],
    nodes: {
      'rect-1': {
        id: 'rect-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        rotation: 0.5,
        visible: true,
        locked: false,
        style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 2, opacity: 0.9 },
      },
      'line-1': {
        id: 'line-1',
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 50, y: 50 },
        visible: true,
        locked: false,
        style: { stroke: '#0000ff', strokeWidth: 1, opacity: 1 },
      },
      'hidden-node': {
        id: 'hidden-node',
        type: 'rectangle',
        x: 5,
        y: 5,
        width: 10,
        height: 10,
        rotation: 0,
        visible: false,
        locked: false,
        style: { fill: '#00ff00', stroke: null, strokeWidth: 0, opacity: 1 },
      },
      'rect-hidden-layer': {
        id: 'rect-hidden-layer',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      'ellipse-1': {
        id: 'ellipse-1',
        type: 'ellipse',
        x: 30,
        y: 40,
        width: 60,
        height: 60,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffff00', stroke: '#333333', strokeWidth: 1.5, opacity: 0.8 },
      },
    },
  };

  it('mantém estritamente a ordem das camadas e dos nós do documento', () => {
    const scene = projectScene(documentFixture);

    expect(scene.items.map((item) => item.id)).toEqual(['rect-1', 'line-1', 'ellipse-1']);
  });

  it('omite nós de camada com visible: false', () => {
    const scene = projectScene(documentFixture);

    expect(scene.items.some((item) => item.id === 'rect-hidden-layer')).toBe(false);
  });

  it('omite nós individuais com visible: false em camada visível', () => {
    const scene = projectScene(documentFixture);

    expect(scene.items.some((item) => item.id === 'hidden-node')).toBe(false);
  });

  it('funciona recebendo um CanvasSnapshot completo', () => {
    const snapshot: CanvasSnapshot = {
      document: documentFixture,
      session: {
        selectedIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        activeTool: 'select',
        readOnly: false,
      },
      history: { canUndo: false, canRedo: false },
      revision: 1,
    };

    const scene = projectScene(snapshot);

    expect(scene.items.map((item) => item.id)).toEqual(['rect-1', 'line-1', 'ellipse-1']);
  });

  it('ignora nós citados em childIds que não existem no mapa de nós', () => {
    const docWithDangling: CanvasDocument = {
      ...documentFixture,
      layers: [
        {
          id: 'l1',
          name: 'L1',
          visible: true,
          locked: false,
          childIds: ['fantasma', 'rect-1'],
        },
      ],
    };

    const scene = projectScene(docWithDangling);

    expect(scene.items.map((item) => item.id)).toEqual(['rect-1']);
  });

  it('ignora tipos de nós desconhecidos em tempo de execução', () => {
    const docWithUnknown: CanvasDocument = {
      ...documentFixture,
      nodes: {
        'unknown-1': {
          id: 'unknown-1',
          type: 'futuro',
          visible: true,
          locked: false,
          style: {},
        } as unknown as ShapeNode,
      },
      layers: [
        {
          id: 'l1',
          name: 'L1',
          visible: true,
          locked: false,
          childIds: ['unknown-1'],
        },
      ],
    };

    const scene = projectScene(docWithUnknown);

    expect(scene.items).toEqual([]);
  });
});

describe('geometria, rotação e estilos de shapes básicas', () => {
  it('projeta retângulo com geometria, rotação e estilos completos', () => {
    const doc: CanvasDocument = {
      id: 'doc-geo',
      schemaVersion: 1,
      layers: [{ id: 'layer-1', name: 'L1', visible: true, locked: false, childIds: ['r1'] }],
      nodes: {
        r1: {
          id: 'r1',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          rotation: Math.PI / 4,
          visible: true,
          locked: false,
          style: { fill: '#ff5500', stroke: '#000000', strokeWidth: 4, opacity: 0.75 },
        },
      },
    };

    const scene = projectScene(doc);

    expect(scene.items[0]).toEqual({
      type: 'rectangle',
      id: 'r1',
      layerId: 'layer-1',
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      rotation: Math.PI / 4,
      style: { fill: '#ff5500', stroke: '#000000', strokeWidth: 4, opacity: 0.75 },
    });
  });

  it('projeta elipse com geometria, rotação e estilos completos', () => {
    const doc: CanvasDocument = {
      id: 'doc-geo',
      schemaVersion: 1,
      layers: [{ id: 'layer-1', name: 'L1', visible: true, locked: false, childIds: ['e1'] }],
      nodes: {
        e1: {
          id: 'e1',
          type: 'ellipse',
          x: 50,
          y: 60,
          width: 80,
          height: 40,
          rotation: -Math.PI / 6,
          visible: true,
          locked: false,
          style: { fill: '#00ff88', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      },
    };

    const scene = projectScene(doc);

    expect(scene.items[0]).toEqual({
      type: 'ellipse',
      id: 'e1',
      layerId: 'layer-1',
      x: 50,
      y: 60,
      width: 80,
      height: 40,
      rotation: -Math.PI / 6,
      style: { fill: '#00ff88', stroke: null, strokeWidth: 0, opacity: 1 },
    });
  });

  it('projeta linha com extremos start/end e estilo com fill nulo', () => {
    const doc: CanvasDocument = {
      id: 'doc-geo',
      schemaVersion: 1,
      layers: [{ id: 'layer-1', name: 'L1', visible: true, locked: false, childIds: ['line-1'] }],
      nodes: {
        'line-1': {
          id: 'line-1',
          type: 'line',
          start: { x: 10, y: 15 },
          end: { x: 100, y: 150 },
          visible: true,
          locked: false,
          style: { stroke: '#112233', strokeWidth: 3, opacity: 0.5 },
        },
      },
    };

    const scene = projectScene(doc);

    expect(scene.items[0]).toEqual({
      type: 'line',
      id: 'line-1',
      layerId: 'layer-1',
      start: { x: 10, y: 15 },
      end: { x: 100, y: 150 },
      style: { fill: null, stroke: '#112233', strokeWidth: 3, opacity: 0.5 },
    });
  });

  it('preserva fill e stroke nulos para formas sem preenchimento ou sem contorno', () => {
    const doc: CanvasDocument = {
      id: 'doc-geo',
      schemaVersion: 1,
      layers: [{ id: 'layer-1', name: 'L1', visible: true, locked: false, childIds: ['r-none'] }],
      nodes: {
        'r-none': {
          id: 'r-none',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          rotation: 0,
          visible: true,
          locked: false,
          style: { fill: null, stroke: null, strokeWidth: 0, opacity: 0 },
        },
      },
    };

    // Este documento só tem um retângulo: o board, sem estilo de forma, não aparece aqui.
    const scene = projectScene(doc) as { items: Exclude<RenderableItem, RenderableBoard>[] };

    expect(scene.items[0]?.style).toEqual({
      fill: null,
      stroke: null,
      strokeWidth: 0,
      opacity: 0,
    });
  });
});

describe('canal de preview na projeção de cena', () => {
  const baseDoc: CanvasDocument = {
    id: 'doc-preview',
    schemaVersion: 1,
    layers: [
      { id: 'l1', name: 'L1', visible: true, locked: false, childIds: ['r1', 'r2'] },
      { id: 'l2', name: 'L2', visible: false, locked: false, childIds: ['r-hidden'] },
    ],
    nodes: {
      r1: {
        id: 'r1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      r2: {
        id: 'r2',
        type: 'rectangle',
        x: 20,
        y: 20,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
      'r-hidden': {
        id: 'r-hidden',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    },
  };

  it('substitui nó existente por seu update na mesma posição visual da camada', () => {
    const scene = projectScene(baseDoc, {
      preview: {
        updates: {
          r1: {
            id: 'r1',
            type: 'rectangle',
            x: 500,
            y: 500,
            width: 100,
            height: 100,
            rotation: 0.1,
            visible: true,
            locked: false,
            style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 1, opacity: 1 },
          },
        },
        additions: [],
        marquee: null,
      },
    });

    expect(scene.items.map((i) => i.id)).toEqual(['r1', 'r2']);
    const first = scene.items[0];
    expect(first?.type).toBe('rectangle');
    if (first && first.type === 'rectangle') {
      expect(first.x).toBe(500);
      expect(first.y).toBe(500);
      expect(first.style.fill).toBe('#ff0000');
    }
  });

  it('omite nó do preview se a camada original estiver oculta', () => {
    const scene = projectScene(baseDoc, {
      preview: {
        updates: {
          'r-hidden': {
            id: 'r-hidden',
            type: 'rectangle',
            x: 10,
            y: 10,
            width: 10,
            height: 10,
            rotation: 0,
            visible: true,
            locked: false,
            style: { fill: '#00ff00', stroke: null, strokeWidth: 0, opacity: 1 },
          },
        },
        additions: [],
        marquee: null,
      },
    });

    expect(scene.items.some((i) => i.id === 'r-hidden')).toBe(false);
  });

  it('omite nó do preview se o update marcar visible: false', () => {
    const scene = projectScene(baseDoc, {
      preview: {
        updates: {
          r1: {
            id: 'r1',
            type: 'rectangle',
            x: 10,
            y: 10,
            width: 100,
            height: 100,
            rotation: 0,
            visible: false,
            locked: false,
            style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
          },
        },
        additions: [],
        marquee: null,
      },
    });

    expect(scene.items.map((i) => i.id)).toEqual(['r2']);
  });

  it('adiciona nós provisórios de additions à frente de todo o documento', () => {
    const scene = projectScene(baseDoc, {
      preview: {
        updates: {},
        additions: [
          {
            id: 'ghost-1',
            type: 'ellipse',
            x: 0,
            y: 0,
            width: 30,
            height: 30,
            rotation: 0,
            visible: true,
            locked: false,
            style: { fill: '#abcdef', stroke: '#123456', strokeWidth: 1, opacity: 0.8 },
          },
        ],
        marquee: null,
      },
    });

    expect(scene.items.map((i) => i.id)).toEqual(['r1', 'r2', 'ghost-1']);
    expect(scene.items[2]?.layerId).toBe('preview');
  });

  it('omite additions com visible: false', () => {
    const scene = projectScene(baseDoc, {
      preview: {
        updates: {},
        additions: [
          {
            id: 'ghost-hidden',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            rotation: 0,
            visible: false,
            locked: false,
            style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
          },
        ],
        marquee: null,
      },
    });

    expect(scene.items.map((i) => i.id)).toEqual(['r1', 'r2']);
  });

  it('funciona perfeitamente sem preview ou com preview null', () => {
    const sceneNull = projectScene(baseDoc, { preview: null });
    const sceneEmpty = projectScene(baseDoc);

    expect(sceneNull.items.map((i) => i.id)).toEqual(['r1', 'r2']);
    expect(sceneEmpty.items.map((i) => i.id)).toEqual(['r1', 'r2']);
  });
});

describe('culling e filtragem por candidateIds em projectScene', () => {
  const cullingDoc: CanvasDocument = {
    schemaVersion: 1,
    id: 'doc-culling',
    nodes: {
      'node-1': {
        id: 'node-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
      },
      'node-2': {
        id: 'node-2',
        type: 'rectangle',
        x: 500,
        y: 500,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#00ff00', stroke: null, strokeWidth: 0, opacity: 1 },
      },
      'node-3': {
        id: 'node-3',
        type: 'rectangle',
        x: 1000,
        y: 1000,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#0000ff', stroke: null, strokeWidth: 0, opacity: 1 },
      },
    },
    layers: [
      {
        id: 'layer-1',
        name: 'Camada 1',
        visible: true,
        locked: false,
        childIds: ['node-1', 'node-2', 'node-3'],
      },
    ],
  };

  it('projeta apenas nós presentes no conjunto candidateIds', () => {
    const candidateIds = new Set(['node-1', 'node-3']);
    const scene = projectScene(cullingDoc, { candidateIds });

    expect(scene.items.map((item) => item.id)).toEqual(['node-1', 'node-3']);
  });

  it('preserva a ordem original do documento entre os nós sobreviventes ao culling', () => {
    const candidateIds = new Set(['node-3', 'node-1']); // Ordem arbitrária no Set
    const scene = projectScene(cullingDoc, { candidateIds });

    // A ordem projetada segue rigorosamente a ordem do documento (layer childIds: node-1 depois node-3)
    expect(scene.items.map((item) => item.id)).toEqual(['node-1', 'node-3']);
  });

  it('retorna zero itens se candidateIds for um conjunto vazio', () => {
    const candidateIds = new Set<string>();
    const scene = projectScene(cullingDoc, { candidateIds });

    expect(scene.items).toEqual([]);
  });

  it('retorna todos os itens visíveis se candidateIds for undefined', () => {
    const scene = projectScene(cullingDoc);

    expect(scene.items.map((item) => item.id)).toEqual(['node-1', 'node-2', 'node-3']);
  });

  it('filtra adições de preview com base em candidateIds', () => {
    const candidateIds = new Set(['node-1', 'addition-in-bounds']);
    const scene = projectScene(cullingDoc, {
      candidateIds,
      preview: {
        updates: {},
        additions: [
          {
            id: 'addition-in-bounds',
            type: 'rectangle',
            x: 20,
            y: 20,
            width: 30,
            height: 30,
            rotation: 0,
            visible: true,
            locked: false,
            style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
          },
          {
            id: 'addition-out-of-bounds',
            type: 'rectangle',
            x: 5000,
            y: 5000,
            width: 30,
            height: 30,
            rotation: 0,
            visible: true,
            locked: false,
            style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 },
          },
        ],
        marquee: null,
      },
    });

    expect(scene.items.map((item) => item.id)).toEqual(['node-1', 'addition-in-bounds']);
  });

  it('projeta nós do tipo text preservando propriedades e ordem', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      id: 'doc-1',
      layers: [{ id: 'l1', name: 'Layer 1', visible: true, locked: false, childIds: ['t1'] }],
      nodes: {
        t1: {
          id: 't1',
          type: 'text',
          x: 10,
          y: 20,
          width: 200,
          height: 50,
          rotation: 0,
          text: 'Texto renderizavel',
          fontSize: 18,
          fontSizeMode: 'auto',
          fontFamily: 'Inter',
          fontWeight: 'bold',
          textAlign: 'center',
          lineHeight: 1.4,
          visible: true,
          locked: false,
          style: { fill: '#111', stroke: null, strokeWidth: 0, opacity: 1 },
        },
      },
    };

    const scene = projectScene(document);
    expect(scene.items).toHaveLength(1);
    const item = scene.items[0]!;
    expect(item.type).toBe('text');
    if (item.type === 'text') {
      expect(item.text).toBe('Texto renderizavel');
      expect(item.fontSize).toBe(18);
      expect(item.fontFamily).toBe('Inter');
      expect(item.fontWeight).toBe('bold');
      expect(item.textAlign).toBe('center');
      expect(item.lineHeight).toBe(1.4);
    }
  });

  it('projeta um SquareNode em RenderableSquare preservando geometria 1:1 e estilo', () => {
    const document: CanvasDocument = {
      id: 'doc-sq',
      schemaVersion: 1,
      layers: [
        {
          id: 'l-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          childIds: ['sq-1'],
        },
      ],
      nodes: {
        'sq-1': {
          id: 'sq-1',
          type: 'square',
          x: 25,
          y: 35,
          width: 90,
          height: 90,
          rotation: 0.4,
          visible: true,
          locked: false,
          style: { fill: '#224466', stroke: '#112233', strokeWidth: 3, opacity: 0.75 },
        },
      },
    };

    const scene = projectScene(document);
    expect(scene.items).toHaveLength(1);
    const item = scene.items[0]!;
    expect(item.type).toBe('square');
    if (item.type === 'square') {
      expect(item.x).toBe(25);
      expect(item.y).toBe(35);
      expect(item.width).toBe(90);
      expect(item.height).toBe(90);
      expect(item.rotation).toBe(0.4);
      expect(item.style).toEqual({
        fill: '#224466',
        stroke: '#112233',
        strokeWidth: 3,
        opacity: 0.75,
      });
    }
  });

  it('projeta um CircleNode em RenderableCircle preservando geometria 1:1 e estilo', () => {
    const document: CanvasDocument = {
      id: 'doc-c',
      schemaVersion: 1,
      layers: [
        {
          id: 'l-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          childIds: ['c-1'],
        },
      ],
      nodes: {
        'c-1': {
          id: 'c-1',
          type: 'circle',
          x: 40,
          y: 50,
          width: 100,
          height: 100,
          rotation: 0.25,
          visible: true,
          locked: false,
          style: { fill: '#10b981', stroke: '#047857', strokeWidth: 2, opacity: 0.9 },
        },
      },
    };

    const scene = projectScene(document);
    expect(scene.items).toHaveLength(1);
    const item = scene.items[0]!;
    expect(item.type).toBe('circle');
    if (item.type === 'circle') {
      expect(item.x).toBe(40);
      expect(item.y).toBe(50);
      expect(item.width).toBe(100);
      expect(item.height).toBe(100);
      expect(item.rotation).toBe(0.25);
      expect(item.style).toEqual({
        fill: '#10b981',
        stroke: '#047857',
        strokeWidth: 2,
        opacity: 0.9,
      });
    }
  });

  it('projeta um DiamondNode em RenderableDiamond preservando geometria livre e estilo', () => {
    const document: CanvasDocument = {
      id: 'doc-d',
      schemaVersion: 1,
      layers: [
        {
          id: 'l-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          childIds: ['d-1'],
        },
      ],
      nodes: {
        'd-1': {
          id: 'd-1',
          type: 'diamond',
          x: 15,
          y: 25,
          width: 140,
          height: 80,
          rotation: 0.5,
          visible: true,
          locked: false,
          style: { fill: '#f59e0b', stroke: '#b45309', strokeWidth: 2, opacity: 0.85 },
        },
      },
    };

    const scene = projectScene(document);
    expect(scene.items).toHaveLength(1);
    const item = scene.items[0]!;
    expect(item.type).toBe('diamond');
    if (item.type === 'diamond') {
      expect(item.x).toBe(15);
      expect(item.y).toBe(25);
      expect(item.width).toBe(140);
      expect(item.height).toBe(80);
      expect(item.rotation).toBe(0.5);
      expect(item.style).toEqual({
        fill: '#f59e0b',
        stroke: '#b45309',
        strokeWidth: 2,
        opacity: 0.85,
      });
    }
  });

  it('projeta um TriangleNode em RenderableTriangle preservando variant, apex e estilo', () => {
    const document: CanvasDocument = {
      id: 'doc-tr',
      schemaVersion: 1,
      layers: [
        {
          id: 'l-1',
          name: 'Layer 1',
          visible: true,
          locked: false,
          childIds: ['tr-1'],
        },
      ],
      nodes: {
        'tr-1': {
          id: 'tr-1',
          type: 'triangle',
          x: 20,
          y: 30,
          width: 120,
          height: 90,
          rotation: 0.3,
          variant: 'scalene',
          apex: 0.25,
          visible: true,
          locked: false,
          style: { fill: '#8b5cf6', stroke: '#5b21b6', strokeWidth: 2, opacity: 0.95 },
        },
      },
    };

    const scene = projectScene(document);
    expect(scene.items).toHaveLength(1);
    const item = scene.items[0]!;
    expect(item.type).toBe('triangle');
    if (item.type === 'triangle') {
      expect(item.x).toBe(20);
      expect(item.y).toBe(30);
      expect(item.width).toBe(120);
      expect(item.height).toBe(90);
      expect(item.rotation).toBe(0.3);
      expect(item.variant).toBe('scalene');
      expect(item.apex).toBe(0.25);
      expect(item.style).toEqual({
        fill: '#8b5cf6',
        stroke: '#5b21b6',
        strokeWidth: 2,
        opacity: 0.95,
      });
    }
  });
});

describe('projeção de polígono (Tarefa 108)', () => {
  it('projeta um PolygonNode em RenderablePolygon preservando sides e estilo', () => {
    const document: CanvasDocument = {
      id: 'doc-pg',
      schemaVersion: 1,
      layers: [{ id: 'l-1', name: 'Layer 1', visible: true, locked: false, childIds: ['pg-1'] }],
      nodes: {
        'pg-1': {
          id: 'pg-1',
          type: 'polygon',
          x: 20,
          y: 30,
          width: 90,
          height: 90,
          rotation: 0.3,
          sides: 7,
          visible: true,
          locked: false,
          style: { fill: '#14b8a6', stroke: '#0f766e', strokeWidth: 2, opacity: 0.9 },
        },
      },
    };

    const scene = projectScene(document);
    expect(scene.items).toEqual([
      {
        type: 'polygon',
        id: 'pg-1',
        layerId: 'l-1',
        x: 20,
        y: 30,
        width: 90,
        height: 90,
        rotation: 0.3,
        sides: 7,
        style: { fill: '#14b8a6', stroke: '#0f766e', strokeWidth: 2, opacity: 0.9 },
      },
    ]);
  });
});

describe('projeção de curva Bézier (Tarefa 111)', () => {
  it('projeta os quatro pontos e o traço, sem preenchimento', () => {
    const document: CanvasDocument = {
      id: 'doc-bz',
      schemaVersion: 1,
      layers: [{ id: 'l-1', name: 'Layer 1', visible: true, locked: false, childIds: ['bz-1'] }],
      nodes: {
        'bz-1': {
          id: 'bz-1',
          type: 'bezier',
          start: { x: 0, y: 0 },
          control1: { x: 10, y: -40 },
          control2: { x: 90, y: -40 },
          end: { x: 100, y: 0 },
          symmetric: true,
          visible: true,
          locked: false,
          style: { stroke: '#7c3aed', strokeWidth: 2, opacity: 0.8 },
        },
      },
    };

    expect(projectScene(document).items).toEqual([
      {
        type: 'bezier',
        id: 'bz-1',
        layerId: 'l-1',
        start: { x: 0, y: 0 },
        control1: { x: 10, y: -40 },
        control2: { x: 90, y: -40 },
        end: { x: 100, y: 0 },
        style: { fill: null, stroke: '#7c3aed', strokeWidth: 2, opacity: 0.8 },
      },
    ]);
  });
});

describe('projeção do texto da forma (US-SL.7)', () => {
  const LABEL = {
    text: 'Olá',
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 'normal' as const,
    color: null,
    textAlign: 'center' as const,
    verticalAlign: 'middle' as const,
  };
  const STYLE = { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 };
  const BOX = { x: 0, y: 0, width: 100, height: 100, rotation: 0, visible: true, locked: false };
  const NINE = [
    { type: 'rectangle' },
    { type: 'square' },
    { type: 'ellipse' },
    { type: 'circle' },
    { type: 'diamond' },
    { type: 'triangle', variant: 'isosceles', apex: 0.5 },
    { type: 'polygon', sides: 6 },
    { type: 'cross', armRatio: 1 / 3 },
    { type: 'chevron', direction: 'right', notchDepth: 0.25 },
  ] as const;
  const documentOf = (nodes: Record<string, unknown>): CanvasDocument =>
    ({
      id: 'doc',
      schemaVersion: 1,
      layers: [{ id: 'l', name: 'L', visible: true, locked: false, childIds: Object.keys(nodes) }],
      nodes,
    }) as unknown as CanvasDocument;

  it.each(NINE)('$type leva o label para o item da cena', (shape) => {
    const node = { id: 'n', ...shape, ...BOX, style: STYLE, label: LABEL };

    const scene = projectScene(documentOf({ n: node }));

    expect(scene.items[0]).toMatchObject({ type: shape.type, label: LABEL });
  });

  it.each(NINE)('$type sem label não ganha a chave', (shape) => {
    const node = { id: 'n', ...shape, ...BOX, style: STYLE };

    const scene = projectScene(documentOf({ n: node }));

    expect('label' in scene.items[0]!).toBe(false);
  });
});

describe('projeção do board (spec boards, §5.5)', () => {
  const STYLE = { fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 } as const;
  const rectangle = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    visible: true,
    locked: false,
    style: STYLE,
    ...extra,
  });
  const board = (id: string, childIds: string[], extra: Record<string, unknown> = {}) => ({
    id,
    type: 'board' as const,
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    title: `Título ${id}`,
    style: { fill: '#eff6ff', fillOpacity: 0.5, stroke: '#d4d4d8' },
    childIds,
    visible: true,
    locked: false,
    ...extra,
  });
  const group = (id: string, childIds: string[]) => ({
    id,
    type: 'group' as const,
    childIds,
    visible: true,
    locked: false,
  });

  function documentOf(
    nodes: Record<string, unknown>[],
    layerChildIds: string[],
    layerExtra: Record<string, unknown> = {},
  ): CanvasDocument {
    return {
      schemaVersion: 1,
      id: 'doc',
      nodes: Object.fromEntries(nodes.map((node) => [node['id'], node])),
      layers: [
        {
          id: 'l',
          name: 'L',
          visible: true,
          locked: false,
          childIds: layerChildIds,
          ...layerExtra,
        },
      ],
    } as unknown as CanvasDocument;
  }

  const idsOf = (scene: ProjectedScene) => scene.items.map((item) => item.id);

  it('US-BD.4 (renderer): o board vem antes dos filhos, e o grupo filho antes dos membros', () => {
    const document = documentOf(
      [
        rectangle('before'),
        board('b', ['c1', 'g', 'c2']),
        rectangle('c1'),
        group('g', ['m1', 'm2']),
        rectangle('m1'),
        rectangle('m2'),
        rectangle('c2'),
        rectangle('after'),
      ],
      ['before', 'b', 'after'],
    );

    expect(idsOf(projectScene(document))).toEqual(['before', 'b', 'c1', 'm1', 'm2', 'c2', 'after']);
  });

  it('com o board à frente de toda a camada, os filhos continuam à frente do fundo', () => {
    const document = documentOf(
      [rectangle('x'), rectangle('y'), board('b', ['c1']), rectangle('c1')],
      ['x', 'y', 'b'],
    );

    expect(idsOf(projectScene(document))).toEqual(['x', 'y', 'b', 'c1']);
  });

  it('o item do board traz geometria, fundo com fillOpacity, borda e título', () => {
    const document = documentOf([board('b', [])], ['b']);

    const [item] = projectScene(document).items;

    expect(item).toEqual({
      type: 'board',
      id: 'b',
      layerId: 'l',
      x: 100,
      y: 200,
      width: 300,
      height: 150,
      fill: '#eff6ff',
      fillOpacity: 0.5,
      stroke: '#d4d4d8',
      title: 'Título b',
      titleColor: '#3f3f46',
    });
  });

  it('boardTitleColor troca a cor do título', () => {
    const document = documentOf([board('b', [])], ['b']);

    const [item] = projectScene(document, { boardTitleColor: '#d4d4d8' }).items;

    expect(item).toMatchObject({ type: 'board', titleColor: '#d4d4d8' });
  });

  it('um board oculto oculta os filhos, e um filho oculto some sozinho', () => {
    const hidden = documentOf([board('b', ['c1'], { visible: false }), rectangle('c1')], ['b']);
    const childHidden = documentOf(
      [board('b', ['c1', 'c2']), rectangle('c1', { visible: false }), rectangle('c2')],
      ['b'],
    );

    expect(idsOf(projectScene(hidden))).toEqual([]);
    expect(idsOf(projectScene(childHidden))).toEqual(['b', 'c2']);
  });

  it('numa camada oculta, nada do board aparece', () => {
    const document = documentOf([board('b', ['c1']), rectangle('c1')], ['b'], { visible: false });

    expect(idsOf(projectScene(document))).toEqual([]);
  });

  it('o culling é por item: o board fora da tela não é projetado, mas o filho visível é', () => {
    const document = documentOf(
      [board('b', ['c1', 'c2']), rectangle('c1'), rectangle('c2')],
      ['b'],
    );

    const onlyChild = projectScene(document, { candidateIds: new Set(['c1']) });
    const onlyBoard = projectScene(document, { candidateIds: new Set(['b']) });

    expect(idsOf(onlyChild)).toEqual(['c1']);
    expect(idsOf(onlyBoard)).toEqual(['b']);
  });

  it('um board em additions é pintado sem fundo: só a borda e o título', () => {
    const document = documentOf([rectangle('a')], ['a']);
    const scene = projectScene(document, {
      preview: { updates: {}, additions: [board('novo', [])], marquee: null } as never,
    });

    expect(scene.items.at(-1)).toMatchObject({
      type: 'board',
      id: 'novo',
      layerId: 'preview',
      fill: null,
      stroke: '#d4d4d8',
      title: 'Título novo',
    });
  });

  it('um board em updates pinta a geometria provisória e mantém os filhos do documento', () => {
    const document = documentOf([board('b', ['c1']), rectangle('c1')], ['b']);

    const scene = projectScene(document, {
      preview: {
        updates: { b: board('b', [], { x: 500, y: 600 }) },
        additions: [],
        marquee: null,
      } as never,
    });

    expect(idsOf(scene)).toEqual(['b', 'c1']);
    expect(scene.items[0]).toMatchObject({ type: 'board', x: 500, y: 600, fill: '#eff6ff' });
  });

  it('um filho em updates do preview substitui o filho do board', () => {
    const document = documentOf([board('b', ['c1']), rectangle('c1')], ['b']);

    const scene = projectScene(document, {
      preview: {
        updates: { c1: rectangle('c1', { x: 77 }) },
        additions: [],
        marquee: null,
      } as never,
    });

    expect(scene.items[1]).toMatchObject({ id: 'c1', x: 77 });
  });

  it('sem title no item (boardTitles omitido) o tipo permite, e a projeção padrão sempre traz', () => {
    expectTypeOf<RenderableBoard['title']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RenderableBoard['titleColor']>().toBeString();
    expectTypeOf<Extract<RenderableItem, { type: 'board' }>>().toEqualTypeOf<RenderableBoard>();
  });
});
