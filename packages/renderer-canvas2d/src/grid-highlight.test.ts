import { describe, expect, it } from 'vitest';
import type { GridOptions } from './grid.js';
import { highlightIntensity, paintGrid } from './grid.js';

interface Fill {
  readonly color: string;
  readonly rects: readonly (readonly [number, number, number, number])[];
}

/** Contexto gravador: guarda, para cada `fill`, a cor e os retângulos do path corrente. */
function recordingContext(): { context: CanvasRenderingContext2D; fills: Fill[] } {
  const fills: Fill[] = [];
  let pending: [number, number, number, number][] = [];
  const recorder = {
    fillStyle: '',
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => {
      pending = [];
    },
    rect: (x: number, y: number, w: number, h: number) => {
      pending.push([x, y, w, h]);
    },
    fill: () => {
      fills.push({ color: String(recorder.fillStyle), rects: pending });
    },
  };
  return { context: recorder as unknown as CanvasRenderingContext2D, fills };
}

const VIEWPORT = { x: 0, y: 0, zoom: 1 };

function paint(options: GridOptions | undefined, pointer?: { x: number; y: number } | null) {
  const { context, fills } = recordingContext();
  paintGrid(context, {
    viewport: VIEWPORT,
    width: 800,
    height: 600,
    options: { size: 20, ...options },
    pointer,
  });
  return fills;
}

/** Centro do retângulo de um ponto de 2 × 2. */
const centerOf = (rect: readonly [number, number, number, number]): [number, number] => [
  rect[0] + rect[2] / 2,
  rect[1] + rect[3] / 2,
];

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Cor final de cada ponto: a última passada que o cobre vence. */
function colorsByDot(fills: readonly Fill[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const fill of fills) {
    for (const rect of fill.rects) {
      const [x, y] = centerOf(rect);
      colors.set(`${x},${y}`, fill.color);
    }
  }
  return colors;
}

const POINTER = { x: 200, y: 200 };

