import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CanvasSelectionMenuElement,
  defaultMenuSize,
  type SelectionMenuCanvas,
} from './canvas-selection-menu.js';
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
  if (result && typeof result === 'object' && '_$litDirective$' in result) {
    // repeat(itens, chave, desenho): desdobra como o Lit desenharia, na ordem dos itens.
    const { values } = result as unknown as { values: unknown[] };
    const render = values[2];
    if (Array.isArray(values[0]) && typeof render === 'function') {
      return values[0]
        .map((item: unknown, index: number) => templateText(render(item, index)))
        .join('');
    }
    return '';
  }
  if (typeof result === 'function' || result === undefined || result === null) return '';
  return String(result);
}

interface Testable {
  _computePlacement(): { x: number; y: number; side: string } | null;
  _measure(): unknown;
  _update(): void;
  _schedule(): void;
  _act(action: 'bring-to-front' | 'send-to-back' | 'group' | 'ungroup' | 'delete'): void;
  _groupActions: { group: string; ungroup: string };
  _placement: { x: number; y: number; side: string } | null;
  _onToolbarKeydown(event: Partial<KeyboardEvent>): void;
  _activeElement(): unknown;
  _toolbarIndex: number;
  updated(changed: Map<string, unknown>): void;
}

const rectangle = (id: string, x: number, y: number) => ({
  type: 'shape.create' as const,
  shape: {
    id,
    type: 'rectangle' as const,
    x,
    y,
    width: 50,
    height: 50,
    rotation: 0,
    style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
  },
});

function fakeCanvas(state: SelectionMenuCanvas['interactionState'] = 'idle') {
  const listeners = new Map<string, Set<EventListener>>();
  const canvas = {
    interactionState: state,
    focus: vi.fn(),
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 700 }),
    addEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
    emit: (type: string, event: Event = new Event(type)) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  };
  return canvas;
}

/** Medidas fixas no lugar do DOM: origem do shell em (100, 50), mesma do canvas. */
function stubMeasure(el: CanvasSelectionMenuElement, menu?: { width: number; height: number }) {
  (el as unknown as Testable)._measure = () => ({
    origin: { left: 100, top: 50 },
    canvas: { left: 100, top: 50, width: 1000, height: 700 },
    menu,
  });
}

function setup() {
  const el = new CanvasSelectionMenuElement();
  const section = createCanvasSection();
  const canvas = fakeCanvas();
  section.dispatch(rectangle('a', 100, 100));
  section.dispatch(rectangle('b', 400, 400));
  el.section = section;
  el.canvas = canvas;
  stubMeasure(el);
  return { el, section, canvas, internals: el as unknown as Testable };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback();
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<canvas-selection-menu>: quando aparece', () => {
  it('fica escondido sem seleção', () => {
    const { internals } = setup();

    expect(internals._computePlacement()).toBeNull();
  });

  it('aparece com uma seleção, a ferramenta de seleção, interação em repouso e fora do modo leitura', () => {
    const { section, internals } = setup();
    section.setSelection(['a']);

    expect(internals._computePlacement()).not.toBeNull();
  });

  it('esconde com outra ferramenta, em modo leitura e durante um gesto ou a edição de texto', () => {
    const { section, canvas, internals } = setup();
    section.setSelection(['a']);

    section.setTool('rectangle');
    expect(internals._computePlacement()).toBeNull();
    section.setTool('select');
    expect(internals._computePlacement()).not.toBeNull();

    section.setReadOnly(true);
    expect(internals._computePlacement()).toBeNull();
    section.setReadOnly(false);

    for (const state of [
      'panning',
      'selecting',
      'marquee',
      'moving',
      'creating',
      'dragging',
      'resizing',
      'rotating',
      'drawing',
      'erasing',
      'editing-text',
    ] as const) {
      canvas.interactionState = state;
      expect(internals._computePlacement()).toBeNull();
    }
    canvas.interactionState = 'idle';
    expect(internals._computePlacement()).not.toBeNull();
  });

  it('esconde quando a seleção está inteira fora da tela e volta com o pan', () => {
    const { section, internals } = setup();
    section.setSelection(['a']);

    section.setViewport({ x: -5000, y: 0, zoom: 1 });
    expect(internals._computePlacement()).toBeNull();

    section.setViewport({ x: 0, y: 0, zoom: 1 });
    expect(internals._computePlacement()).not.toBeNull();
  });

  it('sem canvas ou sem canvas, fica escondido', () => {
    const el = new CanvasSelectionMenuElement();
    expect((el as unknown as Testable)._computePlacement()).toBeNull();

    const { section } = setup();
    el.section = section;
    expect((el as unknown as Testable)._computePlacement()).toBeNull();
  });
});

