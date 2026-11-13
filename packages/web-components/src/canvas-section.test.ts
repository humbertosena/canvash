import { createCanvasSection } from '@canvash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasSectionElement } from './canvas-section.js';
import { defineCanvasElements } from './define.js';
import { defaultI18nEnUS, defaultI18nPtBR, mergeI18n } from './i18n.js';
import type { ShareStopEvent, ShareStopEventDetail } from './index.js';
import { CANVASH_CSS_TOKENS, CANVASH_PARTS } from './theme.js';

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

const cssOf = (): string =>
  (CanvasSectionElement.styles as { cssText: string }).cssText.replace(/\s+/g, ' ');

interface Testable {
  _onMenuButtonClick(): void;
  _onKeydown(event: Partial<KeyboardEvent>): void;
  updated(changed: Map<string, unknown>): void;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<canvas-section>: regiões', () => {
  it('desenha o canvas no slot padrão e as regiões em slots nomeados', () => {
    const el = new CanvasSectionElement();
    const html = templateText(el.render());

    for (const slot of ['', 'actions', 'left', 'toolbar', 'controls', 'overlay']) {
      expect(html).toContain(slot === '' ? '<slot></slot>' : `<slot name="${slot}">`);
    }
    for (const part of [
      'shell',
      'canvas-layer',
      'top',
      'top-start',
      'top-end',
      'left',
      'toolbar',
      'bottom-end',
      'overlay',
    ]) {
      // A região da toolbar tem as partes "right toolbar": right fica por compatibilidade.
      expect(html).toMatch(new RegExp(`part="(?:[a-z-]+ )*${part}(?: [a-z-]+)*"`));
    }
    expect(html).toContain('part="right toolbar"');
  });

  it('a região overlay vem logo depois do canvas no DOM: o mini-menu entra na tabulação depois dele', () => {
    const html = templateText(new CanvasSectionElement().render());
    const at = (slot: string) => html.indexOf(`<slot name="${slot}">`);

    expect(at('overlay')).toBeGreaterThan(html.indexOf('<slot></slot>'));
    for (const slot of ['actions', 'left', 'toolbar', 'controls']) {
      expect(at('overlay')).toBeLessThan(at(slot));
    }
  });

  it('as regiões deixam o ponteiro passar; só as ilhas capturam', () => {
    const css = cssOf();

    expect(css).toContain('pointer-events: none');
    expect(css).toContain('::slotted([slot]) { pointer-events: auto;');
  });

  it('ancora as regiões nas bordas pela margem das ilhas e centraliza a toolbar na vertical', () => {
    const css = cssOf();

    expect(css).toContain('var(--canvash-island-margin, 16px)');
    expect(css).toMatch(/\.right \{[^}]*top: 50%/);
    expect(css).toMatch(/\.right \{[^}]*translateY\(-50%\)/);
  });

  it('a região da toolbar não corta os menus que abrem para fora dela', () => {
    expect(cssOf()).not.toMatch(/\.right \{[^}]*overflow/);
  });

  it('a toolbar fica à direita, e o cartão da esquerda segue na margem, sem deslocar', () => {
    const css = cssOf();

    expect(css).toMatch(/\.right \{[^}]*right: var\(--canvash-island-margin, 16px\)/);
    expect(css).not.toMatch(/\.right \{[^}]*\bleft: var/);
    expect(css).toMatch(/\.left \{[^}]*left: var\(--canvash-island-margin, 16px\)/);
    expect(css).not.toMatch(/\.left \{[^}]*--canvash-shell-toolbar-inline-size/);
  });

  it('o canvas ocupa o shell inteiro e as ilhas passam por cima dele', () => {
    const css = cssOf();

    expect(css).toMatch(/\.canvas-layer \{[^}]*position: absolute;[^}]*inset: 0/);
  });
});

