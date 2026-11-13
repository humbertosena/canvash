import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasToolbarElement, DRAW_GROUP_TOOLS } from './canvas-toolbar.js';
import { defaultI18nEnUS } from './i18n.js';
import type { ToolMenu } from './tool-menu.js';

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
  _drawMenu: ToolMenu;
  _onDrawButton(): void;
  _selectDrawTool(tool: string): void;
  _selectPenOption(patch: Record<string, unknown>): void;
  _selectPenColor(color: string): void;
  _selectEraserSize(size: string): void;
}

function toolbar() {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  return { el, section, internals: el as unknown as Internals };
}

function buttonsWith(el: CanvasToolbarElement, marker: string): string[] {
  return templateText(el.render())
    .split('<button')
    .filter((chunk) => chunk.includes(marker));
}

describe('grupo "Desenho": conteúdo e estado', () => {
  it('lista line, bezier, pen e eraser, nessa ordem', () => {
    expect(DRAW_GROUP_TOOLS).toEqual(['line', 'bezier', 'pen', 'eraser']);
  });

  it('fechado, tem um só botão de grupo com a Bézier e nenhum botão solto das 4 ferramentas', () => {
    const { el } = toolbar();
    const text = templateText(el.render());
    expect(text).not.toContain('role="menu"');

    const [button] = buttonsWith(el, 'data-action="open-draw"');
    expect(buttonsWith(el, 'data-action="open-draw"')).toHaveLength(1);
    expect(button).toContain('data-tool=bezier');
    expect(button).toContain('aria-label=Desenho: Bézier');
    expect(button).toContain('title=Desenho');
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain('aria-expanded=false');
    expect(button).toContain('aria-controls="draw-menu"');

    for (const tool of ['line', 'pen', 'eraser']) {
      expect(text).not.toContain(`data-tool="${tool}"`);
      expect(text).not.toContain(`data-tool=${tool}`);
    }
    // Os grupos antigos de caneta e borracha, com chips, saem.
    expect(text).not.toContain('open-pen-settings');
    expect(text).not.toContain('open-eraser-size');
  });

  it('aberta com a Bézier, mostra as 4 opções e nenhuma configuração', () => {
    const { el } = toolbar();
    el.drawMenuOpen = true;
    const text = templateText(el.render());

    expect(text).toContain('part="draw-menu"');
    const options = buttonsWith(el, 'role="menuitemradio"');
    expect(options).toHaveLength(4);
    expect(options.map((o) => /data-tool=(\w+)/.exec(o)?.[1])).toEqual([...DRAW_GROUP_TOOLS]);
    expect(options.filter((o) => o.includes('aria-checked=true'))).toHaveLength(1);
    expect(options.find((o) => o.includes('aria-checked=true'))).toContain('data-tool=bezier');
    // Tinta é o nome da opção da caneta; o nó continua `ink`.
    expect(options[2]).toContain('aria-label=Tinta');
    expect(text).not.toContain('role="separator" class="menu-divider"');
    expect(text).not.toContain('data-pen-kind');
    expect(text).not.toContain('data-eraser-size');
  });

  it('com Tinta, mostra abaixo do divisor tipo, espessura e as cores com a personalizada', () => {
    const { el, section } = toolbar();
    section.setTool('pen');
    el.drawMenuOpen = true;
    const text = templateText(el.render());

    expect(text).toContain('class="menu-divider"');
    for (const kind of ['pen', 'marker', 'highlighter'])
      expect(text).toContain(`data-pen-kind=${kind}`);
    for (const width of ['thin', 'medium', 'thick'])
      expect(text).toContain(`data-pen-width=${width}`);
    expect(text.match(/data-pen-color=/g)).toHaveLength(8);
    expect(text).toContain('data-action="custom-pen-color"');
    for (const group of ['Tipo', 'Espessura', 'Cor']) {
      expect(text).toContain(`role="group" aria-label=${group}`);
    }
    expect(text).not.toContain('data-eraser-size');
    // 4 opções + 3 tipos + 3 espessuras + 8 cores.
    expect(buttonsWith(el, 'role="menuitemradio"')).toHaveLength(18);
  });

  it('com a borracha, mostra os três tamanhos', () => {
    const { el, section } = toolbar();
    section.setTool('eraser');
    el.drawMenuOpen = true;
    const text = templateText(el.render());

    expect(text).toContain('class="menu-divider"');
    for (const size of ['thin', 'medium', 'thick'])
      expect(text).toContain(`data-eraser-size=${size}`);
    expect(text).not.toContain('data-pen-kind');
    expect(buttonsWith(el, 'role="menuitemradio"')).toHaveLength(7);
  });

  it('as configurações seguem a opção marcada, mesmo com a seleção ativa', () => {
    const { el, section } = toolbar();
    section.setTool('pen');
    section.setTool('select');
    expect(el.lastDrawTool).toBe('pen');
    el.drawMenuOpen = true;
    expect(templateText(el.render())).toContain('data-pen-kind');
  });
});