describe('<canvas-selection-menu>: onde aparece', () => {
  it('centraliza sobre a seleção, acima dela, descontando a origem do shell e o zoom', () => {
    const { section, internals } = setup();
    section.setSelection(['a']);
    section.setViewport({ x: 10, y: 20, zoom: 2 });

    const placement = internals._computePlacement();

    // seleção na tela: (210, 220) 100 × 100; menu padrão 110 × 42; alça de rotação a 28 px
    expect(placement).toEqual({ x: 260 - 55, y: 220 - 12 - 28 - 42, side: 'above' });
  });

  it('usa o tamanho medido do menu quando existe', () => {
    const { el, section, internals } = setup();
    section.setSelection(['b']);
    stubMeasure(el, { width: 100, height: 30 });

    const placement = internals._computePlacement();

    expect(placement?.x).toBe(425 - 50);
    expect(placement?.y).toBe(400 - 12 - 28 - 30);
  });

  it('muda de posição quando a seleção muda, depois de agendar a atualização', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a']);
    internals._update();
    const first = templateText(el.render());

    section.setSelection(['b']);
    internals._update();

    expect(templateText(el.render())).not.toBe(first);
  });
});

describe('<canvas-selection-menu>: a toolbar à direita', () => {
  it('não fica sob a toolbar: a área de posicionamento termina antes da largura medida dela', () => {
    const { el, section, internals } = setup();
    // Seleção na tela em (100, 100), 50 × 50; o menu padrão (110 px) ficaria em x = 70.
    section.setSelection(['a']);
    expect(internals._computePlacement()?.x).toBe(70);

    (el as unknown as { _measure: () => unknown })._measure = () => ({
      origin: { left: 100, top: 50 },
      canvas: { left: 100, top: 50, width: 250, height: 700 },
      rightInset: 82,
    });
    // Reserva a margem e a largura da toolbar (82 px) mais a margem do próprio menu (16 px):
    // 250 - 82 - 16 - 110 = 42, e o menu, que ficaria em x = 70, recua para lá.
    expect(internals._computePlacement()?.x).toBe(42);
  });

  it('mede a largura publicada pelo shell em --canvash-shell-toolbar-inline-size', () => {
    const { el } = setup();
    const measure = (value: string) => {
      vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => value }));
      return (el as unknown as { _toolbarInset(): number })._toolbarInset();
    };

    expect(measure(' 66px')).toBe(16 + 66);
    expect(measure('')).toBe(0);
    expect(measure('abc')).toBe(0);
    vi.stubGlobal('getComputedStyle', undefined);
    expect((el as unknown as { _toolbarInset(): number })._toolbarInset()).toBe(0);
  });
});

describe('<canvas-selection-menu>: o que desenha', () => {
  it('escondido, só desenha a âncora de medida', () => {
    const { el } = setup();

    const html = templateText(el.render());

    expect(html).not.toContain('part="selection-menu"');
    expect(html).toContain('class="origin"');
  });

  it('visível, desenha uma barra de ações com os três botões e nomes localizados', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a']);
    internals._update();

    const html = templateText(el.render());

    expect(html).toContain('part="selection-menu"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label=Ações da seleção');
    for (const [action, label] of [
      ['bring-to-front', 'Trazer para frente'],
      ['send-to-back', 'Enviar para trás'],
      ['delete', 'Excluir'],
    ]) {
      expect(html).toContain(`data-action="${action}"`);
      expect(html).toContain(`aria-label=${label}`);
    }
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('aria-expanded');
  });
});