describe('<canvas-section>: largura da toolbar', () => {
  interface Observer {
    readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void;
    readonly observed: unknown[];
    disconnect: ReturnType<typeof vi.fn>;
  }

  function stubObserver() {
    const created: Observer[] = [];
    class FakeResizeObserver {
      readonly observed: unknown[] = [];
      disconnect = vi.fn();
      constructor(readonly callback: Observer['callback']) {
        created.push(this);
      }
      observe(target: unknown): void {
        this.observed.push(target);
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    return created;
  }

  function shellWithRegion() {
    const el = new CanvasSectionElement();
    const region = { className: 'right' };
    const setProperty = vi.fn();
    Object.defineProperty(el, 'renderRoot', { value: { querySelector: () => region } });
    Object.defineProperty(el, 'style', { value: { setProperty } });
    return { el, region, setProperty };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('mede a região da toolbar e publica a largura em --canvash-shell-toolbar-inline-size', () => {
    const created = stubObserver();
    const { el, region, setProperty } = shellWithRegion();

    (el as unknown as { firstUpdated(changed: Map<string, unknown>): void }).firstUpdated(
      new Map(),
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.observed).toEqual([region]);

    created[0]!.callback([{ contentRect: { width: 66 } }]);
    expect(setProperty).toHaveBeenCalledWith('--canvash-shell-toolbar-inline-size', '66px');
    created[0]!.callback([{ contentRect: { width: 48 } }]);
    expect(setProperty).toHaveBeenLastCalledWith('--canvash-shell-toolbar-inline-size', '48px');
  });

  it('ao desconectar solta o observador; sem ResizeObserver ou sem região, não faz nada', () => {
    const created = stubObserver();
    const { el } = shellWithRegion();
    (el as unknown as { firstUpdated(changed: Map<string, unknown>): void }).firstUpdated(
      new Map(),
    );
    el.disconnectedCallback();
    expect(created[0]!.disconnect).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', undefined);
    const bare = shellWithRegion();
    expect(() =>
      (bare.el as unknown as { firstUpdated(changed: Map<string, unknown>): void }).firstUpdated(
        new Map(),
      ),
    ).not.toThrow();

    const empty = new CanvasSectionElement();
    Object.defineProperty(empty, 'renderRoot', { value: { querySelector: () => null } });
    stubObserver();
    expect(() =>
      (empty as unknown as { firstUpdated(changed: Map<string, unknown>): void }).firstUpdated(
        new Map(),
      ),
    ).not.toThrow();
  });
});

describe('<canvas-section>: menu hambúrguer', () => {
  it('desenha o botão com nome acessível, fechado por padrão e sem role="menu"', () => {
    const el = new CanvasSectionElement();
    const html = templateText(el.render());

    expect(el.menuOpen).toBe(false);
    expect(html).toContain('part="menu-button"');
    expect(html).toContain('aria-label=Menu');
    expect(html).toContain('aria-expanded=false');
    expect(html).toContain('aria-controls="menu"');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('part="menu"');
    expect(html).not.toContain('<slot name="menu">');
  });

  it('aberto, mostra o cartão com o slot "menu" e aria-expanded verdadeiro', () => {
    const el = new CanvasSectionElement();
    el.menuOpen = true;
    const html = templateText(el.render());

    expect(html).toContain('aria-expanded=true');
    expect(html).toContain('part="menu"');
    expect(html).toContain('id="menu"');
    expect(html).toContain('<slot name="menu">');
  });

  it('clicar no botão alterna o menu', () => {
    const el = new CanvasSectionElement();
    const internals = el as unknown as Testable;

    internals._onMenuButtonClick();
    expect(el.menuOpen).toBe(true);
    internals._onMenuButtonClick();
    expect(el.menuOpen).toBe(false);
  });

  it('emite menu-toggle a cada mudança real, composto e com borbulhamento, e não na primeira renderização', () => {
    const el = new CanvasSectionElement();
    const internals = el as unknown as Testable;
    const events: CustomEvent[] = [];
    el.addEventListener('menu-toggle', (event) => events.push(event as CustomEvent));

    internals.updated(new Map([['menuOpen', undefined]]));
    expect(events).toHaveLength(0);

    el.menuOpen = true;
    internals.updated(new Map([['menuOpen', false]]));
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({ open: true });
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);

    el.menuOpen = false;
    internals.updated(new Map([['menuOpen', true]]));
    expect(events).toHaveLength(2);
    expect(events[1]?.detail).toEqual({ open: false });

    internals.updated(new Map([['menuOpen', false]]));
    expect(events).toHaveLength(2);
  });

  it('Esc fecha o menu aberto e devolve o foco ao botão; outras teclas não fazem nada', () => {
    const el = new CanvasSectionElement();
    const internals = el as unknown as Testable;
    const button = { focus: vi.fn() };
    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => button },
      configurable: true,
    });
    el.menuOpen = true;
    const preventDefault = vi.fn();

    internals._onKeydown({ key: 'a', preventDefault });
    expect(el.menuOpen).toBe(true);

    internals._onKeydown({ key: 'Escape', preventDefault });
    expect(el.menuOpen).toBe(false);
    expect(button.focus).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    internals._onKeydown({ key: 'Escape', preventDefault });
    expect(button.focus).toHaveBeenCalledTimes(1);
  });

  it('os listeners de clique fora e de Esc só existem com o menu aberto e saem ao fechar e ao desconectar', () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: remove });
    const el = new CanvasSectionElement();
    const internals = el as unknown as Testable;

    expect(add).not.toHaveBeenCalled();
    el.menuOpen = true;
    internals.updated(new Map([['menuOpen', false]]));
    expect(add).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function));

    el.menuOpen = false;
    internals.updated(new Map([['menuOpen', true]]));
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(remove).toHaveBeenCalledTimes(2);

    el.menuOpen = true;
    internals.updated(new Map([['menuOpen', false]]));
    el.disconnectedCallback();
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it('Esc no document fecha o menu mesmo sem foco no botão', () => {
    const add = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: vi.fn() });
    const el = new CanvasSectionElement();
    const internals = el as unknown as Testable;
    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => ({ focus: vi.fn() }) },
      configurable: true,
    });
    el.menuOpen = true;
    internals.updated(new Map([['menuOpen', false]]));
    const onKeydown = add.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: Partial<KeyboardEvent>,
    ) => void;

    onKeydown({ key: 'Escape', preventDefault: vi.fn() });

    expect(el.menuOpen).toBe(false);
  });

  it('clique fora do menu fecha; clique dentro dele não', () => {
    const add = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: vi.fn() });
    const el = new CanvasSectionElement();
    const internals = el as unknown as Testable;
    const inside = {};
    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => inside },
      configurable: true,
    });
    el.menuOpen = true;
    internals.updated(new Map([['menuOpen', false]]));
    const listener = add.mock.calls[0]?.[1] as (event: Event) => void;

    listener({ composedPath: () => [inside] } as unknown as Event);
    expect(el.menuOpen).toBe(true);

    listener({ composedPath: () => [{}] } as unknown as Event);
    expect(el.menuOpen).toBe(false);
  });
});

interface MenuItemsTestable {
  _selectMenuItem(item: { id: string; label: string; disabled?: boolean }): void;
}

describe('<canvas-section>: itens do menu (menuItems)', () => {
  const items = [
    { id: 'new', label: 'Novo projeto' },
    { id: 'open', label: 'Abrir projeto…', icon: 'data:image/svg+xml,%3Csvg/%3E' },
    { id: 'about', label: 'Sobre', disabled: true },
  ];

  function opened(menuItems = items) {
    const el = new CanvasSectionElement();
    el.menuItems = menuItems;
    el.menuOpen = true;
    const button = { focus: vi.fn() };
    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => button },
      configurable: true,
    });
    const events: Array<{ id: string }> = [];
    el.addEventListener('menu-select', (event) => events.push((event as CustomEvent).detail));
    return { el, button, events, internals: el as unknown as MenuItemsTestable };
  }

  it('não é atributo e começa vazio: sem itens o cartão é só o slot "menu"', () => {
    const el = new CanvasSectionElement();
    el.menuOpen = true;
    const html = templateText(el.render());
    const properties = CanvasSectionElement.properties as unknown as Record<
      string,
      { attribute?: boolean | string }
    >;

    expect(el.menuItems).toEqual([]);
    expect(properties['menuItems']?.attribute).toBe(false);
    expect(html).not.toContain('part="menu-items"');
    expect(html).toContain('<slot name="menu">');
  });

  it('desenha um botão por item, na ordem dada, antes do slot "menu"', () => {
    const { el } = opened();
    const html = templateText(el.render());

    expect(html).toContain('part="menu-items"');
    expect(html.match(/part="menu-item"/g)).toHaveLength(3);
    const at = (text: string) => html.indexOf(text);
    expect(at('Novo projeto')).toBeLessThan(at('Abrir projeto…'));
    expect(at('Abrir projeto…')).toBeLessThan(at('Sobre'));
    expect(at('Sobre')).toBeLessThan(at('<slot name="menu">'));
  });

  it('mostra o ícone, de 20 px e sem nome, só nos itens que o têm', () => {
    const { el } = opened();
    const html = templateText(el.render());

    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
    expect(html).toContain('alt=""');
    expect(html).toContain('data:image/svg+xml,%3Csvg/%3E');
  });

  it('marca o item desabilitado', () => {
    const { el } = opened();
    const html = templateText(el.render());

    expect(html).toContain('?disabled=true');
    expect(html).toContain('?disabled=false');
  });

  it('escolher um item emite menu-select uma vez, fecha o menu e devolve o foco ao botão', () => {
    const { el, button, events, internals } = opened();

    internals._selectMenuItem({ id: 'open', label: 'Abrir projeto…' });

    expect(events).toEqual([{ id: 'open' }]);
    expect(el.menuOpen).toBe(false);
    expect(button.focus).toHaveBeenCalledTimes(1);
  });

  it('o evento borbulha e é composto', () => {
    const { el, internals } = opened();
    let captured: CustomEvent | undefined;
    el.addEventListener('menu-select', (event) => (captured = event as CustomEvent));

    internals._selectMenuItem({ id: 'new', label: 'Novo projeto' });

    expect(captured?.bubbles).toBe(true);
    expect(captured?.composed).toBe(true);
  });

  it('item desabilitado não emite, não fecha o menu e não move o foco', () => {
    const { el, button, events, internals } = opened();

    internals._selectMenuItem({ id: 'about', label: 'Sobre', disabled: true });

    expect(events).toHaveLength(0);
    expect(el.menuOpen).toBe(true);
    expect(button.focus).not.toHaveBeenCalled();
  });

  it('documenta as partes da lista', () => {
    expect(CANVASH_PARTS.shell).toEqual(expect.arrayContaining(['menu-items', 'menu-item']));
  });

  it('o estilo dos itens ocupa a largura do cartão e destaca o foco do teclado', () => {
    const css = cssOf();

    expect(css).toMatch(/\.menu-item \{[^}]*width: 100%/);
    expect(css).toMatch(/\.menu-item:focus-visible \{[^}]*outline: 2px solid/);
    expect(css).toMatch(/\.menu-item:disabled \{/);
  });
});

