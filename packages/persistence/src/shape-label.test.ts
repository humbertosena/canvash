import { readFileSync } from 'node:fs';
import {
  createCanvasSection,
  isLabelable,
  type CanvasDocument,
  type LabelableNode,
} from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaveManager } from './autosave.js';
import { parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';
import { MemoryStorageAdapter } from './storage.js';

// O texto dentro das formas na persistência (spec shape-label, US-SL.13).

const FIXTURES = new URL('../../../tests/fixtures/documents/', import.meta.url);

function loadFixture(path: string): { document: unknown; expected?: unknown } {
  return JSON.parse(readFileSync(new URL(path, FIXTURES), 'utf8')) as {
    document: unknown;
    expected?: unknown;
  };
}

const loadValid = (): CanvasDocument =>
  loadFixture('valid/shape-labels.json').document as CanvasDocument;

describe('texto da forma na persistência (US-SL.13)', () => {
  it('a fixture v1 é aceita, com as nove formas e os campos do label preservados', () => {
    const parsed = parseDocument(loadValid());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const labelled = Object.values(parsed.value.nodes).filter(
      (node): node is LabelableNode => isLabelable(node) && node.label !== undefined,
    );
    expect(new Set(labelled.map((node) => node.type))).toEqual(
      new Set([
        'rectangle',
        'square',
        'ellipse',
        'circle',
        'diamond',
        'triangle',
        'polygon',
        'cross',
        'chevron',
      ]),
    );
    expect(parsed.value.nodes['square']).toMatchObject({
      label: { text: 'Quadrado', textAlign: 'left', verticalAlign: 'top' },
    });
    expect(parsed.value.nodes['ellipse']).toMatchObject({
      label: { fontSize: 20, fontWeight: 'bold' },
    });
    expect(parsed.value.nodes['colored']).toMatchObject({
      label: { color: '#ff5722', fontSize: 24 },
    });
    expect(parsed.value.nodes['rotated']).toMatchObject({ rotation: 0.5235987755982988 });
    expect(parsed.value.nodes['hollow']).toMatchObject({ style: { fill: null, stroke: null } });
  });

  it('um documento sem label continua válido, sem a chave', () => {
    const parsed = parseDocument(loadValid());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect('label' in parsed.value.nodes['plain']!).toBe(false);
  });

  it('parse(serialize(doc)) é idempotente e a serialização é determinística', () => {
    const first = serializeDocument(loadValid());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const parsed = parseDocument(first.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const second = serializeDocument(parsed.value);

    expect(second.ok && second.value).toBe(first.value);
    expect(parsed.value.nodes['rect']).toMatchObject({ label: { text: 'Retângulo' } });
  });

  it('um canvas carregado da fixture tem o mesmo conteúdo do documento lido', () => {
    const section = createCanvasSection();
    expect(section.replaceDocument(loadValid()).ok).toBe(true);
    const parsed = parseDocument(loadValid());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(section.getSnapshot().document.nodes).toEqual(parsed.value.nodes);
  });

  it('o armazenamento devolve o label com os tipos intactos', async () => {
    const adapter = new MemoryStorageAdapter();
    expect((await adapter.save('labels', loadValid())).ok).toBe(true);

    const loaded = await adapter.load('labels');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.document.nodes['ellipse']).toMatchObject({
      label: { text: 'Elipse', fontSize: 20, fontWeight: 'bold', color: null },
    });
  });

  it('a fixture inválida é recusada com o caminho e a regra esperados', () => {
    const fixture = loadFixture('invalid/shape-label-invalid.json');

    const parsed = parseDocument(fixture.document);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('INVALID_DOCUMENT');
    expect(JSON.stringify(parsed.error)).toContain('"label","verticalAlign"');
    expect(JSON.stringify(parsed.error)).toContain('"format"');
  });

  it.each([
    ['sem verticalAlign', (label: Record<string, unknown>) => delete label['verticalAlign']],
    ['com cor inválida', (label: Record<string, unknown>) => (label['color'] = 'azul')],
    ['com fontSize zero', (label: Record<string, unknown>) => (label['fontSize'] = 0)],
    ['com chave desconhecida', (label: Record<string, unknown>) => (label['extra'] = 1)],
  ])('recusa um label %s no documento carregado', (_name, mutate) => {
    const document = structuredClone(loadValid()) as unknown as {
      nodes: Record<string, { label: Record<string, unknown> }>;
    };
    mutate(document.nodes['rect']!.label);

    const parsed = parseDocument(document);

    expect(parsed.ok).toBe(false);
  });
});

describe('autosave do texto da forma (US-SL.13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('o autosave grava o label e o armazenamento o devolve', async () => {
    const section = createCanvasSection();
    const adapter = new MemoryStorageAdapter();
    const manager = createAutosaveManager(section, adapter, { key: 'doc-labels', debounceMs: 100 });
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 's1',
        type: 'diamond',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        label: { text: 'Salvo', verticalAlign: 'bottom' },
      },
    });

    await vi.advanceTimersByTimeAsync(150);
    const loaded = await adapter.load('doc-labels');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.document.nodes['s1']).toMatchObject({
      label: { text: 'Salvo', verticalAlign: 'bottom', textAlign: 'center' },
    });
    manager.destroy();
  });
});
