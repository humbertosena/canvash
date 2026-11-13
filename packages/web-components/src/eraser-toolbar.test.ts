import { createCanvasSection } from '@canvash/core';
import { describe, expect, it, vi } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';
import { CanvasToolbarElement } from './canvas-toolbar.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';
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

interface TestableToolbar {
  _selectEraserSize(size: string): void;
}

function toolbarWithSection() {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  return { el, section, internals: el as unknown as TestableToolbar };
}

describe('borracha na toolbar', () => {
  it('a borracha é uma opção do grupo Desenho, com rótulos localizados', () => {
    const { el } = toolbarWithSection();
    el.drawMenuOpen = true;
    const html = templateText(el.render());
    expect(html).toContain('data-tool=eraser');
    expect(html).toContain('aria-label=Borracha');
    // O botão e o chip separados da borracha saíram.
    expect(html).not.toContain('part="eraser-size action-button"');
    expect(html).not.toContain('data-action="open-eraser-size"');
    expect(html).toContain('data-action="open-draw"');
    expect(el.messages.eraser).toBe('Borracha');
    expect(defaultI18nEnUS.toolbar.eraser).toBe('Eraser');
    expect(defaultI18nPtBR.toolbar.eraserSize).toBe('Tamanho da borracha');
    expect(defaultI18nEnUS.toolbar.eraserThick).toBe('Thick');
  });

  it('o tamanho padrão é médio e a ilha da borracha mostra a bolinha dele', () => {
    const { el, section } = toolbarWithSection();
    expect(el.eraserSize).toBe('medium');
    section.setTool('eraser');
    el.drawMenuOpen = true;
    expect(templateText(el.render())).toContain('width: 10px; height: 10px');
  });

  it('a ilha fechada não aparece; com a borracha marcada traz as três opções de tamanho', () => {
    const { el, section } = toolbarWithSection();
    expect(templateText(el.render())).not.toContain('part="draw-menu"');

    section.setTool('eraser');
    el.drawMenuOpen = true;
    const html = templateText(el.render());
    expect(html).toContain('part="draw-menu"');
    for (const size of ['thin', 'medium', 'thick']) {
      expect(html).toContain(`data-eraser-size=${size}`);
    }
    // 4 opções do grupo + 3 tamanhos.
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(7);
    for (const name of ['Fina', 'Média', 'Grossa']) expect(html).toContain(`aria-label=${name}`);
    const checked = html
      .split('<button')
      .filter((chunk) => chunk.includes('aria-checked=true'))
      .map((chunk) => /data-(?:eraser-size|tool)=(\w+)/.exec(chunk)?.[1]);
    expect(checked).toEqual(['eraser', 'medium']);
  });

  it('escolher o tamanho muda a borracha, ativa a ferramenta, fecha o menu e avisa com o canvas', () => {
    const { el, section, internals } = toolbarWithSection();
    const events: Array<{ size: string; section: unknown }> = [];
    el.addEventListener('eraser-size-change', (event) => {
      events.push((event as CustomEvent).detail);
    });
    el.drawMenuOpen = true;

    internals._selectEraserSize('thick');

    expect(el.eraserSize).toBe('thick');
    expect(section.getSnapshot().session.activeTool).toBe('eraser');
    expect(el.drawMenuOpen).toBe(false);
    expect(events).toEqual([{ size: 'thick', section }]);
  });

  it('o mesmo tamanho não repete o aviso e valor inválido é ignorado', () => {
    const { el } = toolbarWithSection();
    const listener = vi.fn();
    el.addEventListener('eraser-size-change', listener);
    el.eraserSize = 'medium';
    el.eraserSize = 'enorme' as never;
    expect(listener).not.toHaveBeenCalled();
    el.eraserSize = 'thin';
    expect(listener).toHaveBeenCalledTimes(1);
    expect(el.eraserSize).toBe('thin');
  });

  it('sem canvas, o botão do grupo Desenho fica desabilitado', () => {
    const el = new CanvasToolbarElement();
    const html = templateText(el.render());
    const button = html.split('<button').find((chunk) => chunk.includes('data-action="open-draw"'));
    expect(button).toContain('?disabled=');
  });

  it('o tema expõe o token do indicador e as partes da borracha', () => {
    expect(CANVASH_CSS_TOKENS.eraserCursor).toBe('--canvash-eraser-cursor');
    for (const part of ['draw-group', 'draw-button', 'draw-menu', 'draw-item', 'eraser-item']) {
      expect(CANVASH_PARTS.toolbar).toContain(part);
    }
  });
});

describe('<canvas-surface> acompanha a borracha da toolbar', () => {
  it('guarda o tamanho pedido antes da montagem', () => {
    const canvas = new CanvasSurfaceElement();
    expect(canvas.getEraserSize()).toBeUndefined();
    canvas.setEraserSize('thick');
    expect(canvas.getEraserSize()).toBe('thick');
  });
});
