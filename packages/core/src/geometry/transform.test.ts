import { describe, expect, it } from 'vitest';
import type { Point } from '../shapes.js';
import {
  DEFAULT_ZOOM_LIMITS,
  clampZoom,
  rotatePoint,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Viewport,
} from './transform.js';

const { min: MIN_ZOOM, max: MAX_ZOOM } = DEFAULT_ZOOM_LIMITS;

/** Maior coordenada absoluta de um documento (limites default). */
const WORLD_LIMIT = 10_000_000;
/** Erro máximo aceito por CORE-05, por eixo. */
const MAX_ERROR = 1e-6;

const ZOOMS = [MIN_ZOOM, 0.1, 1 / 3, 1, 2.5, MAX_ZOOM];
const COORDINATES = [-WORLD_LIMIT, -1234.5678, -0.1, 0, 0.001, 987_654.321, WORLD_LIMIT];

/** Todos os pares de coordenadas da grade, extremos incluídos. */
const POINTS: readonly Point[] = COORDINATES.flatMap((x) => COORDINATES.map((y) => ({ x, y })));

/** Viewports com deslocamento e zoom nos extremos e no meio da faixa. */
const VIEWPORTS: readonly Viewport[] = ZOOMS.flatMap((zoom) =>
  POINTS.map(({ x, y }) => ({ x, y, zoom })),
);

/** Gerador congruente linear de semente fixa: a mesma sequência em toda execução. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function axisError(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Confere o maior erro de `measure` nas fixtures; a falha mostra a fixture em que ele ocorreu. */
function expectWithinLimit<T>(fixtures: Iterable<T>, measure: (fixture: T) => number): void {
  let worst = 0;
  let worstFixture: T | undefined;
  let count = 0;
  for (const fixture of fixtures) {
    const error = measure(fixture);
    count += 1;
    // Um erro NaN não é menor que nada: também fica registrado como o pior.
    if (!(error <= worst)) {
      worst = error;
      worstFixture = fixture;
    }
  }

  expect(count).toBeGreaterThan(0);
  expect(worst, `pior caso: ${JSON.stringify(worstFixture)}`).toBeLessThanOrEqual(MAX_ERROR);
}

describe('DEFAULT_ZOOM_LIMITS', () => {
  it('é a faixa padrão da especificação, congelada', () => {
    expect(DEFAULT_ZOOM_LIMITS).toEqual({ min: 0.05, max: 16 });
    expect(Object.isFrozen(DEFAULT_ZOOM_LIMITS)).toBe(true);
  });
});

describe('clampZoom', () => {
  it.each([0.05, 0.5, 1, 3.75, 16])('devolve %d sem alterar: já está na faixa padrão', (zoom) => {
    expect(clampZoom(zoom)).toBe(zoom);
  });

  it('sobe para o mínimo um zoom abaixo da faixa', () => {
    expect(clampZoom(0.049)).toBe(0.05);
    expect(clampZoom(0)).toBe(0.05);
    expect(clampZoom(-3)).toBe(0.05);
  });

  it('desce para o máximo um zoom acima da faixa', () => {
    expect(clampZoom(16.001)).toBe(16);
    expect(clampZoom(Infinity)).toBe(16);
  });

  it('usa os limites dados no lugar da faixa padrão', () => {
    const limits = { min: 0.5, max: 4 };

    expect(clampZoom(0.1, limits)).toBe(0.5);
    expect(clampZoom(2, limits)).toBe(2);
    expect(clampZoom(16, limits)).toBe(4);
  });
});

describe('worldToScreen', () => {
  it('multiplica pelo zoom e soma o deslocamento', () => {
    expect(worldToScreen({ x: 100, y: -50, zoom: 2 }, { x: 10, y: 20 })).toEqual({
      x: 120,
      y: -10,
    });
  });

  it('leva a origem do mundo ao deslocamento do viewport', () => {
    expect(worldToScreen({ x: 37, y: 91, zoom: 0.5 }, { x: 0, y: 0 })).toEqual({ x: 37, y: 91 });
  });

  it('não muda o ponto com o viewport padrão', () => {
    expect(worldToScreen({ x: 0, y: 0, zoom: 1 }, { x: -7.5, y: 12 })).toEqual({ x: -7.5, y: 12 });
  });
});

