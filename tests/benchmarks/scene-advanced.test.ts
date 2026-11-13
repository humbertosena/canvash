import { describe, expect, it } from 'vitest';
import { generateAdvancedBenchmarkScene } from './scene-advanced.js';

describe('gerador de cena avançada de benchmark (Marco 4)', () => {
  it('gera documento determinístico com semente fixa', () => {
    const doc1 = generateAdvancedBenchmarkScene(42, 100);
    const doc2 = generateAdvancedBenchmarkScene(42, 100);

    expect(doc1).toEqual(doc2);
  });

  it('gera documento com 10.000 nós e schema v1', () => {
    const doc = generateAdvancedBenchmarkScene(42, 10000);

    expect(doc.schemaVersion).toBe(1);
    expect(doc.id).toBe('doc-benchmark-advanced-42');
    expect(doc.layers.length).toBe(1);

    const nodeCount = Object.keys(doc.nodes).length;
    expect(nodeCount).toBe(10000);
  });

  it('contém todos os 5 tipos de nós: retângulo, elipse, texto, seta e grupo', () => {
    const doc = generateAdvancedBenchmarkScene(42, 1000);

    const counts: Record<string, number> = {
      rectangle: 0,
      ellipse: 0,
      text: 0,
      arrow: 0,
      group: 0,
    };

    for (const node of Object.values(doc.nodes)) {
      counts[node.type] = (counts[node.type] ?? 0) + 1;
    }

    expect(counts['rectangle']).toBeGreaterThan(0);
    expect(counts['ellipse']).toBeGreaterThan(0);
    expect(counts['text']).toBeGreaterThan(0);
    expect(counts['arrow']).toBeGreaterThan(0);
    expect(counts['group']).toBeGreaterThan(0);
  });

  it('grupos têm exatamente 1 nível e agrupam apenas shapes primitivos', () => {
    const doc = generateAdvancedBenchmarkScene(42, 1000);

    for (const node of Object.values(doc.nodes)) {
      if (node.type === 'group') {
        expect(node.childIds.length).toBeGreaterThanOrEqual(2);
        for (const childId of node.childIds) {
          const childNode = doc.nodes[childId];
          expect(childNode).toBeDefined();
          expect(childNode?.type).not.toBe('group');
        }
      }
    }
  });

  it('garante que todos os nós estão alocados na camada ou em exatamente um grupo', () => {
    const doc = generateAdvancedBenchmarkScene(42, 500);
    const layer = doc.layers[0]!;

    const placed = new Set<string>();
    for (const childId of layer.childIds) {
      expect(placed.has(childId)).toBe(false);
      placed.add(childId);
      const node = doc.nodes[childId];
      expect(node).toBeDefined();

      if (node?.type === 'group') {
        for (const subId of node.childIds) {
          expect(placed.has(subId)).toBe(false);
          placed.add(subId);
          expect(doc.nodes[subId]).toBeDefined();
        }
      }
    }

    expect(placed.size).toBe(Object.keys(doc.nodes).length);
  });

  it('setas têm marcadores válidos e extremos definidos', () => {
    const doc = generateAdvancedBenchmarkScene(42, 500);

    for (const node of Object.values(doc.nodes)) {
      if (node.type === 'arrow') {
        expect(node.start).toBeDefined();
        expect(node.end).toBeDefined();
        expect(['none', 'arrow', 'dot']).toContain(node.startMarker);
        expect(['none', 'arrow', 'dot']).toContain(node.endMarker);
      }
    }
  });
});
