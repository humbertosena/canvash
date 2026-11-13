import { createCanvasSection, type CanvasPeer } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasPropertiesElement } from './canvas-properties.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';

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
  if (typeof result === 'symbol') return '';
  return String(result);
}

const holder = (locks: string[], name = 'Ana'): CanvasPeer => ({
  sessionId: 'outra',
  name,
  color: '#dc2626',
  cursor: null,
  selection: locks,
  selectedAt: 1,
  drag: null,
  view: null,
  locks,
  followed: false,
});

function panelWith(selected: string[]) {
  const section = createCanvasSection();
  for (const id of ['a', 'b']) {
    section.dispatch({
      type: 'shape.create',
      shape: {
        id,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        style: { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 },
      },
    });
  }
  section.setSelection(selected);
  const el = new CanvasPropertiesElement();
  el.section = section;
  return { section, el };
}

describe('<canvas-properties>: seleção bloqueada por outro participante (US-RL.2)', () => {
  it('sem bloqueio os campos ficam habilitados e não há aviso', () => {
    const { el } = panelWith(['a']);
    const html = templateText(el.render());

    expect(html).not.toContain('peer-lock-notice');
    expect(html).not.toMatch(/<input[^>]*\sdisabled/);
  });

  it('mostra a linha Em edição por <Nome> e desabilita os campos', () => {
    const { section, el } = panelWith(['a']);
    section.setPeers([holder(['a'])]);

    const html = templateText(el.render());

    expect(html).toContain('part="peer-lock-notice"');
    expect(html).toContain('Em edição por Ana');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('border-left: 4px solid #dc2626');
    // Todo campo numérico vem desabilitado.
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((input) => /\bdisabled\b/.test(input))).toBe(true);
  });

  it('um bloqueio em outro nó não afeta a seleção livre', () => {
    const { section, el } = panelWith(['a']);
    section.setPeers([holder(['b'])]);

    expect(templateText(el.render())).not.toContain('peer-lock-notice');
  });

  it('numa seleção mista basta um nó bloqueado', () => {
    const { section, el } = panelWith(['a', 'b']);
    section.setPeers([holder(['b'], 'Caio')]);

    expect(templateText(el.render())).toContain('Em edição por Caio');
  });

  it('a mensagem existe em pt-BR e em en', () => {
    expect(defaultI18nPtBR.properties.lockedBy('Ana')).toBe('Em edição por Ana');
    expect(defaultI18nEnUS.properties.lockedBy('Ana')).toBe('Being edited by Ana');
  });
});
