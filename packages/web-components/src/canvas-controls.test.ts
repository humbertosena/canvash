import { createCanvasSection } from '@canvash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CanvasControlsElement,
  ZOOM_ITEMS,
  type ZoomItemId,
  type ZoomTarget,
} from './canvas-controls.js';
import { defineCanvasElements } from './define.js';
import { defaultI18nEnUS, defaultI18nPtBR, mergeI18n } from './i18n.js';
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

interface Testable {
  _openHelp(): void;
  _closeHelp(): void;
  _onHelpClose(): void;
  _activate(id: ZoomItemId): void;
  _onZoomKeydown(event: Partial<KeyboardEvent>): void;
  _undo(): void;
  _redo(): void;
}

function stubCanvas() {
  return {
    zoomBy: vi.fn<(factor: number) => void>(),
    zoomTo: vi.fn<(zoom: number) => void>(),
    fitToContent: vi.fn<() => void>(),
    fitToSelection: vi.fn<() => void>(),
  } satisfies ZoomTarget;
}

const rectangle = {
  type: 'shape.create' as const,
  shape: {
    id: 'r1',
    type: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
  },
};

function setup(options: { withCanvas?: boolean } = {}) {
  const el = new CanvasControlsElement();
  const section = createCanvasSection();
  const canvas = stubCanvas();
  el.section = section;
  if (options.withCanvas ?? true) el.canvas = canvas;
  return { el, section, canvas, internals: el as unknown as Testable };
}

/** Trecho do HTML do botão que contém o marcador dado. */
function buttonWith(html: string, marker: string): string {
  const chunk = html.split('<button').find((part) => part.includes(marker));
  if (!chunk) throw new Error(`botão com ${marker} não encontrado`);
  return chunk;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<canvas-controls>: histórico', () => {
  it('desenha desfazer e refazer desabilitados num canvas sem histórico', () => {
    const { el } = setup();
    const html = templateText(el.render());

    expect(buttonWith(html, 'data-action="undo"')).toContain('?disabled=true');
    expect(buttonWith(html, 'data-action="redo"')).toContain('?disabled=true');
    expect(buttonWith(html, 'data-action="undo"')).toContain('aria-label=Desfazer');
    expect(buttonWith(html, 'data-action="redo"')).toContain('aria-label=Refazer');
  });

  it('habilita desfazer depois de um comando e refazer depois de desfazer; clicar chama o canvas', () => {
    const { el, section, internals } = setup();
    section.dispatch(rectangle);
    expect(buttonWith(templateText(el.render()), 'data-action="undo"')).toContain(
      '?disabled=false',
    );
    expect(buttonWith(templateText(el.render()), 'data-action="redo"')).toContain('?disabled=true');

    internals._undo();
    expect(section.getSnapshot().document.nodes['r1']).toBeUndefined();
    expect(buttonWith(templateText(el.render()), 'data-action="redo"')).toContain(
      '?disabled=false',
    );

    internals._redo();
    expect(section.getSnapshot().document.nodes['r1']).toBeDefined();
  });

  it('desabilita desfazer e refazer em modo somente leitura', () => {
    const { el, section } = setup();
    section.dispatch(rectangle);
    section.setReadOnly(true);

    const html = templateText(el.render());

    expect(buttonWith(html, 'data-action="undo"')).toContain('?disabled=true');
  });
});

