import { createCanvasSection } from '@canvash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasToolbarElement, SHAPE_GROUP_TOOLS } from './canvas-toolbar.js';
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
  _focusedShape: string;
  _shapesMenuFlipped: boolean;
  _onToggleKeydown(event: KeyboardEvent): void;
  _onMenuKeydown(event: KeyboardEvent): void;
  _selectShape(tool: string): void;
  _toggleShapesMenu(): void;
  _openShapesMenu(): void;
  _closeShapesMenu(options: { restoreFocus: boolean }): void;
  _onMenuFocusOut(event: FocusEvent): void;
}

/** O comportamento do menu mora em `ToolMenu`; o elemento só o desenha e o liga ao canvas. */
const internals = (el: CanvasToolbarElement): Internals => {
  const parts = el as unknown as {
    _shapesMenu: ToolMenu;
    _selectShape(tool: string): void;
  };
  const menu = parts._shapesMenu;
  return {
    get _focusedShape(): string {
      return SHAPE_GROUP_TOOLS[menu.focusedIndex] ?? '';
    },
    set _focusedShape(tool: string) {
      menu.focusedIndex = SHAPE_GROUP_TOOLS.indexOf(tool as never);
    },
    get _shapesMenuFlipped(): boolean {
      return menu.flipped;
    },
    _onToggleKeydown: (event) => menu.onToggleKeydown(event),
    _onMenuKeydown: (event) => menu.onMenuKeydown(event),
    _selectShape: (tool) => parts._selectShape(tool),
    _toggleShapesMenu: () => menu.toggle(),
    _openShapesMenu: () => menu.openMenu(),
    _closeShapesMenu: (options) => menu.close(options),
    _onMenuFocusOut: (event) => menu.onFocusOut(event),
  };
};

function toolbar(): { el: CanvasToolbarElement; section: ReturnType<typeof createCanvasSection> } {
  const el = new CanvasToolbarElement();
  const section = createCanvasSection();
  el.section = section;
  return { el, section };
}