describe('<canvas-selection-menu>: ações', () => {
  it('Trazer para frente leva a seleção ao topo da ordem, numa entrada de histórico', () => {
    const { section, internals } = setup();
    section.setSelection(['a']);
    const order = () => section.getSnapshot().document.layers[0]!.childIds;
    expect(order()).toEqual(['a', 'b']);

    internals._act('bring-to-front');

    expect(order()).toEqual(['b', 'a']);
    section.undo();
    expect(order()).toEqual(['a', 'b']);
  });

  it('Enviar para trás leva a seleção ao fundo da ordem, numa entrada de histórico', () => {
    const { section, internals } = setup();
    section.setSelection(['b']);

    internals._act('send-to-back');

    expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['b', 'a']);
    section.undo();
    expect(section.getSnapshot().document.layers[0]!.childIds).toEqual(['a', 'b']);
  });

  it('Excluir remove a seleção numa entrada de histórico e leva o foco ao canvas', () => {
    const { section, canvas, internals } = setup();
    section.setSelection(['a']);

    internals._act('delete');

    expect(section.getSnapshot().document.nodes['a']).toBeUndefined();
    expect(section.getSnapshot().session.selectedIds).toEqual([]);
    expect(canvas.focus).toHaveBeenCalledTimes(1);
    section.undo();
    expect(section.getSnapshot().document.nodes['a']).toBeDefined();
  });

  it('as ações não fazem nada em modo leitura nem sem canvas', () => {
    const { section, canvas, internals } = setup();
    section.setSelection(['a']);
    section.setReadOnly(true);

    internals._act('delete');
    internals._act('bring-to-front');

    expect(section.getSnapshot().document.nodes['a']).toBeDefined();
    expect(canvas.focus).not.toHaveBeenCalled();
    expect(() =>
      (new CanvasSelectionMenuElement() as unknown as Testable)._act('delete'),
    ).not.toThrow();
  });

  it('Propriedades saiu do mini-menu: sem botão, painel, estado nem evento próprios', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a']);
    internals._update();
    const events: Event[] = [];
    el.addEventListener('properties-panel-toggle', (event) => events.push(event));

    const html = templateText(el.render());
    expect(html).not.toContain('data-action="properties"');
    expect(html).not.toContain('part="properties-panel"');
    expect(html).not.toContain('<slot name="properties">');
    expect('panelOpen' in el).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe('<canvas-selection-menu>: atualização e ciclo de vida', () => {
  it('agrupa várias mudanças num único quadro e não agenda nada em repouso', () => {
    const { el, section } = setup();
    (el as unknown as { renderRoot: unknown }).renderRoot = fakeRoot({});
    const callbacks: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    el.connectedCallback();
    callbacks.splice(0).forEach((callback) => callback());

    section.setSelection(['a']);
    section.setViewport({ x: 5, y: 5, zoom: 1 });
    section.setSelection(['b']);

    expect(callbacks).toHaveLength(1);
    callbacks[0]!();
    expect(callbacks).toHaveLength(1);
    el.disconnectedCallback();
  });

  it('reage ao evento de estado da interação do canvas', () => {
    const { el, section, canvas } = setup();
    (el as unknown as { renderRoot: unknown }).renderRoot = fakeRoot({});
    section.setSelection(['a']);
    canvas.interactionState = 'moving';
    el.connectedCallback();
    expect(templateText(el.render())).not.toContain('part="selection-menu"');

    canvas.interactionState = 'idle';
    canvas.emit('interaction-state-change');

    expect(templateText(el.render())).toContain('part="selection-menu"');
    el.disconnectedCallback();
  });

  it('troca de canvas e de canvas desassina os antigos e libera tudo ao desconectar', () => {
    const el = new CanvasSelectionMenuElement();
    const first = createCanvasSection();
    const second = createCanvasSection();
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();
    vi.spyOn(first, 'subscribe').mockReturnValue(unsubscribeFirst);
    vi.spyOn(second, 'subscribe').mockReturnValue(unsubscribeSecond);
    const canvasA = fakeCanvas();
    const canvasB = fakeCanvas();

    el.section = first;
    el.canvas = canvasA;
    expect(canvasA.listenerCount('interaction-state-change')).toBe(1);

    el.section = second;
    el.canvas = canvasB;
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(canvasA.listenerCount('interaction-state-change')).toBe(0);
    expect(canvasB.listenerCount('interaction-state-change')).toBe(1);

    el.disconnectedCallback();
    expect(unsubscribeSecond).toHaveBeenCalledTimes(1);
    expect(canvasB.listenerCount('interaction-state-change')).toBe(0);
  });

  it('cancela o quadro pendente ao desconectar', () => {
    const { el, section } = setup();
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 42);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    el.connectedCallback();
    section.setSelection(['a']);

    el.disconnectedCallback();

    expect(cancel).toHaveBeenCalledWith(42);
  });
});

/** Botão de mentira: só o que o menu usa dele. */
function fakeButtons() {
  return Array.from({ length: 3 }, () => ({ focus: vi.fn() }));
}

/** `renderRoot` de mentira: o que `querySelector` e `querySelectorAll` devolvem por seletor. */
function fakeRoot(parts: { menu?: unknown; buttons?: unknown[] }) {
  return {
    querySelector: (selector: string) => {
      if (selector === '.menu') return parts.menu ?? null;
      if (selector === '[data-action="bring-to-front"]') return parts.buttons?.[0] ?? null;
      return null;
    },
    querySelectorAll: (selector: string) =>
      selector === '.menu button' ? (parts.buttons ?? []) : [],
  };
}

describe('<canvas-selection-menu>: teclado do mini-menu', () => {
  it('só o botão atual entra na ordem de tabulação (tabindex móvel)', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a']);
    internals._update();

    const tabindexes = (html: string) => [...html.matchAll(/tabindex=(-?\d)/g)].map((m) => m[1]);
    expect(tabindexes(templateText(el.render()))).toEqual(['0', '-1', '-1']);

    internals._toolbarIndex = 2;
    expect(tabindexes(templateText(el.render()))).toEqual(['-1', '-1', '0']);
  });

  it('as setas andam entre os botões, dão a volta, e Home e End vão às pontas', () => {
    const { el, internals } = setup();
    const buttons = fakeButtons();
    (el as unknown as { renderRoot: unknown }).renderRoot = fakeRoot({ buttons });
    const press = (key: string, from: number) => {
      const preventDefault = vi.fn();
      internals._onToolbarKeydown({
        key,
        target: buttons[from] as unknown as EventTarget,
        preventDefault,
      });
      return preventDefault;
    };

    press('ArrowRight', 0);
    expect(buttons[1]!.focus).toHaveBeenCalledTimes(1);
    expect(internals._toolbarIndex).toBe(1);

    press('ArrowRight', 2);
    expect(buttons[0]!.focus).toHaveBeenCalledTimes(1);

    press('ArrowLeft', 0);
    expect(buttons[2]!.focus).toHaveBeenCalledTimes(1);

    press('Home', 2);
    expect(buttons[0]!.focus).toHaveBeenCalledTimes(2);

    press('End', 1);
    expect(buttons[2]!.focus).toHaveBeenCalledTimes(2);
    expect(internals._toolbarIndex).toBe(2);
  });

  it('outras teclas seguem o caminho normal, sem impedir o padrão', () => {
    const { el, internals } = setup();
    const buttons = fakeButtons();
    (el as unknown as { renderRoot: unknown }).renderRoot = fakeRoot({ buttons });
    const preventDefault = vi.fn();

    internals._onToolbarKeydown({
      key: 'a',
      target: buttons[0] as unknown as EventTarget,
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(buttons.every((button) => button.focus.mock.calls.length === 0)).toBe(true);
  });

  it('ContextMenu e ⇧F10, com o canvas focado, levam o foco ao mini-menu', () => {
    const { el, section, canvas, internals } = setup();
    const buttons = fakeButtons();
    (el as unknown as { renderRoot: unknown }).renderRoot = fakeRoot({ buttons });
    el.connectedCallback();
    section.setSelection(['a']);
    internals._update();
    const key = (init: Partial<KeyboardEvent>) => {
      const preventDefault = vi.fn();
      canvas.emit('keydown', { ...init, preventDefault } as unknown as Event);
      return preventDefault;
    };

    expect(key({ key: 'ContextMenu' })).toHaveBeenCalledTimes(1);
    expect(key({ key: 'F10', shiftKey: true })).toHaveBeenCalledTimes(1);
    expect(buttons[0]!.focus).toHaveBeenCalledTimes(2);

    // Sem Shift, ou com outro modificador, F10 e a tecla de contexto não são atalhos do menu.
    expect(key({ key: 'F10', shiftKey: false })).not.toHaveBeenCalled();
    expect(key({ key: 'F10', shiftKey: true, ctrlKey: true })).not.toHaveBeenCalled();
    expect(key({ key: 'a' })).not.toHaveBeenCalled();
    expect(buttons[0]!.focus).toHaveBeenCalledTimes(2);
    el.disconnectedCallback();
  });

  it('com o menu escondido, as teclas de contexto não são tomadas', () => {
    const { el, canvas } = setup();
    const buttons = fakeButtons();
    (el as unknown as { renderRoot: unknown }).renderRoot = fakeRoot({ buttons });
    el.connectedCallback();
    const preventDefault = vi.fn();

    canvas.emit('keydown', { key: 'ContextMenu', preventDefault } as unknown as Event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(buttons[0]!.focus).not.toHaveBeenCalled();
    el.disconnectedCallback();
  });
});

describe('<canvas-selection-menu>: recursos liberados (WC-04)', () => {
  it('50 ciclos de conectar e desconectar não deixam listener, assinatura, observador nem quadro', () => {
    const created: number[] = [];
    let live = 0;
    class FakeResizeObserver {
      constructor() {
        created.push(1);
        live += 1;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        live -= 1;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let pending = 0;
    vi.stubGlobal('requestAnimationFrame', () => {
      pending += 1;
      return pending;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      pending -= 1;
    });

    const { el, section, canvas } = setup();
    (el as unknown as { renderRoot: unknown }).renderRoot = fakeRoot({});
    let subscriptions = 0;
    const subscribe = section.subscribe.bind(section);
    vi.spyOn(section, 'subscribe').mockImplementation((listener) => {
      subscriptions += 1;
      const unsubscribe = subscribe(listener);
      return () => {
        subscriptions -= 1;
        unsubscribe();
      };
    });
    el.section = section;
    el.section = undefined;
    el.section = section;

    for (let i = 0; i < 50; i += 1) {
      el.connectedCallback();
      (el as unknown as Testable)._update();
      el.disconnectedCallback();
    }

    expect(subscriptions).toBe(0);
    expect(canvas.listenerCount('interaction-state-change')).toBe(0);
    expect(canvas.listenerCount('keydown')).toBe(0);
    expect(live).toBe(0);
    expect(pending).toBeLessThanOrEqual(0);
  });
});

describe('<canvas-selection-menu>: tamanhos observados', () => {
  /** ResizeObserver de mentira: guarda o que foi observado e deixa disparar a chamada. */
  function stubResizeObserver() {
    const observed = new Set<unknown>();
    const state = { callback: () => {}, disconnected: 0 };
    class FakeResizeObserver {
      constructor(callback: () => void) {
        state.callback = callback;
      }
      observe(target: unknown) {
        observed.add(target);
      }
      unobserve(target: unknown) {
        observed.delete(target);
      }
      disconnect() {
        state.disconnected += 1;
        observed.clear();
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    return { observed, state };
  }

  it('observa o canvas e, quando ele existe, o menu; e reposiciona quando um muda de tamanho', () => {
    const { observed, state } = stubResizeObserver();
    const { el, section, canvas, internals } = setup();
    const menu = { tag: 'menu' };
    (el as unknown as { renderRoot: unknown }).renderRoot = {
      querySelector: (selector: string) => (selector === '.menu' ? menu : null),
    };
    section.setSelection(['a']);

    internals._update();
    expect([...observed]).toEqual(expect.arrayContaining([canvas, menu]));

    const spy = vi.spyOn(el as unknown as Testable, '_update');
    state.callback();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('para de observar o que saiu da tela e libera o observador ao desconectar', () => {
    const { observed, state } = stubResizeObserver();
    const { el, section, canvas, internals } = setup();
    let menu: object | null = { tag: 'menu' };
    (el as unknown as { renderRoot: unknown }).renderRoot = {
      querySelector: () => menu,
    };
    section.setSelection(['a']);
    internals._update();
    expect(observed.size).toBe(2);

    menu = null;
    internals._update();
    expect([...observed]).toEqual([canvas]);

    el.disconnectedCallback();
    expect(state.disconnected).toBeGreaterThan(0);
    expect(observed.size).toBe(0);
  });

  it('não redesenha quando a posição não mudou', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a']);
    internals._update();
    const requestUpdate = vi.spyOn(el, 'requestUpdate');

    internals._update();
    internals._update();

    expect(requestUpdate).not.toHaveBeenCalled();
  });
});

describe('<canvas-selection-menu>: textos, partes e registro', () => {
  it('textos em pt-BR e en-US, personalizáveis por instância', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a']);
    internals._update();

    expect(defaultI18nPtBR.selectionMenu.delete).toBe('Excluir');
    expect(defaultI18nEnUS.selectionMenu.delete).toBe('Delete');
    expect(defaultI18nEnUS.selectionMenu.toolbarLabel).toBe('Selection actions');

    el.messages = { delete: 'Apagar' };
    expect(templateText(el.render())).toContain('aria-label=Apagar');
    expect(
      mergeI18n(defaultI18nPtBR, { selectionMenu: { delete: 'X' } }).selectionMenu.delete,
    ).toBe('X');
  });

  it('documenta as partes e registra canvas-selection-menu, também com prefixo', () => {
    expect(CANVASH_PARTS.selectionMenu).toEqual(
      expect.arrayContaining(['selection-menu', 'selection-action']),
    );

    const registry = new Map<string, CustomElementConstructor>();
    const fake = {
      get: (name: string) => registry.get(name),
      define: (name: string, ctor: CustomElementConstructor) => registry.set(name, ctor),
    } as unknown as CustomElementRegistry;
    defineCanvasElements({ registry: fake });
    defineCanvasElements({ registry: fake, prefix: 'app' });

    expect(registry.get('canvas-selection-menu')).toBe(CanvasSelectionMenuElement);
    expect(registry.get('app-canvas-selection-menu')).toBe(CanvasSelectionMenuElement);
  });

  it('não expõe mais o atributo panel-open nem a parte do painel', () => {
    const properties = CanvasSelectionMenuElement.properties as unknown as Record<string, unknown>;
    expect(properties['panelOpen']).toBeUndefined();
    expect(CANVASH_PARTS.selectionMenu).not.toContain('properties-panel');
    expect(CANVASH_PARTS.selectionMenu).not.toContain('selection-action-properties');
  });
});

// Evita que o canvas importado só como tipo seja removido pelo transformador.
export type { CanvasSectionApi };

/** Os `data-action` do template, na ordem em que os botões aparecem. */
function actionsOf(html: string): string[] {
  return [...html.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]!);
}

describe('<canvas-selection-menu>: Agrupar e Desagrupar (US-GA.1 a US-GA.4)', () => {
  const grouped = () => {
    const ctx = setup();
    ctx.section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });
    ctx.section.dispatch(rectangle('c', 700, 100));
    return ctx;
  };

  it('dois nós soltos: Agrupar habilitado entre Enviar para trás e Excluir, e sem Desagrupar', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a', 'b']);
    internals._update();

    const html = templateText(el.render());

    expect(actionsOf(html)).toEqual(['bring-to-front', 'send-to-back', 'group', 'delete']);
    expect(html).toContain('part="selection-action selection-action-group"');
    expect(html).toContain('aria-label=Agrupar');
    expect(html).not.toContain('aria-disabled=true');
    expect(html).not.toContain('data-action="ungroup"');
  });

  it('um só nó: o menu tem os três botões de sempre', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a']);
    internals._update();

    expect(actionsOf(templateText(el.render()))).toEqual([
      'bring-to-front',
      'send-to-back',
      'delete',
    ]);
  });

  it('um grupo: só Desagrupar, habilitado', () => {
    const { el, section, internals } = grouped();
    section.setSelection(['g']);
    internals._update();

    const html = templateText(el.render());

    expect(actionsOf(html)).toEqual(['bring-to-front', 'send-to-back', 'ungroup', 'delete']);
    expect(html).toContain('part="selection-action selection-action-ungroup"');
    expect(html).toContain('aria-label=Desagrupar');
    expect(html).not.toContain('aria-disabled=true');
  });

  it('um grupo e um nó solto: Agrupar visível e desabilitado, Desagrupar habilitado', () => {
    const { el, section, internals } = grouped();
    section.setSelection(['g', 'c']);
    internals._update();

    const html = templateText(el.render());

    expect(actionsOf(html)).toEqual([
      'bring-to-front',
      'send-to-back',
      'group',
      'ungroup',
      'delete',
    ]);
    expect(html.match(/aria-disabled=true/g)).toHaveLength(1);
    expect(html).toMatch(
      /data-action="group"[^>]*aria-disabled=true|aria-disabled=true[^>]*data-action="group"/,
    );
  });

  it('um nó com locked na seleção desabilita Agrupar sem tirar o botão', () => {
    const { el, section, internals } = setup();
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'lk',
        type: 'rectangle',
        x: 600,
        y: 100,
        width: 50,
        height: 50,
        rotation: 0,
        locked: true,
      },
    });
    section.setSelection(['a', 'lk']);
    internals._update();

    const html = templateText(el.render());

    expect(actionsOf(html)).toContain('group');
    expect(html.match(/aria-disabled=true/g)).toHaveLength(1);
  });

  it('clicar em Agrupar cria o grupo numa entrada de histórico, e o menu passa a oferecer Desagrupar sem se mexer', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a', 'b']);
    internals._update();
    const placement = internals._placement;
    expect(placement).not.toBeNull();

    internals._act('group');

    const [created] = section.getSnapshot().session.selectedIds;
    expect(section.getSnapshot().document.nodes[created!]?.type).toBe('group');
    expect(internals._placement).toEqual(placement);
    const html = templateText(el.render());
    expect(html).toContain('data-action="ungroup"');
    expect(html).not.toContain('data-action="group"');
    section.undo();
    expect(section.getSnapshot().document.nodes[created!]).toBeUndefined();
  });

  it('clicar em Desagrupar desfaz o grupo e seleciona os filhos', () => {
    const { section, internals } = grouped();
    section.setSelection(['g']);
    internals._update();

    internals._act('ungroup');

    expect(section.getSnapshot().document.nodes['g']).toBeUndefined();
    expect([...section.getSnapshot().session.selectedIds].sort()).toEqual(['a', 'b']);
  });

  it('o clique num botão desabilitado não muda o documento', () => {
    const { section, internals } = grouped();
    section.setSelection(['g', 'c']);
    internals._update();
    const revision = section.getSnapshot().revision;

    internals._act('group');

    expect(section.getSnapshot().revision).toBe(revision);
  });

  it('uma mudança remota que bloqueia um nó da seleção redesenha o menu sem mover a seleção', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a', 'b']);
    internals._update();
    expect(actionsOf(templateText(el.render()))).toContain('group');

    section.setPeers([
      {
        sessionId: 'outra',
        name: 'Bia',
        color: '#dc2626',
        cursor: null,
        selection: ['a'],
        selectedAt: 1,
        drag: null,
        view: null,
        locks: ['a'],
        followed: false,
      },
    ]);

    // Só `b` é livre: nenhum dos dois botões de grupo cabe mais.
    expect(actionsOf(templateText(el.render()))).toEqual([
      'bring-to-front',
      'send-to-back',
      'delete',
    ]);
  });

  it('em repouso, um _update() sem mudança não troca o estado das ações', () => {
    const { section, internals } = setup();
    section.setSelection(['a', 'b']);
    internals._update();
    const actions = internals._groupActions;

    internals._update();

    expect(internals._groupActions).toBe(actions);
  });

  it('o tamanho padrão do menu cresce com os botões: 110, 144 e 178 px', () => {
    expect(defaultMenuSize(3)).toEqual({ width: 110, height: 42 });
    expect(defaultMenuSize(4)).toEqual({ width: 144, height: 42 });
    expect(defaultMenuSize(5)).toEqual({ width: 178, height: 42 });
  });
});

