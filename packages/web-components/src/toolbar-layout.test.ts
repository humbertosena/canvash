import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasToolbarElement } from './canvas-toolbar.js';

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

function toolbar(
  options: Partial<Pick<CanvasToolbarElement, 'hideHistory' | 'hideZoom' | 'compactReadonly'>> = {},
) {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  Object.assign(el, options);
  return { el, section };
}

const count = (text: string, part: string): number => text.split(part).length - 1;

/** Ferramentas com botão no template. Os valores aparecem com ou sem aspas. */
const toolsIn = (html: string): string[] =>
  html
    .split('data-tool=')
    .slice(1)
    .map((chunk) => chunk.replace(/^"/, '').split(/["\s>]/)[0] ?? '');

/** O botão da ferramenta existe? */
const hasTool = (html: string, id: string): boolean => toolsIn(html).includes(id);

describe('<canvas-toolbar>: hide-history, hide-zoom e compact-readonly', () => {
  it('por padrão desenha tudo: três áreas, histórico e zoom, com 4 separadores', () => {
    const { el } = toolbar();
    const html = templateText(el.render());

    expect(el.hideHistory).toBe(false);
    expect(el.hideZoom).toBe(false);
    expect(el.compactReadonly).toBe(false);
    expect(html).toContain('part="history-group"');
    expect(html).toContain('part="zoom-controls"');
    expect(hasTool(html, 'hand')).toBe(true);
    expect(hasTool(html, 'text')).toBe(true);
    expect(count(html, 'role="separator"')).toBe(4);
  });

  it('hide-history esconde só o histórico e o separador dele', () => {
    const { el } = toolbar({ hideHistory: true });
    const html = templateText(el.render());

    expect(html).not.toContain('part="history-group"');
    expect(html).not.toContain('data-action="undo"');
    expect(html).toContain('part="zoom-controls"');
    expect(count(html, 'role="separator"')).toBe(3);
  });

  it('hide-zoom esconde só o zoom e o separador dele', () => {
    const { el } = toolbar({ hideZoom: true });
    const html = templateText(el.render());

    expect(html).not.toContain('part="zoom-controls"');
    expect(html).not.toContain('data-action="zoom-in"');
    expect(html).toContain('part="history-group"');
    expect(count(html, 'role="separator"')).toBe(3);
  });

  it('com os dois escondidos sobram as três áreas, com dois separadores entre elas', () => {
    const { el } = toolbar({ hideHistory: true, hideZoom: true });
    const html = templateText(el.render());

    expect(html).toContain('part="tools-group');
    expect(count(html, 'role="separator"')).toBe(2);
  });

  it('compact-readonly só tem efeito em modo leitura: então mostra apenas Seleção e Mão', () => {
    const { el, section } = toolbar({ compactReadonly: true });

    const editable = templateText(el.render());
    expect(hasTool(editable, 'text')).toBe(true);
    expect(editable).toContain('shapes-group');

    section.setReadOnly(true);
    const readOnly = templateText(el.render());
    expect(hasTool(readOnly, 'select')).toBe(true);
    expect(hasTool(readOnly, 'hand')).toBe(true);
    for (const hidden of ['shapes-group', 'sticky-group', 'draw-group', 'shapes-area']) {
      expect(readOnly).not.toContain(hidden);
    }
    for (const tool of ['line', 'bezier', 'arrow', 'text']) {
      expect(hasTool(readOnly, tool)).toBe(false);
    }

    section.setReadOnly(false);
    expect(hasTool(templateText(el.render()), 'text')).toBe(true);
  });

  it('em modo leitura sem compact-readonly a toolbar continua completa', () => {
    const { el, section } = toolbar();
    section.setReadOnly(true);

    const html = templateText(el.render());

    expect(html).toContain('shapes-group');
    expect(hasTool(html, 'text')).toBe(true);
  });

  it('ao ficar compacta, fecha os menus abertos para não deixar listener de clique fora', () => {
    const { el, section } = toolbar({ compactReadonly: true });
    el.shapesMenuOpen = true;
    expect(el.shapesMenuOpen).toBe(true);

    section.setReadOnly(true);
    (el as unknown as { willUpdate(): void }).willUpdate();

    expect(el.shapesMenuOpen).toBe(false);
  });

  it('expõe os atributos hide-history, hide-zoom e compact-readonly', () => {
    const properties = CanvasToolbarElement.properties as unknown as Record<
      string,
      { attribute?: string | boolean }
    >;

    expect(properties['hideHistory']?.attribute).toBe('hide-history');
    expect(properties['hideZoom']?.attribute).toBe('hide-zoom');
    expect(properties['compactReadonly']?.attribute).toBe('compact-readonly');
  });
});