/** Pedaços de `<button` do template com o atributo dado. */
function buttonsWith(el: CanvasToolbarElement, marker: string): string[] {
  return templateText(el.render())
    .split('<button')
    .filter((chunk) => chunk.includes(marker));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('grupo "Formas" da toolbar: conteúdo e estado', () => {
  it('lista as 14 figuras, com seta e chaves, na ordem do menu', () => {
    expect(SHAPE_GROUP_TOOLS).toEqual([
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
    ]);
  });

  it('fechado, mostra os botões próprios, o grupo Figuras com o retângulo e o Desenho com a Bézier, sem o menu', () => {
    const { el } = toolbar();
    const text = templateText(el.render());

    expect([...text.matchAll(/data-tool=([a-z]+)/g)].map((m) => m[1])).toEqual([
      'select',
      'hand',
      'rectangle',
      'text',
      'bezier',
      'board',
    ]);
    expect(text).not.toContain('role="menu"');

    // O botão do grupo é um só: ativa a última figura e abre a ilha (premissa 7).
    const [main] = buttonsWith(el, 'part="shapes-button');
    expect(buttonsWith(el, 'data-action="open-shapes"')).toHaveLength(1);
    expect(main).toContain('data-action="open-shapes"');
    expect(main).toContain('aria-label=Figuras: Retângulo');
    expect(main).toContain('title=Figuras');
    expect(main).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(main).toContain('aria-haspopup="menu"');
    expect(main).toContain('aria-expanded=false');
    expect(main).toContain('aria-controls="shapes-menu"');
  });

  it('aberto, mostra um item por figura com nome, tooltip e aria-checked na ferramenta ativa', () => {
    const { el, section } = toolbar();
    section.setTool('hexagon');
    el.shapesMenuOpen = true;
    const text = templateText(el.render());

    expect(text).toContain('role="menu"');
    expect(text).toContain('part="shapes-menu"');
    const items = buttonsWith(el, 'role="menuitemradio"');
    expect(items).toHaveLength(14);
    for (const [index, item] of items.entries()) {
      expect(item).toContain(`data-tool=${SHAPE_GROUP_TOOLS[index]}`);
      expect(item).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(item).toMatch(/aria-label=\S+/);
      expect(item).toMatch(/title=\S+/);
    }

    const checked = items.filter((item) => item.includes('aria-checked=true'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('data-tool=hexagon');
    // O nome acessível não repete o atalho; o tooltip, sim.
    expect(items[0]).toMatch(/aria-label=Retângulo\s/);
    expect(items[0]).toContain('title=Retângulo (R)');
    expect(items[2]).toContain('title=Elipse (O)');
    // A seta entra antes das chaves.
    expect(items[12]).toContain('data-tool=arrow');
    expect(items[13]).toContain('data-tool=brace');
    expect(buttonsWith(el, 'aria-expanded=true')).toHaveLength(1);
  });
});

describe('grupo "Formas": figura marcada na ilha', () => {
  it('marca a última figura mesmo com outra ferramenta ativa; na primeira vez, o retângulo', () => {
    const { el, section } = toolbar();
    el.shapesMenuOpen = true;
    const checked = () =>
      buttonsWith(el, 'role="menuitemradio"').filter((item) => item.includes('aria-checked=true'));

    expect(section.getSnapshot().session.activeTool).toBe('select');
    expect(checked()).toHaveLength(1);
    expect(checked()[0]).toContain('data-tool=rectangle');

    section.setTool('circle');
    section.setTool('select');
    expect(checked()).toHaveLength(1);
    expect(checked()[0]).toContain('data-tool=circle');
  });
});

describe('grupo "Formas": última forma usada', () => {
  it('começa no retângulo e acompanha a ferramenta ativa, inclusive por setTool externo', () => {
    const { el, section } = toolbar();
    expect(el.lastShape).toBe('rectangle');

    section.setTool('hexagon');
    expect(el.lastShape).toBe('hexagon');
    const [main] = buttonsWith(el, 'part="shapes-button');
    expect(main).toContain('data-tool=hexagon');
    expect(main).toContain('aria-label=Figuras: Hexágono');
    expect(main).toContain('aria-pressed=true');

    // Ferramentas fora do grupo não mudam o botão.
    section.setTool('line');
    expect(el.lastShape).toBe('hexagon');
    expect(buttonsWith(el, 'part="shapes-button')[0]).toContain('aria-pressed=false');
  });

  it('lê a ferramenta que já estava ativa ao receber o canvas', () => {
    const section = createCanvasSection();
    section.setTool('octagon');
    const el = new CanvasToolbarElement();
    el.section = section;
    expect(el.lastShape).toBe('octagon');

    const other = createCanvasSection();
    other.setTool('select');
    const fresh = new CanvasToolbarElement();
    fresh.section = other;
    expect(fresh.lastShape).toBe('rectangle');
  });

  it('o host pode atribuir lastShape antes de ligar o canvas', () => {
    const el = new CanvasToolbarElement();
    el.lastShape = 'brace';
    el.section = createCanvasSection();
    expect(el.lastShape).toBe('brace');
    expect(buttonsWith(el, 'part="shapes-button')[0]).toContain('aria-label=Figuras: Chaves');
  });

  it('cada instância tem a própria última forma e o próprio menu', () => {
    const a = toolbar();
    const b = toolbar();

    a.section.setTool('circle');
    expect(a.el.lastShape).toBe('circle');
    expect(b.el.lastShape).toBe('rectangle');

    internals(a.el)._openShapesMenu();
    expect(a.el.shapesMenuOpen).toBe(true);
    expect(b.el.shapesMenuOpen).toBe(false);
  });

  it('traduz o nome acessível do botão principal', () => {
    const { el } = toolbar();
    el.messages = defaultI18nEnUS.toolbar;
    const [main] = buttonsWith(el, 'part="shapes-button');
    expect(main).toContain('aria-label=Shapes: Rectangle');
    expect(main).toContain('title=Shapes');
  });
});

describe('grupo "Formas": abrir, escolher e fechar', () => {
  it('escolher uma figura ativa a ferramenta, lembra dela e fecha o menu', () => {
    const { el, section } = toolbar();
    internals(el)._openShapesMenu();
    expect(el.shapesMenuOpen).toBe(true);

    internals(el)._selectShape('circle');
    expect(section.getSnapshot().session.activeTool).toBe('circle');
    expect(el.lastShape).toBe('circle');
    expect(el.shapesMenuOpen).toBe(false);
  });

  it('o botão de abrir alterna o menu', () => {
    const { el } = toolbar();
    internals(el)._toggleShapesMenu();
    expect(el.shapesMenuOpen).toBe(true);
    internals(el)._toggleShapesMenu();
    expect(el.shapesMenuOpen).toBe(false);
    // Abrir de novo com o menu aberto e fechar sem o menu aberto não fazem nada.
    internals(el)._openShapesMenu();
    internals(el)._openShapesMenu();
    expect(el.shapesMenuOpen).toBe(true);
    internals(el)._closeShapesMenu({ restoreFocus: false });
    internals(el)._closeShapesMenu({ restoreFocus: false });
    expect(el.shapesMenuOpen).toBe(false);
  });

  it('o clique no botão do grupo ativa a última figura e fixa a ilha; o clique seguinte a fecha', () => {
    const { el, section } = toolbar();
    const parts = el as unknown as { _onShapesButton(): void; _shapesMenu: ToolMenu };
    section.setTool('hexagon');
    section.setTool('select');

    parts._onShapesButton();
    expect(section.getSnapshot().session.activeTool).toBe('hexagon');
    expect(el.shapesMenuOpen).toBe(true);
    expect(parts._shapesMenu.pinned).toBe(true);

    parts._onShapesButton();
    expect(el.shapesMenuOpen).toBe(false);
  });

  it('a seta ativada pela API vira a figura lembrada, e escolhê-la na ilha a ativa', () => {
    const { el, section } = toolbar();
    section.setTool('arrow');
    expect(el.lastShape).toBe('arrow');
    expect(buttonsWith(el, 'part="shapes-button')[0]).toContain('aria-label=Figuras: Seta');

    section.setTool('select');
    internals(el)._selectShape('arrow');
    expect(section.getSnapshot().session.activeTool).toBe('arrow');
  });

  it('sem canvas, escolher uma figura não faz nada', () => {
    const el = new CanvasToolbarElement();
    internals(el)._selectShape('circle');
    expect(el.lastShape).toBe('rectangle');
  });

  it('fechar com restoreFocus devolve o foco ao botão de abrir', () => {
    const { el } = toolbar();
    const focus = vi.fn();
    Object.defineProperty(el, 'renderRoot', {
      value: { querySelector: () => ({ focus }) },
    });
    internals(el)._openShapesMenu();
    internals(el)._closeShapesMenu({ restoreFocus: true });
    expect(focus).toHaveBeenCalledTimes(1);

    internals(el)._openShapesMenu();
    internals(el)._closeShapesMenu({ restoreFocus: false });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('com o canvas somente leitura os itens ficam desabilitados e escolher não ativa nada', () => {
    const { el, section } = toolbar();
    section.setReadOnly(true);
    el.shapesMenuOpen = true;

    const items = buttonsWith(el, 'role="menuitemradio"');
    expect(items.every((item) => item.includes('aria-disabled=true'))).toBe(true);

    internals(el)._selectShape('circle');
    expect(section.getSnapshot().session.activeTool).toBe('select');
    expect(el.lastShape).toBe('rectangle');
    expect(el.shapesMenuOpen).toBe(true);
  });
});

describe('grupo "Formas": listeners globais (WC-04)', () => {
  function stubDocument() {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: remove });
    return { add, remove };
  }

  it('só registra o pointerdown no document enquanto o menu está aberto', () => {
    const { add, remove } = stubDocument();
    const { el } = toolbar();
    expect(add).not.toHaveBeenCalled();

    internals(el)._openShapesMenu();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]![0]).toBe('pointerdown');

    // Abrir de novo não duplica o listener.
    internals(el)._openShapesMenu();
    expect(add).toHaveBeenCalledTimes(1);

    internals(el)._closeShapesMenu({ restoreFocus: false });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
  });

  it('remove o listener ao desconectar o elemento com o menu aberto', () => {
    const { add, remove } = stubDocument();
    const { el } = toolbar();
    internals(el)._openShapesMenu();
    el.disconnectedCallback();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);

    // Desconectar de novo, sem listener, é seguro.
    el.disconnectedCallback();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('o clique fora fecha o menu e o clique dentro não', () => {
    const { add } = stubDocument();
    const { el } = toolbar();
    internals(el)._openShapesMenu();
    const listener = add.mock.calls[0]![1] as (event: Event) => void;

    listener({ composedPath: () => [el] } as unknown as Event);
    expect(el.shapesMenuOpen).toBe(true);

    listener({ composedPath: () => [{}] } as unknown as Event);
    expect(el.shapesMenuOpen).toBe(false);
  });

  it('sem document (SSR) abrir e fechar o menu não registra nada nem quebra', () => {
    vi.stubGlobal('document', undefined);
    const { el } = toolbar();
    internals(el)._openShapesMenu();
    expect(el.shapesMenuOpen).toBe(true);
    internals(el)._closeShapesMenu({ restoreFocus: false });
    expect(el.shapesMenuOpen).toBe(false);
  });

  it('o foco que sai do grupo fecha o menu; foco nulo ou dentro do grupo não', () => {
    stubDocument();
    const { el } = toolbar();
    const inside = { closest: (selector: string) => (selector === '.shapes-group' ? {} : null) };
    Object.defineProperty(el, 'renderRoot', {
      value: { contains: (node: unknown) => node === inside, querySelector: () => null },
    });

    internals(el)._openShapesMenu();
    internals(el)._onMenuFocusOut({ relatedTarget: null } as FocusEvent);
    expect(el.shapesMenuOpen).toBe(true);
    internals(el)._onMenuFocusOut({ relatedTarget: inside } as unknown as FocusEvent);
    expect(el.shapesMenuOpen).toBe(true);
    internals(el)._onMenuFocusOut({ relatedTarget: {} } as unknown as FocusEvent);
    expect(el.shapesMenuOpen).toBe(false);
  });
});

interface FakeDom {
  readonly focused: string[];
  readonly menuBox: { left: number; right: number; bottom: number; width: number; height: number };
}

/** Raiz e elementos falsos: `focus()` registra o seletor que recebeu o foco. */
function fakeDom(
  el: CanvasToolbarElement,
  bar: { top: number; left: number; right?: number },
): FakeDom {
  const focused: string[] = [];
  const menuBox = { left: 0, right: 0, bottom: 0, width: 140, height: 150 };
  const element = (name: string, box?: object) => ({
    focus: () => focused.push(name),
    getBoundingClientRect: () => box,
  });
  Object.defineProperty(el, 'renderRoot', {
    value: {
      querySelector: (selector: string) =>
        selector === '.shapes-menu'
          ? element('menu', menuBox)
          : selector === '[data-action="open-shapes"]'
            ? element('toggle')
            : element(selector.replace(/^\[role="menuitemradio"\]\[data-tool="(.*)"\]$/, '$1')),
    },
  });
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ top: bar.top, left: bar.left, right: bar.right ?? bar.left }),
  });
  Object.defineProperty(el, 'updateComplete', { value: Promise.resolve(true) });
  return { focused, menuBox };
}