interface ExportTestable {
  _exportOpen: boolean;
  _openExport(): void;
  _closeExport(restoreFocus?: boolean): void;
  _toggleExport(): void;
  _chooseExport(format: 'svg' | 'png'): void;
}

describe('<canvas-section>: ilha Exportar', () => {
  it('desenha a pill com nome acessível, fechada por padrão e sem a ilha temporária', () => {
    const html = templateText(new CanvasSectionElement().render());

    expect(html).toContain('part="export"');
    expect(html).toContain('part="export-button"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label=Exportar');
    expect(html).toContain('>Exportar</span>');
    expect(html).toMatch(/part="export-button"[\s\S]*aria-expanded=false/);
    expect(html).not.toContain('part="export-menu"');
    expect(html).not.toContain('role="menu"');
  });

  it('vem depois do slot actions, na região do topo à direita', () => {
    const html = templateText(new CanvasSectionElement().render());

    expect(html.indexOf('<slot name="actions">')).toBeLessThan(html.indexOf('part="export"'));
    expect(html.indexOf('part="top-end"')).toBeLessThan(html.indexOf('part="export"'));
  });

  it('hide-export remove a pill', () => {
    const el = new CanvasSectionElement();
    el.hideExport = true;
    const properties = CanvasSectionElement.properties as unknown as Record<
      string,
      { attribute?: string; reflect?: boolean }
    >;

    expect(templateText(el.render())).not.toContain('part="export');
    expect(properties['hideExport']?.attribute).toBe('hide-export');
    expect(properties['hideExport']?.reflect).toBe(true);
    expect(new CanvasSectionElement().hideExport).toBe(false);
  });

  it('aberta, mostra a ilha com role="menu", nome acessível e os dois formatos', () => {
    const el = new CanvasSectionElement();
    (el as unknown as ExportTestable)._exportOpen = true;
    const html = templateText(el.render());

    expect(html).toContain('part="export-menu"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label=Opções de exportação');
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html.match(/part="export-item"/g)).toHaveLength(2);
    expect(html).toContain('data-format="svg"');
    expect(html).toContain('data-format="png"');
    expect(html.indexOf('Exportar SVG')).toBeLessThan(html.indexOf('Exportar PNG'));
    expect(html).toMatch(/part="export-button"[\s\S]*aria-expanded=true/);
  });

  it('textos em pt-BR e en-US e personalizáveis por instância', () => {
    expect(defaultI18nPtBR.shell).toMatchObject({
      export: 'Exportar',
      exportMenu: 'Opções de exportação',
      exportSvg: 'Exportar SVG',
      exportPng: 'Exportar PNG',
    });
    expect(defaultI18nEnUS.shell).toMatchObject({
      export: 'Export',
      exportMenu: 'Export options',
      exportSvg: 'Export SVG',
      exportPng: 'Export PNG',
    });

    const el = new CanvasSectionElement();
    el.messages = { export: 'Baixar' };
    expect(templateText(el.render())).toContain('aria-label=Baixar');
  });

  it('documenta as partes da ilha', () => {
    expect(CANVASH_PARTS.shell).toEqual(
      expect.arrayContaining(['export', 'export-button', 'export-menu', 'export-item']),
    );
  });

  it('a ilha abre 8 px abaixo da pill, alinhada à borda direita, e a pill é negrito', () => {
    const css = cssOf();

    expect(css).toMatch(/\.export-menu \{[^}]*top: calc\(100% \+ 8px\)/);
    expect(css).toMatch(/\.export-menu \{[^}]*right: 0/);
    expect(css).toMatch(/\.export \{[^}]*position: relative/);
    expect(css).toMatch(/\.pill \{[^}]*height: 32px/);
    expect(css).toMatch(/\.pill \{[^}]*font-weight: 700/);
  });

  describe('estado e ouvintes', () => {
    it('abrir foca o primeiro item e fecha o menu hambúrguer; fechar devolve o foco à pill', () => {
      const el = new CanvasSectionElement();
      const internals = el as unknown as ExportTestable;
      const button = { focus: vi.fn() };
      Object.defineProperty(el, 'renderRoot', {
        value: { querySelector: () => button },
        configurable: true,
      });
      el.menuOpen = true;

      internals._openExport();
      expect(internals._exportOpen).toBe(true);
      expect(el.menuOpen).toBe(false);

      (el as unknown as { updated(changed: Map<string, unknown>): void }).updated(new Map());
      expect(button.focus).toHaveBeenCalledTimes(1);

      internals._closeExport(true);
      expect(internals._exportOpen).toBe(false);
      expect(button.focus).toHaveBeenCalledTimes(2);

      internals._closeExport(true);
      expect(button.focus).toHaveBeenCalledTimes(2);
    });

    it('abrir o menu hambúrguer fecha a ilha', () => {
      const el = new CanvasSectionElement();
      const internals = el as unknown as ExportTestable & Testable;
      internals._openExport();

      internals._onMenuButtonClick();

      expect(el.menuOpen).toBe(true);
      expect(internals._exportOpen).toBe(false);
    });

    it('clicar na pill alterna a ilha', () => {
      const internals = new CanvasSectionElement() as unknown as ExportTestable;

      internals._toggleExport();
      expect(internals._exportOpen).toBe(true);
      internals._toggleExport();
      expect(internals._exportOpen).toBe(false);
    });

    it('escolher um formato emite export-request uma vez, composto, e fecha a ilha', () => {
      const el = new CanvasSectionElement();
      const internals = el as unknown as ExportTestable;
      const events: CustomEvent[] = [];
      el.addEventListener('export-request', (event) => events.push(event as CustomEvent));
      internals._openExport();

      internals._chooseExport('png');

      expect(events).toHaveLength(1);
      expect(events[0]?.detail).toEqual({ format: 'png' });
      expect(events[0]?.bubbles).toBe(true);
      expect(events[0]?.composed).toBe(true);
      expect(internals._exportOpen).toBe(false);
    });

    it('os listeners de clique fora e de Esc só existem com a ilha aberta e saem ao fechar e ao desconectar', () => {
      const add = vi.fn();
      const remove = vi.fn();
      vi.stubGlobal('document', { addEventListener: add, removeEventListener: remove });
      const el = new CanvasSectionElement();
      const internals = el as unknown as ExportTestable;

      expect(add).not.toHaveBeenCalled();
      internals._openExport();
      expect(add).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
      expect(add).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(add).toHaveBeenCalledTimes(2);

      internals._closeExport();
      expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
      expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(remove).toHaveBeenCalledTimes(2);

      internals._openExport();
      el.disconnectedCallback();
      expect(remove).toHaveBeenCalledTimes(4);
      expect(internals._exportOpen).toBe(false);
    });
  });
});

