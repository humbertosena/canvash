import { readFileSync } from 'node:fs';
import {
  createCanvasSection,
  validateDocument,
  type BoardNode,
  type CanvasDocument,
} from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';
import { MemoryStorageAdapter } from './storage.js';

// O board na persistência (spec boards, US-BD.12): o JSON do schema 1 passa por parse e
// serialize sem perder pertença, título nem estilo, e os documentos inválidos são recusados.

const FIXTURES = new URL('../../../tests/fixtures/documents/', import.meta.url);

function loadFixture(path: string): { document: CanvasDocument } {
  return JSON.parse(readFileSync(new URL(path, FIXTURES), 'utf8')) as { document: CanvasDocument };
}

const boards = () => loadFixture('valid/boards.json').document;

describe('board na persistência', () => {
  it('serialize → parse devolve o documento igual em valor', () => {
    const serialized = serializeDocument(boards());
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const parsed = parseDocument(serialized.value);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(boards());
  });

  it('preserva childIds, título e estilo de cada board, e o grupo e a seta dentro do board', () => {
    const parsed = parseDocument(boards());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const a = parsed.value.nodes['board-a'] as BoardNode;
    expect(a).toMatchObject({
      type: 'board',
      title: 'Planejamento',
      style: { fill: '#eff6ff', fillOpacity: 0.6, stroke: '#d4d4d8' },
      childIds: ['card-1', 'group-1', 'link'],
    });
    expect(parsed.value.nodes['group-1']).toMatchObject({ type: 'group' });
    expect(parsed.value.nodes['link']).toMatchObject({ type: 'arrow' });
    expect(parsed.value.nodes['board-b']).toMatchObject({
      type: 'board',
      style: { fill: null, stroke: null },
    });
    expect(parsed.value.layers[0]!.childIds).not.toContain('card-1');
  });

  it('a serialização é determinística', () => {
    const first = serializeDocument(boards());
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
    expect(section.replaceDocument(boards()).ok).toBe(true);
    const parsed = parseDocument(boards());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(section.getSnapshot().document.nodes).toEqual(parsed.value.nodes);
    expect(section.getSnapshot().document.layers).toEqual(parsed.value.layers);
  });

  it('o armazenamento devolve a fixture com os boards intactos', async () => {
    const adapter = new MemoryStorageAdapter();
    expect((await adapter.save('boards', boards())).ok).toBe(true);

    const loaded = await adapter.load('boards');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.document).toEqual(boards());
  });

  it.each(['nested-board', 'board-in-group'])(
    'recusa a fixture %s com o mesmo erro de validateDocument',
    (name) => {
      const { document } = loadFixture(`invalid/${name}.json`);
      const validated = validateDocument(document);
      expect(validated.ok).toBe(false);
      if (validated.ok) return;
      const expected = (validated.error.details as { issues: unknown[] }).issues;

      const parsed = parseDocument(JSON.stringify(document));

      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error.code).toBe('INVALID_DOCUMENT');
      expect(parsed.error.issues).toEqual(expected);
      expect(parsed.error.issues!.length).toBeGreaterThan(0);
    },
  );

  it.each([
    ['title', 'x'.repeat(201)],
    ['title', 7],
    ['width', 0],
  ])('recusa um board com %s = %s', (field, value) => {
    const document = structuredClone(boards()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    document.nodes['board-a']![field] = value;

    expect(parseDocument(document).ok).toBe(false);
  });

  it('recusa um board com campo desconhecido', () => {
    const document = structuredClone(boards()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    document.nodes['board-a']!['rotation'] = 0.5;

    expect(parseDocument(document).ok).toBe(false);
  });
});
