import { STICKY_COLORS, createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasPropertiesElement } from './canvas-properties.js';

/** Texto do template: as partes fixas intercaladas com os valores, funções ignoradas. */
function templateText(result: unknown): string {
  if (Array.isArray(result)) return result.map(templateText).join('');
  if (result && typeof result === 'object' && 'strings' in result && 'values' in result) {
    const { strings, values } = result as { strings: readonly string[]; values: unknown[] };
    return strings.reduce(
      (text, part, i) => text + part + (i < values.length ? templateText(values[i]) : ''),
      '',
    );
  }
  if (typeof result === 'function' || result === undefined || result === null) return '';
  return String(result);
}

const fakeEvent = (value: string) =>
  ({ target: { value }, stopPropagation: () => {}, preventDefault: () => {} }) as unknown as Event;

interface TestableProperties {
  _onStickyColor(color: string): void;
  _onTextChange(e: Event): void;
  _onFontSizeChange(e: Event): void;
}

function setup(ids: string[] = ['n1']) {
  const el = new CanvasPropertiesElement();
  const section = createCanvasSection();
  el.section = section;
  ids.forEach((id, index) => {
    section.dispatch({
      type: 'shape.create',
      shape: { id, type: 'sticky', x: index * 300, y: 0, width: 200, height: 200, text: 'Ideia' },
    });
  });
  section.setSelection(ids);
  return {
    el,
    section,
    internals: el as unknown as TestableProperties,
    rendered: (): string => JSON.stringify(el.render()),
  };
}

describe('painel de propriedades: nota adesiva', () => {
  it('mostra a seção da nota com as 6 amostras e o seletor personalizado', () => {
    const { rendered } = setup();
    const html = rendered();
    expect(html).toContain('section-sticky');
    expect(html).toContain('Nota adesiva');
    for (const name of ['yellow', 'pink', 'green', 'blue', 'orange', 'purple']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('input-sticky-color');
  });

  it('esconde a seção quando não há nota selecionada', () => {
    const { el, section, rendered } = setup();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'rc', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    section.setSelection(['rc']);
    expect(rendered()).not.toContain('section-sticky');
    expect(el.render()).toBeDefined();
  });

  it('marca como selecionada a amostra da cor atual', () => {
    const { el, section, internals } = setup();
    internals._onStickyColor(STICKY_COLORS.blue);
    expect(section.getSnapshot().document.nodes['n1']).toMatchObject({
      style: { fill: STICKY_COLORS.blue },
    });
    const swatches = templateText(el.render()).split('<button');
    const checked = swatches.filter((chunk) => chunk.includes('aria-checked=true'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('data-color=blue');
  });

  it('esconde a linha genérica de preenchimento quando a seleção é só de notas', () => {
    const { section, rendered } = setup();
    expect(rendered()).not.toContain('btn-fill-preview');

    section.dispatch({
      type: 'shape.create',
      shape: { id: 'rc', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    section.setSelection(['n1', 'rc']);
    expect(rendered()).toContain('btn-fill-preview');
  });

  it('escolher a cor muda só as notas, numa única entrada de histórico', () => {
    const { section, internals } = setup(['a', 'b']);
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'rc', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    const rectBefore = section.getSnapshot().document.nodes['rc'];
    section.setSelection(['a', 'b', 'rc']);

    internals._onStickyColor(STICKY_COLORS.green);
    const nodes = section.getSnapshot().document.nodes;
    expect(nodes['a']).toMatchObject({ style: { fill: STICKY_COLORS.green } });
    expect(nodes['b']).toMatchObject({ style: { fill: STICKY_COLORS.green } });
    expect(nodes['rc']).toBe(rectBefore);

    section.undo();
    const undone = section.getSnapshot().document.nodes;
    expect(undone['a']).toMatchObject({ style: { fill: STICKY_COLORS.yellow } });
    expect(undone['b']).toMatchObject({ style: { fill: STICKY_COLORS.yellow } });
  });

  it('cores inválidas ou sem nota selecionada não fazem nada', () => {
    const { section, internals } = setup();
    const before = section.getSnapshot();
    for (const value of ['', 'azul', '#fff', '#12345g']) internals._onStickyColor(value);
    expect(section.getSnapshot()).toBe(before);

    section.setSelection([]);
    internals._onStickyColor(STICKY_COLORS.pink);
    expect(section.getSnapshot().document.nodes['n1']).toMatchObject({
      style: { fill: STICKY_COLORS.yellow },
    });

    const detached = new CanvasPropertiesElement() as unknown as TestableProperties;
    expect(() => detached._onStickyColor(STICKY_COLORS.pink)).not.toThrow();
  });

  it('o conteúdo de texto vale para a nota e o tamanho da fonte também', () => {
    const { section, internals, rendered } = setup();
    expect(rendered()).toContain('input-text');
    expect(rendered()).toContain('input-font-size');

    internals._onTextChange(fakeEvent('Outra ideia'));
    expect(section.getSnapshot().document.nodes['n1']).toMatchObject({ text: 'Outra ideia' });

    internals._onFontSizeChange(fakeEvent('24'));
    expect(section.getSnapshot().document.nodes['n1']).toMatchObject({
      fontSizeMode: 'fixed',
      fontSize: 24,
    });
  });

  it('o conteúdo muda só nos nós com texto de uma seleção mista', () => {
    const { section, internals } = setup();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'rc', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    section.setSelection(['n1', 'rc']);
    internals._onTextChange(fakeEvent('Misto'));
    expect(section.getSnapshot().document.nodes['n1']).toMatchObject({ text: 'Misto' });
    expect(section.getSnapshot().document.nodes['rc']).toMatchObject({ type: 'rectangle' });
  });
});
