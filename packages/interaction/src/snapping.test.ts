import { describe, expect, it } from 'vitest';
import type { CanvasDocument, RectangleNode } from '@canvash/core';
import {
  collectObjectSnapTargets,
  computeBoxSnap,
  computePointSnap,
  computeSnap,
  type SnapTarget,
} from './snapping.js';

function createMockDocument(): CanvasDocument {
  const rectA: RectangleNode = {
    id: 'rect-a',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const rectB: RectangleNode = {
    id: 'rect-b',
    type: 'rectangle',
    x: 400,
    y: 150,
    width: 100,
    height: 100,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#00ff00', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const hiddenNode: RectangleNode = {
    id: 'rect-hidden',
    type: 'rectangle',
    x: 50,
    y: 50,
    width: 50,
    height: 50,
    rotation: 0,
    visible: false,
    locked: false,
    style: { fill: '#0000ff', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  const nodeInHiddenLayer: RectangleNode = {
    id: 'rect-in-hidden-layer',
    type: 'rectangle',
    x: 70,
    y: 70,
    width: 50,
    height: 50,
    rotation: 0,
    visible: true,
    locked: false,
    style: { fill: '#ffff00', stroke: null, strokeWidth: 0, opacity: 1 },
  };

  return {
    schemaVersion: 1,
    id: 'doc-1',
    nodes: {
      'rect-a': rectA,
      'rect-b': rectB,
      'rect-hidden': hiddenNode,
      'rect-in-hidden-layer': nodeInHiddenLayer,
    },
    layers: [
      {
        id: 'layer-1',
        name: 'Visible Layer',
        visible: true,
        locked: false,
        childIds: ['rect-a', 'rect-b', 'rect-hidden'],
      },
      {
        id: 'layer-hidden',
        name: 'Hidden Layer',
        visible: false,
        locked: false,
        childIds: ['rect-in-hidden-layer'],
      },
    ],
  };
}

describe('Motor de Snapping Espacial (Tarefa 51 - INPUT-09)', () => {
  it('coleta alvos de bordas e centros apenas de nós e camadas visíveis, excluindo nós informados', () => {
    const doc = createMockDocument();
    // Exclui rect-a
    const targets = collectObjectSnapTargets(doc, new Set(['rect-a']));

    // Apenas rect-b deve ser coletado (rect-a foi excluído, rect-hidden tem visible:false, rect-in-hidden-layer está em camada oculta)
    const nodeIds = new Set(targets.map((t) => t.nodeId));
    expect(nodeIds.has('rect-b')).toBe(true);
    expect(nodeIds.has('rect-a')).toBe(false);
    expect(nodeIds.has('rect-hidden')).toBe(false);
    expect(nodeIds.has('rect-in-hidden-layer')).toBe(false);

    // rect-b está em x: 400..500 (centro 450) e y: 150..250 (centro 200)
    const xCoords = targets.filter((t) => t.axis === 'x').map((t) => t.coordinate);
    expect(xCoords).toContain(400); // left
    expect(xCoords).toContain(450); // center
    expect(xCoords).toContain(500); // right

    const yCoords = targets.filter((t) => t.axis === 'y').map((t) => t.coordinate);
    expect(yCoords).toContain(150); // top
    expect(yCoords).toContain(200); // center
    expect(yCoords).toContain(250); // bottom
  });

  describe('tolerância de 6 CSS px dependente de zoom', () => {
    it('em zoom = 1, tolerância de mundo é 6 px', () => {
      const targets: SnapTarget[] = [
        { type: 'object', axis: 'x', coordinate: 100, nodeId: 'target-1' },
      ];

      // Distância de 5 mundo px <= 6 -> deve atrair
      const resultSnap = computeSnap({ x: [95], y: [0] }, targets, { zoom: 1 });
      expect(resultSnap.delta.x).toBe(5);
      expect(resultSnap.guides.length).toBe(1);

      // Distância de 7 mundo px > 6 -> NÃO deve atrair
      const resultNoSnap = computeSnap({ x: [93], y: [0] }, targets, { zoom: 1 });
      expect(resultNoSnap.delta.x).toBe(0);
      expect(resultNoSnap.guides.length).toBe(0);
    });

    it('em zoom = 2, tolerância de mundo é 3 px (6 / 2)', () => {
      const targets: SnapTarget[] = [
        { type: 'object', axis: 'x', coordinate: 100, nodeId: 'target-1' },
      ];

      // Distância de 3 mundo px <= 3 -> atrai
      const resultSnap = computeSnap({ x: [97], y: [0] }, targets, { zoom: 2 });
      expect(resultSnap.delta.x).toBe(3);

      // Distância de 4 mundo px > 3 -> não atrai
      const resultNoSnap = computeSnap({ x: [96], y: [0] }, targets, { zoom: 2 });
      expect(resultNoSnap.delta.x).toBe(0);
    });

    it('em zoom = 0.5, tolerância de mundo é 12 px (6 / 0.5)', () => {
      const targets: SnapTarget[] = [
        { type: 'object', axis: 'x', coordinate: 100, nodeId: 'target-1' },
      ];

      // Distância de 10 mundo px <= 12 -> atrai
      const resultSnap = computeSnap({ x: [90], y: [0] }, targets, { zoom: 0.5 });
      expect(resultSnap.delta.x).toBe(10);

      // Distância de 15 mundo px > 12 -> não atrai
      const resultNoSnap = computeSnap({ x: [85], y: [0] }, targets, { zoom: 0.5 });
      expect(resultNoSnap.delta.x).toBe(0);
    });
  });

  describe('prioridade determinística de tie-breaking', () => {
    it('1. menor distância absoluta sempre vence', () => {
      const targets: SnapTarget[] = [
        { type: 'object', axis: 'x', coordinate: 100, nodeId: 'further' },
        { type: 'object', axis: 'x', coordinate: 102, nodeId: 'closer' },
      ];

      // Ponto 103: distância para 102 é 1, para 100 é 3
      const result = computeSnap({ x: [103], y: [0] }, targets, { zoom: 1 });
      expect(result.delta.x).toBe(-1); // ajusta para 102
      expect(result.guides[0]?.nodeId).toBe('closer');
    });

    it('2. em empate de distância, objeto vence grid', () => {
      const targets: SnapTarget[] = [
        { type: 'object', axis: 'x', coordinate: 102, nodeId: 'obj-target' },
      ];

      // Ponto 100:
      // - Distância para grid (tamanho 10) em 98 (ou 100? Se grid=50, linha é 98?):
      // Vamos configurar grid com size 10. Em x=100, dist até 102 é 2.
      // Se tivermos grid em 98, dist até 98 também é 2!
      // Vamos usar grid={ enabled: true, size: 98 }: em x=100, linha mais próxima é 98 (distância 2).
      // Objeto em 102 tem distância 2.
      const result = computeSnap({ x: [100], y: [0] }, targets, {
        zoom: 1,
        grid: { enabled: true, size: 98 },
      });

      // Objeto deve vencer a grade
      expect(result.delta.x).toBe(2);
      expect(result.guides[0]?.targetType).toBe('object');
      expect(result.guides[0]?.nodeId).toBe('obj-target');
    });

    it('3. em empate de distância entre objetos, desempate por ID alfabético estável', () => {
      const targets: SnapTarget[] = [
        { type: 'object', axis: 'x', coordinate: 98, nodeId: 'zebra' },
        { type: 'object', axis: 'x', coordinate: 102, nodeId: 'alpha' },
      ];

      // Ponto 100: dist para zebra é 2, dist para alpha é 2.
      // 'alpha' vem antes de 'zebra' -> 'alpha' vence!
      const result = computeSnap({ x: [100], y: [0] }, targets, { zoom: 1 });
      expect(result.delta.x).toBe(2); // puxa para 102 (alpha)
      expect(result.guides[0]?.nodeId).toBe('alpha');
    });
  });

  describe('suspensão por tecla Alt', () => {
    it('com altKey: true, o snap fica suspenso (delta 0 e sem guias)', () => {
      const targets: SnapTarget[] = [
        { type: 'object', axis: 'x', coordinate: 100, nodeId: 'target-1' },
      ];

      const result = computeSnap({ x: [99], y: [0] }, targets, { zoom: 1, altKey: true });

      expect(result.delta.x).toBe(0);
      expect(result.delta.y).toBe(0);
      expect(result.guides).toEqual([]);
    });
  });

  describe('helpers de alto nível computeBoxSnap e computePointSnap', () => {
    it('computeBoxSnap detecta alinhamento de bordas e centros de um retângulo com objetos do doc', () => {
      const doc = createMockDocument();
      // rect-a está em x: 100..300, y: 100..200
      // Caixa sendo movida perto da borda direita de rect-a (x = 300)
      const movingBox = {
        x: 302, // borda esquerda a 2 px de distância de 300
        y: 50,
        width: 80,
        height: 60,
      };

      const result = computeBoxSnap(movingBox, doc, { zoom: 1, excludedIds: ['moving-id'] });
      expect(result.delta.x).toBe(-2); // puxa 302 para 300
      expect(result.guides.some((g) => g.axis === 'x' && g.coordinate === 300)).toBe(true);
    });

    it('computePointSnap detecta snap em ponto único de criação', () => {
      const doc = createMockDocument();
      // rect-a centro horizontal é 200
      const createPoint = { x: 198, y: 350 };
      const result = computePointSnap(createPoint, doc, { zoom: 1 });
      expect(result.delta.x).toBe(2); // 198 puxado para 200
      expect(result.guides.some((g) => g.axis === 'x' && g.coordinate === 200)).toBe(true);
    });
  });
});

describe('desempate por id independente de locale', () => {
  it('em empate de distância entre objetos, vence o id menor na ordem binária (code units UTF-16)', () => {
    const targets: SnapTarget[] = [
      { type: 'object', axis: 'x', coordinate: 98, nodeId: 'a' },
      { type: 'object', axis: 'x', coordinate: 102, nodeId: 'B' },
    ];

    // Na ordem binária 'B' (U+0042) vem antes de 'a' (U+0061); por locale seria o contrário.
    const result = computeSnap({ x: [100], y: [0] }, targets, { zoom: 1 });
    expect(result.delta.x).toBe(2);
    expect(result.guides[0]?.nodeId).toBe('B');
  });
});
