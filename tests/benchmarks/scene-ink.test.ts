import { describe, expect, it } from 'vitest';
import { generateInkBenchmarkScene } from './scene-ink.js';

describe('gerador da cena de benchmark da caneta', () => {
  it('é determinístico com semente fixa e muda com outra', () => {
    expect(generateInkBenchmarkScene(42, 50, 20)).toEqual(generateInkBenchmarkScene(42, 50, 20));
    expect(generateInkBenchmarkScene(7, 50, 20)).not.toEqual(generateInkBenchmarkScene(42, 50, 20));
  });

  it('gera 1.000 elementos de 200 pontos, num documento schema v1', () => {
    const doc = generateInkBenchmarkScene();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.id).toBe('doc-benchmark-ink-42');
    expect(Object.keys(doc.nodes)).toHaveLength(1000);
    expect(doc.layers[0]!.childIds).toHaveLength(1000);
    for (const node of Object.values(doc.nodes)) {
      expect(node.type).toBe('ink');
      expect(node.strokes).toHaveLength(1);
      expect(node.strokes[0]!.points).toHaveLength(200);
    }
  });

  it('mistura tipos, espessuras e cores, com e sem rotação', () => {
    const nodes = Object.values(generateInkBenchmarkScene().nodes);
    const strokes = nodes.flatMap((node) => node.strokes);
    expect(new Set(strokes.map((s) => s.kind)).size).toBe(3);
    expect(new Set(strokes.map((s) => s.width)).size).toBe(3);
    expect(new Set(strokes.map((s) => s.color)).size).toBeGreaterThan(4);
    expect(nodes.some((node) => node.rotation === 0)).toBe(true);
    expect(nodes.some((node) => node.rotation !== 0)).toBe(true);
  });

  it('todos os pontos ficam em [0, 1], como o core exige de um traço local', () => {
    const doc = generateInkBenchmarkScene();
    for (const node of Object.values(doc.nodes)) {
      for (const p of node.strokes[0]!.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('os elementos ficam na área anunciada', () => {
    const nodes = Object.values(generateInkBenchmarkScene().nodes);
    expect(Math.min(...nodes.map((n) => n.x))).toBeGreaterThanOrEqual(-500);
    expect(Math.max(...nodes.map((n) => n.x))).toBeLessThanOrEqual(1500);
    expect(Math.min(...nodes.map((n) => n.y))).toBeGreaterThanOrEqual(-300);
    expect(Math.max(...nodes.map((n) => n.y))).toBeLessThanOrEqual(1000);
  });
});
