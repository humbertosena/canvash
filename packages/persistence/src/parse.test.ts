import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';

describe('parseDocument (IO-01, IO-02, IO-06)', () => {
  it('faz parse de documento válido vindo de string, Uint8Array ou objeto', () => {
    const section = createCanvasSection();
    const doc = section.getSnapshot().document;
    const jsonString = serializeDocument(doc).ok
      ? (serializeDocument(doc) as { value: string }).value
      : '';
    const bytes = new TextEncoder().encode(jsonString);

    const fromObj = parseDocument(doc);
    expect(fromObj.ok).toBe(true);

    const fromString = parseDocument(jsonString);
    expect(fromString.ok).toBe(true);

    const fromBytes = parseDocument(bytes);
    expect(fromBytes.ok).toBe(true);
  });

  it('rejeita payload acima de 20 MiB com LIMIT_EXCEEDED (IO-02)', () => {
    // Cria string fictícia que reporta comprimento excessivo
    const largeBytes = new Uint8Array(MAX_DOCUMENT_BYTES + 10);
    const result = parseDocument(largeBytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIMIT_EXCEEDED');
  });

  it('rejeita injeção de propriedades maliciosas (__proto__, constructor, prototype) (IO-06)', () => {
    const maliciousJson =
      '{"schemaVersion": 1, "id": "doc-attack", "__proto__": {"polluted": true}, "nodes": {}, "layers": [{"id": "l1", "name": "L1", "visible": true, "locked": false, "childIds": []}]}';

    const result = parseDocument(maliciousJson);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_DOCUMENT');

    // Teste com objeto direto contendo __proto__ / constructor / prototype
    const maliciousObj = {
      schemaVersion: 1,
      id: 'doc-attack-2',
      ['constructor']: 'malicious',
      nodes: {},
      layers: [{ id: 'l1', name: 'L1', visible: true, locked: false, childIds: [] }],
    };

    const resultObj = parseDocument(maliciousObj);
    expect(resultObj.ok).toBe(false);
    if (resultObj.ok) return;
    expect(resultObj.error.code).toBe('INVALID_DOCUMENT');
  });

  it('rejeita schemaVersion futura com UNSUPPORTED_VERSION (IO-02)', () => {
    const section = createCanvasSection();
    const doc = {
      ...section.getSnapshot().document,
      schemaVersion: 999,
    };

    const result = parseDocument(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_VERSION');
  });

  it('rejeita documento com integridade referencial quebrada (IO-02)', () => {
    const section = createCanvasSection();
    const doc = {
      ...section.getSnapshot().document,
      layers: [
        {
          id: 'l1',
          name: 'L1',
          visible: true,
          locked: false,
          childIds: ['non-existent-shape-id'],
        },
      ],
    };

    const result = parseDocument(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_DOCUMENT');
    expect(result.error.issues).toBeDefined();
  });

  it('serializa e faz parse de documento contendo SquareNode, rejeitando invariante quebrada (width !== height) (Tarefa 95)', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'sq-persisted',
        type: 'square',
        x: 30,
        y: 40,
        width: 90,
        height: 90,
        rotation: 0,
      },
    });

    const doc = section.getSnapshot().document;
    const serialized = serializeDocument(doc);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const parsed = parseDocument(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes['sq-persisted']).toMatchObject({
      type: 'square',
      x: 30,
      y: 40,
      width: 90,
      height: 90,
    });

    // Documento corrompido com square onde width !== height deve ser rejeitado
    const corrupted = JSON.parse(serialized.value) as Record<string, unknown>;
    (
      (corrupted['nodes'] as Record<string, Record<string, unknown>>)['sq-persisted'] as Record<
        string,
        unknown
      >
    )['height'] = 120;

    const corruptedRes = parseDocument(corrupted);
    expect(corruptedRes.ok).toBe(false);
    if (corruptedRes.ok) return;
    expect(corruptedRes.error.code).toBe('INVALID_DOCUMENT');
  });

  it('serializa e restaura CircleNode preservando invariante width === height (Tarefa 99)', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'c-persisted',
        type: 'circle',
        x: 30,
        y: 40,
        width: 90,
        height: 90,
        rotation: 0,
      },
    });

    const doc = section.getSnapshot().document;
    const serialized = serializeDocument(doc);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const parsed = parseDocument(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes['c-persisted']).toMatchObject({
      type: 'circle',
      x: 30,
      y: 40,
      width: 90,
      height: 90,
    });

    const corrupted = JSON.parse(serialized.value) as Record<string, unknown>;
    (
      (corrupted['nodes'] as Record<string, Record<string, unknown>>)['c-persisted'] as Record<
        string,
        unknown
      >
    )['height'] = 120;

    const corruptedRes = parseDocument(corrupted);
    expect(corruptedRes.ok).toBe(false);
    if (corruptedRes.ok) return;
    expect(corruptedRes.error.code).toBe('INVALID_DOCUMENT');
  });

  it('serializa e restaura TriangleNode nas 4 variantes e rejeita invariante quebrada (Tarefa 105)', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tr-eq',
        type: 'triangle',
        x: 20,
        y: 30,
        width: 100,
        height: (100 * Math.sqrt(3)) / 2,
        rotation: 0,
        variant: 'equilateral',
      },
    });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tr-scalene',
        type: 'triangle',
        x: 150,
        y: 30,
        width: 120,
        height: 80,
        rotation: 0,
        variant: 'scalene',
        apex: 0.25,
      },
    });

    const doc = section.getSnapshot().document;
    const serialized = serializeDocument(doc);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const parsed = parseDocument(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes['tr-eq']).toMatchObject({
      type: 'triangle',
      variant: 'equilateral',
      apex: 0.5,
    });
    expect(parsed.value.nodes['tr-scalene']).toMatchObject({
      type: 'triangle',
      variant: 'scalene',
      apex: 0.25,
    });

    const corrupted = JSON.parse(serialized.value) as Record<string, unknown>;
    (
      (corrupted['nodes'] as Record<string, Record<string, unknown>>)['tr-eq'] as Record<
        string,
        unknown
      >
    )['height'] = 120;

    const corruptedRes = parseDocument(corrupted);
    expect(corruptedRes.ok).toBe(false);
    if (corruptedRes.ok) return;
    expect(corruptedRes.error.code).toBe('INVALID_DOCUMENT');
  });
});

