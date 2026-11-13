import { STICKY_COLORS, createCanvasSection } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';
import { CanvasToolbarElement } from './canvas-toolbar.js';
import { defaultI18nEnUS } from './i18n.js';

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

interface TestableToolbar {
  _stickyMenu: { open: boolean; pinned: boolean; toggle(): void };
  _onStickyButton(): void;
  _selectStickyColor(color: string): void;
  _openStickyColorPicker(): void;
  performUpdate(): void;
}

function toolbarWithSection() {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  return { el, section, internals: el as unknown as TestableToolbar };
}

describe('nota adesiva na toolbar', () => {
  it('desenha um só botão de grupo, que ativa a nota e abre a ilha de cores', () => {
    const { el } = toolbarWithSection();
    const html = templateText(el.render());
    const buttons = html.split('<button').filter((chunk) => chunk.includes('data-tool="sticky"'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('data-action="open-sticky-colors"');
    expect(buttons[0]).toContain('aria-label=Nota adesiva');
    expect(buttons[0]).toContain('aria-haspopup="menu"');
    expect(buttons[0]).toContain('aria-expanded=false');
    expect(buttons[0]).toContain('aria-controls="sticky-menu"');
    // O chip de cor separado saiu.
    expect(html).not.toContain('part="sticky-color action-button"');
    expect(html).not.toContain('sticky-chip');
    expect(el.messages.sticky).toBe('Nota adesiva');
    expect(defaultI18nEnUS.toolbar.sticky).toBe('Sticky note');
    expect(defaultI18nEnUS.toolbar.stickyColor).toBe('Note color');
  });

  it('a cor inicial é o amarelo e vem marcada na ilha', () => {
    const { el, internals } = toolbarWithSection();
    expect(el.stickyColor).toBe(STICKY_COLORS.yellow);

    internals._stickyMenu.toggle();
    const checked = templateText(el.render())
      .split('<button')
      .filter((chunk) => chunk.includes('aria-checked=true'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('data-color=yellow');
  });

  it('o clique no botão ativa a nota com a cor lembrada e fixa a ilha; o seguinte a fecha', () => {
    const { el, section, internals } = toolbarWithSection();
    el.stickyColor = STICKY_COLORS.pink;

    internals._onStickyButton();
    expect(section.getSnapshot().session.activeTool).toBe('sticky');
    expect(el.stickyColor).toBe(STICKY_COLORS.pink);
    expect(internals._stickyMenu.open).toBe(true);
    expect(internals._stickyMenu.pinned).toBe(true);

    internals._onStickyButton();
    expect(internals._stickyMenu.open).toBe(false);
  });

  it('o menu fechado não mostra amostras; aberto mostra as 6 cores e a entrada personalizada', () => {
    const { el, internals } = toolbarWithSection();
    expect(templateText(el.render())).not.toContain('role="menu"');

    internals._stickyMenu.toggle();
    const html = templateText(el.render());
    expect(html).toContain('part="sticky-menu"');
    for (const name of ['yellow', 'pink', 'green', 'blue', 'orange', 'purple']) {
      expect(html).toContain(`data-color=${name}`);
    }
    expect(html).toContain('data-action="custom-sticky-color"');
    expect(html).toContain('aria-label=Amarelo');
    expect(html).toContain('Personalizada');
  });

  it('escolher uma cor muda a cor, ativa a ferramenta, fecha o menu e avisa com o canvas', () => {
    const { el, section, internals } = toolbarWithSection();
    const events: Array<{ color: string; section: unknown }> = [];
    el.addEventListener('sticky-color-change', (event) => {
      events.push((event as CustomEvent).detail);
    });
    internals._stickyMenu.toggle();

    internals._selectStickyColor(STICKY_COLORS.pink);

    expect(el.stickyColor).toBe(STICKY_COLORS.pink);
    expect(section.getSnapshot().session.activeTool).toBe('sticky');
    expect(internals._stickyMenu.open).toBe(false);
    expect(events).toEqual([{ color: STICKY_COLORS.pink, section }]);
  });

  it('a mesma cor não repete o aviso e valores que não são #rrggbb são ignorados', () => {
    const { el } = toolbarWithSection();
    const listener = vi.fn();
    el.addEventListener('sticky-color-change', listener);

    el.stickyColor = STICKY_COLORS.yellow;
    el.stickyColor = 'vermelho';
    el.stickyColor = '#fff';
    expect(listener).not.toHaveBeenCalled();
    expect(el.stickyColor).toBe(STICKY_COLORS.yellow);

    el.stickyColor = '#AABBCC';
    expect(el.stickyColor).toBe('#aabbcc');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('o seletor personalizado abre o seletor nativo quando existir', () => {
    const { el, internals } = toolbarWithSection();
    const showPicker = vi.fn();
    const click = vi.fn();
    (el as unknown as { renderRoot: unknown }).renderRoot = {
      querySelector: () => ({ showPicker, click }),
    };
    internals._openStickyColorPicker();
    expect(showPicker).toHaveBeenCalledTimes(1);

    (el as unknown as { renderRoot: unknown }).renderRoot = {
      querySelector: () => ({ click }),
    };
    internals._openStickyColorPicker();
    expect(click).toHaveBeenCalledTimes(1);

    (el as unknown as { renderRoot: unknown }).renderRoot = { querySelector: () => null };
    expect(() => internals._openStickyColorPicker()).not.toThrow();
  });

  it('sem canvas, o botão do grupo fica desabilitado', () => {
    const el = new CanvasToolbarElement();
    const html = templateText(el.render());
    const sticky = html.split('<button').find((chunk) => chunk.includes('data-tool="sticky"'));
    expect(sticky).toContain('?disabled=');
  });
});

describe('<canvas-surface> acompanha a cor da toolbar', () => {
  it('guarda a cor pedida antes da montagem', () => {
    const canvas = new CanvasSurfaceElement();
    expect(canvas.getStickyColor()).toBeUndefined();
    canvas.setStickyColor(STICKY_COLORS.green);
    expect(canvas.getStickyColor()).toBe(STICKY_COLORS.green);
  });
});