/** Botão de mentira com nome de ação: o que o foco depois da ação lê e usa. */
function namedButtons(actions: readonly string[]) {
  return actions.map((action) => ({
    getAttribute: (name: string) => (name === 'data-action' ? action : null),
    focus: vi.fn(),
  }));
}

/** `renderRoot` de mentira com botões e o elemento que tem o foco. */
function rootWith(buttons: unknown[], activeElement: unknown = null) {
  return { ...fakeRoot({ buttons }), activeElement };
}

describe('<canvas-selection-menu>: dica e atalho de Agrupar e Desagrupar (US-GA.6)', () => {
  const groupedMenu = (selection: string[]) => {
    const ctx = setup();
    ctx.section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });
    ctx.section.dispatch(rectangle('c', 700, 100));
    ctx.section.setSelection(selection);
    ctx.internals._update();
    return ctx;
  };

  it('no macOS, o title e o aria-keyshortcuts trazem ⌘ primeiro', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    const both = groupedMenu(['g', 'c']);

    const html = templateText(both.el.render());

    expect(html).toContain('title=Agrupar (⌘G)');
    expect(html).toContain('aria-keyshortcuts=Meta+G Control+G');
    expect(html).toContain('title=Desagrupar (⌘⇧G)');
    expect(html).toContain('aria-keyshortcuts=Meta+Shift+G Control+Shift+G');
  });

  it('nas outras plataformas, trazem Ctrl primeiro', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    const both = groupedMenu(['g', 'c']);

    const html = templateText(both.el.render());

    expect(html).toContain('title=Agrupar (Ctrl+G)');
    expect(html).toContain('aria-keyshortcuts=Control+G Meta+G');
    expect(html).toContain('title=Desagrupar (Ctrl+Shift+G)');
    expect(html).toContain('aria-keyshortcuts=Control+Shift+G Meta+Shift+G');
  });

  it('o aria-label continua só o rótulo, e os três botões antigos não têm dica nem atalho', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    const { el } = groupedMenu(['g', 'c']);

    const html = templateText(el.render());

    expect(html).toContain('aria-label=Agrupar');
    expect(html).not.toContain('aria-label=Agrupar (');
    const buttons = html.split('<button').slice(1);
    expect(buttons).toHaveLength(5);
    for (const markup of buttons) {
      const isGroupAction = /data-action="(group|ungroup)"/.test(markup);
      // `nothing` (atributo ausente) aparece como Symbol no texto do template.
      expect(/\btitle=(?!Symbol)\S/.test(markup)).toBe(isGroupAction);
      expect(/aria-keyshortcuts=(?!Symbol)\S/.test(markup)).toBe(isGroupAction);
    }
  });

  it('em en, o rótulo da dica vem do i18n: "Group (⌘G)"', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    const { el } = groupedMenu(['g', 'c']);
    el.messages = defaultI18nEnUS.selectionMenu;

    const html = templateText(el.render());

    expect(html).toContain('title=Group (⌘G)');
    expect(html).toContain('title=Ungroup (⌘⇧G)');
  });
});

