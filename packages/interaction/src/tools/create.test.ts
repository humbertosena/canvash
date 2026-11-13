import { describe, expect, it } from 'vitest';
import {
  buildCreateShapeInput,
  buildPreviewShape,
  computeCreationGeometry,
  isCreationValid,
} from './create.js';

describe('computeCreationGeometry', () => {
  it('calcula retângulo arrastando para sudeste (+x, +y)', () => {
    const geo = computeCreationGeometry({
      tool: 'rectangle',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 60, y: 70 },
      shiftKey: false,
    });

    expect(geo).toEqual({
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      rotation: 0,
    });
  });

  it('calcula retângulo arrastando para noroeste (-x, -y)', () => {
    const geo = computeCreationGeometry({
      tool: 'rectangle',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 40, y: 30 },
      shiftKey: false,
    });

    expect(geo).toEqual({
      type: 'rectangle',
      x: 40,
      y: 30,
      width: 60,
      height: 70,
      rotation: 0,
    });
  });

  it('calcula elipse com shiftKey: true travando proporção 1:1', () => {
    const geo = computeCreationGeometry({
      tool: 'ellipse',
      startWorld: { x: 50, y: 50 },
      currentWorld: { x: 90, y: 70 }, // dx: 40, dy: 20 => max: 40
      shiftKey: true,
    });

    expect(geo).toEqual({
      type: 'ellipse',
      x: 50,
      y: 50,
      width: 40,
      height: 40,
      rotation: 0,
    });
  });

  it('calcula elipse com shiftKey: true arrastando para trás (-x, -y)', () => {
    const geo = computeCreationGeometry({
      tool: 'ellipse',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 70, y: 50 }, // dx: -30, dy: -50 => max: 50
      shiftKey: true,
    });

    expect(geo).toEqual({
      type: 'ellipse',
      x: 50,
      y: 50,
      width: 50,
      height: 50,
      rotation: 0,
    });
  });

  it('calcula linha livre', () => {
    const geo = computeCreationGeometry({
      tool: 'line',
      startWorld: { x: 10, y: 10 },
      currentWorld: { x: 40, y: 50 },
      shiftKey: false,
    });

    expect(geo.type).toBe('line');
    if (geo.type === 'line') {
      expect(geo.start).toEqual({ x: 10, y: 10 });
      expect(geo.end).toEqual({ x: 40, y: 50 });
      expect(geo.length).toBeCloseTo(50, 1);
    }
  });

  it('calcula linha com shiftKey: true travando em 45 graus', () => {
    const geo = computeCreationGeometry({
      tool: 'line',
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 52, y: 48 }, // próximo de 45°
      shiftKey: true,
    });

    expect(geo.type).toBe('line');
    if (geo.type === 'line') {
      expect(geo.start).toEqual({ x: 0, y: 0 });
      // A 45°, x e y devem ser rigorosamente iguais
      expect(geo.end.x).toBeCloseTo(geo.end.y, 4);
    }
  });
});

describe('isCreationValid', () => {
  it('reprova retângulo com largura ou altura menor que minDimension', () => {
    expect(
      isCreationValid({ type: 'rectangle', x: 0, y: 0, width: 1, height: 10, rotation: 0 }, 2),
    ).toBe(false);
    expect(
      isCreationValid({ type: 'rectangle', x: 0, y: 0, width: 10, height: 1.5, rotation: 0 }, 2),
    ).toBe(false);
    expect(
      isCreationValid({ type: 'rectangle', x: 0, y: 0, width: 2, height: 2, rotation: 0 }, 2),
    ).toBe(true);
  });

  it('reprova linha com comprimento menor que minDimension', () => {
    expect(
      isCreationValid({ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, length: 1 }, 2),
    ).toBe(false);
    expect(
      isCreationValid({ type: 'line', start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, length: 2 }, 2),
    ).toBe(true);
  });
});

