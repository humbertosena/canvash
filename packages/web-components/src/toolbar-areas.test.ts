import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasToolbarElement } from './canvas-toolbar.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';
import { CANVASH_PARTS } from './theme.js';

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

function toolbar() {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  return { el, section };
}

describe('<canvas-toolbar>: áreas da ilha vertical', () => {
  it('ordena os botões: Select e Pan, depois Figuras, Texto, Nota e Desenho', () => {
    const { el } = toolbar();
    const html = templateText(el.render());
    const tools = [...html.matchAll(/data-tool="?(\w+)/g)].map((match) => match[1]);
    expect(tools).toEqual(['select', 'hand', 'rectangle', 'text', 'sticky', 'bezier', 'board']);
  });

  it('agrupa em duas áreas nomeadas, separadas por um divisor, antes do histórico e do zoom', () => {
    const { el } = toolbar();
    const html = templateText(el.render());

    const control = html.search(/role="group"\s+aria-label=Controle/);
    const shapes = html.search(/role="group"\s+aria-label=Formas/);
    const divider = html.indexOf('role="separator"');
    const history = html.indexOf('part="history-group"');
    const zoom = html.indexOf('part="zoom-controls"');
    expect(control).toBeGreaterThan(-1);
    expect(control).toBeLessThan(divider);
    expect(divider).toBeLessThan(shapes);
    expect(shapes).toBeLessThan(history);
    expect(history).toBeLessThan(zoom);

    // Cada área leva a sua parte, e Select e Pan ficam na primeira.
    expect(html).toContain('part="tools-group control-area"');
    expect(html).toContain('part="tools-group shapes-area"');
    const first = html.slice(control, divider);
    expect(first).toMatch(/data-tool="?select/);
    expect(first).toMatch(/data-tool="?hand/);
    expect(first).not.toContain('open-shapes');
  });

  it('o nome da toolbar e o das áreas vêm do i18n, em pt-BR e en-US', () => {
    const { el } = toolbar();
    expect(templateText(el.render())).toContain('aria-label=Ferramentas do canvas');
    expect(defaultI18nPtBR.toolbar.islandAreas).toEqual({
      control: 'Controle',
      shapes: 'Formas',
      properties: 'Propriedades',
    });

    el.messages = defaultI18nEnUS.toolbar;
    const html = templateText(el.render());
    expect(html).toContain('aria-label=Canvas tools');
    expect(html).toMatch(/role="group"\s+aria-label=Controls/);
    expect(html).toMatch(/role="group"\s+aria-label=Shapes/);
  });

  it('em modo leitura compacto, sobra a área de controle e some a de formas', () => {
    const { el, section } = toolbar();
    el.compactReadonly = true;
    section.setReadOnly(true);
    const html = templateText(el.render());

    expect(html).toMatch(/role="group"\s+aria-label=Controle/);
    expect(html).not.toContain('aria-label=Formas');
    expect(html).not.toContain('shapes-area');
  });

  it('expõe as partes das áreas', () => {
    for (const part of ['control-area', 'shapes-area']) {
      expect(CANVASH_PARTS.toolbar).toContain(part);
    }
  });
});

describe('<canvas-toolbar>: uma ilha por vez', () => {
  it('abrir uma ilha de grupo fecha a que estava aberta', () => {
    const { el } = toolbar();
    el.shapesMenuOpen = true;
    expect(el.shapesMenuOpen).toBe(true);

    el.drawMenuOpen = true;
    expect(el.drawMenuOpen).toBe(true);
    expect(el.shapesMenuOpen).toBe(false);

    const sticky = (el as unknown as { _stickyMenu: { openMenu(): void; open: boolean } })
      ._stickyMenu;
    sticky.openMenu();
    expect(sticky.open).toBe(true);
    expect(el.drawMenuOpen).toBe(false);

    el.shapesMenuOpen = true;
    expect(sticky.open).toBe(false);
    expect(el.shapesMenuOpen).toBe(true);
  });
});