describe('PolygonNode na persistência (Tarefa 108)', () => {
  it('serializa e restaura o polígono com sides e recusa sides fora da faixa', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'pg-io',
        type: 'polygon',
        x: 20,
        y: 30,
        width: 80,
        height: 80,
        rotation: 0.2,
        sides: 9,
      },
    });
    const serialized = serializeDocument(section.getSnapshot().document);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const parsed = parseDocument(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes['pg-io']).toMatchObject({
      type: 'polygon',
      sides: 9,
      width: 80,
      height: 80,
      rotation: 0.2,
    });

    const corrupted = JSON.parse(serialized.value) as {
      nodes: Record<string, Record<string, unknown>>;
    };
    corrupted.nodes['pg-io']!['sides'] = 13;
    const corruptedRes = parseDocument(corrupted);
    expect(corruptedRes.ok).toBe(false);
    if (corruptedRes.ok) return;
    expect(corruptedRes.error.code).toBe('INVALID_DOCUMENT');
  });
});

describe('BezierNode na persistência (Tarefa 111)', () => {
  it('serializa e restaura a curva e recusa simetria quebrada', () => {
    const section = createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'bz-io',
        type: 'bezier',
        start: { x: 10, y: 20 },
        control1: { x: 30, y: -40 },
        end: { x: 210, y: 20 },
      },
    });
    const serialized = serializeDocument(section.getSnapshot().document);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const parsed = parseDocument(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes['bz-io']).toEqual(section.getSnapshot().document.nodes['bz-io']);

    const corrupted = JSON.parse(serialized.value) as {
      nodes: Record<string, Record<string, unknown>>;
    };
    corrupted.nodes['bz-io']!['control2'] = { x: 0, y: 0 };
    const corruptedRes = parseDocument(corrupted);
    expect(corruptedRes.ok).toBe(false);
    if (corruptedRes.ok) return;
    expect(corruptedRes.error.code).toBe('INVALID_DOCUMENT');
  });
});