describe('buildPreviewShape e buildCreateShapeInput', () => {
  it('constrói PreviewShape e ShapeInput para retângulo', () => {
    const geo = {
      type: 'rectangle' as const,
      x: 10,
      y: 10,
      width: 40,
      height: 30,
      rotation: 0,
    };
    const preview = buildPreviewShape(geo, 'custom-id');
    expect(preview).toEqual({
      id: 'custom-id',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 40,
      height: 30,
      rotation: 0,
      style: {
        fill: '#2563eb26',
        stroke: '#2563eb',
        strokeWidth: 2,
        opacity: 0.8,
      },
    });

    const shapeInput = buildCreateShapeInput(geo);
    expect(shapeInput).toEqual({
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 40,
      height: 30,
      rotation: 0,
    });
  });

  it('constrói PreviewShape e ShapeInput para linha', () => {
    const geo = {
      type: 'line' as const,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      length: 14.14,
    };
    const preview = buildPreviewShape(geo);
    expect(preview).toEqual({
      id: '__preview_shape__',
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      style: {
        stroke: '#2563eb',
        strokeWidth: 2,
        opacity: 0.8,
      },
    });

    const shapeInput = buildCreateShapeInput(geo);
    expect(shapeInput).toEqual({
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
    });
  });

  it('calcula e constrói quadrado (square) forçando proporção 1:1 mesmo sem Shift em todos os quadrantes', () => {
    // Sudeste (+x, +y), shiftKey: false -> size = max(80, 40) = 80
    const se = computeCreationGeometry({
      tool: 'square',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 90, y: 60 },
      shiftKey: false,
    });
    expect(se).toEqual({
      type: 'square',
      x: 10,
      y: 20,
      width: 80,
      height: 80,
      rotation: 0,
    });

    // Noroeste (-x, -y), shiftKey: false -> size = max(30, 70) = 70
    const nw = computeCreationGeometry({
      tool: 'square',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 70, y: 30 },
      shiftKey: false,
    });
    expect(nw).toEqual({
      type: 'square',
      x: 30,
      y: 30,
      width: 70,
      height: 70,
      rotation: 0,
    });

    // Sudoeste (-x, +y), shiftKey: true -> size = max(60, 25) = 60
    const sw = computeCreationGeometry({
      tool: 'square',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 40, y: 125 },
      shiftKey: true,
    });
    expect(sw).toEqual({
      type: 'square',
      x: 40,
      y: 100,
      width: 60,
      height: 60,
      rotation: 0,
    });

    const preview = buildPreviewShape(se, 'preview-sq');
    expect(preview.type).toBe('square');
    const input = buildCreateShapeInput(se);
    expect(input).toEqual({
      type: 'square',
      x: 10,
      y: 20,
      width: 80,
      height: 80,
      rotation: 0,
    });
  });

  it('calcula e constrói círculo (circle) forçando proporção 1:1 mesmo sem Shift em todos os quadrantes', () => {
    const se = computeCreationGeometry({
      tool: 'circle',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 90, y: 60 },
      shiftKey: false,
    });
    expect(se).toEqual({
      type: 'circle',
      x: 10,
      y: 20,
      width: 80,
      height: 80,
      rotation: 0,
    });

    const nw = computeCreationGeometry({
      tool: 'circle',
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 70, y: 30 },
      shiftKey: false,
    });
    expect(nw).toEqual({
      type: 'circle',
      x: 30,
      y: 30,
      width: 70,
      height: 70,
      rotation: 0,
    });

    const preview = buildPreviewShape(se, 'preview-c');
    expect(preview.type).toBe('circle');
    const input = buildCreateShapeInput(se);
    expect(input).toEqual({
      type: 'circle',
      x: 10,
      y: 20,
      width: 80,
      height: 80,
      rotation: 0,
    });
  });

  it('calcula e constrói losango (diamond) com proporção livre sem Shift e 1:1 com Shift', () => {
    const free = computeCreationGeometry({
      tool: 'diamond',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 130, y: 80 },
      shiftKey: false,
    });
    expect(free).toEqual({
      type: 'diamond',
      x: 10,
      y: 20,
      width: 120,
      height: 60,
      rotation: 0,
    });

    const locked = computeCreationGeometry({
      tool: 'diamond',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 130, y: 80 },
      shiftKey: true,
    });
    expect(locked).toEqual({
      type: 'diamond',
      x: 10,
      y: 20,
      width: 120,
      height: 120,
      rotation: 0,
    });

    const preview = buildPreviewShape(free, 'preview-d');
    expect(preview.type).toBe('diamond');
    const input = buildCreateShapeInput(free);
    expect(input).toEqual({
      type: 'diamond',
      x: 10,
      y: 20,
      width: 120,
      height: 60,
      rotation: 0,
    });
  });

  it('calcula e constrói triângulo (triangle) como isósceles com proporção livre sem Shift e 1:1 com Shift', () => {
    const free = computeCreationGeometry({
      tool: 'triangle',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 130, y: 100 },
      shiftKey: false,
    });
    expect(free).toEqual({
      type: 'triangle',
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      rotation: 0,
    });

    const locked = computeCreationGeometry({
      tool: 'triangle',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 130, y: 100 },
      shiftKey: true,
    });
    expect(locked).toEqual({
      type: 'triangle',
      x: 10,
      y: 20,
      width: 120,
      height: 120,
      rotation: 0,
    });

    const preview = buildPreviewShape(free, 'preview-tr');
    expect(preview).toMatchObject({
      id: 'preview-tr',
      type: 'triangle',
      variant: 'isosceles',
      apex: 0.5,
      x: 10,
      y: 20,
      width: 120,
      height: 80,
    });

    const input = buildCreateShapeInput(free);
    expect(input).toEqual({
      type: 'triangle',
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      rotation: 0,
      variant: 'isosceles',
      apex: 0.5,
    });
  });
});

