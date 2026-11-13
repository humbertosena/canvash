import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import { fitStickyFontSize } from './sticky.js';
import type { StickyNode } from './shapes.js';

function newSection(): CanvasSectionApi {
  let count = 0;
  return createCanvasSection({ generateId: () => `id-${++count}` });
}

function addSticky(section: CanvasSectionApi, extra: Record<string, unknown> = {}): StickyNode {
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id: 'note-1', type: 'sticky', x: 10, y: 20, ...extra } as never,
  });
  expect(result.ok).toBe(true);
  return section.getSnapshot().document.nodes['note-1'] as StickyNode;
}

const node = (section: CanvasSectionApi): StickyNode =>
  section.getSnapshot().document.nodes['note-1'] as StickyNode;

describe('StickyNode: criação', () => {
  it('nasce amarela, 200 × 200, sem contorno, em modo automático e com texto vazio', () => {
    const created = addSticky(newSection());
    expect(created).toMatchObject({
      type: 'sticky',
      x: 10,
      y: 20,
      width: 200,
      height: 200,
      rotation: 0,
      text: '',
      fontSizeMode: 'auto',
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      textAlign: 'left',
      lineHeight: 1.25,
      visible: true,
      locked: false,
      style: { fill: '#fff59d', stroke: null, strokeWidth: 0, opacity: 1 },
    });
    expect(created.fontSize).toBe(120);
  });

  it('guarda os campos dados e escolhe a fonte pelo ajuste no modo automático', () => {
    const created = addSticky(newSection(), {
      width: 150,
      height: 120,
      rotation: 0.3,
      text: 'Reunião de planejamento do trimestre',
      fontSize: 99,
      textAlign: 'center',
      fontWeight: 'bold',
      lineHeight: 1.5,
      style: { fill: '#f8bbd0', stroke: '#000000', strokeWidth: 1 },
      metadata: { 'app:tag': 'x' },
    });
    expect(created).toMatchObject({
      width: 150,
      height: 120,
      rotation: 0.3,
      textAlign: 'center',
      fontWeight: 'bold',
      lineHeight: 1.5,
      style: { fill: '#f8bbd0', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      metadata: { 'app:tag': 'x' },
    });
    expect(created.fontSize).toBe(fitStickyFontSize(created));
    expect(created.fontSize).not.toBe(99);
  });

  it('no modo fixo, o tamanho dado vale', () => {
    expect(
      addSticky(newSection(), { fontSizeMode: 'fixed', fontSize: 28, text: 'a' }),
    ).toMatchObject({
      fontSizeMode: 'fixed',
      fontSize: 28,
    });
  });

  it.each([
    ['text', '<b>oi</b>', ['shape', 'text'], 'format'],
    ['width', 0, ['shape', 'width'], 'range'],
    ['fontSizeMode', 'huge', ['shape', 'fontSizeMode'], 'format'],
    ['fontSize', -4, ['shape', 'fontSize'], 'range'],
    ['textAlign', 'justify', ['shape', 'textAlign'], 'format'],
    ['armRatio', 0.5, ['shape', 'armRatio'], 'unknown-field'],
    ['style', { fill: null }, ['shape', 'style', 'fill'], 'type'],
    ['style', { fill: 'amarelo' }, ['shape', 'style', 'fill'], 'format'],
  ])('recusa %s inválido na criação, sem alterar o documento', (field, value, path, rule) => {
    const section = newSection();
    const before = section.getSnapshot();
    const result = section.dispatch({
      type: 'shape.create',
      shape: { type: 'sticky', x: 0, y: 0, [field]: value } as never,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', details: { issues: [{ path, rule }] } },
    });
    expect(section.getSnapshot()).toBe(before);
  });

  it('exige a posição', () => {
    const section = newSection();
    expect(
      section.dispatch({ type: 'shape.create', shape: { type: 'sticky', x: 5 } as never }),
    ).toMatchObject({
      ok: false,
      error: { details: { issues: [{ path: ['shape', 'y'], rule: 'type' }] } },
    });
  });
});

describe('StickyNode: ajuste automático da fonte no patch', () => {
  const LONG = 'Uma frase comprida o bastante para obrigar a fonte a encolher dentro da nota';

  it('mudar o texto refaz o tamanho e digitar mais não o aumenta', () => {
    const section = newSection();
    addSticky(section, { text: 'Oi' });
    const short = node(section).fontSize;

    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { text: LONG } });
    const long = node(section).fontSize;
    expect(long).toBeLessThan(short);
    expect(long).toBe(fitStickyFontSize(node(section)));

    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { text: 'Oi' } });
    expect(node(section).fontSize).toBe(short);
  });

  it('redimensionar refaz o tamanho: nota maior não diminui, menor não aumenta', () => {
    const section = newSection();
    addSticky(section, { text: LONG });
    const base = node(section).fontSize;

    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { width: 400, height: 400 } });
    expect(node(section).fontSize).toBeGreaterThan(base);
    expect(node(section).fontSize).toBe(fitStickyFontSize(node(section)));

    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { height: 60 } });
    expect(node(section).fontSize).toBeLessThanOrEqual(base);
  });

  it('o modo fixo não refaz o tamanho', () => {
    const section = newSection();
    addSticky(section, { text: LONG, fontSizeMode: 'fixed', fontSize: 40 });
    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { text: 'curto', width: 500 } });
    expect(node(section)).toMatchObject({ fontSize: 40, fontSizeMode: 'fixed' });
  });

  it('voltar ao automático refaz o tamanho; passar ao fixo com tamanho o guarda', () => {
    const section = newSection();
    addSticky(section, { text: LONG, fontSizeMode: 'fixed', fontSize: 120 });

    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { fontSizeMode: 'auto' } });
    expect(node(section).fontSize).toBe(fitStickyFontSize(node(section)));
    expect(node(section).fontSize).toBeLessThan(120);

    section.dispatch({
      type: 'shape.update',
      id: 'note-1',
      patch: { fontSizeMode: 'fixed', fontSize: 24 },
    });
    expect(node(section)).toMatchObject({ fontSizeMode: 'fixed', fontSize: 24 });
  });

  it('família, peso e entrelinha também refazem o tamanho no modo automático', () => {
    const section = newSection();
    addSticky(section, { text: LONG });
    const base = node(section).fontSize;
    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { lineHeight: 3 } });
    expect(node(section).fontSize).toBeLessThanOrEqual(base);
    expect(node(section).fontSize).toBe(fitStickyFontSize(node(section)));
    section.dispatch({
      type: 'shape.update',
      id: 'note-1',
      patch: { fontFamily: 'serif', fontWeight: 'bold' },
    });
    expect(node(section).fontSize).toBe(fitStickyFontSize(node(section)));
  });

  it('um patch de cor ou de alinhamento não mexe no tamanho', () => {
    const section = newSection();
    addSticky(section, { text: LONG });
    const base = node(section).fontSize;
    section.dispatch({
      type: 'shape.update',
      id: 'note-1',
      patch: { style: { fill: '#bbdefb' }, textAlign: 'right' },
    });
    expect(node(section)).toMatchObject({
      fontSize: base,
      textAlign: 'right',
      style: { fill: '#bbdefb' },
    });
  });

  it('desfaz e refaz texto e tamanho juntos', () => {
    const section = newSection();
    addSticky(section, { text: 'Oi' });
    const before = node(section);
    section.dispatch({ type: 'shape.update', id: 'note-1', patch: { text: LONG } });
    const after = node(section);

    section.undo();
    expect(node(section)).toMatchObject({ text: 'Oi', fontSize: before.fontSize });
    section.redo();
    expect(node(section)).toMatchObject({ text: LONG, fontSize: after.fontSize });
  });

  it('recusa preenchimento nulo, HTML e campo de outra figura no patch', () => {
    const section = newSection();
    addSticky(section);
    const before = section.getSnapshot();
    const refuse = (patch: Record<string, unknown>, path: string[], rule: string) =>
      expect(
        section.dispatch({ type: 'shape.update', id: 'note-1', patch: patch as never }),
      ).toMatchObject({
        ok: false,
        error: { details: { issues: [{ path: ['patch', ...path], rule }] } },
      });
    refuse({ style: { fill: null } }, ['style', 'fill'], 'type');
    refuse({ text: '<script>' }, ['text'], 'format');
    refuse({ sides: 5 }, ['sides'], 'unknown-field');
    refuse({ fontSizeMode: 'x' }, ['fontSizeMode'], 'format');
    expect(section.getSnapshot()).toBe(before);
  });
});