describe('highlightIntensity', () => {
  it('vale 1 no cursor, 0,5625 na metade do raio e 0 na borda e além', () => {
    expect(highlightIntensity(0, 120)).toBe(1);
    expect(highlightIntensity(60, 120)).toBeCloseTo(0.5625, 10);
    expect(highlightIntensity(120, 120)).toBe(0);
    expect(highlightIntensity(500, 120)).toBe(0);
  });

  it('nunca cresce com a distância', () => {
    let previous = highlightIntensity(0, 120);
    for (let distance = 1; distance <= 130; distance += 1) {
      const current = highlightIntensity(distance, 120);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('paintGrid: realce sob o ponteiro', () => {
  it('sem ponteiro mantém só a passada base, igual à de hoje', () => {
    const semOpcao = paint(undefined);
    expect(semOpcao).toHaveLength(1);
    expect(paint(undefined, null)).toEqual(semOpcao);
    expect(paint({ highlight: true }, undefined)).toEqual(semOpcao);
  });

  it('com ponteiro preserva a passada base e acrescenta no máximo 8 preenchimentos', () => {
    const base = paint(undefined);
    const fills = paint(undefined, POINTER);

    expect(fills[0]).toEqual(base[0]);
    expect(fills.length).toBeGreaterThan(1);
    expect(fills.length - 1).toBeLessThanOrEqual(8);
  });

  it('pinta o ponto sob o cursor com a cor do centro, no mesmo retângulo da base', () => {
    const fills = paint(undefined, POINTER);
    const centro = fills.slice(1).find((fill) => fill.color === '#8b8f99');

    expect(centro).toBeDefined();
    expect(centro?.rects).toContainEqual([199, 199, 2, 2]);
  });

  it('realça só pontos a menos do raio, com cor entre o centro e a base', () => {
    const fills = paint(undefined, POINTER);
    const base = channels('#c9cbd1');
    const centro = channels('#8b8f99');

    for (const fill of fills.slice(1)) {
      const [r, g, b] = channels(fill.color);
      expect(r).toBeGreaterThanOrEqual(centro[0]);
      expect(r).toBeLessThan(base[0]);
      expect(g).toBeGreaterThanOrEqual(centro[1]);
      expect(b).toBeGreaterThanOrEqual(centro[2]);
      for (const rect of fill.rects) {
        const [x, y] = centerOf(rect);
        expect(Math.hypot(x - POINTER.x, y - POINTER.y)).toBeLessThan(120);
      }
    }
  });

  it('um ponto a 60 px fica estritamente entre o centro e a base; a 120 px ou mais, na base', () => {
    const colors = colorsByDot(paint(undefined, POINTER));
    const [r] = channels(colors.get('260,200')!);

    expect(r).toBeGreaterThan(0x8b);
    expect(r).toBeLessThan(0xc9);
    expect(colors.get('320,200')).toBe('#c9cbd1');
    expect(colors.get('360,200')).toBe('#c9cbd1');
  });

  it('a luminância dos pontos não diminui conforme se afasta do cursor', () => {
    const colors = colorsByDot(paint(undefined, POINTER));
    let previous = -1;

    for (let x = 200; x <= 360; x += 20) {
      const [r, g, b] = channels(colors.get(`${x},200`)!);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(luminance).toBeGreaterThanOrEqual(previous);
      previous = luminance;
    }
  });

  it('não acrescenta chamadas com highlight false, estilo lines, grid desligado ou ponteiro inválido', () => {
    const base = paint(undefined);

    expect(paint({ highlight: false }, POINTER)).toEqual(base);
    expect(paint({ enabled: false }, POINTER)).toEqual([]);
    expect(paint(undefined, { x: Number.NaN, y: 10 })).toEqual(base);
    expect(paint(undefined, { x: 10, y: Number.POSITIVE_INFINITY })).toEqual(base);
  });

  it('com estilo lines não preenche nada', () => {
    const { context, fills } = recordingContext();
    const calls: string[] = [];
    const lineContext = Object.assign(context, {
      stroke: () => calls.push('stroke'),
      moveTo: () => undefined,
      lineTo: () => undefined,
    });
    paintGrid(lineContext, {
      viewport: VIEWPORT,
      width: 800,
      height: 600,
      options: { size: 20, style: 'lines' },
      pointer: POINTER,
    });

    expect(fills).toHaveLength(0);
    expect(calls).toEqual(['stroke']);
  });

  it('respeita radius e color explícitos', () => {
    const fills = paint({ highlight: { radius: 40, color: '#112233' } }, POINTER);
    const highlight = fills.slice(1);

    expect(highlight.some((fill) => fill.color === '#112233')).toBe(true);
    for (const fill of highlight) {
      for (const rect of fill.rects) {
        const [x, y] = centerOf(rect);
        expect(Math.hypot(x - POINTER.x, y - POINTER.y)).toBeLessThan(40);
      }
    }
  });

  it('raio inválido cai no padrão de 120 px', () => {
    for (const radius of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const colors = colorsByDot(paint({ highlight: { radius } }, POINTER));
      expect(colors.get('300,200')).not.toBe('#c9cbd1');
      expect(colors.get('320,200')).toBe('#c9cbd1');
    }
  });

  it('interpola a partir da cor do grid quando ela é explícita', () => {
    const colors = colorsByDot(
      paint({ color: '#ffffff', highlight: { color: '#000000' } }, POINTER),
    );

    expect(colors.get('200,200')).toBe('#000000');
    expect(colors.get('400,200')).toBe('#ffffff');
    const [r] = channels(colors.get('240,200')!);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(255);
  });

  it('aceita cores hexadecimais curtas', () => {
    const colors = colorsByDot(paint({ color: '#fff', highlight: { color: '#000' } }, POINTER));

    expect(colors.get('200,200')).toBe('#000000');
  });

  it('sem hexadecimal só aparece o centro, a partir de metade da intensidade', () => {
    const fills = paint({ color: 'rebeccapurple' }, POINTER);
    const highlight = fills.slice(1);

    expect(highlight).toHaveLength(1);
    expect(highlight[0]?.color).toBe('#8b8f99');
    for (const rect of highlight[0]!.rects) {
      const [x, y] = centerOf(rect);
      expect(
        highlightIntensity(Math.hypot(x - POINTER.x, y - POINTER.y), 120),
      ).toBeGreaterThanOrEqual(0.5 - 1 / 16);
    }
  });

  it('mantém o raio do ponto constante no zoom 0,05, 1 e 16', () => {
    for (const zoom of [0.05, 1, 16]) {
      const { context, fills } = recordingContext();
      paintGrid(context, {
        viewport: { x: 0, y: 0, zoom },
        width: 800,
        height: 600,
        options: { size: 20 },
        pointer: { x: 400, y: 300 },
      });

      for (const fill of fills) {
        for (const rect of fill.rects) {
          expect(rect[2]).toBe(2);
          expect(rect[3]).toBe(2);
        }
      }
    }
  });
});