describe('criação de polígono (Tarefa 108)', () => {
  it('cria polígono com caixa 1:1 pelo maior lado do arrasto, com ou sem Shift, e 5 lados', () => {
    for (const shiftKey of [false, true]) {
      const geometry = computeCreationGeometry({
        tool: 'polygon',
        startWorld: { x: 100, y: 100 },
        currentWorld: { x: 40, y: 130 },
        shiftKey,
      });
      expect(geometry).toEqual({
        type: 'polygon',
        x: 40,
        y: 100,
        width: 60,
        height: 60,
        rotation: 0,
      });
    }

    const geometry = computeCreationGeometry({
      tool: 'polygon',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 90, y: 50 },
      shiftKey: false,
    });
    expect(buildPreviewShape(geometry, 'preview-pg')).toMatchObject({
      id: 'preview-pg',
      type: 'polygon',
      sides: 5,
      x: 10,
      y: 20,
      width: 80,
      height: 80,
    });
    expect(buildCreateShapeInput(geometry)).toEqual({
      type: 'polygon',
      x: 10,
      y: 20,
      width: 80,
      height: 80,
      rotation: 0,
      sides: 5,
    });
  });
});

describe('criação de curva Bézier (Tarefa 112)', () => {
  it('usa a regra da linha nas pontas e o arco padrão nos controles', () => {
    const geometry = computeCreationGeometry({
      tool: 'bezier',
      startWorld: { x: 10, y: 20 },
      currentWorld: { x: 130, y: 20 },
      shiftKey: false,
    });
    expect(geometry).toEqual({
      type: 'bezier',
      start: { x: 10, y: 20 },
      end: { x: 130, y: 20 },
      length: 120,
    });

    expect(buildPreviewShape(geometry, 'preview-bz')).toEqual({
      id: 'preview-bz',
      type: 'bezier',
      start: { x: 10, y: 20 },
      control1: { x: 50, y: -10 },
      control2: { x: 90, y: -10 },
      end: { x: 130, y: 20 },
      symmetric: true,
      style: { stroke: '#2563eb', strokeWidth: 2, opacity: 0.8 },
    });
    expect(buildCreateShapeInput(geometry)).toEqual({
      type: 'bezier',
      start: { x: 10, y: 20 },
      end: { x: 130, y: 20 },
    });
  });

  it('com Shift trava a corda em múltiplos de 45° e recusa arrasto curto', () => {
    const snapped = computeCreationGeometry({
      tool: 'bezier',
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 100, y: 10 },
      shiftKey: true,
    });
    expect(snapped.type).toBe('bezier');
    if (snapped.type !== 'bezier') return;
    expect(snapped.end.y).toBeCloseTo(0, 9);

    const tiny = computeCreationGeometry({
      tool: 'bezier',
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 1, y: 0 },
      shiftKey: false,
    });
    expect(isCreationValid(tiny)).toBe(false);
  });
});

describe('predefinições de polígono regular (pentagon, hexagon, octagon)', () => {
  const presets = [
    ['pentagon', 5],
    ['hexagon', 6],
    ['octagon', 8],
  ] as const;

  for (const [tool, sides] of presets) {
    it(`${tool} cria um polígono 1:1 com ${sides} lados nos 4 quadrantes`, () => {
      const start = { x: 100, y: 100 };
      const cases = [
        { current: { x: 150, y: 130 }, x: 100, y: 100 },
        { current: { x: 50, y: 130 }, x: 50, y: 100 },
        { current: { x: 150, y: 70 }, x: 100, y: 50 },
        { current: { x: 50, y: 70 }, x: 50, y: 50 },
      ];

      for (const c of cases) {
        const geometry = computeCreationGeometry({
          tool,
          startWorld: start,
          currentWorld: c.current,
          shiftKey: false,
        });

        expect(geometry).toMatchObject({
          type: 'polygon',
          sides,
          x: c.x,
          y: c.y,
          width: 50,
          height: 50,
          rotation: 0,
        });

        expect(buildCreateShapeInput(geometry)).toEqual({
          type: 'polygon',
          x: c.x,
          y: c.y,
          width: 50,
          height: 50,
          rotation: 0,
          sides,
        });
        expect(buildPreviewShape(geometry)).toMatchObject({ type: 'polygon', sides });
      }
    });
  }

  it('o polígono genérico continua com 5 lados e sem campo extra na geometria', () => {
    const geometry = computeCreationGeometry({
      tool: 'polygon',
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 20, y: 10 },
      shiftKey: false,
    });
    expect('sides' in geometry).toBe(false);
    expect(buildCreateShapeInput(geometry)).toMatchObject({ type: 'polygon', sides: 5 });
  });
});
