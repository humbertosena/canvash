import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import { FONT_SIZE_PRESETS } from './shapes.js';
import { layoutText } from './text.js';
import type { TextNode } from './shapes.js';

function newSection(): CanvasSectionApi {
  let count = 0;
  return createCanvasSection({ generateId: () => `id-${++count}` });
}

const LONG_TEXT = 'Uma frase comprida o bastante para quebrar em várias linhas dentro da caixa';

function addText(section: CanvasSectionApi, extra: Record<string, unknown> = {}): TextNode {
  const result = section.dispatch({
    type: 'shape.create',
    shape: {
      id: 'text-1',
      type: 'text',
      x: 10,
      y: 20,
      width: 120,
      text: LONG_TEXT,
      ...extra,
    } as never,
  });
  expect(result.ok).toBe(true);
  return section.getSnapshot().document.nodes['text-1'] as TextNode;
}

const expectedHeight = (fontSize: number, width = 120): number =>
  layoutText(LONG_TEXT, {
    fontSize,
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    lineHeight: 1.25,
    maxWidth: width,
  }).height;

describe('FONT_SIZE_PRESETS', () => {
  it('tem os 17 tamanhos do roadmap, em ordem crescente, e está congelada', () => {
    expect(FONT_SIZE_PRESETS).toEqual([
      12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 120,
    ]);
    expect(Object.isFrozen(FONT_SIZE_PRESETS)).toBe(true);
    expect([...FONT_SIZE_PRESETS]).toEqual([...FONT_SIZE_PRESETS].sort((a, b) => a - b));
  });
});

describe('fontSizeMode no texto', () => {
  it('nasce em modo automático com 16', () => {
    const node = addText(newSection());
    expect(node).toMatchObject({ fontSizeMode: 'auto', fontSize: 16 });
  });

  it('guarda o modo dado na criação', () => {
    expect(addText(newSection(), { fontSizeMode: 'fixed', fontSize: 24 })).toMatchObject({
      fontSizeMode: 'fixed',
      fontSize: 24,
    });
  });

  it.each([
    ['diagonal', 'format'],
    [3, 'format'],
    [null, 'format'],
  ])('recusa o modo %s na criação, sem alterar o documento', (value, rule) => {
    const section = newSection();
    const before = section.getSnapshot();
    const result = section.dispatch({
      type: 'shape.create',
      shape: { type: 'text', x: 0, y: 0, width: 50, text: 'a', fontSizeMode: value } as never,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: { issues: [{ path: ['shape', 'fontSizeMode'], rule }] },
      },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('escolher um tamanho com o modo fixo recalcula a altura num só shape.update', () => {
    const section = newSection();
    const before = addText(section);
    expect(before.height).toBeCloseTo(expectedHeight(16), 9);

    const result = section.dispatch({
      type: 'shape.update',
      id: 'text-1',
      patch: { fontSizeMode: 'fixed', fontSize: 24 },
    });
    expect(result.ok).toBe(true);
    const after = section.getSnapshot().document.nodes['text-1'] as TextNode;
    expect(after).toMatchObject({ fontSizeMode: 'fixed', fontSize: 24 });
    expect(after.height).toBeCloseTo(expectedHeight(24), 9);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('voltar ao automático mantém o tamanho atual', () => {
    const section = newSection();
    addText(section, { fontSizeMode: 'fixed', fontSize: 32 });
    const before = section.getSnapshot().document.nodes['text-1'] as TextNode;

    section.dispatch({ type: 'shape.update', id: 'text-1', patch: { fontSizeMode: 'auto' } });
    expect(section.getSnapshot().document.nodes['text-1']).toMatchObject({
      fontSizeMode: 'auto',
      fontSize: 32,
      height: before.height,
    });
  });

  it('desfaz e refaz modo, tamanho e altura juntos', () => {
    const section = newSection();
    const original = addText(section);
    section.dispatch({
      type: 'shape.update',
      id: 'text-1',
      patch: { fontSizeMode: 'fixed', fontSize: 40 },
    });
    const changed = section.getSnapshot().document.nodes['text-1'] as TextNode;

    section.undo();
    expect(section.getSnapshot().document.nodes['text-1']).toMatchObject({
      fontSizeMode: 'auto',
      fontSize: 16,
      height: original.height,
    });
    section.redo();
    expect(section.getSnapshot().document.nodes['text-1']).toMatchObject({
      fontSizeMode: 'fixed',
      fontSize: 40,
      height: changed.height,
    });
  });

  it('um patch de outro campo não mexe no modo', () => {
    const section = newSection();
    addText(section, { fontSizeMode: 'fixed' });
    section.dispatch({ type: 'shape.update', id: 'text-1', patch: { text: 'curto' } });
    expect(section.getSnapshot().document.nodes['text-1']).toMatchObject({
      fontSizeMode: 'fixed',
    });
  });

  it('recusa modo inválido no patch e o campo em figura que não é texto', () => {
    const section = newSection();
    addText(section);
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    const before = section.getSnapshot();

    expect(
      section.dispatch({
        type: 'shape.update',
        id: 'text-1',
        patch: { fontSizeMode: 'huge' as never },
      }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'fontSizeMode'], rule: 'format' }] } },
    });
    expect(
      section.dispatch({ type: 'shape.update', id: 'r', patch: { fontSizeMode: 'fixed' } }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['patch', 'fontSizeMode'], rule: 'unknown-field' }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('fontSizeMode na carga do documento', () => {
  function documentWith(textExtra: Record<string, unknown>): {
    nodes: Record<string, Record<string, unknown>>;
  } {
    const section = newSection();
    addText(section);
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as {
      nodes: Record<string, Record<string, unknown>>;
    };
    delete doc.nodes['text-1']!['fontSizeMode'];
    doc.nodes['text-1'] = { ...doc.nodes['text-1']!, ...textExtra };
    return doc;
  }

  it('um texto gravado sem o campo carrega em modo automático', () => {
    const section = newSection();
    expect(section.replaceDocument(documentWith({})).ok).toBe(true);
    expect(section.getSnapshot().document.nodes['text-1']).toMatchObject({
      fontSizeMode: 'auto',
      fontSize: 16,
    });
  });

  it('guarda o modo fixo gravado', () => {
    const section = newSection();
    expect(section.replaceDocument(documentWith({ fontSizeMode: 'fixed', fontSize: 48 })).ok).toBe(
      true,
    );
    expect(section.getSnapshot().document.nodes['text-1']).toMatchObject({
      fontSizeMode: 'fixed',
      fontSize: 48,
    });
  });

  it('recusa valor inválido com VALIDATION_ERROR no caminho do campo', () => {
    expect(newSection().replaceDocument(documentWith({ fontSizeMode: 'huge' }))).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: {
          issues: [
            expect.objectContaining({ path: ['nodes', 'text-1', 'fontSizeMode'], rule: 'format' }),
          ],
        },
      },
    });
  });
});