interface AvatarTestable {
  _avatarFailed: boolean;
  _requestShare(): void;
  _clickAvatar(): void;
  willUpdate(changed: Map<string, unknown>): void;
}

describe('<canvas-section>: ilha Compartilhar', () => {
  it('desenha a pill com nome acessível, antes da Exportar e depois do slot actions', () => {
    const html = templateText(new CanvasSectionElement().render());

    expect(html).toContain('part="share-button"');
    expect(html).toContain('aria-label=Compartilhar');
    expect(html).toContain('>Compartilhar</span>');
    expect(html.indexOf('<slot name="actions">')).toBeLessThan(html.indexOf('part="share-button"'));
    expect(html.indexOf('part="share-button"')).toBeLessThan(html.indexOf('part="export"'));
  });

  it('hide-share remove a pill', () => {
    const el = new CanvasSectionElement();
    el.hideShare = true;
    const properties = CanvasSectionElement.properties as unknown as Record<
      string,
      { attribute?: string; reflect?: boolean }
    >;

    expect(templateText(el.render())).not.toContain('part="share-button"');
    expect(properties['hideShare']?.attribute).toBe('hide-share');
    expect(properties['hideShare']?.reflect).toBe(true);
    expect(new CanvasSectionElement().hideShare).toBe(false);
  });

  it('cada clique emite share-request, composto e com borbulhamento', () => {
    const el = new CanvasSectionElement();
    const events: CustomEvent[] = [];
    el.addEventListener('share-request', (event) => events.push(event as CustomEvent));
    const internals = el as unknown as AvatarTestable;

    internals._requestShare();
    internals._requestShare();

    expect(events).toHaveLength(2);
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);
  });

  it('textos em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.shell.share).toBe('Compartilhar');
    expect(defaultI18nEnUS.shell.share).toBe('Share');
  });

  it('documenta a parte da pill', () => {
    expect(CANVASH_PARTS.shell).toEqual(expect.arrayContaining(['share-button']));
  });
});

describe('<canvas-section>: Avatar', () => {
  const withUser = (user?: { name: string; avatarUrl?: string }) => {
    const el = new CanvasSectionElement();
    if (user) el.user = user;
    return el;
  };
  const text = (el: CanvasSectionElement) => templateText(el.render()).replace(/\s+/g, ' ');

  it('sem user não há avatar', () => {
    const html = text(withUser());

    expect(html).not.toContain('part="avatar"');
    expect(new CanvasSectionElement().user).toBeUndefined();
  });

  it('com foto, mostra a imagem de 32 px com texto alternativo vazio e o nome acessível', () => {
    const html = text(withUser({ name: 'Ana Silva', avatarUrl: '/ana.png' }));

    expect(html).toContain('part="avatar"');
    expect(html).toContain('aria-label=Conta: Ana Silva');
    expect(html).toContain('part="avatar-image"');
    expect(html).toContain('/ana.png');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="32"');
    expect(html).not.toContain('part="avatar-initials"');
  });

  it('sem URL, mostra as iniciais', () => {
    const html = text(withUser({ name: 'Ana Silva' }));

    expect(html).toContain('part="avatar-initials"');
    expect(html).toContain('>AS</span>');
    expect(html).not.toContain('part="avatar-image"');
  });

  it('se a imagem falhar, troca pela iniciais; um novo user tenta de novo', () => {
    const el = withUser({ name: 'Ana Silva', avatarUrl: '/quebrada.png' });
    const internals = el as unknown as AvatarTestable;

    internals._avatarFailed = true;
    expect(text(el)).toContain('part="avatar-initials"');
    expect(text(el)).not.toContain('part="avatar-image"');

    el.user = { name: 'Ana Silva', avatarUrl: '/outra.png' };
    internals.willUpdate(new Map([['user', undefined]]));
    expect(internals._avatarFailed).toBe(false);
    expect(text(el)).toContain('part="avatar-image"');

    internals._avatarFailed = true;
    internals.willUpdate(new Map([['menuOpen', false]]));
    expect(internals._avatarFailed).toBe(true);
  });

  it.each([
    ['Ana Silva', 'AS'],
    ['ana', 'A'],
    ['  maria   de  souza ', 'MS'],
    ['élan vital', 'ÉV'],
    ['', '?'],
    ['   ', '?'],
  ])('iniciais de "%s" = %s', (name, initials) => {
    expect(text(withUser({ name }))).toContain(`>${initials}</span>`);
  });

  it('o clique emite avatar-click', () => {
    const el = withUser({ name: 'Ana' });
    const events: CustomEvent[] = [];
    el.addEventListener('avatar-click', (event) => events.push(event as CustomEvent));

    (el as unknown as AvatarTestable)._clickAvatar();

    expect(events).toHaveLength(1);
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);
  });

  it('fica depois da pill Exportar, e a Exportar depois da Compartilhar', () => {
    const html = templateText(withUser({ name: 'Ana' }).render());

    expect(html.indexOf('part="share-button"')).toBeLessThan(html.indexOf('part="export"'));
    expect(html.indexOf('part="export"')).toBeLessThan(html.indexOf('part="avatar"'));
  });

  it('textos em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.shell.account('Ana')).toBe('Conta: Ana');
    expect(defaultI18nEnUS.shell.account('Ana')).toBe('Account: Ana');
  });

  it('documenta as partes', () => {
    expect(CANVASH_PARTS.shell).toEqual(
      expect.arrayContaining(['avatar', 'avatar-image', 'avatar-initials']),
    );
  });

  it('é um círculo de 32 px, sem borda nem sombra, com iniciais brancas sobre #1f1f1f', () => {
    const css = cssOf();

    expect(css).toMatch(/\.avatar \{[^}]*width: 32px/);
    expect(css).toMatch(/\.avatar \{[^}]*height: 32px/);
    expect(css).toMatch(/\.avatar \{[^}]*border: 0/);
    expect(css).toMatch(/\.avatar \{[^}]*border-radius: 50%/);
    expect(css).toMatch(/\.avatar \{[^}]*box-shadow: none/);
    expect(css).toMatch(/\.avatar \{[^}]*background: #1f1f1f/);
    expect(css).toMatch(/\.avatar \{[^}]*color: #ffffff/);
  });
});