describe('screenToWorld', () => {
  it('desfaz o deslocamento e divide pelo zoom', () => {
    expect(screenToWorld({ x: 100, y: -50, zoom: 2 }, { x: 120, y: -10 })).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('leva o deslocamento do viewport à origem do mundo', () => {
    expect(screenToWorld({ x: 37, y: 91, zoom: 0.5 }, { x: 37, y: 91 })).toEqual({ x: 0, y: 0 });
  });
});

describe('zoomAt', () => {
  it('mantém sob a âncora o mesmo ponto de mundo', () => {
    const viewport = { x: 40, y: -20, zoom: 1 };
    const anchor = { x: 300, y: 200 };

    const next = zoomAt(viewport, anchor, 2);

    expect(next).toEqual({ x: -220, y: -240, zoom: 2 });
    expect(screenToWorld(viewport, anchor)).toEqual({ x: 260, y: 220 });
    expect(screenToWorld(next, anchor)).toEqual({ x: 260, y: 220 });
  });

  it('afasta da âncora os outros pontos, na proporção do zoom', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 100, y: 100 };

    const next = zoomAt(viewport, anchor, 4);

    // Um ponto de mundo a 10 px da âncora passa a ficar a 40 px dela.
    expect(worldToScreen(next, { x: 110, y: 90 })).toEqual({ x: 140, y: 60 });
  });

  it('limita o zoom pedido antes de calcular o deslocamento, ainda ancorado', () => {
    const viewport = { x: 12, y: 34, zoom: 1 };
    const anchor = { x: 50, y: 60 };

    const zoomedIn = zoomAt(viewport, anchor, 1000);
    const zoomedOut = zoomAt(viewport, anchor, 0);

    // O ponto de mundo sob a âncora é (38, 26): o deslocamento sai do zoom limitado, não do pedido.
    expect(zoomedIn).toEqual({ x: 50 - 38 * 16, y: 60 - 26 * 16, zoom: 16 });
    expect(zoomedOut.zoom).toBe(0.05);
    expect(axisError(screenToWorld(zoomedOut, anchor), { x: 38, y: 26 })).toBeLessThanOrEqual(
      MAX_ERROR,
    );
  });

  it.each([
    { from: 16, requested: 32, limit: 16 },
    { from: 0.05, requested: 0.01, limit: 0.05 },
  ])(
    'pedir zoom $requested a partir de $from deixa o zoom em $limit e o ponto sob a âncora no lugar',
    ({ from, requested, limit }) => {
      const viewport = { x: -1234.5, y: 987.25, zoom: from };
      const anchor = { x: 640, y: 360 };
      const before = screenToWorld(viewport, anchor);

      const next = zoomAt(viewport, anchor, requested);

      expect(next.zoom).toBe(limit);
      expect(screenToWorld(next, anchor)).toEqual(before);
    },
  );

  it('usa os limites dados no lugar da faixa padrão', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 100, y: 50 };
    const limits = { min: 0.5, max: 4 };

    expect(zoomAt(viewport, anchor, 16, limits)).toEqual({ x: -300, y: -150, zoom: 4 });
    expect(zoomAt(viewport, anchor, 0.1, limits)).toEqual({ x: 50, y: 25, zoom: 0.5 });
    // Com a faixa padrão, o mesmo pedido de zoom 16 não seria limitado.
    expect(zoomAt(viewport, anchor, 16).zoom).toBe(16);
  });

  it('devolve o mesmo viewport quando o zoom não muda', () => {
    const viewport = { x: 0.1, y: 0.7, zoom: 3 };
    const atLimit = { x: 0.1, y: 0.7, zoom: 16 };

    expect(zoomAt(viewport, { x: 0.3, y: 1e7 }, 3)).toBe(viewport);
    expect(zoomAt(atLimit, { x: 0.3, y: 1e7 }, 50)).toBe(atLimit);
  });

  it('não altera o viewport, a âncora nem os limites recebidos', () => {
    const viewport = Object.freeze({ x: 5, y: 6, zoom: 1 });
    const anchor = Object.freeze({ x: 7, y: 8 });
    const limits = Object.freeze({ min: 0.5, max: 4 });

    const next = zoomAt(viewport, anchor, 2, limits);

    expect(next).not.toBe(viewport);
    expect(viewport).toEqual({ x: 5, y: 6, zoom: 1 });
    expect(anchor).toEqual({ x: 7, y: 8 });
    expect(limits).toEqual({ min: 0.5, max: 4 });
  });
});

