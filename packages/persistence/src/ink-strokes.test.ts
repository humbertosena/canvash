import { readFileSync } from 'node:fs';
import { createCanvasSection, type CanvasDocument, type InkNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';
import { MemoryStorageAdapter } from './storage.js';

const FIXTURE = new URL(
  '../../../tests/fixtures/documents/valid/ink-strokes.json',
  import.meta.url,
);

function loadFixture(): CanvasDocument {
  return (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { document: CanvasDocument }).document;
}

describe('traço à mão livre na persistência', () => {
  it('a fixture v1 é aceita e preserva traços, cores, tipos e espessuras', () => {
    const parsed = parseDocument(loadFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const pen = parsed.value.nodes['ink-pen'] as InkNode;
    expect(pen.strokes).toHaveLength(2);
    expect(pen.strokes[0]).toMatchObject({ kind: 'pen', width: 'medium', color: '#1f2937' });
    expect(pen.strokes[0]!.points).toHaveLength(4);
    expect(pen.strokes[1]).toMatchObject({ kind: 'marker', width: 'thick' });
    expect(parsed.value.nodes['ink-highlight']).toMatchObject({
      rotation: 0.1,
      style: { opacity: 0.8 },
      metadata: { 'app:autor': 'ana' },
    });
    expect((parsed.value.nodes['ink-highlight'] as InkNode).strokes[0]).toMatchObject({
      kind: 'highlighter',
      color: '#eab30880',
    });
    expect(parsed.value.nodes['ink-dot']).toMatchObject({ locked: true });
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

  it('um canvas carregado da fixture tem o mesmo conteúdo do documento lido', () => {
    const section = createCanvasSection();
    expect(section.replaceDocument(loadFixture()).ok).toBe(true);
    const parsed = parseDocument(loadFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(section.getSnapshot().document.nodes).toEqual(parsed.value.nodes);
  });

  it('o armazenamento devolve a fixture com os tipos intactos', async () => {
    const adapter = new MemoryStorageAdapter();
    expect((await adapter.save('ink', loadFixture())).ok).toBe(true);
    const loaded = await adapter.load('ink');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Object.values(loaded.value.document.nodes).map((node) => node.type)).toEqual([
      'ink',
      'ink',
      'ink',
    ]);
  });

  it.each([
    ['strokes', []],
    ['strokes', 'x'],
    ['width', 0],
    ['style', { opacity: 2 }],
  ])('recusa ink-pen com %s = %j', (field, value) => {
    const document = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    document.nodes['ink-pen']![field] = value;
    const parsed = parseDocument(document);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('INVALID_DOCUMENT');
  });

  it('recusa ponto fora da caixa e tipo de traço desconhecido', () => {
    const outside = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, { strokes: Array<Record<string, unknown>> }>;
    };
    outside.nodes['ink-pen']!.strokes[0]!['points'] = [{ x: 1.2, y: 0 }];
    expect(parseDocument(outside).ok).toBe(false);

    const kind = structuredClone(loadFixture()) as unknown as typeof outside;
    kind.nodes['ink-pen']!.strokes[0]!['kind'] = 'brush';
    expect(parseDocument(kind).ok).toBe(false);
  });
});