describe('<canvas-section>: tela estreita', () => {
  it('abaixo de 600 px as pills mostram só o ícone', () => {
    const css = cssOf();

    expect(css).toMatch(/@media \(max-width: 599px\) \{[^@]*\.pill-label \{[^}]*display: none/);
  });
});

describe('<canvas-section>: estilo do título', () => {
  it('em repouso é negrito, sem fundo nem borda, e o hover não cria fundo', () => {
    const css = cssOf();

    expect(css).toMatch(/\.title \{[^}]*font-weight: 700/);
    expect(css).toMatch(/\.title \{[^}]*background: none/);
    expect(css).toMatch(/\.title \{[^}]*border: 0/);
    expect(css).not.toContain('button.title:hover');
  });

  it('o anel de foco do teclado do título continua', () => {
    expect(cssOf()).toMatch(/\.title:focus-visible \{[^}]*outline: 2px solid/);
  });

  it('em edição é itálico, com borda transparente de 1 px e o fundo do token, transparente por padrão', () => {
    const css = cssOf().replace(/\( /g, '(').replace(/ \)/g, ')');

    expect(css).toMatch(/\.title-input \{[^}]*font-style: italic/);
    expect(css).toMatch(/\.title-input \{[^}]*border: 1px solid transparent/);
    expect(css).toMatch(
      /\.title-input \{[^}]*background: var\(--canvash-title-edit-bg, transparent\)/,
    );
  });

  it('o campo em edição fica sem contorno de foco: o gradiente e o itálico marcam a edição', () => {
    const css = cssOf();

    expect(css).toMatch(/\.title-input:focus,? ?[^{]*\{[^}]*outline: none/);
    expect(css).not.toMatch(/\.title-input:focus-visible \{[^}]*outline: 2px/);
  });

  it('o token --canvash-title-edit-bg entra em CANVASH_CSS_TOKENS', () => {
    expect(CANVASH_CSS_TOKENS.titleEditBg).toBe('--canvash-title-edit-bg');
  });
});

describe('<canvas-section>: registro, textos e partes', () => {
  it('expõe o atributo menu-open', () => {
    const properties = CanvasSectionElement.properties as unknown as Record<
      string,
      { attribute?: string }
    >;

    expect(properties['menuOpen']?.attribute).toBe('menu-open');
  });

  it('textos em pt-BR e en-US e personalizáveis por instância', () => {
    const el = new CanvasSectionElement();

    expect(el.messages.menu).toBe('Menu');
    expect(defaultI18nPtBR.shell.menu).toBe('Menu');
    expect(defaultI18nEnUS.shell.menu).toBe('Menu');

    el.messages = { menu: 'Abrir menu' };
    expect(templateText(el.render())).toContain('aria-label=Abrir menu');
    expect(mergeI18n(defaultI18nPtBR, { shell: { menu: 'X' } }).shell.menu).toBe('X');
  });

  it('documenta as partes e registra canvas-section, também com prefixo', () => {
    expect(CANVASH_PARTS.shell).toEqual(
      expect.arrayContaining(['shell', 'menu-button', 'menu', 'top-end', 'left', 'right']),
    );

    const registry = new Map<string, CustomElementConstructor>();
    const fake = {
      get: (name: string) => registry.get(name),
      define: (name: string, ctor: CustomElementConstructor) => registry.set(name, ctor),
    } as unknown as CustomElementRegistry;
    defineCanvasElements({ registry: fake });
    defineCanvasElements({ registry: fake, prefix: 'app' });

    expect(registry.get('canvas-section')).toBe(CanvasSectionElement);
    expect(registry.get('app-canvas-section')).toBe(CanvasSectionElement);
  });
});

interface TitleTestable {
  _startEdit(): void;
  _commitEdit(value: string): void;
  _cancelEdit(): void;
  _onTitleKeydown(event: Partial<KeyboardEvent>): void;
  _onInputKeydown(
    event: Omit<Partial<KeyboardEvent>, 'target'> & { target?: { value: string } },
  ): void;
  _onInputBlur(event: { target?: { value: string } }): void;
  updated(changed: Map<string, unknown>): void;
}

describe('<canvas-section>: título do projeto', () => {
  function titled(title = 'Meu projeto') {
    const el = new CanvasSectionElement();
    el.projectTitle = title;
    const events: Array<{ title: string }> = [];
    el.addEventListener('title-change', (event) => events.push((event as CustomEvent).detail));
    return { el, events, internals: el as unknown as TitleTestable };
  }

  it('mostra o título num botão que edita, e "Sem título" quando está vazio', () => {
    const { el } = titled();
    const html = templateText(el.render());

    expect(html).toContain('part="title"');
    expect(html).toContain('Meu projeto');
    expect(html).toContain('aria-label=Editar título: Meu projeto');
    expect(html).not.toContain('part="title-input"');

    el.projectTitle = '';
    expect(templateText(el.render())).toContain('Sem título');
  });

  it('clicar ou F2 no título abre o campo de edição, com nome acessível e limite de 120 caracteres', () => {
    const { el, internals } = titled();

    internals._startEdit();
    const html = templateText(el.render());

    expect(html).toContain('part="title-input"');
    expect(html).toContain('aria-label=Título do projeto');
    expect(html).toContain('maxlength=120');
    expect(html).not.toContain('part="title"');

    internals._cancelEdit();
    const preventDefault = vi.fn();
    internals._onTitleKeydown({ key: 'F2', preventDefault });
    expect(templateText(el.render())).toContain('part="title-input"');
    expect(preventDefault).toHaveBeenCalledTimes(1);

    internals._cancelEdit();
    internals._onTitleKeydown({ key: 'a', preventDefault });
    expect(templateText(el.render())).not.toContain('part="title-input"');
  });

  it('Enter confirma e emite title-change uma vez, com o valor aparado', () => {
    const { el, events, internals } = titled();
    internals._startEdit();
    const preventDefault = vi.fn();

    internals._onInputKeydown({ key: 'Enter', target: { value: '  Novo nome  ' }, preventDefault });
    internals._onInputBlur({ target: { value: '  Novo nome  ' } });

    expect(events).toEqual([{ title: 'Novo nome' }]);
    expect(templateText(el.render())).not.toContain('part="title-input"');
    // o shell só exibe a propriedade: quem aceita a mudança é o host
    expect(el.projectTitle).toBe('Meu projeto');
  });

  it('o blur também confirma', () => {
    const { events, internals } = titled();
    internals._startEdit();

    internals._onInputBlur({ target: { value: 'Outro' } });

    expect(events).toEqual([{ title: 'Outro' }]);
  });

  it('Esc cancela sem evento, mesmo que o blur venha depois', () => {
    const { el, events, internals } = titled();
    internals._startEdit();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    internals._onInputKeydown({
      key: 'Escape',
      target: { value: 'descartado' },
      preventDefault,
      stopPropagation,
    });
    internals._onInputBlur({ target: { value: 'descartado' } });

    expect(events).toHaveLength(0);
    expect(templateText(el.render())).not.toContain('part="title-input"');
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('título vazio ou só com espaços volta ao anterior, sem evento', () => {
    const { events, internals } = titled();

    internals._startEdit();
    internals._commitEdit('   ');
    internals._startEdit();
    internals._commitEdit('');

    expect(events).toHaveLength(0);
  });

  it('título igual ao atual não emite evento; acima de 120 caracteres é cortado', () => {
    const { events, internals } = titled();

    internals._startEdit();
    internals._commitEdit('Meu projeto');
    expect(events).toHaveLength(0);

    internals._startEdit();
    internals._commitEdit('x'.repeat(200));
    expect(events).toEqual([{ title: 'x'.repeat(120) }]);
  });

  it('o evento de confirmação borbulha e é composto', () => {
    const { el, internals } = titled();
    let captured: CustomEvent | undefined;
    el.addEventListener('title-change', (event) => (captured = event as CustomEvent));
    internals._startEdit();

    internals._commitEdit('Novo');

    expect(captured?.bubbles).toBe(true);
    expect(captured?.composed).toBe(true);
  });

  it('com o canvas em modo leitura, o título não é editável', () => {
    const { el, internals } = titled();
    const section = createCanvasSection();
    el.section = section;
    section.setReadOnly(true);

    internals._startEdit();
    const html = templateText(el.render());

    expect(html).not.toContain('part="title-input"');
    expect(html).not.toContain('aria-label=Editar título');
    expect(html).toContain('Meu projeto');

    section.setReadOnly(false);
    internals._startEdit();
    expect(templateText(el.render())).toContain('part="title-input"');
    el.disconnectedCallback();
  });

  it('foca e seleciona o campo ao abrir; ao fechar, devolve o foco ao título', () => {
    const { el, internals } = titled();
    const input = { focus: vi.fn(), select: vi.fn() };
    const title = { focus: vi.fn() };
    Object.defineProperty(el, 'renderRoot', {
      value: {
        querySelector: (selector: string) => (selector.includes('title-input') ? input : title),
      },
      configurable: true,
    });

    internals._startEdit();
    internals.updated(new Map([['_editing', false]]));
    expect(input.focus).toHaveBeenCalledTimes(1);
    expect(input.select).toHaveBeenCalledTimes(1);

    internals._cancelEdit();
    internals.updated(new Map([['_editing', true]]));
    expect(title.focus).toHaveBeenCalledTimes(1);
  });

  it('troca de canvas desassina o anterior e libera a assinatura ao desconectar', () => {
    const el = new CanvasSectionElement();
    const first = createCanvasSection();
    const second = createCanvasSection();
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();
    vi.spyOn(first, 'subscribe').mockReturnValue(unsubscribeFirst);
    vi.spyOn(second, 'subscribe').mockReturnValue(unsubscribeSecond);

    el.section = first;
    el.section = second;
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);

    el.disconnectedCallback();
    expect(unsubscribeSecond).toHaveBeenCalledTimes(1);
  });

  it('expõe project-title e textos localizados do título', () => {
    const properties = CanvasSectionElement.properties as unknown as Record<
      string,
      { attribute?: string }
    >;
    expect(properties['projectTitle']?.attribute).toBe('project-title');
    expect(defaultI18nPtBR.shell.untitled).toBe('Sem título');
    expect(defaultI18nEnUS.shell.untitled).toBe('Untitled');
    expect(defaultI18nEnUS.shell.editTitle('Plan')).toBe('Edit title: Plan');
    expect(defaultI18nEnUS.shell.titleInput).toBe('Project title');
  });
});

// Fundo de hover e ilhas temporárias -----------------------------------------------------------

/** Fundo mais forte e opaco das ilhas em hover, e das ilhas temporárias (ghost island). */
const HOVER_BG = 'var(--canvash-surface-float-hover, #d9dbe0)';

/** Tom de seleção de um item dentro de uma ilha temporária: o fundo do hover com 6 % de preto por cima. */
const ITEM_HOVER_BG = 'var(--canvash-surface-float-item-hover, #ccced3)';

const EXPORT_ICON_PATH =
  'M4.05 15.3C3.675 15.3 3.35625 15.1687 3.09375 14.9062C2.83125 14.6437 2.7 14.325 2.7 13.95V10.8H4.05V13.95H13.95V4.05H4.05V7.2H2.7V4.05C2.7 3.675 2.83125 3.35625 3.09375 3.09375C3.35625 2.83125 3.675 2.7 4.05 2.7H13.95C14.325 2.7 14.6438 2.83125 14.9063 3.09375C15.1688 3.35625 15.3 3.675 15.3 4.05V13.95C15.3 14.325 15.1688 14.6437 14.9063 14.9062C14.6438 15.1687 14.325 15.3 13.95 15.3H4.05ZM8.1 12.6L7.14375 11.6437L9.1125 9.675H2.7V8.325H9.1125L7.14375 6.35625L8.1 5.4L11.7 9L8.1 12.6Z';
const SHARE_ICON_PATH =
  'M176,160a39.89,39.89,0,0,0-28.62,12.09l-46.1-29.63a39.8,39.8,0,0,0,0-28.92l46.1-29.63a40,40,0,1,0-8.66-13.45l-46.1,29.63a40,40,0,1,0,0,55.82l46.1,29.63A40,40,0,1,0,176,160Zm0-128a24,24,0,1,1-24,24A24,24,0,0,1,176,32ZM64,152a24,24,0,1,1,24-24A24,24,0,0,1,64,152Zm112,72a24,24,0,1,1,24-24A24,24,0,0,1,176,224Z';

describe('<canvas-section>: fundo de hover das ilhas', () => {
  const css = () => cssOf().replace(/\( /g, '(').replace(/ \)/g, ')');

  it('o token --canvash-surface-float-hover entra em CANVASH_CSS_TOKENS', () => {
    expect(CANVASH_CSS_TOKENS.surfaceFloatHover).toBe('--canvash-surface-float-hover');
  });

  it('o hover do botão hambúrguer e das pills usa o fundo forte e opaco do token', () => {
    expect(css()).toContain(`background: ${HOVER_BG}`);
    expect(css()).toMatch(
      new RegExp(`\\.menu-button:hover,? ?[^{]*\\{[^}]*background: ${escapeRegExp(HOVER_BG)}`),
    );
    expect(css()).toMatch(
      new RegExp(`\\.pill:hover,? ?[^{]*\\{[^}]*background: ${escapeRegExp(HOVER_BG)}`),
    );
  });

  it('o hover das ilhas não é mais o véu translúcido que deixava o fundo transparente', () => {
    expect(css()).not.toMatch(/\.menu-button:hover[^{]*\{[^}]*btn-hover-bg/);
    expect(css()).not.toMatch(/\.pill:hover[^{]*\{[^}]*btn-hover-bg/);
  });

  it('o hover do item dentro de uma ilha usa o tom de seleção do token, opaco', () => {
    expect(css()).toMatch(
      new RegExp(
        `\\.menu-item:hover:not\\(:disabled\\) \\{[^}]*background: ${escapeRegExp(ITEM_HOVER_BG)}`,
      ),
    );
    expect(css()).not.toMatch(/\.menu-item:hover[^{]*\{[^}]*btn-hover-bg/);
  });
});

describe('<canvas-section>: ilhas temporárias (ghost island)', () => {
  const css = () => cssOf().replace(/\( /g, '(').replace(/ \)/g, ')');

  it('o cartão do menu hambúrguer e a ilha de exportação têm o fundo do hover', () => {
    expect(css()).toMatch(new RegExp(`\\.menu \\{[^}]*background: ${escapeRegExp(HOVER_BG)}`));
    expect(css()).toMatch(
      new RegExp(`\\.export-menu \\{[^}]*background: ${escapeRegExp(HOVER_BG)}`),
    );
  });

  it('o botão hambúrguer e a pill Exportar mantêm o fundo do hover enquanto a ilha está aberta', () => {
    expect(css()).toMatch(
      new RegExp(
        `\\.menu-button\\[aria-expanded='true'\\][^{]*\\{[^}]*background: ${escapeRegExp(HOVER_BG)}`,
      ),
    );
    expect(css()).toMatch(
      new RegExp(
        `\\.pill\\[aria-expanded='true'\\][^{]*\\{[^}]*background: ${escapeRegExp(HOVER_BG)}`,
      ),
    );
  });

  it('o fundo em repouso das ilhas continua o da superfície', () => {
    expect(css()).toMatch(
      /\.menu-button \{[^}]*background: var\(--canvash-surface-float, #ebecef\)/,
    );
    expect(css()).toMatch(/\.pill \{[^}]*background: var\(--canvash-surface-float, #ebecef\)/);
  });
});

describe('<canvas-section>: ícones das pills', () => {
  it('Exportar usa o ícone de 20 px, viewBox 18, preenchido com currentColor', () => {
    const html = templateText(new CanvasSectionElement().render());
    const icon = /part="export-button"[\s\S]*?<svg([^>]*)>([\s\S]*?)<\/svg>/.exec(html);

    expect(icon?.[1]).toContain('viewBox="0 0 18 18"');
    expect(icon?.[1]).toContain('width="20"');
    expect(icon?.[1]).toContain('height="20"');
    expect(icon?.[1]).toContain('fill="currentColor"');
    expect(icon?.[1]).toContain('aria-hidden="true"');
    expect(icon?.[2]).toContain(`d="${EXPORT_ICON_PATH}"`);
    expect(icon?.[2]).toContain('fill="currentColor"');
  });

  it('Compartilhar usa o ícone de 16 px, viewBox 256, preenchido com currentColor', () => {
    const html = templateText(new CanvasSectionElement().render());
    const icon = /part="share-button"[\s\S]*?<svg([^>]*)>([\s\S]*?)<\/svg>/.exec(html);

    expect(icon?.[1]).toContain('viewBox="0 0 256 256"');
    expect(icon?.[1]).toContain('width="16"');
    expect(icon?.[1]).toContain('height="16"');
    expect(icon?.[1]).toContain('fill="currentColor"');
    expect(icon?.[1]).toContain('aria-hidden="true"');
    expect(icon?.[2]).toContain(`d="${SHARE_ICON_PATH}"`);
  });

  it('os ícones antigos, de traço, saíram das duas pills', () => {
    const html = templateText(new CanvasSectionElement().render());

    expect(html).not.toContain('M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5');
    expect(html).not.toContain('M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14');
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('<canvas-section>: título em edição (sem negrito, fundo transparente e linha em degradê)', () => {
  const css = () => cssOf().replace(/\( /g, '(').replace(/ \)/g, ')');

  it('em edição o campo não é negrito: só o itálico marca a edição', () => {
    expect(css()).toMatch(/\.title-input \{[^}]*font-weight: 400/);
    expect(css()).not.toMatch(/\.title-input \{[^}]*font-weight: 700/);
    // O título em repouso segue em negrito.
    expect(css()).toMatch(/\.title \{[^}]*font-weight: 700/);
  });

  it('o fundo do campo em edição é transparente, sem gradiente de preenchimento', () => {
    expect(css()).toMatch(
      /\.title-input \{[^}]*background: var\(--canvash-title-edit-bg, transparent\)/,
    );
    expect(css()).not.toMatch(/\.title-input \{[^}]*background: [^;]*linear-gradient/);
  });

  it('a borda inferior, de 2 px, é uma linha em degradê da esquerda para a direita', () => {
    const line = escapeRegExp(
      'var(--canvash-title-edit-line, linear-gradient(90deg, var(--canvash-surface-float-item-hover, #ccced3), var(--canvash-canvas-bg, #f2f3f5)))',
    );

    expect(css()).toMatch(/\.title-input \{[^}]*border-bottom-width: 2px/);
    expect(css()).toMatch(new RegExp(`\\.title-input \\{[^}]*border-image: ${line} 0 0 1 0`));
  });

  it('a altura do campo não muda com a linha: o padding de baixo perde 1 px', () => {
    expect(css()).toMatch(/\.title-input \{[^}]*padding: 4px 8px 3px/);
  });

  it('os tokens --canvash-title-edit-line e --canvash-surface-float-item-hover entram em CANVASH_CSS_TOKENS', () => {
    expect(CANVASH_CSS_TOKENS.titleEditLine).toBe('--canvash-title-edit-line');
    expect(CANVASH_CSS_TOKENS.surfaceFloatItemHover).toBe('--canvash-surface-float-item-hover');
  });
});

describe('<canvas-section>: estado de compartilhamento (sharing)', () => {
  const properties = CanvasSectionElement.properties as unknown as Record<
    string,
    { attribute?: string; reflect?: boolean }
  >;

  /** Contraste WCAG entre duas cores #rrggbb. */
  const luminance = (hex: string): number => {
    const channel = (offset: number): number => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it('nasce em off e a propriedade reflete no atributo sharing', () => {
    expect(new CanvasSectionElement().sharing).toBe('off');
    expect(properties['sharing']?.attribute).toBe('sharing');
    expect(properties['sharing']?.reflect).toBe(true);
  });

  it('o rótulo visível é sempre Compartilhar e data-sharing acompanha o estado', () => {
    for (const state of ['off', 'connecting', 'on'] as const) {
      const el = new CanvasSectionElement();
      el.sharing = state;
      const html = templateText(el.render());

      expect(html).toContain('>Compartilhar</span>');
      expect(html).toContain(`data-sharing=${state}`);
    }
  });

  it('o nome acessível muda com o estado', () => {
    const labelOf = (state: 'off' | 'connecting' | 'on'): string => {
      const el = new CanvasSectionElement();
      el.sharing = state;
      return (
        /part="share-button"[\s\S]*?aria-label=([^\n]*)\n/.exec(templateText(el.render()))?.[1] ??
        ''
      );
    };

    expect(labelOf('off')).toBe('Compartilhar');
    expect(labelOf('connecting')).toBe('Compartilhar, conectando');
    expect(labelOf('on')).toBe('Compartilhar, ativo');
  });

  it('o ponto de status fica escondido em off e aparece em connecting e on', () => {
    const dotIn = (state: 'off' | 'connecting' | 'on'): boolean => {
      const el = new CanvasSectionElement();
      el.sharing = state;
      return templateText(el.render()).includes('part="share-status"');
    };

    expect(dotIn('off')).toBe(false);
    expect(dotIn('connecting')).toBe(true);
    expect(dotIn('on')).toBe(true);
  });

  it('o ponto tem 8 px, usa --canvash-share-active-color e fica escondido para leitores de tela', () => {
    const css = cssOf();

    expect(css).toMatch(/\.share-status \{[^}]*width: 8px/);
    expect(css).toMatch(/\.share-status \{[^}]*height: 8px/);
    expect(css).toMatch(
      /\.share-status \{[^}]*background: var\(--canvash-share-active-color, #[0-9a-f]{6}\)/,
    );
    expect(templateText(new CanvasSectionElement().render())).not.toContain('part="share-status"');
    const el = new CanvasSectionElement();
    el.sharing = 'on';
    expect(templateText(el.render())).toMatch(/part="share-status"[^>]*aria-hidden="true"/);
  });

  it('em connecting o ponto pulsa; com prefers-reduced-motion fica estático a 50%', () => {
    const css = cssOf();

    expect(css).toMatch(
      /\.share-status\[data-state='connecting'\] \{[^}]*animation: [^;]*canvash-share-pulse/,
    );
    expect(css).toMatch(/@keyframes canvash-share-pulse/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.share-status\[data-state='connecting'\] \{[^}]*animation: none;[^}]*opacity: 0\.5/,
    );
  });

  it('o ponto tem contraste de pelo menos 3:1 com o fundo da pill', () => {
    const color = /--canvash-share-active-color, (#[0-9a-f]{6})\)/.exec(cssOf())?.[1] ?? '';
    const surface = /--canvash-surface-float, (#[0-9a-f]{6})\)/.exec(cssOf())?.[1] ?? '';

    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(color, surface)).toBeGreaterThanOrEqual(3);
  });

  it('share-request traz o estado do momento do clique em sharing', () => {
    const el = new CanvasSectionElement();
    const details: unknown[] = [];
    el.addEventListener('share-request', (event) => details.push((event as CustomEvent).detail));
    const internals = el as unknown as AvatarTestable;

    internals._requestShare();
    el.sharing = 'connecting';
    internals._requestShare();
    el.sharing = 'on';
    internals._requestShare();

    expect(details).toEqual([{ sharing: 'off' }, { sharing: 'connecting' }, { sharing: 'on' }]);
  });

  it('o shell não muda sharing sozinho ao clicar', () => {
    const el = new CanvasSectionElement();
    (el as unknown as AvatarTestable)._requestShare();

    expect(el.sharing).toBe('off');
  });

  it('share-stop é exportado como tipo de evento', () => {
    const detail: ShareStopEventDetail = {};
    const event: ShareStopEvent = new CustomEvent('share-stop', { detail });

    expect(event.type).toBe('share-stop');
    expect(event.detail).toEqual({});
  });

  it('as mensagens de compartilhamento existem em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.shell.shareConnecting).toBe('Compartilhar, conectando');
    expect(defaultI18nPtBR.shell.shareActive).toBe('Compartilhar, ativo');
    expect(defaultI18nPtBR.shell.shareFailed).toBe('Não foi possível compartilhar');
    expect(defaultI18nPtBR.shell.shareStop).toBe('Parar compartilhamento');
    expect(defaultI18nPtBR.shell.shareStopPending.length).toBeGreaterThan(0);
    expect(defaultI18nEnUS.shell.shareConnecting).toBe('Share, connecting');
    expect(defaultI18nEnUS.shell.shareActive).toBe('Share, active');
    expect(defaultI18nEnUS.shell.shareFailed).toBe('Could not start sharing');
    expect(defaultI18nEnUS.shell.shareStop).toBe('Stop sharing');
    expect(defaultI18nEnUS.shell.shareStopPending.length).toBeGreaterThan(0);
  });

  it('o token --canvash-share-active-color e a parte share-status entram na API de tema', () => {
    expect(CANVASH_CSS_TOKENS.shareActiveColor).toBe('--canvash-share-active-color');
    expect(CANVASH_PARTS.shell).toEqual(expect.arrayContaining(['share-status']));
  });
});
