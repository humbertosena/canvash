import { describe, expect, it } from 'vitest';
import { generateLabelsBenchmarkScene, labelsBenchmarkText } from './scene-labels.js';

describe('gerador da cena de benchmark do texto nas formas', () => {
  it('é determinístico com semente fixa e muda com outra', () => {
    expect(generateLabelsBenchmarkScene(42, 200)).toEqual(generateLabelsBenchmarkScene(42, 200));
    expect(generateLabelsBenchmarkScene(7, 200)).not.toEqual(generateLabelsBenchmarkScene(42, 200));
  });

  it('gera 10.000 formas num documento schema v1, numa camada', () => {
    const doc = generateLabelsBenchmarkScene();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.id).toBe('doc-benchmark-labels-42');
    expect(Object.keys(doc.nodes)).toHaveLength(10000);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]!.childIds).toHaveLength(10000);
  });

  it('metade das formas tem texto, e todo texto tem três linhas', () => {
    const nodes = Object.values(generateLabelsBenchmarkScene().nodes);
    const labeled = nodes.filter((node) => node.label !== undefined);
    expect(labeled).toHaveLength(5000);
    for (const node of labeled) {
      expect(node.label!.text.split('\n')).toHaveLength(3);
      expect(node.label!.fontSize).toBe(14);
    }
  });

  it('o label é completo, como o documento guardado exige', () => {
    const doc = generateLabelsBenchmarkScene(42, 10);
    expect(doc.nodes['node-0']!.label).toEqual({
      text: labelsBenchmarkText(0),
      fontSize: 14,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      color: null,
      textAlign: 'center',
      verticalAlign: 'middle',
    });
  });

  it('o texto de cada forma é próprio dela', () => {
    const doc = generateLabelsBenchmarkScene();
    expect(doc.nodes['node-0']!.label!.text).toBe(labelsBenchmarkText(0));
    expect(doc.nodes['node-1']!.label).toBeUndefined();
    expect(labelsBenchmarkText(3)).not.toBe(labelsBenchmarkText(4));
  });

  it('mistura retângulos e elipses, com e sem texto', () => {
    const nodes = Object.values(generateLabelsBenchmarkScene().nodes);
    const count = (type: string, withLabel: boolean) =>
      nodes.filter((node) => node.type === type && (node.label !== undefined) === withLabel).length;
    for (const type of ['rectangle', 'ellipse']) {
      expect(count(type, true)).toBe(2500);
      expect(count(type, false)).toBe(2500);
    }
  });

  it('as formas ficam na área anunciada e têm o tamanho previsto', () => {
    const nodes = Object.values(generateLabelsBenchmarkScene().nodes);
    expect(Math.min(...nodes.map((n) => n.x))).toBeGreaterThanOrEqual(-2500);
    expect(Math.max(...nodes.map((n) => n.x))).toBeLessThanOrEqual(2500);
    expect(Math.min(...nodes.map((n) => n.y))).toBeGreaterThanOrEqual(-2000);
    expect(Math.max(...nodes.map((n) => n.y))).toBeLessThanOrEqual(2000);
    expect(Math.min(...nodes.map((n) => n.width))).toBeGreaterThanOrEqual(100);
    expect(Math.max(...nodes.map((n) => n.width))).toBeLessThanOrEqual(220);
    expect(Math.min(...nodes.map((n) => n.height))).toBeGreaterThanOrEqual(70);
    expect(Math.max(...nodes.map((n) => n.height))).toBeLessThanOrEqual(150);
  });
});