const key = (name: string) => {
  const event = { key: name, preventDefault: vi.fn() };
  return { event: event as unknown as KeyboardEvent, preventDefault: event.preventDefault };
};

describe('grupo "Formas": teclado', () => {
  it('abre com seta para baixo na horizontal e seta para a esquerda na vertical', () => {
    const horizontal = toolbar().el;
    const down = key('ArrowDown');
    internals(horizontal)._onToggleKeydown(down.event);
    expect(horizontal.shapesMenuOpen).toBe(true);
    expect(down.preventDefault).toHaveBeenCalled();

    const ignored = toolbar().el;
    for (const name of ['ArrowRight', 'ArrowUp', 'Enter', 'a']) {
      const pressed = key(name);
      internals(ignored)._onToggleKeydown(pressed.event);
      expect(pressed.preventDefault).not.toHaveBeenCalled();
    }
    expect(ignored.shapesMenuOpen).toBe(false);

    const vertical = toolbar().el;
    vertical.orientation = 'vertical';
    internals(vertical)._onToggleKeydown(key('ArrowDown').event);
    expect(vertical.shapesMenuOpen).toBe(false);
    internals(vertical)._onToggleKeydown(key('ArrowRight').event);
    expect(vertical.shapesMenuOpen).toBe(false);
    internals(vertical)._onToggleKeydown(key('ArrowLeft').event);
    expect(vertical.shapesMenuOpen).toBe(true);
  });

  it('ao abrir, leva o foco ao item da ferramenta ativa, ou da última forma', async () => {
    const active = toolbar();
    active.section.setTool('hexagon');
    const activeDom = fakeDom(active.el, { top: 0, left: 0 });
    internals(active.el)._openShapesMenu();
    await active.el.updateComplete;
    expect(internals(active.el)._focusedShape).toBe('hexagon');
    expect(activeDom.focused).toEqual(['hexagon']);

    const remembered = toolbar();
    remembered.section.setTool('brace');
    remembered.section.setTool('line');
    const rememberedDom = fakeDom(remembered.el, { top: 0, left: 0 });
    internals(remembered.el)._openShapesMenu();
    await remembered.el.updateComplete;
    expect(rememberedDom.focused).toEqual(['brace']);
  });

  it('não leva o foco a lugar nenhum se o menu fechou antes do render', async () => {
    const { el } = toolbar();
    const dom = fakeDom(el, { top: 0, left: 0 });
    internals(el)._openShapesMenu();
    internals(el)._closeShapesMenu({ restoreFocus: false });
    await el.updateComplete;
    expect(dom.focused).toEqual([]);
  });

  it('as setas andam um item ou uma linha de 4, sem passar das pontas', async () => {
    const { el } = toolbar();
    const dom = fakeDom(el, { top: 0, left: 0 });
    internals(el)._openShapesMenu();
    await el.updateComplete;
    dom.focused.length = 0;

    const press = async (name: string): Promise<string> => {
      const pressed = key(name);
      internals(el)._onMenuKeydown(pressed.event);
      expect(pressed.preventDefault).toHaveBeenCalled();
      await el.updateComplete;
      return internals(el)._focusedShape;
    };

    expect(await press('ArrowRight')).toBe('square');
    expect(await press('ArrowDown')).toBe('triangle');
    expect(await press('ArrowLeft')).toBe('diamond');
    expect(await press('ArrowUp')).toBe('rectangle');
    expect(await press('ArrowUp')).toBe('rectangle');
    expect(await press('ArrowLeft')).toBe('rectangle');
    expect(await press('End')).toBe('brace');
    expect(await press('ArrowRight')).toBe('brace');
    expect(await press('ArrowDown')).toBe('brace');
    expect(await press('Home')).toBe('rectangle');
    expect(dom.focused.at(-1)).toBe('rectangle');
  });

  it('a navegação é a mesma na toolbar vertical', async () => {
    const { el } = toolbar();
    el.orientation = 'vertical';
    fakeDom(el, { top: 0, left: 0 });
    internals(el)._openShapesMenu();
    await el.updateComplete;

    internals(el)._onMenuKeydown(key('ArrowDown').event);
    await el.updateComplete;
    expect(internals(el)._focusedShape).toBe('diamond');
    internals(el)._onMenuKeydown(key('ArrowRight').event);
    await el.updateComplete;
    expect(internals(el)._focusedShape).toBe('triangle');
  });

  it('Esc e Tab fecham o menu e devolvem o foco ao botão de abrir; outras teclas passam', async () => {
    for (const name of ['Escape', 'Tab']) {
      const { el } = toolbar();
      const dom = fakeDom(el, { top: 0, left: 0 });
      internals(el)._openShapesMenu();
      await el.updateComplete;
      dom.focused.length = 0;

      const pressed = key(name);
      internals(el)._onMenuKeydown(pressed.event);
      expect(pressed.preventDefault).toHaveBeenCalled();
      expect(el.shapesMenuOpen).toBe(false);
      expect(dom.focused).toEqual(['toggle']);
    }

    const { el } = toolbar();
    fakeDom(el, { top: 0, left: 0 });
    internals(el)._openShapesMenu();
    const other = key('a');
    internals(el)._onMenuKeydown(other.event);
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(el.shapesMenuOpen).toBe(true);
  });

  it('só o item focado entra na ordem de tabulação', () => {
    const { el } = toolbar();
    el.shapesMenuOpen = true;
    internals(el)._focusedShape = 'circle';
    const items = buttonsWith(el, 'role="menuitemradio"');
    const tabbable = items.filter((item) => /tabindex=0/.test(item));
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toContain('data-tool=circle');
    expect(items.filter((item) => /tabindex=-1/.test(item))).toHaveLength(13);
  });
});

