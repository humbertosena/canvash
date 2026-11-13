import { createCanvasSection, type CanvasSectionApi, type CanvasPeer } from '@canvash/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPeerGhostCache,
  ghostIdsOf,
  GHOST_LINE_WIDTH,
  GHOST_OPACITY,
  MAX_GHOST_NODES,
  MAX_INK_POINTS,
  buildGhostParts,
  simplifyPolyline,
} from './peer-ghosts.js';

const COLOR = '#dc2626';
const STYLE = { fill: '#ffffff', stroke: '#000000', strokeWidth: 4, opacity: 1 };

const peer = (ids: string[], overrides: Partial<CanvasPeer> = {}): CanvasPeer => ({
  sessionId: 'outra',
  name: 'Bia',
  color: COLOR,
  cursor: null,
  selection: ids,
  selectedAt: 1,
  drag: { ids, dx: 30, dy: 10 },
  view: null,
  locks: ids,
  followed: false,
  ...overrides,
});

describe('silhueta simplificada do arrasto remoto (US-DP.4, US-DP.5, US-DP.7)', () => {
  let section: CanvasSectionApi;

  const create = (shape: Record<string, unknown>) =>
    expect(section.dispatch({ type: 'shape.create', shape: shape as never }).ok).toBe(true);
  const box = (id: string, type: string, x = 0, extra: Record<string, unknown> = {}) =>
    create({ id, type, x, y: 0, width: 100, height: 60, rotation: 0.4, style: STYLE, ...extra });
  const parts = (ids: string[], zoom = 1) =>
    buildGhostParts(section.getSnapshot().document, ids, COLOR, zoom);

  beforeEach(() => {
    section = createCanvasSection();
  });

  it('formas geométricas viram o próprio contorno, rotacionado, sem preenchimento', () => {
    for (const [index, type] of [
      'rectangle',
      'ellipse',
      'diamond',
      'triangle',
      'cross',
    ].entries()) {
      box(`n${index}`, type, index * 120);
    }

    const result = parts(['n0', 'n1', 'n2', 'n3', 'n4'], 2);

    expect(result).toHaveLength(5);
    for (const part of result) {
      expect(part.kind).toBe('item');
      if (part.kind !== 'item' || part.item.type === 'board') continue;
      expect(part.item.style).toEqual({
        fill: null,
        stroke: COLOR,
        strokeWidth: GHOST_LINE_WIDTH / 2,
        opacity: GHOST_OPACITY,
      });
      expect('rotation' in part.item ? part.item.rotation : 0).toBe(0.4);
    }
    expect(result.map((part) => (part.kind === 'item' ? part.item.type : ''))).toEqual([
      'rectangle',
      'ellipse',
      'diamond',
      'triangle',
      'cross',
    ]);
  });

  it('linha e bezier mantêm o traço', () => {
    create({
      id: 'l',
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 50, y: 50 },
      style: { stroke: '#000000', strokeWidth: 6, opacity: 1 },
    });
    create({
      id: 'b',
      type: 'bezier',
      start: { x: 0, y: 0 },
      end: { x: 60, y: 0 },
      style: { stroke: '#000000', strokeWidth: 6, opacity: 1 },
    });

    const result = parts(['l', 'b']);

    expect(result.map((part) => (part.kind === 'item' ? part.item.type : part.kind))).toEqual([
      'line',
      'bezier',
    ]);
  });

  it('texto e nota viram só o retângulo envolvente, sem o texto', () => {
    create({ id: 't', type: 'text', x: 10, y: 20, width: 200, text: 'Olá', fontSize: 16 });
    create({ id: 's', type: 'sticky', x: 300, y: 20, width: 120, height: 120, text: 'Nota' });

    const result = parts(['t', 's']);

    expect(result).toHaveLength(2);
    for (const part of result) {
      expect(part.kind).toBe('box');
      if (part.kind === 'box') expect(part.dashed).toBe(false);
    }
    const first = result[0];
    expect(first?.kind === 'box' ? first.bounds.x : -1).toBe(10);
  });

  it('tinta vira uma polilinha de no máximo 64 pontos, e uma reta colapsa em dois', () => {
    const wavy = Array.from({ length: 500 }, (_, i) => ({ x: i, y: Math.sin(i / 5) * 50 }));
    const straight = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 10 }));
    create({ id: 'i', type: 'ink', strokes: [{ points: wavy }, { points: straight }] });

    const result = parts(['i']);

    expect(result).toHaveLength(2);
    for (const part of result) expect(part.kind).toBe('polyline');
    const [curve, line] = result;
    expect(curve?.kind === 'polyline' ? curve.points.length : 0).toBeLessThanOrEqual(
      MAX_INK_POINTS,
    );
    expect(line?.kind === 'polyline' ? line.points : []).toHaveLength(2);
  });

  it('acima de 20 nós, desenha só a caixa da união, tracejada', () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_GHOST_NODES + 1; i += 1) {
      const id = `n${i}`;
      ids.push(id);
      box(id, 'rectangle', i * 10, { rotation: 0 });
    }

    const result = parts(ids);

    expect(result).toHaveLength(1);
    const only = result[0];
    expect(only?.kind).toBe('box');
    if (only?.kind === 'box') {
      expect(only.dashed).toBe(true);
      expect(only.bounds.x).toBeLessThanOrEqual(0);
      expect(only.bounds.x + only.bounds.width).toBeGreaterThanOrEqual(20 * 10 + 100);
    }
  });

  it('exatamente 20 nós ainda desenha cada silhueta', () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_GHOST_NODES; i += 1) {
      ids.push(`n${i}`);
      box(`n${i}`, 'rectangle', i * 10);
    }

    expect(parts(ids)).toHaveLength(MAX_GHOST_NODES);
  });

  it('ids desconhecidos não desenham nada', () => {
    box('a', 'rectangle');

    expect(parts(['fantasma'])).toEqual([]);
    expect(parts(['fantasma', 'a'])).toHaveLength(1);
  });

  describe('ghostIdsOf: quem pode arrastar o quê', () => {
    it('só entram os nós que o remetente detém e que o documento conhece', () => {
      box('a', 'rectangle');
      box('b', 'rectangle', 200);
      section.setPeers([peer(['a'], { drag: { ids: ['a', 'b', 'fantasma'], dx: 1, dy: 1 } })]);

      expect(ghostIdsOf(section, section.getPeers()[0]!)).toEqual(['a']);
    });

    it('um drag sobre nós sem bloqueio, ou sem drag, não devolve nada', () => {
      box('a', 'rectangle');
      section.setPeers([peer([], { drag: { ids: ['a'], dx: 1, dy: 1 }, locks: [] })]);
      expect(ghostIdsOf(section, section.getPeers()[0]!)).toEqual([]);

      section.setPeers([peer(['a'], { drag: null })]);
      expect(ghostIdsOf(section, section.getPeers()[0]!)).toEqual([]);
    });

    it('um drag sobre o membro de um grupo travado pelo remetente vale', () => {
      box('m1', 'rectangle');
      box('m2', 'rectangle', 200);
      section.dispatch({ type: 'group.create', id: 'g', childIds: ['m1', 'm2'] });
      section.setPeers([peer(['g'], { drag: { ids: ['m1', 'm2'], dx: 5, dy: 5 } })]);

      expect(ghostIdsOf(section, section.getPeers()[0]!)).toEqual(['m1', 'm2']);
    });
  });

  describe('cache por gesto', () => {
    it('reaproveita as partes entre amostras do gesto', () => {
      box('a', 'rectangle');
      section.setPeers([peer(['a'])]);
      const cache = createPeerGhostCache();
      const first = cache.get(section, section.getPeers()[0]!, 1);

      section.setPeers([peer(['a'], { drag: { ids: ['a'], dx: 90, dy: 90 } })]);
      const second = cache.get(section, section.getPeers()[0]!, 1);

      expect(first).not.toBeNull();
      expect(second).toBe(first);
    });

    it('quando o nó muda no documento (commit), a prévia cai até o gesto acabar', () => {
      box('a', 'rectangle');
      section.setPeers([peer(['a'])]);
      const cache = createPeerGhostCache();
      expect(cache.get(section, section.getPeers()[0]!, 1)).not.toBeNull();

      section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 200 } });
      expect(cache.get(section, section.getPeers()[0]!, 1)).toBeNull();
      expect(cache.get(section, section.getPeers()[0]!, 1)).toBeNull();

      // O fim do gesto (drag nulo) zera o cache; o próximo arrasto volta a desenhar.
      cache.retain(new Set());
      expect(cache.get(section, section.getPeers()[0]!, 1)).not.toBeNull();
    });

    it('recalcula quando o zoom muda e quando os nós do gesto mudam', () => {
      box('a', 'rectangle');
      box('b', 'rectangle', 200);
      section.setPeers([peer(['a'])]);
      const cache = createPeerGhostCache();
      const base = cache.get(section, section.getPeers()[0]!, 1);

      expect(cache.get(section, section.getPeers()[0]!, 2)).not.toBe(base);

      section.setPeers([peer(['a', 'b'])]);
      expect(cache.get(section, section.getPeers()[0]!, 1)).not.toBe(base);
    });

    it('guarda um por participante e esquece o que saiu', () => {
      box('a', 'rectangle');
      box('b', 'rectangle', 200);
      section.setPeers([
        peer(['a']),
        peer(['b'], { sessionId: 'outra2', name: 'Caio', color: '#16a34a' }),
      ]);
      const cache = createPeerGhostCache();
      const [one, two] = section.getPeers();
      const first = cache.get(section, one!, 1);
      const second = cache.get(section, two!, 1);

      expect(first).not.toBe(second);
      expect(cache.get(section, one!, 1)).toBe(first);

      cache.retain(new Set(['outra2']));
      expect(cache.get(section, one!, 1)).not.toBe(first);
      expect(cache.get(section, two!, 1)).toBe(second);
    });

    it('devolve null sem nada para desenhar', () => {
      section.setPeers([peer(['fantasma'])]);

      expect(createPeerGhostCache().get(section, section.getPeers()[0]!, 1)).toBeNull();
    });
  });
});

describe('simplifyPolyline (Douglas-Peucker)', () => {
  it('mantém as pontas e descarta pontos dentro da tolerância', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0.5 },
      { x: 10, y: 0 },
    ];

    expect(simplifyPolyline(points, 1, 64)).toEqual([points[0], points[2]]);
  });

  it('preserva o pico que passa da tolerância', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 8 },
      { x: 10, y: 0 },
    ];

    expect(simplifyPolyline(points, 1, 64)).toHaveLength(3);
  });

  it('limita ao máximo de pontos, mantendo a primeira e a última', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i % 2 === 0 ? 0 : 100 }));

    const result = simplifyPolyline(points, 0.1, 64);

    expect(result.length).toBeLessThanOrEqual(64);
    expect(result[0]).toEqual(points[0]);
    expect(result.at(-1)).toEqual(points.at(-1));
  });

  it('trata listas curtas', () => {
    expect(simplifyPolyline([], 1, 64)).toEqual([]);
    expect(simplifyPolyline([{ x: 1, y: 1 }], 1, 64)).toEqual([{ x: 1, y: 1 }]);
    expect(
      simplifyPolyline(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        1,
        64,
      ),
    ).toHaveLength(2);
  });
});
