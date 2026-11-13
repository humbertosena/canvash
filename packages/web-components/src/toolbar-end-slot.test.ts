import { describe, expect, it } from 'vitest';
import { CanvasToolbarElement } from './canvas-toolbar.js';
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

interface EndSlotTestable {
  _hasEnd: boolean;
  _onEndSlotChange(event: { target: { assignedElements(): unknown[] } }): void;
}

const slotWith = (count: number) => ({
  target: { assignedElements: () => Array.from({ length: count }, () => ({})) },
});

describe('<canvas-toolbar>: divisor do slot end', () => {
  it('liga o slotchange do slot end uma vez, na primeira renderização', () => {
    const el = new CanvasToolbarElement();
    const added: string[] = [];
    const slot = { addEventListener: (type: string) => added.push(type) };
    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: (selector: string) => (selector.includes('end') ? slot : null) },
      configurable: true,
    });

    (el as unknown as { firstUpdated(changed: Map<string, unknown>): void }).firstUpdated(
      new Map(),
    );

    expect(added).toEqual(['slotchange']);
  });

  it('sem conteúdo no slot end, a toolbar renderiza como antes: sem end-separator', () => {
    const html = templateText(new CanvasToolbarElement().render());

    expect(html).not.toContain('part="end-separator"');
    expect(html.split('role="separator"')).toHaveLength(5);
    expect(html).toContain('<slot name="end"');
  });

  it('com conteúdo no slot end, desenha o divisor logo antes dele, na orientação da toolbar', () => {
    const el = new CanvasToolbarElement();
    el.orientation = 'vertical';
    const internals = el as unknown as EndSlotTestable;

    internals._onEndSlotChange(slotWith(1));
    const html = templateText(el.render());

    expect(internals._hasEnd).toBe(true);
    expect(html).toContain('part="end-separator"');
    expect(html).toMatch(/part="end-separator"\s+role="separator"\s+aria-orientation=vertical/);
    expect(html.indexOf('part="end-separator"')).toBeLessThan(html.indexOf('<slot name="end"'));
    expect(html.indexOf('<slot></slot>')).toBeLessThan(html.indexOf('part="end-separator"'));
  });

  it('o divisor some quando o slot esvazia', () => {
    const el = new CanvasToolbarElement();
    const internals = el as unknown as EndSlotTestable;

    internals._onEndSlotChange(slotWith(2));
    expect(internals._hasEnd).toBe(true);
    internals._onEndSlotChange(slotWith(0));

    expect(internals._hasEnd).toBe(false);
    expect(templateText(el.render())).not.toContain('part="end-separator"');
  });

  it('documenta a parte', () => {
    expect(CANVASH_PARTS.toolbar).toContain('end-separator');
  });
});
