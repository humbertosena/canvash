import { readFileSync } from 'node:fs';
import {
  createCanvasSection,
  fitStickyFontSize,
  type CanvasDocument,
  type StickyNode,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';
import { MemoryStorageAdapter } from './storage.js';

const FIXTURE = new URL(
  '../../../tests/fixtures/documents/valid/sticky-note.json',
  import.meta.url,
);

function loadFixture(): CanvasDocument {
  return (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { document: CanvasDocument }).document;
}

describe('nota adesiva na persistência', () => {
  it('a fixture v1 é aceita e preserva cor, texto, modo e vínculo da seta', () => {
    const parsed = parseDocument(loadFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.nodes['note-auto']).toMatchObject({
      type: 'sticky',
      fontSizeMode: 'auto',
      style: { fill: '#fff59d' },
    });
    expect(parsed.value.nodes['note-fixed']).toMatchObject({
      fontSizeMode: 'fixed',
      fontSize: 20,
      text: 'Linha um\nLinha dois',
      rotation: 0.15,
      style: { fill: '#bbdefb', stroke: '#1e3a8a' },
      metadata: { 'app:autor': 'ana' },
    });
    expect(parsed.value.nodes['note-dark']).toMatchObject({ locked: true, text: '' });
    expect(parsed.value.nodes['arrow-1']).toMatchObject({
      start: { targetId: 'note-auto' },
      end: { targetId: 'note-fixed' },
    });
  });

  it('no modo automático o tamanho gravado vale o ajuste, e a carga o refaz se divergir', () => {
    const parsed = parseDocument(loadFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const auto = parsed.value.nodes['note-auto'] as StickyNode;
    expect(auto.fontSize).toBe(fitStickyFontSize(auto));

    const stale = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    stale.nodes['note-auto']!['fontSize'] = 9;
    const reloaded = parseDocument(stale);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect((reloaded.value.nodes['note-auto'] as StickyNode).fontSize).toBe(auto.fontSize);
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
    expect((await adapter.save('sticky', loadFixture())).ok).toBe(true);
    const loaded = await adapter.load('sticky');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Object.values(loaded.value.document.nodes).map((node) => node.type)).toEqual([
      'sticky',
      'sticky',
      'sticky',
      'arrow',
    ]);
  });

  it.each([
    ['note-fixed', 'fontSizeMode', 'huge'],
    ['note-fixed', 'text', '<b>x</b>'],
    ['note-fixed', 'fontSize', 0],
    ['note-fixed', 'width', -5],
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

  it('recusa a nota sem cor de fundo', () => {
    const document = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, { style: Record<string, unknown> }>;
    };
    document.nodes['note-auto']!.style['fill'] = null;
    expect(parseDocument(document).ok).toBe(false);
  });
});