describe('rotatePoint', () => {
  it('gira um quarto de volta do eixo x para o eixo y', () => {
    const rotated = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);

    expect(rotated.x).toBeCloseTo(0, 12);
    expect(rotated.y).toBeCloseTo(1, 12);
  });

  it('gira ao redor do centro dado, não da origem', () => {
    const rotated = rotatePoint({ x: 13, y: 20 }, { x: 10, y: 20 }, Math.PI / 2);

    expect(rotated.x).toBeCloseTo(10, 12);
    expect(rotated.y).toBeCloseTo(23, 12);
  });

  it('gira no sentido contrário com ângulo negativo', () => {
    const rotated = rotatePoint({ x: 13, y: 20 }, { x: 10, y: 20 }, -Math.PI / 2);

    expect(rotated.x).toBeCloseTo(10, 12);
    expect(rotated.y).toBeCloseTo(17, 12);
  });

  it('devolve o próprio ponto com ângulo zero', () => {
    expect(rotatePoint({ x: 3.5, y: -8 }, { x: 100, y: 200 }, 0)).toEqual({ x: 3.5, y: -8 });
  });

  it('deixa o centro no lugar', () => {
    expect(rotatePoint({ x: 4, y: 9 }, { x: 4, y: 9 }, 1.234)).toEqual({ x: 4, y: 9 });
  });

  it('volta ao ponto de partida com o ângulo oposto, mantendo a distância ao centro', () => {
    const point = { x: 120, y: -45 };
    const center = { x: 30, y: 60 };

    const rotated = rotatePoint(point, center, 0.7);
    const back = rotatePoint(rotated, center, -0.7);

    expect(Math.hypot(rotated.x - center.x, rotated.y - center.y)).toBeCloseTo(
      Math.hypot(point.x - center.x, point.y - center.y),
      9,
    );
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it('não altera os pontos recebidos', () => {
    const point = Object.freeze({ x: 1, y: 2 });
    const center = Object.freeze({ x: 3, y: 4 });

    rotatePoint(point, center, 1);

    expect(point).toEqual({ x: 1, y: 2 });
    expect(center).toEqual({ x: 3, y: 4 });
  });
});

describe('precisão dentro dos limites numéricos (CORE-05)', () => {
  interface Sample {
    readonly viewport: Viewport;
    readonly point: Point;
    readonly zoom: number;
  }

  /** Zoom sorteado: duas vezes em cinco em um dos limites, as outras em escala logarítmica. */
  function randomZoom(random: () => number): number {
    const pick = random();
    if (pick < 0.2) return MIN_ZOOM;
    if (pick < 0.4) return MAX_ZOOM;
    return clampZoom(MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** random());
  }

  /** Viewport, ponto e zoom de destino sorteados na faixa, metade das coordenadas no extremo. */
  function* randomSamples(count: number): Generator<Sample> {
    const random = lcg(0x5eed);
    const coordinate = (): number => {
      const value = (random() * 2 - 1) * WORLD_LIMIT;
      return random() < 0.5 ? Math.sign(value) * WORLD_LIMIT * (1 - random() * 1e-9) : value;
    };
    for (let index = 0; index < count; index += 1) {
      yield {
        viewport: { x: coordinate(), y: coordinate(), zoom: randomZoom(random) },
        point: { x: coordinate(), y: coordinate() },
        zoom: randomZoom(random),
      };
    }
  }

  function* gridSamples(): Generator<Sample> {
    for (const viewport of VIEWPORTS) {
      for (const point of POINTS) for (const zoom of ZOOMS) yield { viewport, point, zoom };
    }
  }

  function roundTripError({ viewport, point }: Sample): number {
    return Math.max(
      axisError(screenToWorld(viewport, worldToScreen(viewport, point)), point),
      axisError(worldToScreen(viewport, screenToWorld(viewport, point)), point),
    );
  }

  /** Quanto o zoom ancorado tira do lugar: o ponto de mundo sob a âncora, e a âncora desse ponto. */
  function anchorDrift({ viewport, point: anchor, zoom }: Sample): number {
    const before = screenToWorld(viewport, anchor);
    const next = zoomAt(viewport, anchor, zoom);
    return Math.max(
      axisError(screenToWorld(next, anchor), before),
      axisError(worldToScreen(next, before), anchor),
    );
  }

  it('mundo → tela → mundo e tela → mundo → tela erram no máximo 1e-6 na grade de extremos', () => {
    expectWithinLimit(gridSamples(), roundTripError);
  });

  it('as duas idas e voltas erram no máximo 1e-6 em 20 mil amostras da faixa', () => {
    expectWithinLimit(randomSamples(20_000), roundTripError);
  });

  it('zoom ancorado tira o ponto sob a âncora do lugar no máximo 1e-6 na grade de extremos', () => {
    expectWithinLimit(gridSamples(), anchorDrift);
  });

  it('zoom ancorado tira o ponto sob a âncora do lugar no máximo 1e-6 em 20 mil amostras', () => {
    expectWithinLimit(randomSamples(20_000), anchorDrift);
  });

  it('mantém o limite com o viewport enquadrando a borda do mundo em qualquer zoom', () => {
    // Para mostrar o ponto de mundo W no pixel p é preciso o deslocamento p - W * zoom: na borda
    // do mundo com o zoom máximo ele chega a 160 milhões, 16 vezes o limite das coordenadas.
    function* framed(count: number): Generator<Sample & { readonly world: Point }> {
      const random = lcg(0xb07da);
      const nearEdge = (): number =>
        (random() < 0.5 ? -1 : 1) * WORLD_LIMIT * (1 - random() * 1e-3);
      for (let index = 0; index < count; index += 1) {
        const zoom = randomZoom(random);
        const world = { x: nearEdge(), y: nearEdge() };
        const point = { x: random() * 4096, y: random() * 4096 };
        const viewport = { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
        yield { viewport, world, point, zoom: randomZoom(random) };
      }
    }

    let largestOffset = 0;
    expectWithinLimit(framed(20_000), (sample) => {
      const { viewport, world, point } = sample;
      largestOffset = Math.max(largestOffset, Math.abs(viewport.x), Math.abs(viewport.y));
      return Math.max(
        axisError(worldToScreen(viewport, world), point),
        axisError(screenToWorld(viewport, point), world),
        axisError(screenToWorld(viewport, worldToScreen(viewport, world)), world),
        anchorDrift(sample),
      );
    });
    expect(largestOffset).toBeGreaterThan(15.9 * WORLD_LIMIT);
  });
});
