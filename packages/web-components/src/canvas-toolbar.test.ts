import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CanvasToolbarElement, DEFAULT_TOOLBAR_TOOLS } from './canvas-toolbar.js';
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

/** Todos os handlers de evento do template, na ordem em que aparecem. */
function templateHandlers(result: unknown): Array<(this: unknown, event?: unknown) => void> {
  if (Array.isArray(result)) return result.flatMap(templateHandlers);
  if (result && typeof result === 'object' && 'values' in result) {
    return (result as { values: unknown[] }).values.flatMap(templateHandlers);
  }
  return typeof result === 'function' ? [result as (this: unknown, event?: unknown) => void] : [];
}

interface TestableToolbar {
  _section: unknown;
  _unsubscribeSection: unknown;
  _selectTool(toolId: string): void;
  _undo(): void;
  _redo(): void;
  _zoom(factor: number): void;
  _resetZoom(): void;
  performUpdate(): void;
}

/** Botões das predefinições de polígono, que ganham testes próprios. */
const PRESET_TOOL = /data-tool=(pentagon|hexagon|octagon)\b/;
/** Todas as ferramentas acrescentadas depois das 13 originais, cada uma com teste próprio. */
const ADDED_TOOL =
  /data-tool="?(pentagon|hexagon|octagon|cross|chevron|brace|sticky|pen|eraser|board)\b/;

