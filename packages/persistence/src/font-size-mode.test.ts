import { readFileSync } from 'node:fs';
import {
  createCanvasSection,
  FONT_SIZE_PRESETS,
  type CanvasDocument,
  type TextNode,
} from '@canvash/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDocument } from './parse.js';
import { serializeDocument } from './serialize.js';

const FIXTURE = new URL(
  '../../../tests/fixtures/documents/valid/text-font-size.json',
  import.meta.url,
);

function loadFixture(): CanvasDocument {
  return (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { document: CanvasDocument }).document;
}

describe('fontSizeMode na persistência', () => {
  it('a fixture v1 é aceita e preserva os dois modos', () => {
    const parsed = parseDocument(loadFixture());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes['text-auto']).toMatchObject({ fontSizeMode: 'auto', fontSize: 16 });
    expect(parsed.value.nodes['text-fixed']).toMatchObject({ fontSizeMode: 'fixed', fontSize: 48 });
  });

  it('o JSON canônico de todo texto traz fontSizeMode, inclusive o carregado sem o campo', () => {
    const legacy = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    delete legacy.nodes['text-auto']!['fontSizeMode'];
    delete legacy.nodes['text-fixed']!['fontSizeMode'];

    const parsed = parseDocument(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const serialized = serializeDocument(parsed.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.value.match(/"fontSizeMode":"auto"/g)).toHaveLength(2);
  });

  it('recusa modo inválido na carga', () => {
    const broken = structuredClone(loadFixture()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    broken.nodes['text-fixed']!['fontSizeMode'] = 'huge';
    const parsed = parseDocument(broken);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('INVALID_DOCUMENT');
  });

  it('parse(serialize(doc)) é idempotente com textos nos dois modos e tamanhos quaisquer', () => {
    const textArb = fc.record({
      mode: fc.constantFrom('auto' as const, 'fixed' as const),
      fontSize: fc.oneof(
        fc.constantFrom(...FONT_SIZE_PRESETS),
        fc.double({ min: 1, max: 400, noNaN: true }),
      ),
      width: fc.integer({ min: 20, max: 800 }),
      text: fc.string({ maxLength: 60 }).filter((value) => !/[<>]/.test(value)),
    });

    fc.assert(
      fc.property(fc.array(textArb, { minLength: 1, maxLength: 6 }), (texts) => {
        const section = createCanvasSection();
        texts.forEach((entry, index) => {
          const result = section.dispatch({
            type: 'shape.create',
            shape: {
              id: `t-${index}`,
              type: 'text',
              x: index * 10,
              y: 0,
              width: entry.width,
              text: entry.text,
              fontSize: entry.fontSize,
              fontSizeMode: entry.mode,
            },
          });
          expect(result.ok).toBe(true);
        });

        const first = serializeDocument(section.getSnapshot().document);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const parsed = parseDocument(first.value);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const second = serializeDocument(parsed.value);
        expect(second.ok && second.value).toBe(first.value);

        texts.forEach((entry, index) => {
          const node = parsed.value.nodes[`t-${index}`] as TextNode;
          expect(node.fontSizeMode).toBe(entry.mode);
          expect(node.fontSize).toBe(entry.fontSize);
        });
      }),
      { numRuns: 60 },
    );
  });
});
