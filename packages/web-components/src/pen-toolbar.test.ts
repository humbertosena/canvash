import { PEN_PALETTE, createCanvasSection, type InkNode } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';
import { CanvasPropertiesElement } from './canvas-properties.js';
import { CanvasToolbarElement } from './canvas-toolbar.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';

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
  _selectPenOption(patch: Record<string, unknown>): void;
  _selectPenColor(color: string): void;
  _onCustomPenColor(event: Event): void;
  _openPenColorPicker(): void;
}

function toolbarWithSection() {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  return { el, section, internals: el as unknown as TestableToolbar };
}

describe('caneta na toolbar', () => {
  it('a Tinta é uma opção do grupo Desenho, com rótulos localizados', () => {
    const { el } = toolbarWithSection();
    el.drawMenuOpen = true;
    const html = templateText(el.render());
    expect(html).toContain('data-tool=pen');
    expect(html).toContain('aria-label=Tinta');
    // O botão e o chip separados da caneta saíram.
    expect(html).not.toContain('part="pen-color action-button"');
    expect(html).not.toContain('data-action="open-pen-settings"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(el.messages.pen).toBe('Caneta');
    expect(el.messages.drawPen).toBe('Tinta');
    expect(defaultI18nEnUS.toolbar.drawPen).toBe('Ink');
    expect(defaultI18nEnUS.toolbar.pen).toBe('Pen');
    expect(defaultI18nPtBR.toolbar.penSettings).toBe('Configurações da caneta');
  });

  it('o padrão é grafite, caneta, média, e a ilha da Tinta marca a cor', () => {
    const { el, section } = toolbarWithSection();
    expect(el.penSettings).toEqual({ color: '#1f2937', kind: 'pen', width: 'medium' });
    section.setTool('pen');
    el.drawMenuOpen = true;
    const checked = templateText(el.render())
      .split('<button')
      .find((chunk) => chunk.includes('data-pen-color=#1f2937'));
    expect(checked).toContain('aria-checked=true');
  });

  it('a ilha fechada não aparece; com a Tinta marcada traz tipo, espessura, 8 cores e a personalizada', () => {
    const { el, section } = toolbarWithSection();
    expect(templateText(el.render())).not.toContain('part="draw-menu"');

    section.setTool('pen');
    el.drawMenuOpen = true;
    const html = templateText(el.render());
    expect(html).toContain('part="draw-menu"');
    for (const kind of ['pen', 'marker', 'highlighter']) {
      expect(html).toContain(`data-pen-kind=${kind}`);
    }
    for (const width of ['thin', 'medium', 'thick']) {
      expect(html).toContain(`data-pen-width=${width}`);
    }
    for (const color of PEN_PALETTE) expect(html).toContain(`data-pen-color=${color}`);
    expect(html).toContain('data-action="custom-pen-color"');
    for (const group of ['Tipo', 'Espessura', 'Cor']) {
      expect(html).toContain(`role="group" aria-label=${group}`);
    }
    for (const name of ['Marca-texto', 'Grossa', 'Grafite', 'Rosa', 'Personalizada']) {
      expect(html).toContain(`aria-label=${name}`);
    }
    // 4 opções do grupo + 3 tipos + 3 espessuras + 8 cores.
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(18);
  });

  it('o item ativo de cada grupo fica marcado', () => {
    const { el, section } = toolbarWithSection();
    section.setTool('pen');
    el.drawMenuOpen = true;
    el.penSettings = { kind: 'marker', width: 'thick', color: '#ef4444' };
    const chunks = templateText(el.render()).split('<button');
    // A opção Tinta do grupo e uma opção de cada bloco de configurações.
    const checked = chunks.filter(
      (chunk) => chunk.includes('aria-checked=true') && !chunk.includes('draw-item'),
    );
    expect(checked).toHaveLength(3);
    expect(checked.some((chunk) => chunk.includes('data-pen-kind=marker'))).toBe(true);
    expect(checked.some((chunk) => chunk.includes('data-pen-width=thick'))).toBe(true);
    expect(checked.some((chunk) => chunk.includes('data-pen-color=#ef4444'))).toBe(true);
  });

  it('tipo e espessura mudam a caneta, ativam a ferramenta e deixam o menu aberto', () => {
    const { el, section, internals } = toolbarWithSection();
    const events: Array<{ settings: unknown; section: unknown }> = [];
    el.addEventListener('pen-settings-change', (event) => {
      events.push((event as CustomEvent).detail);
    });
    el.drawMenuOpen = true;

    internals._selectPenOption({ kind: 'highlighter' });
    internals._selectPenOption({ width: 'thin' });

    expect(el.penSettings).toEqual({ color: '#1f2937', kind: 'highlighter', width: 'thin' });
    expect(section.getSnapshot().session.activeTool).toBe('pen');
    expect(el.drawMenuOpen).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      settings: { color: '#1f2937', kind: 'highlighter', width: 'thin' },
      section,
    });
  });

  it('escolher a cor ativa a caneta e fecha o menu', () => {
    const { el, section, internals } = toolbarWithSection();
    el.drawMenuOpen = true;
    internals._selectPenColor('#3B82F6');
    expect(el.penSettings.color).toBe('#3b82f6');
    expect(section.getSnapshot().session.activeTool).toBe('pen');
    expect(el.drawMenuOpen).toBe(false);
  });

  it('valores inválidos são ignorados e o mesmo valor não repete o aviso', () => {
    const { el } = toolbarWithSection();
    const listener = vi.fn();
    el.addEventListener('pen-settings-change', listener);
    el.penSettings = { color: 'vermelho', kind: 'brush' as never, width: 'huge' as never };
    el.penSettings = { color: '#1f2937', kind: 'pen', width: 'medium' };
    el.penSettings = {};
    expect(listener).not.toHaveBeenCalled();
    el.penSettings = { color: '#AABBCC' };
    expect(el.penSettings.color).toBe('#aabbcc');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('o seletor personalizado abre o seletor nativo quando existir e escolhe a cor', () => {
    const { el, internals } = toolbarWithSection();
    const showPicker = vi.fn();
    const click = vi.fn();
    (el as unknown as { renderRoot: unknown }).renderRoot = {
      querySelector: () => ({ showPicker, click }),
    };
    internals._openPenColorPicker();
    expect(showPicker).toHaveBeenCalledTimes(1);
    (el as unknown as { renderRoot: unknown }).renderRoot = { querySelector: () => ({ click }) };
    internals._openPenColorPicker();
    expect(click).toHaveBeenCalledTimes(1);
    (el as unknown as { renderRoot: unknown }).renderRoot = { querySelector: () => null };
    expect(() => internals._openPenColorPicker()).not.toThrow();

    internals._onCustomPenColor({ target: { value: '#123456' } } as unknown as Event);
    expect(el.penSettings.color).toBe('#123456');
    expect(() => internals._onCustomPenColor({ target: null } as unknown as Event)).not.toThrow();
  });

  it('sem canvas, o botão do grupo Desenho fica desabilitado', () => {
    const el = new CanvasToolbarElement();
    const html = templateText(el.render());
    const pen = html.split('<button').find((chunk) => chunk.includes('data-action="open-draw"'));
    expect(pen).toContain('?disabled=');
  });
});

describe('<canvas-surface> acompanha a caneta da toolbar', () => {
  it('guarda as configurações pedidas antes da montagem', () => {
    const canvas = new CanvasSurfaceElement();
    expect(canvas.getPenSettings()).toBeUndefined();
    canvas.setPenSettings({ color: '#ef4444', kind: 'marker', width: 'thick' });
    expect(canvas.getPenSettings()).toEqual({ color: '#ef4444', kind: 'marker', width: 'thick' });
  });
});

describe('painel de propriedades: traços à mão livre', () => {
  function setup(ids: string[] = ['k1']) {
    const el = new CanvasPropertiesElement();
    const section = createCanvasSection();
    el.section = section;
    ids.forEach((id, index) => {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id,
          type: 'ink',
          strokes: [
            {
              points: [
                { x: index * 100, y: 0 },
                { x: index * 100 + 50, y: 40 },
              ],
            },
            { points: [{ x: index * 100, y: 80 }], color: '#ef4444' },
          ],
        } as never,
      });
    });
    section.setSelection(ids);
    return {
      el,
      section,
      internals: el as unknown as { _onInkColor(color: string): void },
      html: (): string => templateText(el.render()),
    };
  }

  it('mostra a seção com a contagem de traços, a cor e a opacidade, sem preenchimento nem contorno', () => {
    const { html } = setup();
    const text = html();
    expect(text).toContain('section-ink');
    expect(text).toContain('2 traços');
    expect(text).toContain('data-field="ink-color"');
    expect(text).toContain('input-opacity');
    expect(text).not.toContain('btn-fill-preview');
    expect(text).not.toContain('btn-stroke-preview');
    expect(text).not.toContain('input-stroke-width');
  });

  it('com traços de cores diferentes mostra "Misto"', () => {
    const { html } = setup();
    expect(html()).toContain('Misto');
  });

  it('com uma cor só mostra a cor', () => {
    const { section, internals, html } = setup();
    internals._onInkColor('#3b82f6');
    expect(html()).not.toContain('Misto');
    expect(html()).toContain('#3b82f6');
    expect(
      (section.getSnapshot().document.nodes['k1'] as InkNode).strokes.map((s) => s.color),
    ).toEqual(['#3b82f6', '#3b82f6']);
  });

  it('recolorir muda todos os traços numa entrada de histórico e o undo volta', () => {
    const { section, internals } = setup();
    const before = (section.getSnapshot().document.nodes['k1'] as InkNode).strokes;
    const revision = section.getSnapshot().revision;
    internals._onInkColor('#22c55e');
    expect(section.getSnapshot().revision).toBe(revision + 1);
    section.undo();
    expect((section.getSnapshot().document.nodes['k1'] as InkNode).strokes).toEqual(before);
  });

  it('recolorir vale para todos os elementos selecionados em uma transação', () => {
    const { section, internals } = setup(['k1', 'k2']);
    const revision = section.getSnapshot().revision;
    internals._onInkColor('#8b5cf6');
    expect(section.getSnapshot().revision).toBe(revision + 1);
    for (const id of ['k1', 'k2']) {
      const colors = (section.getSnapshot().document.nodes[id] as InkNode).strokes.map(
        (s) => s.color,
      );
      expect(new Set(colors)).toEqual(new Set(['#8b5cf6']));
    }
  });

  it('cor inválida, sem seleção de traços ou sem canvas não faz nada', () => {
    const { section, internals } = setup();
    const before = section.getSnapshot().document;
    for (const value of ['', 'azul', '#fff', '#12345g']) internals._onInkColor(value);
    expect(section.getSnapshot().document).toBe(before);
    section.setSelection([]);
    internals._onInkColor('#22c55e');
    expect(section.getSnapshot().document).toBe(before);
    const detached = new CanvasPropertiesElement() as unknown as { _onInkColor(c: string): void };
    expect(() => detached._onInkColor('#22c55e')).not.toThrow();
  });

  it('a opacidade muda só o estilo do elemento', () => {
    const { section, el } = setup();
    (el as unknown as { _onOpacityChange(e: Event): void })._onOpacityChange({
      target: { value: '40' },
    } as unknown as Event);
    expect((section.getSnapshot().document.nodes['k1'] as InkNode).style.opacity).toBe(0.4);
  });

  it('uma seleção mista não quebra: o preenchimento vale só para quem o tem', () => {
    const { section, el } = setup();
    section.dispatch({
      type: 'shape.create',
      shape: { id: 'ret', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    });
    section.setSelection(['k1', 'ret']);
    expect(templateText(el.render())).toContain('btn-fill-preview');
    (el as unknown as { _onColorChange(p: string, e: Event): void })._onColorChange('fill', {
      target: { value: '#ff0000' },
    } as unknown as Event);
    expect(section.getSnapshot().document.nodes['ret']).toMatchObject({
      style: { fill: '#ff0000' },
    });
    expect(section.getSnapshot().document.nodes['k1']).toMatchObject({ style: { opacity: 1 } });
  });

  it('as mensagens da seção existem em pt-BR e em inglês', () => {
    expect(defaultI18nPtBR.properties.sectionInk).toBe('Caneta');
    expect(defaultI18nPtBR.properties.inkStrokes(1)).toBe('1 traço');
    expect(defaultI18nPtBR.properties.inkStrokes(3)).toBe('3 traços');
    expect(defaultI18nEnUS.properties.inkStrokes(1)).toBe('1 stroke');
    expect(defaultI18nEnUS.properties.inkStrokes(2)).toBe('2 strokes');
  });
});