describe('<canvas-controls>: botão e menu de zoom', () => {
  it('mostra o percentual arredondado e o nome acessível "Zoom: n%"', () => {
    const { el, section } = setup();
    section.setViewport({ x: 0, y: 0, zoom: 0.75 });

    const button = buttonWith(templateText(el.render()), 'data-action="open-zoom"');

    expect(button).toContain('aria-label=Zoom: 75%');
    expect(button).toContain('75%');
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain('aria-expanded=false');
  });

  it('desabilita o botão de zoom sem canvas', () => {
    const el = new CanvasControlsElement();

    expect(buttonWith(templateText(el.render()), 'data-action="open-zoom"')).toContain(
      '?disabled=true',
    );
  });

  it('o menu fechado não aparece; aberto traz os cinco itens, na ordem, com o atalho de cada um', () => {
    const { el } = setup();
    expect(templateText(el.render())).not.toContain('part="zoom-menu"');

    el.zoomMenuOpen = true;
    const html = templateText(el.render());

    expect(html).toContain('part="zoom-menu"');
    expect(html).toContain('role="menu"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(5);
    const order = [...html.matchAll(/data-zoom=(\w+)/g)].map((match) => match[1]);
    expect(order).toEqual(['in', 'out', 'reset', 'fit', 'selection']);
    for (const label of [
      'Aproximar',
      'Afastar',
      'Zoom em 100%',
      'Ajustar ao conteúdo',
      'Ajustar à seleção',
    ]) {
      expect(html).toContain(label);
    }
    el.disconnectedCallback();
  });

  it('mostra os atalhos com ⌘ e ⇧ no macOS e com Ctrl e Shift nos demais sistemas', () => {
    const { el } = setup();
    el.zoomMenuOpen = true;

    vi.stubGlobal('navigator', { platform: 'Win32' });
    const other = templateText(el.render());
    for (const shortcut of ['Ctrl+=', 'Ctrl+-', 'Shift+0', 'Shift+1', 'Shift+2']) {
      expect(other).toContain(shortcut);
    }

    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    const mac = templateText(el.render());
    for (const shortcut of ['⌘=', '⌘-', '⇧0', '⇧1', '⇧2']) {
      expect(mac).toContain(shortcut);
    }
    el.disconnectedCallback();
  });

  it('o menu usa roving tabindex: só o item focado entra na ordem de tabulação', () => {
    const { el } = setup();
    el.zoomMenuOpen = true;

    const html = templateText(el.render());
    const items = html.split('<button').filter((chunk) => chunk.includes('role="menuitem"'));

    expect(items.filter((chunk) => chunk.includes('tabindex=0'))).toHaveLength(1);
    expect(items[0]).toContain('tabindex=0');
    el.disconnectedCallback();
  });

  it('seta para cima ou para baixo no botão abre o menu', () => {
    const { el, internals } = setup();
    const preventDefault = vi.fn();

    internals._onZoomKeydown({ key: 'ArrowUp', preventDefault });
    expect(el.zoomMenuOpen).toBe(true);
    expect(preventDefault).toHaveBeenCalled();

    el.zoomMenuOpen = false;
    internals._onZoomKeydown({ key: 'ArrowDown', preventDefault });
    expect(el.zoomMenuOpen).toBe(true);

    el.zoomMenuOpen = false;
    internals._onZoomKeydown({ key: 'a', preventDefault });
    expect(el.zoomMenuOpen).toBe(false);
    el.disconnectedCallback();
  });
});

describe('<canvas-controls>: ações do menu', () => {
  it('Aproximar e Afastar pedem ao canvas o fator de 1,2 e fecham o menu', () => {
    const { el, canvas, internals } = setup();
    el.zoomMenuOpen = true;

    internals._activate('in');
    expect(canvas.zoomBy).toHaveBeenLastCalledWith(1.2);
    expect(el.zoomMenuOpen).toBe(false);

    internals._activate('out');
    expect(canvas.zoomBy).toHaveBeenLastCalledWith(1 / 1.2);
  });

  it('Zoom em 100% pede zoomTo(1) e os ajustes pedem o enquadramento ao canvas', () => {
    const { section, canvas, internals } = setup();
    section.dispatch(rectangle);
    section.setSelection(['r1']);

    internals._activate('reset');
    expect(canvas.zoomTo).toHaveBeenCalledWith(1);

    internals._activate('fit');
    expect(canvas.fitToContent).toHaveBeenCalledTimes(1);

    internals._activate('selection');
    expect(canvas.fitToSelection).toHaveBeenCalledTimes(1);
  });

  it('"ajustar ao conteúdo" fica desabilitado com o documento vazio e não age', () => {
    const { el, canvas, internals } = setup();
    el.zoomMenuOpen = true;

    const html = templateText(el.render());
    expect(buttonWith(html, 'data-zoom=fit')).toContain('aria-disabled=true');

    internals._activate('fit');
    expect(canvas.fitToContent).not.toHaveBeenCalled();
    expect(el.zoomMenuOpen).toBe(true);
    el.disconnectedCallback();
  });

  it('"ajustar à seleção" fica desabilitado sem seleção e habilita com ela', () => {
    const { el, section } = setup();
    section.dispatch(rectangle);
    el.zoomMenuOpen = true;
    expect(buttonWith(templateText(el.render()), 'data-zoom=selection')).toContain(
      'aria-disabled=true',
    );

    section.setSelection(['r1']);

    const html = templateText(el.render());
    expect(buttonWith(html, 'data-zoom=selection')).toContain('aria-disabled=false');
    expect(buttonWith(html, 'data-zoom=fit')).toContain('aria-disabled=false');
    el.disconnectedCallback();
  });

  it('sem canvas, os dois ajustes ficam desabilitados e o zoom ancora na origem da tela', () => {
    const { el, section, internals } = setup({ withCanvas: false });
    section.dispatch(rectangle);
    section.setSelection(['r1']);
    section.setViewport({ x: 0, y: 0, zoom: 1 });
    el.zoomMenuOpen = true;

    const html = templateText(el.render());
    expect(buttonWith(html, 'data-zoom=fit')).toContain('aria-disabled=true');
    expect(buttonWith(html, 'data-zoom=selection')).toContain('aria-disabled=true');

    internals._activate('in');
    expect(section.getSnapshot().session.viewport).toEqual({ x: 0, y: 0, zoom: 1.2 });

    internals._activate('reset');
    expect(section.getSnapshot().session.viewport.zoom).toBe(1);
    el.disconnectedCallback();
  });

  it('sem canvas e no limite de zoom, não republica o viewport', () => {
    const { section, internals } = setup({ withCanvas: false });
    section.setViewport({ x: 0, y: 0, zoom: 16 });
    const spy = vi.spyOn(section, 'setViewport');

    internals._activate('in');

    expect(spy).not.toHaveBeenCalled();
  });

  it('sem canvas, nenhum item age', () => {
    const el = new CanvasControlsElement();
    const canvas = stubCanvas();
    el.canvas = canvas;

    (el as unknown as Testable)._activate('in');
    (el as unknown as Testable)._activate('fit');

    expect(canvas.zoomBy).not.toHaveBeenCalled();
    expect(canvas.fitToContent).not.toHaveBeenCalled();
  });

  it('o zoom não altera a revisão do documento nem o histórico', () => {
    const { section, internals } = setup({ withCanvas: false });
    section.dispatch(rectangle);
    const { revision } = section.getSnapshot();
    const undoDepth = section.getSnapshot().history;

    internals._activate('in');

    expect(section.getSnapshot().revision).toBe(revision);
    expect(section.getSnapshot().history).toEqual(undoDepth);
  });
});

describe('<canvas-controls>: ciclo de vida, i18n e registro', () => {
  it('troca de canvas desassina o anterior e libera a assinatura ao desconectar', () => {
    const el = new CanvasControlsElement();
    const first = createCanvasSection();
    const second = createCanvasSection();
    const unsubscribeFirst = vi.fn();
    vi.spyOn(first, 'subscribe').mockReturnValue(unsubscribeFirst);
    const unsubscribeSecond = vi.fn();
    vi.spyOn(second, 'subscribe').mockReturnValue(unsubscribeSecond);

    el.section = first;
    el.section = second;
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);

    el.disconnectedCallback();
    expect(unsubscribeSecond).toHaveBeenCalledTimes(1);
  });

  it('atualiza quando o canvas muda e para de atualizar depois de desconectado', () => {
    const { el, section } = setup();
    const update = vi.spyOn(el, 'requestUpdate');

    section.setViewport({ x: 0, y: 0, zoom: 2 });
    expect(update).toHaveBeenCalled();

    el.disconnectedCallback();
    update.mockClear();
    section.setViewport({ x: 0, y: 0, zoom: 3 });
    expect(update).not.toHaveBeenCalled();
  });

  it('o listener de clique fora só existe com o menu aberto', () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: remove });
    const { el } = setup();

    expect(add).not.toHaveBeenCalled();
    el.zoomMenuOpen = true;
    expect(add).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);

    el.zoomMenuOpen = false;
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
  });

  it('mensagens localizadas em pt-BR e en-US e personalizáveis por instância', () => {
    const { el } = setup();
    expect(el.messages.zoomIn).toBe('Aproximar');
    expect(defaultI18nPtBR.controls.zoomToFit).toBe('Ajustar ao conteúdo');
    expect(defaultI18nEnUS.controls.zoomToFit).toBe('Zoom to fit');
    expect(defaultI18nEnUS.controls.zoomButton(75)).toBe('Zoom: 75%');

    el.messages = { zoomIn: 'Mais zoom' };
    expect(el.messages.zoomIn).toBe('Mais zoom');
    expect(templateText(el.render())).toContain('aria-label=Desfazer');

    const merged = mergeI18n(defaultI18nPtBR, { controls: { redo: 'Refazer já' } });
    expect(merged.controls.redo).toBe('Refazer já');
    expect(merged.controls.undo).toBe('Desfazer');
  });

  it('expõe as partes documentadas e uma entrada de menu por item de zoom', () => {
    expect(CANVASH_PARTS.canvasControls).toContain('zoom-menu');
    expect(CANVASH_PARTS.canvasControls).toContain('history-group');
    expect(ZOOM_ITEMS.map((item) => item.id)).toEqual(['in', 'out', 'reset', 'fit', 'selection']);
  });

  it('defineCanvasElements registra canvas-controls, também com prefixo', () => {
    const registry = new Map<string, CustomElementConstructor>();
    const fake = {
      get: (name: string) => registry.get(name),
      define: (name: string, ctor: CustomElementConstructor) => registry.set(name, ctor),
    } as unknown as CustomElementRegistry;

    defineCanvasElements({ registry: fake });
    defineCanvasElements({ registry: fake, prefix: 'canvash' });

    expect(registry.get('canvas-controls')).toBe(CanvasControlsElement);
    expect(registry.get('canvash-canvas-controls')).toBe(CanvasControlsElement);
  });
});