describe('CanvasToolbarElement', () => {
  it('inicializa com orientação horizontal e sem canvas', () => {
    const el = new CanvasToolbarElement();
    expect(el.orientation).toBe('horizontal');
    expect(el.section).toBeUndefined();
    expect(DEFAULT_TOOLBAR_TOOLS.length).toBe(6);
    expect(el.messages.square).toBe('Quadrado');
    expect(el.messages.circle).toBe('Círculo');
  });

  it('permite definir e alternar o canvas reativamente', () => {
    const el = new CanvasToolbarElement();
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();

    el.section = sectionA;
    expect(el.section).toBe(sectionA);

    el.section = sectionB;
    expect(el.section).toBe(sectionB);

    // Mesma instância é no-op
    el.section = sectionB;
    expect(el.section).toBe(sectionB);

    // Desconecta canvas
    el.section = undefined;
    expect(el.section).toBeUndefined();
  });

  it('seleciona ferramentas no canvas via _selectTool()', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;

    const testable = el as unknown as TestableToolbar;
    testable._selectTool('rectangle');
    expect(section.getSnapshot().session.activeTool).toBe('rectangle');

    testable._selectTool('square');
    expect(section.getSnapshot().session.activeTool).toBe('square');

    testable._selectTool('ellipse');
    expect(section.getSnapshot().session.activeTool).toBe('ellipse');

    testable._selectTool('circle');
    expect(section.getSnapshot().session.activeTool).toBe('circle');

    testable._selectTool('diamond');
    expect(section.getSnapshot().session.activeTool).toBe('diamond');

    testable._selectTool('triangle');
    expect(section.getSnapshot().session.activeTool).toBe('triangle');

    testable._selectTool('polygon');
    expect(section.getSnapshot().session.activeTool).toBe('polygon');

    testable._selectTool('bezier');
    expect(section.getSnapshot().session.activeTool).toBe('bezier');
  });

  it('_selectTool() é seguro se o canvas for nulo', () => {
    const el = new CanvasToolbarElement();
    const testable = el as unknown as TestableToolbar;
    expect(() => testable._selectTool('rectangle')).not.toThrow();
  });

  it('aciona undo e redo no canvas', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;

    const testable = el as unknown as TestableToolbar;

    // Cria forma para gerar histórico
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'tb-shape',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
      },
    });

    expect(section.getSnapshot().history.canUndo).toBe(true);

    testable._undo();
    expect(section.getSnapshot().document.nodes['tb-shape']).toBeUndefined();
    expect(section.getSnapshot().history.canRedo).toBe(true);

    testable._redo();
    expect(section.getSnapshot().document.nodes['tb-shape']).toBeDefined();
  });

  it('_undo() e _redo() são seguros se o canvas for nulo', () => {
    const el = new CanvasToolbarElement();
    const testable = el as unknown as TestableToolbar;
    expect(() => testable._undo()).not.toThrow();
    expect(() => testable._redo()).not.toThrow();
  });

  it('altera e redefine o zoom do viewport', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;

    const testable = el as unknown as TestableToolbar;

    // Zoom in (+20%)
    testable._zoom(1.2);
    expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(1.2);

    // Zoom out (-20%)
    testable._zoom(1 / 1.2);
    expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(1.0);

    // Reset zoom
    testable._zoom(2.5);
    expect(section.getSnapshot().session.viewport.zoom).toBeCloseTo(2.5);
    testable._resetZoom();
    expect(section.getSnapshot().session.viewport.zoom).toBe(1.0);
  });

  it('_zoom() e _resetZoom() são seguros se o canvas for nulo', () => {
    const el = new CanvasToolbarElement();
    const testable = el as unknown as TestableToolbar;
    expect(() => testable._zoom(1.2)).not.toThrow();
    expect(() => testable._resetZoom()).not.toThrow();
  });

  it('limpa inscrição ao desconectar e reanexa ao conectar', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;
    const testable = el as unknown as TestableToolbar;

    el.disconnectedCallback();
    expect(testable._unsubscribeSection).toBeUndefined();

    el.connectedCallback();
    expect(testable._unsubscribeSection).toBeDefined();
  });

  it('renderiza o template HTML da toolbar com botões para cada ferramenta', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;

    const result = el.render();
    expect(result).toBeDefined();
  });

  it('ordena as ferramentas como a spec: seleção, mão, grupo Figuras (botão e ilha, com a seta), texto, grupo Desenho (botão), board', () => {
    const el = new CanvasToolbarElement();
    el.section = createCanvasSection();
    el.shapesMenuOpen = true;

    const text = templateText(el.render());
    const tools = [...text.matchAll(/data-tool=([a-z]+)/g)].map((match) => match[1]);
    expect(tools).toEqual([
      'select',
      'hand',
      'rectangle',
      'rectangle',
      'square',
      'ellipse',
      'circle',
      'diamond',
      'triangle',
      'polygon',
      'pentagon',
      'hexagon',
      'octagon',
      'cross',
      'chevron',
      'arrow',
      'brace',
      'text',
      'bezier',
      'board',
    ]);
  });

  it('desenha cada ferramenta com ícone SVG decorativo e o nome no aria-label', () => {
    const el = new CanvasToolbarElement();
    el.section = createCanvasSection();
    // Com o menu aberto, as figuras originais aparecem como itens; o botão principal repete a última.
    el.shapesMenuOpen = true;

    const buttons = templateText(el.render())
      .split('<button')
      .filter(
        (chunk) =>
          chunk.includes('data-tool=') &&
          !ADDED_TOOL.test(chunk) &&
          !chunk.includes('part="shapes-button'),
      );
    expect(buttons).toHaveLength(12);
    for (const button of buttons) {
      expect(button).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(button).toMatch(/aria-label=\S+/);
    }
    expect(buttons[1]).toContain('aria-label=Mão');
  });

  it('desenha as predefinições de polígono com ícone SVG, rótulo localizado e ativação', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;
    el.shapesMenuOpen = true;

    const presets = templateText(el.render())
      .split('<button')
      .filter((chunk) => PRESET_TOOL.test(chunk));
    expect(presets).toHaveLength(3);
    for (const button of presets) {
      expect(button).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(button).toMatch(/aria-label=\S+/);
    }
    expect(el.messages.pentagon).toBe('Pentágono');
    expect(el.messages.hexagon).toBe('Hexágono');
    expect(el.messages.octagon).toBe('Octógono');

    for (const tool of ['pentagon', 'hexagon', 'octagon']) {
      (el as unknown as TestableToolbar)._selectTool(tool);
      expect(section.getSnapshot().session.activeTool).toBe(tool);
    }
  });

  it('desenha a cruz depois do octógono, com ícone SVG e rótulo localizado', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;
    el.shapesMenuOpen = true;

    const chunks = templateText(el.render()).split('<button');
    const cross = chunks.find((chunk) => chunk.includes('data-tool=cross'));
    expect(cross).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(cross).toContain('aria-label=Cruz');
    expect(el.messages.cross).toBe('Cruz');
    expect(defaultI18nEnUS.toolbar.cross).toBe('Cross');

    (el as unknown as TestableToolbar)._selectTool('cross');
    expect(section.getSnapshot().session.activeTool).toBe('cross');
  });

  it('desenha o chevron depois da cruz, com ícone SVG e rótulo localizado', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;
    el.shapesMenuOpen = true;

    const chunks = templateText(el.render()).split('<button');
    const chevron = chunks.find((chunk) => chunk.includes('data-tool=chevron'));
    expect(chevron).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(chevron).toContain('aria-label=Chevron');
    expect(el.messages.chevron).toBe('Chevron');

    (el as unknown as TestableToolbar)._selectTool('chevron');
    expect(section.getSnapshot().session.activeTool).toBe('chevron');
  });

  it('desenha as chaves depois do chevron, com ícone SVG e rótulo localizado', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;
    el.shapesMenuOpen = true;

    const chunks = templateText(el.render()).split('<button');
    const brace = chunks.find((chunk) => chunk.includes('data-tool=brace'));
    expect(brace).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(brace).toContain('aria-label=Chaves');
    expect(el.messages.brace).toBe('Chaves');
    expect(defaultI18nEnUS.toolbar.brace).toBe('Brace');

    (el as unknown as TestableToolbar)._selectTool('brace');
    expect(section.getSnapshot().session.activeTool).toBe('brace');
  });

  it('ativa a ferramenta mão pelo botão e traduz o rótulo', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;

    (el as unknown as TestableToolbar)._selectTool('hand');
    expect(section.getSnapshot().session.activeTool).toBe('hand');
    expect(el.messages.hand).toBe('Mão');
    expect(defaultI18nEnUS.toolbar.hand).toBe('Hand');
  });

  it('desenha desfazer e refazer com ícones SVG', () => {
    const el = new CanvasToolbarElement();
    el.section = createCanvasSection();

    const buttons = templateText(el.render())
      .split('<button')
      .filter((chunk) => /data-action="(undo|redo)"/.test(chunk));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('os handlers do template ativam a ferramenta, desfazem, refazem e ajustam o zoom', () => {
    const el = new CanvasToolbarElement();
    const section = createCanvasSection();
    el.section = section;

    const handlers = templateHandlers(el.render());
    // Selecionar, mão, os grupos "Figuras", "Nota" e "Desenho" (pressionar, clique, teclado e hover:
    // entrar e sair; a Nota e o Desenho ainda trazem o seletor de cor personalizado), texto, o botão
    // Propriedades, desfazer, refazer e os três controles de zoom.
    expect(handlers).toHaveLength(27);
    // O Lit liga `this` ao elemento ao registrar os métodos soltos no template.
    for (const handler of handlers) handler.call(el, { key: '', preventDefault: () => {} });

    const { session } = section.getSnapshot();
    expect(session.activeTool).toBe('board');
    expect(session.viewport.zoom).toBeCloseTo(1.2, 5);
  });

  it('sem canvas, os handlers não fazem nada', () => {
    const el = new CanvasToolbarElement();
    const handlers = templateHandlers(el.render());
    expect(handlers).toHaveLength(27);
    expect(() => {
      for (const handler of handlers) handler.call(el, { key: '', preventDefault: () => {} });
    }).not.toThrow();
  });

  it('performUpdate() retorna prematuramente em ambiente sem DOM completo', () => {
    const el = new CanvasToolbarElement();
    const testable = el as unknown as TestableToolbar;
    expect(() => testable.performUpdate()).not.toThrow();
  });

  describe('botão Board (spec boards, §5.1)', () => {
    const boardButton = (el: CanvasToolbarElement): string => {
      const chunk = templateText(el.render())
        .split('<button')
        .find((candidate) => candidate.includes('data-tool=board'));
      if (chunk === undefined) throw new Error('botão Board não encontrado');
      return chunk;
    };

    it('fica na área de formas, logo depois do grupo Desenho', () => {
      const el = new CanvasToolbarElement();
      el.section = createCanvasSection();

      const text = templateText(el.render());
      const shapesArea = text.slice(text.indexOf('shapes-area'), text.indexOf('properties-area'));

      expect(shapesArea.indexOf('data-tool=board')).toBeGreaterThan(
        shapesArea.indexOf('draw-button'),
      );
      expect(shapesArea.split('<button').at(-1)).toContain('data-tool=board');
    });

    it('tem ícone decorativo, nome acessível e aria-pressed refletindo a ferramenta ativa', () => {
      const el = new CanvasToolbarElement();
      const section = createCanvasSection();
      el.section = section;

      expect(boardButton(el)).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(boardButton(el)).toContain('aria-label=Board');
      expect(boardButton(el)).toContain('aria-pressed=false');

      section.setTool('board');

      expect(boardButton(el)).toContain('aria-pressed=true');
    });

    it('o nome vem do i18n da toolbar', () => {
      const el = new CanvasToolbarElement();
      el.section = createCanvasSection();
      el.messages = { board: 'Quadro' };

      expect(boardButton(el)).toContain('aria-label=Quadro');
      expect(defaultI18nEnUS.toolbar.board).toBe('Board');
    });

    it('sem canvas, o botão fica desabilitado', () => {
      const el = new CanvasToolbarElement();

      expect(boardButton(el)).toContain('disabled');
    });

    it('o clique ativa a ferramenta board', () => {
      const el = new CanvasToolbarElement();
      const section = createCanvasSection();
      el.section = section;
      (el as unknown as TestableToolbar)._selectTool('board');

      expect(section.getSnapshot().session.activeTool).toBe('board');
    });
  });
});