describe('grupo "Desenho": lembrança e escolha', () => {
  it('começa na Bézier e acompanha a ferramenta ativa, inclusive por setTool externo', () => {
    const { el, section } = toolbar();
    expect(el.lastDrawTool).toBe('bezier');

    section.setTool('eraser');
    expect(el.lastDrawTool).toBe('eraser');
    expect(buttonsWith(el, 'data-action="open-draw"')[0]).toContain('aria-pressed=true');

    section.setTool('rectangle');
    expect(el.lastDrawTool).toBe('eraser');
    expect(buttonsWith(el, 'data-action="open-draw"')[0]).toContain('aria-pressed=false');
  });

  it('lê a ferramenta que já estava ativa ao receber o canvas e aceita atribuição do host', () => {
    const section = createCanvasSection();
    section.setTool('line');
    const el = new CanvasToolbarElement();
    el.section = section;
    expect(el.lastDrawTool).toBe('line');

    const host = new CanvasToolbarElement();
    host.lastDrawTool = 'pen';
    host.section = createCanvasSection();
    expect(host.lastDrawTool).toBe('pen');
  });

  it('o clique no botão ativa a opção lembrada e fixa a ilha; o seguinte a fecha', () => {
    const { el, section, internals } = toolbar();
    section.setTool('line');
    section.setTool('select');

    internals._onDrawButton();
    expect(section.getSnapshot().session.activeTool).toBe('line');
    expect(el.drawMenuOpen).toBe(true);
    expect(internals._drawMenu.pinned).toBe(true);

    internals._onDrawButton();
    expect(el.drawMenuOpen).toBe(false);
  });

  it('escolher uma opção a ativa, lembra dela e fecha a ilha', () => {
    const { el, section, internals } = toolbar();
    el.drawMenuOpen = true;
    internals._selectDrawTool('eraser');
    expect(section.getSnapshot().session.activeTool).toBe('eraser');
    expect(el.lastDrawTool).toBe('eraser');
    expect(el.drawMenuOpen).toBe(false);
  });

  it('sem canvas ou em leitura, escolher não ativa nada', () => {
    const bare = new CanvasToolbarElement();
    (bare as unknown as Internals)._selectDrawTool('pen');
    expect(bare.lastDrawTool).toBe('bezier');

    const { el, section, internals } = toolbar();
    section.setReadOnly(true);
    internals._selectDrawTool('pen');
    expect(section.getSnapshot().session.activeTool).toBe('select');
    expect(el.lastDrawTool).toBe('bezier');
  });

  it('tipo e espessura deixam a ilha aberta; a cor e o tamanho da borracha fecham', () => {
    const { el, section, internals } = toolbar();
    section.setTool('pen');
    el.drawMenuOpen = true;
    internals._selectPenOption({ kind: 'marker' });
    expect(el.drawMenuOpen).toBe(true);
    internals._selectPenColor('#3b82f6');
    expect(el.drawMenuOpen).toBe(false);

    section.setTool('eraser');
    el.drawMenuOpen = true;
    internals._selectEraserSize('thick');
    expect(el.eraserSize).toBe('thick');
    expect(el.drawMenuOpen).toBe(false);
  });

  it('traduz o nome acessível do botão e da opção', () => {
    const { el } = toolbar();
    el.messages = defaultI18nEnUS.toolbar;
    expect(buttonsWith(el, 'data-action="open-draw"')[0]).toContain('aria-label=Draw: Bézier');
    el.drawMenuOpen = true;
    expect(buttonsWith(el, 'role="menuitemradio"')[2]).toContain('aria-label=Ink');
  });
});

