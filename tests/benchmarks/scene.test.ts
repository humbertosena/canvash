import { describe, expect, it } from 'vitest';
import { createPrng, generateBenchmarkScene } from './scene.js';

describe('gerador determinístico de cena de benchmark (RENDER-06)', () => {
  it('PRNG com semente fixa produz sequência determinística exata', () => {
    const prng1 = createPrng(42);
    const prng2 = createPrng(42);

    const seq1 = Array.from({ length: 10 }, () => prng1());
    const seq2 = Array.from({ length: 10 }, () => prng2());

    expect(seq1).toEqual(seq2);
    expect(seq1[0]).toBeGreaterThanOrEqual(0);
    expect(seq1[0]).toBeLessThan(1);
  });

  it('gera documento válido com 10.000 nós no schema v1', () => {
    const doc = generateBenchmarkScene(42, 10000);

    expect(doc.schemaVersion).toBe(1);
    expect(doc.id).toBe('doc-benchmark-42');
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0]?.childIds.length).toBe(10000);

    const nodeKeys = Object.keys(doc.nodes);
    expect(nodeKeys.length).toBe(10000);

    // Confere primeiro e último nó
    const firstNode = doc.nodes['node-0'];
    expect(firstNode).toBeDefined();
    expect(firstNode?.type).toBe('rectangle');
    expect(firstNode?.visible).toBe(true);
    expect(firstNode?.locked).toBe(false);

    const secondNode = doc.nodes['node-1'];
    expect(secondNode).toBeDefined();
    expect(secondNode?.type).toBe('ellipse');
  });

  it('garante distribuição balanceada de retângulos e elipses', () => {
    const doc = generateBenchmarkScene(100, 1000);
    let rectCount = 0;
    let ellipseCount = 0;

    for (const node of Object.values(doc.nodes)) {
      if (node.type === 'rectangle') rectCount += 1;
      if (node.type === 'ellipse') ellipseCount += 1;
    }

    expect(rectCount).toBe(500);
    expect(ellipseCount).toBe(500);
  });
});