describe('grupo "Formas": inversão de lado ao estourar o viewport', () => {
  const viewport = { innerWidth: 800, innerHeight: 600 };

  async function open(
    orientation: 'horizontal' | 'vertical',
    box: { top: number; left: number; right?: number },
    menu: { left?: number; right: number; bottom: number },
  ) {
    vi.stubGlobal('window', viewport);
    const { el } = toolbar();
    el.orientation = orientation;
    const dom = fakeDom(el, box);
    Object.assign(dom.menuBox, menu);
    internals(el)._openShapesMenu();
    await el.updateComplete;
    return el;
  }

  it('na horizontal, abre para cima quando o menu passa da borda de baixo e cabe acima', async () => {
    const el = await open('horizontal', { top: 520, left: 10 }, { right: 150, bottom: 690 });
    expect(internals(el)._shapesMenuFlipped).toBe(true);
    expect(templateText(el.render())).toContain('shapes-menu flipped');
  });

  it('na vertical, abre para a direita quando o menu passa da borda esquerda e cabe à direita', async () => {
    const el = await open(
      'vertical',
      { top: 10, left: 20, right: 60 },
      { left: -100, right: 40, bottom: 160 },
    );
    expect(internals(el)._shapesMenuFlipped).toBe(true);
  });

  it('não inverte quando cabe, nem quando o outro lado também não cabe', async () => {
    const fits = await open('horizontal', { top: 20, left: 10 }, { right: 150, bottom: 190 });
    expect(internals(fits)._shapesMenuFlipped).toBe(false);
    expect(templateText(fits.render())).not.toContain('flipped');

    const noRoom = await open('horizontal', { top: 40, left: 10 }, { right: 150, bottom: 690 });
    expect(internals(noRoom)._shapesMenuFlipped).toBe(false);

    const sideways = await open(
      'vertical',
      { top: 10, left: 700, right: 760 },
      { left: -100, right: 40, bottom: 160 },
    );
    expect(internals(sideways)._shapesMenuFlipped).toBe(false);
  });

  it('sem window ou sem o menu renderizado não mede nada', async () => {
    vi.stubGlobal('window', undefined);
    const { el } = toolbar();
    fakeDom(el, { top: 520, left: 0 });
    internals(el)._openShapesMenu();
    await el.updateComplete;
    expect(internals(el)._shapesMenuFlipped).toBe(false);

    vi.stubGlobal('window', viewport);
    const empty = toolbar().el;
    Object.defineProperty(empty, 'renderRoot', { value: { querySelector: () => null } });
    Object.defineProperty(empty, 'updateComplete', { value: Promise.resolve(true) });
    internals(empty)._openShapesMenu();
    await empty.updateComplete;
    expect(internals(empty)._shapesMenuFlipped).toBe(false);
  });

  it('fechar e abrir de novo mede outra vez', async () => {
    vi.stubGlobal('window', viewport);
    const { el } = toolbar();
    const dom = fakeDom(el, { top: 520, left: 10 });
    Object.assign(dom.menuBox, { right: 150, bottom: 690 });
    internals(el)._openShapesMenu();
    await el.updateComplete;
    expect(internals(el)._shapesMenuFlipped).toBe(true);

    internals(el)._closeShapesMenu({ restoreFocus: false });
    expect(internals(el)._shapesMenuFlipped).toBe(false);
    Object.assign(dom.menuBox, { bottom: 300 });
    internals(el)._openShapesMenu();
    await el.updateComplete;
    expect(internals(el)._shapesMenuFlipped).toBe(false);
  });
});