describe('<canvas-controls>: ajuda e atalhos', () => {
  /** Diálogo e botão falsos, devolvidos pelo renderRoot do elemento. */
  function withFakeRoot(el: CanvasControlsElement) {
    const dialog = { open: false, showModal: vi.fn(), close: vi.fn() };
    const helpButton = { focus: vi.fn() };
    Object.defineProperty(el, 'renderRoot', {
      value: {
        querySelector: (selector: string) =>
          selector === 'dialog' ? dialog : selector.includes('open-help') ? helpButton : null,
      },
      configurable: true,
    });
    return { dialog, helpButton };
  }

  it('desenha o botão "?" que abre um diálogo, com nome acessível localizado', () => {
    const { el } = setup();

    const button = buttonWith(templateText(el.render()), 'data-action="open-help"');

    expect(button).toContain('part="help-button"');
    expect(button).toContain('aria-label=Ajuda e atalhos');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('?');
  });

  it('desenha o diálogo com título, slot "help" e botão Fechar', () => {
    const { el } = setup();

    const html = templateText(el.render());

    expect(html).toContain('<dialog');
    expect(html).toContain('part="help-dialog"');
    expect(html).toContain('aria-labelledby="help-title"');
    expect(html).toContain('Atalhos de teclado');
    expect(html).toContain('<slot name="help">');
    expect(buttonWith(html, 'data-action="close-help"')).toContain('Fechar');
  });

  it('a lista padrão traz edição, organização e visão, com os atalhos de zoom', () => {
    const { el } = setup();
    vi.stubGlobal('navigator', { platform: 'Win32' });

    const html = templateText(el.render());

    for (const text of ['Edição', 'Organização', 'Visão', 'Excluir', 'Desfazer', 'Agrupar']) {
      expect(html).toContain(text);
    }
    for (const shortcut of ['Ctrl+=', 'Ctrl+-', 'Shift+0', 'Shift+1', 'Shift+2']) {
      expect(html).toContain(shortcut);
    }
    expect(html).toContain('Ajustar ao conteúdo');
  });

  it('a seção de edição lista "Editar o texto da forma" com a tecla Enter, em pt-BR e en', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    const pt = setup().el;
    const en = setup().el;
    en.messages = defaultI18nEnUS.controls;

    const ptHtml = templateText(pt.render());
    const enHtml = templateText(en.render());

    expect(ptHtml).toContain('Editar o texto da forma');
    expect(ptHtml).toContain('Enter');
    expect(enHtml).toContain('Edit shape text');
    // Fica na seção de edição: antes de "Organização".
    expect(ptHtml.indexOf('Editar o texto da forma')).toBeLessThan(ptHtml.indexOf('Organização'));
  });

  it('em macOS a lista usa os símbolos ⌘ e ⇧', () => {
    const { el } = setup();
    vi.stubGlobal('navigator', { platform: 'MacIntel' });

    const html = templateText(el.render());

    expect(html).toContain('⌘Z');
    expect(html).toContain('⌘⇧Z');
    expect(html).toContain('⇧1');
  });

  it('abrir mostra o diálogo modal; já aberto, não abre de novo', () => {
    const { el, internals } = setup();
    const { dialog } = withFakeRoot(el);

    internals._openHelp();
    expect(dialog.showModal).toHaveBeenCalledTimes(1);

    dialog.open = true;
    internals._openHelp();
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
  });

  it('fechar fecha o diálogo aberto e, ao fechar, o foco volta ao botão "?"', () => {
    const { el, internals } = setup();
    const { dialog, helpButton } = withFakeRoot(el);

    internals._closeHelp();
    expect(dialog.close).not.toHaveBeenCalled();

    dialog.open = true;
    internals._closeHelp();
    expect(dialog.close).toHaveBeenCalledTimes(1);

    internals._onHelpClose();
    expect(helpButton.focus).toHaveBeenCalledTimes(1);
  });

  it('sem diálogo no DOM, abrir e fechar não fazem nada', () => {
    const { internals } = setup();

    expect(() => internals._openHelp()).not.toThrow();
    expect(() => internals._closeHelp()).not.toThrow();
  });

  it('textos de ajuda em en-US e a parte documentada', () => {
    expect(defaultI18nEnUS.controls.help).toBe('Help and shortcuts');
    expect(defaultI18nEnUS.controls.helpTitle).toBe('Keyboard shortcuts');
    expect(defaultI18nEnUS.controls.close).toBe('Close');
    expect(CANVASH_PARTS.canvasControls).toContain('help-dialog');
    expect(CANVASH_PARTS.canvasControls).toContain('help-button');
  });
});