describe('StickyNode: carga do documento', () => {
  function documentWith(extra: Record<string, unknown>): {
    nodes: Record<string, Record<string, unknown>>;
  } {
    const section = newSection();
    addSticky(section, { text: 'Anotação importante para guardar' });
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as {
      nodes: Record<string, Record<string, unknown>>;
    };
    doc.nodes['note-1'] = { ...doc.nodes['note-1']!, ...extra };
    return doc;
  }

  it('round-trip preserva a nota', () => {
    const section = newSection();
    addSticky(section, { text: 'Anotação', style: { fill: '#d1c4e9' } });
    const doc = JSON.parse(JSON.stringify(section.getSnapshot().document)) as unknown;
    const copy = newSection();
    expect(copy.replaceDocument(doc).ok).toBe(true);
    expect(copy.getSnapshot().document.nodes['note-1']).toEqual(node(section));
  });

  it('no modo automático a carga refaz o tamanho, qualquer que seja o gravado', () => {
    const section = newSection();
    expect(section.replaceDocument(documentWith({ fontSize: 7 })).ok).toBe(true);
    expect(node(section).fontSize).toBe(fitStickyFontSize(node(section)));
  });

  it('no modo fixo a carga guarda o tamanho gravado', () => {
    const section = newSection();
    expect(section.replaceDocument(documentWith({ fontSizeMode: 'fixed', fontSize: 33 })).ok).toBe(
      true,
    );
    expect(node(section)).toMatchObject({ fontSizeMode: 'fixed', fontSize: 33 });
  });

  it('um documento sem fontSizeMode carrega em modo automático', () => {
    const doc = documentWith({});
    delete doc.nodes['note-1']!['fontSizeMode'];
    const section = newSection();
    expect(section.replaceDocument(doc).ok).toBe(true);
    expect(node(section).fontSizeMode).toBe('auto');
  });

  it.each([
    [
      { style: { fill: null, stroke: null, strokeWidth: 0, opacity: 1 } },
      ['style', 'fill'],
      'type',
    ],
    [{ text: '<i>x</i>' }, ['text'], 'format'],
    [{ fontSizeMode: 'huge' }, ['fontSizeMode'], 'format'],
    [{ width: -1 }, ['width'], 'range'],
  ])('recusa nota inválida na carga (%o)', (extra, path, rule) => {
    expect(newSection().replaceDocument(documentWith(extra))).toMatchObject({
      ok: false,
      error: {
        details: {
          issues: [expect.objectContaining({ path: ['nodes', 'note-1', ...path], rule })],
        },
      },
    });
  });
});

describe('StickyNode: preview e consultas', () => {
  it('aceita a nota como preview', () => {
    const section = newSection();
    expect(
      section.setPreview({
        additions: [{ id: 'p', type: 'sticky', x: 0, y: 0, width: 100, height: 100 }],
      }).ok,
    ).toBe(true);
    expect(section.getPreview()?.additions[0]).toMatchObject({ type: 'sticky', id: 'p' });
  });

  it('é atingida como um retângulo preenchido e some do hit-test fora da caixa', () => {
    const section = newSection();
    addSticky(section, { x: 0, y: 0, width: 100, height: 100 });
    const hit = (x: number, y: number) =>
      section.hitTest({ x, y }, { includePreview: false, tolerance: 0 });
    expect(hit(5, 5)).toBe('note-1');
    expect(hit(95, 95)).toBe('note-1');
    expect(hit(120, 50)).toBeUndefined();
    expect(
      section.queryMarquee(
        { x: 90, y: 90, width: 30, height: 30 },
        { includePreview: false, mode: 'intersect' },
      ),
    ).toEqual(['note-1']);
  });
});
