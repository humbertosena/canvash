import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import { CanvasToolbarElement } from './canvas-toolbar.js';
import { defaultI18nEnUS } from './i18n.js';
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

interface Internals {
  _onPropertiesButton(): void;
  _onPropertiesKeydown(event: KeyboardEvent): void;
  willUpdate(): void;
  updated(changed: Map<string, unknown>): void;
  _stickyMenu: { openMenu(): void; open: boolean };
}

function toolbar() {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  return { el, section, internals: el as unknown as Internals };
}

function addShape(section: CanvasSectionApi, id: string) {
  section.dispatch({
    type: 'shape.create',
    shape: { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  });
}

const button = (el: CanvasToolbarElement): string =>
  templateText(el.render())
    .split('<button')
    .find((chunk) => chunk.includes('data-action="properties"')) ?? '';

describe('<canvas-toolbar>: botão e painel de Propriedades', () => {
  it('a área Propriedades vem depois da de formas, com separador, e traz o botão com o nome localizado', () => {
    const { el } = toolbar();
    const html = templateText(el.render());

    expect(html).toMatch(/role="group"\s+aria-label=Propriedades/);
    expect(html).toContain('part="tools-group properties-area"');
    expect(html.indexOf('shapes-area')).toBeLessThan(html.indexOf('properties-area'));
    expect(button(el)).toContain('aria-label=Propriedades');
    expect(button(el)).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(button(el)).toContain('aria-haspopup="dialog"');
    expect(button(el)).toContain('aria-controls="properties-panel"');
    expect(CANVASH_PARTS.toolbar).toEqual(
      expect.arrayContaining(['properties-area', 'properties-button', 'properties-panel']),
    );
    expect(defaultI18nEnUS.toolbar.properties).toBe('Properties');
  });

  it('sem seleção o botão fica desabilitado e explica por quê; com seleção habilita', () => {
    const { el, section } = toolbar();
    expect(button(el)).toContain('?disabled=true');
    expect(button(el)).toContain('title=Selecione uma ou mais formas');

    addShape(section, 'a');
    section.setSelection(['a']);
    expect(button(el)).toContain('?disabled=false');
    expect(button(el)).toContain('title=Propriedades');
  });

  it('em leitura o botão fica desabilitado, e sem canvas também', () => {
    const { el, section } = toolbar();
    addShape(section, 'a');
    section.setSelection(['a']);
    section.setReadOnly(true);
    expect(button(el)).toContain('?disabled=true');

    const bare = new CanvasToolbarElement();
    expect(button(bare)).toContain('?disabled=true');
  });

  it('em leitura compacta a área some', () => {
    const { el, section } = toolbar();
    el.compactReadonly = true;
    section.setReadOnly(true);
    const html = templateText(el.render());
    expect(html).not.toContain('properties-area');
    expect(html).not.toContain('data-action="properties"');
  });

  it('o clique abre o painel com role dialog e o slot properties; o seguinte fecha', () => {
    const { el, section, internals } = toolbar();
    addShape(section, 'a');
    section.setSelection(['a']);
    expect(templateText(el.render())).not.toContain('role="dialog"');

    internals._onPropertiesButton();
    expect(el.propertiesOpen).toBe(true);
    const html = templateText(el.render());
    expect(html).toContain('id="properties-panel"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<slot name="properties">');
    expect(button(el)).toContain('aria-expanded=true');

    internals._onPropertiesButton();
    expect(el.propertiesOpen).toBe(false);
  });

  it('trocar a seleção mantém o painel; esvaziá-la ou entrar em leitura o fecha', () => {
    const { el, section, internals } = toolbar();
    addShape(section, 'a');
    addShape(section, 'b');
    section.setSelection(['a']);
    el.propertiesOpen = true;

    section.setSelection(['b']);
    internals.willUpdate();
    expect(el.propertiesOpen).toBe(true);

    section.setSelection([]);
    internals.willUpdate();
    expect(el.propertiesOpen).toBe(false);

    section.setSelection(['a']);
    el.propertiesOpen = true;
    section.setReadOnly(true);
    internals.willUpdate();
    expect(el.propertiesOpen).toBe(false);
  });

  it('Esc no painel fecha e devolve o foco ao botão; outras teclas não fazem nada', () => {
    const { el, section, internals } = toolbar();
    addShape(section, 'a');
    section.setSelection(['a']);
    const focus = vi.fn();
    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => ({ focus }), contains: () => false },
    });
    el.propertiesOpen = true;

    const other = { key: 'a', preventDefault: vi.fn() } as unknown as KeyboardEvent;
    internals._onPropertiesKeydown(other);
    expect(el.propertiesOpen).toBe(true);

    const esc = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent;
    internals._onPropertiesKeydown(esc);
    expect(el.propertiesOpen).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(esc.preventDefault).toHaveBeenCalled();
  });

  it('emite properties-panel-toggle uma vez por mudança, com bubbles e composed', () => {
    const { el, internals } = toolbar();
    const events: CustomEvent<{ open: boolean }>[] = [];
    el.addEventListener('properties-panel-toggle', (event) =>
      events.push(event as CustomEvent<{ open: boolean }>),
    );

    // A primeira atualização não conta como mudança.
    internals.updated(new Map([['propertiesOpen', undefined]]));
    expect(events).toHaveLength(0);

    el.propertiesOpen = true;
    internals.updated(new Map([['propertiesOpen', false]]));
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toEqual({ open: true });
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);

    // Uma atualização sem mudança de fato não repete o aviso.
    internals.updated(new Map([['propertiesOpen', true]]));
    expect(events).toHaveLength(1);

    el.propertiesOpen = false;
    internals.updated(new Map([['propertiesOpen', true]]));
    expect(events.map((event) => event.detail.open)).toEqual([true, false]);
  });

  it('abrir Propriedades fecha a ilha de grupo, e abrir uma ilha de grupo fecha Propriedades', () => {
    const { el, section, internals } = toolbar();
    addShape(section, 'a');
    section.setSelection(['a']);

    el.shapesMenuOpen = true;
    internals._onPropertiesButton();
    expect(el.propertiesOpen).toBe(true);
    expect(el.shapesMenuOpen).toBe(false);

    internals._stickyMenu.openMenu();
    expect(el.propertiesOpen).toBe(false);
    expect(internals._stickyMenu.open).toBe(true);
  });

  it('expõe o atributo properties-open, refletido', () => {
    const properties = CanvasToolbarElement.properties as unknown as Record<
      string,
      { attribute?: string | boolean; reflect?: boolean }
    >;
    expect(properties['propertiesOpen']?.attribute).toBe('properties-open');
    expect(properties['propertiesOpen']?.reflect).toBe(true);
  });
});