/** Funções ligadas ao template (eventos), na ordem em que aparecem. */
function templateHandlers(result: unknown): Array<(this: unknown, event?: unknown) => void> {
  if (Array.isArray(result)) return result.flatMap(templateHandlers);
  if (result && typeof result === 'object' && 'values' in result) {
    return (result as { values: unknown[] }).values.flatMap(templateHandlers);
  }
  return typeof result === 'function' ? [result as (this: unknown, event?: unknown) => void] : [];
}

describe('grupo "Desenho": grades da ilha e teclado', () => {
  interface Block {
    start: number;
    count: number;
    columns: number;
  }
  const blocksOf = (el: CanvasToolbarElement): Block[] =>
    (el as unknown as { _drawBlocks(): Block[] })._drawBlocks();

  it('as grades empilhadas seguem a opção marcada', () => {
    const { el } = toolbar();
    const options = { start: 0, count: 4, columns: 4 };

    el.lastDrawTool = 'line';
    expect(blocksOf(el)).toEqual([options]);
    el.lastDrawTool = 'eraser';
    expect(blocksOf(el)).toEqual([options, { start: 4, count: 3, columns: 3 }]);
    el.lastDrawTool = 'pen';
    expect(blocksOf(el)).toEqual([
      options,
      { start: 4, count: 3, columns: 3 },
      { start: 7, count: 3, columns: 3 },
      { start: 10, count: 9, columns: 3 },
    ]);
  });

  /** Seletores consultados ao andar, com a seta para a direita, por todas as entradas. */
  async function walk(tool: 'line' | 'pen' | 'eraser', entries: number): Promise<string[]> {
    const { el, internals } = toolbar();
    el.lastDrawTool = tool;
    const queried: string[] = [];
    Object.defineProperty(el, 'renderRoot', {
      value: {
        querySelector: (selector: string) => (queried.push(selector), { focus: () => {} }),
        contains: () => false,
      },
    });
    Object.defineProperty(el, 'updateComplete', { value: Promise.resolve(true) });
    for (let index = 1; index < entries; index++) {
      internals._drawMenu.focusedIndex = index - 1;
      internals._drawMenu.onMenuKeydown({ key: 'ArrowRight', preventDefault: () => {} } as never);
      await Promise.resolve();
    }
    return queried;
  }

  it('cada índice da ilha aponta para o seu botão: opções, tipos, espessuras, cores e personalizada', async () => {
    const pen = await walk('pen', 19);
    expect(pen).toHaveLength(18);
    expect(pen[0]).toBe('[role="menuitemradio"][data-tool="bezier"]');
    expect(pen[2]).toBe('[role="menuitemradio"][data-tool="eraser"]');
    expect(pen[3]).toBe('[role="menuitemradio"][data-pen-kind="pen"]');
    expect(pen[5]).toBe('[role="menuitemradio"][data-pen-kind="highlighter"]');
    expect(pen[6]).toBe('[role="menuitemradio"][data-pen-width="thin"]');
    expect(pen[9]).toMatch(/^\[role="menuitemradio"\]\[data-pen-color="#[0-9a-f]{6}"\]$/);
    expect(pen[16]).toMatch(/data-pen-color/);
    expect(pen[17]).toBe('[data-action="custom-pen-color"]');

    const eraser = await walk('eraser', 7);
    expect(eraser.slice(3)).toEqual([
      '[role="menuitemradio"][data-eraser-size="thin"]',
      '[role="menuitemradio"][data-eraser-size="medium"]',
      '[role="menuitemradio"][data-eraser-size="thick"]',
    ]);

    expect(await walk('line', 4)).toHaveLength(3);
  });

  it('os handlers do botão e da ilha com a Tinta e com a borracha funcionam e não quebram', () => {
    for (const tool of ['pen', 'eraser', 'line'] as const) {
      const { el } = toolbar();
      el.lastDrawTool = tool;
      el.drawMenuOpen = true;
      const handlers = templateHandlers(el.render());
      expect(handlers.length).toBeGreaterThan(10);
      const event = {
        key: '',
        pointerType: 'mouse',
        relatedTarget: null,
        target: { value: '#123456' },
        preventDefault: () => {},
      };
      for (const handler of handlers) expect(() => handler.call(el, event)).not.toThrow();
    }
  });
});