describe('<canvas-selection-menu>: o botão do tabindex móvel acompanha as ações (US-GA.7)', () => {
  it('quando Agrupar some, o índice vai para o botão na mesma posição', () => {
    const { section, internals } = setup();
    section.setSelection(['a', 'b']);
    internals._update();
    internals._toolbarIndex = 2;

    section.setSelection(['a']);
    internals._update();

    expect(internals._toolbarIndex).toBe(2);
  });

  it('quando o botão focado segue existindo noutra posição, o índice o acompanha', () => {
    const { section, internals } = setup();
    section.setSelection(['a', 'b']);
    internals._update();
    internals._toolbarIndex = 3;

    section.setSelection(['a']);
    internals._update();

    expect(internals._toolbarIndex).toBe(2);
  });

  it('o índice nunca passa do último botão', () => {
    const { section, internals } = setup();
    section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });
    section.setSelection(['g']);
    internals._update();
    internals._toolbarIndex = 3;

    section.setSelection(['g', 'a']);
    internals._update();
    internals._toolbarIndex = 4;
    section.setSelection(['a']);
    internals._update();

    expect(internals._toolbarIndex).toBeLessThanOrEqual(2);
  });
});

describe('<canvas-selection-menu>: foco depois de Agrupar e Desagrupar (US-GA.7)', () => {
  function afterAction(action: 'group' | 'ungroup') {
    const ctx = setup();
    if (action === 'ungroup') {
      ctx.section.dispatch({ type: 'group.create', id: 'g', childIds: ['a', 'b'] });
      ctx.section.setSelection(['g']);
    } else {
      ctx.section.setSelection(['a', 'b']);
    }
    ctx.internals._update();
    return ctx;
  }

  it('agrupar com o foco no botão leva o foco a Desagrupar', () => {
    const { el, internals } = afterAction('group');
    const before = namedButtons(['bring-to-front', 'send-to-back', 'group', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(before, before[2]);

    internals._act('group');
    const after = namedButtons(['bring-to-front', 'send-to-back', 'ungroup', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(after);
    internals.updated(new Map());

    expect(after[2]!.focus).toHaveBeenCalledTimes(1);
    expect(internals._toolbarIndex).toBe(2);
  });

  it('desagrupar com o foco no botão leva o foco a Agrupar', () => {
    const { el, internals } = afterAction('ungroup');
    const before = namedButtons(['bring-to-front', 'send-to-back', 'ungroup', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(before, before[2]);

    internals._act('ungroup');
    const after = namedButtons(['bring-to-front', 'send-to-back', 'group', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(after);
    internals.updated(new Map());

    expect(after[2]!.focus).toHaveBeenCalledTimes(1);
  });

  it('se Agrupar não ficar visível, o foco vai ao botão que ocupa a mesma posição', () => {
    const { el, section, internals } = afterAction('ungroup');
    section.dispatch(rectangle('lk', 700, 100));
    const before = namedButtons(['bring-to-front', 'send-to-back', 'ungroup', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(before, before[2]);

    internals._act('ungroup');
    section.setSelection(['a']);
    const after = namedButtons(['bring-to-front', 'send-to-back', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(after);
    internals.updated(new Map());

    expect(after[2]!.focus).toHaveBeenCalledTimes(1);
  });

  it('se o menu sumir depois da ação, o foco volta ao canvas', () => {
    const { el, section, canvas, internals } = afterAction('group');
    const before = namedButtons(['bring-to-front', 'send-to-back', 'group', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(before, before[2]);

    internals._act('group');
    section.setSelection([]);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith([]);
    internals.updated(new Map());

    expect(canvas.focus).toHaveBeenCalledTimes(1);
  });

  it('um clique sem foco no botão (WebKit) não move o foco', () => {
    const { el, canvas, internals } = afterAction('group');
    const before = namedButtons(['bring-to-front', 'send-to-back', 'group', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(before, null);

    internals._act('group');
    const after = namedButtons(['bring-to-front', 'send-to-back', 'ungroup', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(after);
    internals.updated(new Map());

    for (const button of after) expect(button.focus).not.toHaveBeenCalled();
    expect(canvas.focus).not.toHaveBeenCalled();
  });

  it('uma ação recusada não deixa foco pendente para a próxima atualização', () => {
    const { el, section, internals } = afterAction('group');
    section.setReadOnly(true);
    const buttons = namedButtons(['bring-to-front', 'send-to-back', 'group', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(buttons, buttons[2]);

    internals._act('group');
    internals.updated(new Map());

    for (const button of buttons) expect(button.focus).not.toHaveBeenCalled();
  });
});

describe('<canvas-selection-menu>: o foco não é roubado (US-GA.7)', () => {
  it('se o foco já foi para outro elemento, a ação não o puxa de volta', () => {
    const { el, section, internals } = setup();
    section.setSelection(['a', 'b']);
    internals._update();
    const before = namedButtons(['bring-to-front', 'send-to-back', 'group', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(before, before[2]);

    internals._act('group');
    // Outro elemento da página tem o foco agora.
    Object.defineProperty(el, 'ownerDocument', { value: { activeElement: {}, body: {} } });
    const after = namedButtons(['bring-to-front', 'send-to-back', 'ungroup', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(after);
    internals.updated(new Map());

    for (const button of after) expect(button.focus).not.toHaveBeenCalled();
  });
});

describe('<canvas-selection-menu>: o índice do foco pendente sai antes do desenho (US-GA.7)', () => {
  it('dois grupos, Desagrupar no índice 3: _update() já põe o índice em Agrupar e updated() só foca', () => {
    const { el, section, internals } = setup();
    section.dispatch(rectangle('c', 700, 100));
    section.dispatch(rectangle('d', 800, 100));
    section.dispatch({ type: 'group.create', id: 'g1', childIds: ['a', 'b'] });
    section.dispatch({ type: 'group.create', id: 'g2', childIds: ['c', 'd'] });
    section.setSelection(['g1', 'g2']);
    internals._update();
    const before = namedButtons(['bring-to-front', 'send-to-back', 'group', 'ungroup', 'delete']);
    expect(actionsOf(templateText(el.render()))).toEqual(
      before.map((b) => b.getAttribute('data-action')),
    );
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(before, before[3]);
    // O `@focus` de Desagrupar, que o DOM de mentira não dispara.
    internals._toolbarIndex = 3;

    // O quadro fica para depois, como no navegador: o _update() roda com o foco já pendente.
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    internals._act('ungroup');
    expect(frames).toHaveLength(1);
    frames.shift()!();

    expect(internals._toolbarIndex).toBe(2);

    const after = namedButtons(['bring-to-front', 'send-to-back', 'group', 'delete']);
    (el as unknown as { renderRoot: unknown }).renderRoot = rootWith(after);
    // Aqui `_toolbarIndex` é um campo comum, sem o acessor do Lit, e um espião de `requestUpdate`
    // nunca seria chamado: registra as escritas que mudam o valor, as que reagendariam o desenho.
    let current = internals._toolbarIndex;
    const changes: number[] = [];
    Object.defineProperty(el, '_toolbarIndex', {
      configurable: true,
      get: () => current,
      set: (value: number) => {
        if (value !== current) changes.push(value);
        current = value;
      },
    });
    internals.updated(new Map());

    expect(after[2]!.focus).toHaveBeenCalledTimes(1);
    expect(internals._toolbarIndex).toBe(2);
    expect(changes).toEqual([]);
  });
});
