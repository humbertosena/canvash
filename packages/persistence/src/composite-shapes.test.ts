import { readFileSync } from 'node:fs';
import { createCanvasSection, type CanvasDocument } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';
import { MemoryStorageAdapter } from './storage.js';

const FIXTURE = new URL(
  '../../../tests/fixtures/documents/valid/composite-shapes.json',
  import.meta.url,
);

function loadFixture(): CanvasDocument {
  const { document } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { document: CanvasDocument };
  return document;
}

describe('cruz, chevron e chaves na persistência', () => {
  it('a fixture v1 é aceita e preserva todos os parâmetros', () => {
    const parsed = parseDocument(loadFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.nodes['cross-1']).toMatchObject({
      type: 'cross',
      armRatio: 0.4,
      rotation: 0.25,
    });
    expect(parsed.value.nodes['chevron-1']).toMatchObject({
      type: 'chevron',
      direction: 'down',
      notchDepth: 0.35,
      style: { fill: null },
    });
    expect(parsed.value.nodes['brace-1']).toMatchObject({
      type: 'brace',
      orientation: 'right',
      tipPosition: 0.3,
      curvature: 1,
      locked: true,
    });
    expect(parsed.value.nodes['brace-hidden-stroke']).toMatchObject({
      orientation: 'up',
      tipPosition: 0,
      curvature: 0,
      visible: false,
      style: { stroke: null, strokeWidth: 0 },
    });
  });

  it('parse(serialize(doc)) é idempotente e a serialização é determinística', () => {
    const first = serializeDocument(loadFixture());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const parsed = parseDocument(first.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const second = serializeDocument(parsed.value);
    expect(second.ok && second.value).toBe(first.value);
  });

  it('um canvas carregado da fixture exporta o mesmo documento', () => {
    const section = createCanvasSection();
    expect(section.replaceDocument(loadFixture()).ok).toBe(true);
    const parsed = parseDocument(loadFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(section.getSnapshot().document.nodes).toEqual(parsed.value.nodes);
  });

  it('o armazenamento devolve o documento com os três tipos intactos', async () => {
    const adapter = new MemoryStorageAdapter();
    const saved = await adapter.save('composite', loadFixture());
    expect(saved.ok).toBe(true);

    const loaded = await adapter.load('composite');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Object.values(loaded.value.document.nodes).map((node) => node.type)).toEqual([
      'cross',
      'chevron',
      'brace',
      'brace',
    ]);
  });

  it.each([
    ['cross-1', 'armRatio', 0.01],
    ['chevron-1', 'notchDepth', 0.9],
    ['chevron-1', 'direction', 'north'],
    ['brace-1', 'curvature', 3],
    ['brace-1', 'tipPosition', -1],
    ['brace-1', 'orientation', 'sideways'],
  ])('recusa %s com %s = %s', (id, field, value) => {
    const document = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    document.nodes[id]![field] = value;

    const parsed = parseDocument(document);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('INVALID_DOCUMENT');
  });

  it('recusa chaves com preenchimento', () => {
    const document = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, { style: Record<string, unknown> }>;
    };
    document.nodes['brace-1']!.style['fill'] = '#ffffff';
    expect(parseDocument(document).ok).toBe(false);
  });
});
