import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';

describe('serializeDocument (IO-01)', () => {
  it('gera serialização determinística canônica independente da ordem de inserção das chaves', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-canonical',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 150,
        height: 100,
        rotation: 0,
        style: {
          fill: '#3b82f6',
          stroke: '#1d4ed8',
          strokeWidth: 2,
          opacity: 1,
        },
      },
    });

    const doc1 = section.getSnapshot().document;

    // Constrói um objeto semanticamente idêntico mas com chaves em ordem invertida
    const invertedNode = {
      style: {
        opacity: 1,
        strokeWidth: 2,
        stroke: '#1d4ed8',
        fill: '#3b82f6',
      },
      locked: false,
      visible: true,
      rotation: 0,
      height: 100,
      width: 150,
      y: 20,
      x: 10,
      type: 'rectangle' as const,
      id: 'rect-canonical',
    };

    const doc2 = {
      metadata: undefined,
      layers: doc1.layers,
      nodes: {
        'rect-canonical': invertedNode,
      },
      id: doc1.id,
      schemaVersion: doc1.schemaVersion,
    };

    const res1 = serializeDocument(doc1);
    const res2 = serializeDocument(doc2 as unknown as typeof doc1);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (!res1.ok || !res2.ok) return;

    // As duas strings JSON devem ser estritamente idênticas byte a byte
    expect(res1.value).toBe(res2.value);

    // As chaves dentro do JSON gerado devem estar em ordem alfabética
    const idPos = res1.value.indexOf('"id"');
    const nodesPos = res1.value.indexOf('"nodes"');
    const schemaPos = res1.value.indexOf('"schemaVersion"');
    expect(idPos).toBeLessThan(nodesPos);
    expect(nodesPos).toBeLessThan(schemaPos);
  });

  it('preserva semanticamente o documento no roundtrip parse(serialize(doc)) (IO-01)', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'rect-roundtrip',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 120,
        height: 80,
        rotation: 0,
      },
    });

    const originalDoc = section.getSnapshot().document;
    const serialized = serializeDocument(originalDoc);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const parsed = parseDocument(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.id).toBe(originalDoc.id);
    expect(parsed.value.schemaVersion).toBe(originalDoc.schemaVersion);
    expect(parsed.value.layers).toEqual(originalDoc.layers);
    expect(parsed.value.nodes['rect-roundtrip']).toEqual(originalDoc.nodes['rect-roundtrip']);
  });

  it('recusa entradas inválidas com erro tipado', () => {
    // @ts-expect-error teste com valor inválido
    const res = serializeDocument(null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('INVALID_DOCUMENT');
  });
});
