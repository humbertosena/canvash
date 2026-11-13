import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSelectionMenuElement, defaultMenuSize } from './canvas-selection-menu.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';
import { CANVASH_PARTS } from './theme.js';

// Exportar board no mini-menu (spec board-export, §4.6; US-BE.7 e US-BE.8, parte do mouse).

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
  _update(): void;
  _toggleExportMenu(): void;
  _closeExportMenu(): void;
  _chooseExport(format: 'svg' | 'png'): void;
  _exportBoardId: string | undefined;
  _exportMenu: { x: number; y: number } | null;
  _toolbarIndex: number;
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

function setup(exportBoard = true) {
  const el = new CanvasSelectionMenuElement();
  const section: CanvasSectionApi = createCanvasSection();
  const result = section.transact([
    {
      type: 'shape.create',
      shape: { id: 'bd', type: 'board', x: 100, y: 100, width: 300, height: 200 },
    },
    rectangle('child', 120, 120),
    rectangle('other', 600, 100),
    rectangle('r2', 600, 300),
    { type: 'board.attach', boardId: 'bd', ids: ['child'] },
  ] as never);
  expect(result.ok).toBe(true);
  const canvas = {
    interactionState: 'idle' as const,
    focus: vi.fn(),
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 700 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  el.section = section;
  el.canvas = canvas;
  el.exportBoard = exportBoard;
  (el as unknown as { _measure: () => unknown })._measure = () => ({
    origin: { left: 100, top: 50 },
    canvas: { left: 100, top: 50, width: 1000, height: 700 },
    menu: undefined,
  });
  return { el, section, internals: el as unknown as Testable };
}

const actionsOf = (html: string): string[] =>
  [...html.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]!);

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

describe('<canvas-selection-menu export-board>: quando o botão aparece (US-BE.7)', () => {
  it('com um board selecionado, entre Enviar para trás e Excluir', () => {
    const { el, section, internals } = setup();
    section.setSelection(['bd']);
    internals._update();

    const html = templateText(el.render());

    expect(actionsOf(html)).toEqual(['bring-to-front', 'send-to-back', 'export-board', 'delete']);
    expect(html).toContain('part="selection-action selection-action-export-board"');
    expect(html).toContain('aria-label=Exportar board');
    expect(html).toContain('title=Exportar board');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded=false');
    const start = html.indexOf('selection-action-export-board');
    expect(html.slice(start, html.indexOf('</button>', start))).not.toContain('aria-keyshortcuts');
  });

  it('sem o atributo export-board, o menu tem os mesmos botões de hoje', () => {
    const { el, section, internals } = setup(false);
    section.setSelection(['bd']);
    internals._update();

    const html = templateText(el.render());

    expect(actionsOf(html)).toEqual(['bring-to-front', 'send-to-back', 'delete']);
    expect(html).not.toContain('export-board');
    expect(html).not.toContain('aria-haspopup');
  });

  it.each([
    ['um retângulo', ['other']],
    ['um board e outro nó', ['bd', 'other']],
    ['um filho do board', ['child']],
    ['dois retângulos', ['other', 'r2']],
    ['nada', []],
  ])('com %s selecionado, o botão não aparece', (_name, ids) => {
    const { el, section, internals } = setup();
    section.setSelection(ids);
    internals._update();

    expect(actionsOf(templateText(el.render()))).not.toContain('export-board');
  });

  it('ligar o atributo com o board já selecionado faz o botão aparecer', () => {
    const { el, section, internals } = setup(false);
    section.setSelection(['bd']);
    internals._update();
    expect(actionsOf(templateText(el.render()))).not.toContain('export-board');

    el.exportBoard = true;
    (el as unknown as { updated(changed: Map<string, unknown>): void }).updated(
      new Map([['exportBoard', false]]),
    );

    expect(actionsOf(templateText(el.render()))).toContain('export-board');
  });

  it('trocar a seleção para um board redesenha o menu mesmo sem a posição mudar', () => {
    const { section, internals } = setup();
    section.setSelection(['child']);
    internals._update();
    expect(internals._exportBoardId).toBeUndefined();

    section.setSelection(['bd']);
    internals._update();

    expect(internals._exportBoardId).toBe('bd');
  });

  it('em repouso, um _update() sem mudança não troca o estado', () => {
    const { section, internals } = setup();
    section.setSelection(['bd']);
    internals._update();
    const id = internals._exportBoardId;

    internals._update();

    expect(internals._exportBoardId).toBe(id);
  });

  it('o tamanho padrão do menu conta o botão de exportar', () => {
    const { el, section, internals } = setup();
    section.setSelection(['bd']);
    internals._update();

    const placement = (el as unknown as { _placement: { x: number } | null })._placement;

    expect(placement).not.toBeNull();
    expect(defaultMenuSize(4)).toEqual({ width: 144, height: 42 });
  });
});

describe('<canvas-selection-menu export-board>: submenu e pedido (US-BE.7)', () => {
  const open = () => {
    const ctx = setup();
    ctx.section.setSelection(['bd']);
    ctx.internals._update();
    ctx.internals._toggleExportMenu();
    return ctx;
  };

  it('o clique abre o submenu com SVG e PNG, fora de .menu, e aria-expanded fica true', () => {
    const { el, internals } = open();

    const html = templateText(el.render());

    expect(internals._exportMenu).not.toBeNull();
    expect(html).toContain('part="export-board-menu"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label=Opções de exportação do board');
    expect(html).toContain('part="export-board-item"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html.indexOf('data-format=svg')).toBeLessThan(html.indexOf('data-format=png'));
    expect(html).toContain('aria-label=Exportar board como SVG');
    expect(html).toContain('aria-label=Exportar board como PNG');
    expect(html).toContain('aria-expanded=true');
    // Os itens do submenu ficam depois do fechamento da barra: irmãos de .menu, não filhos.
    expect(html.indexOf('part="export-board-menu"')).toBeGreaterThan(
      html.indexOf('part="selection-action selection-action-delete"'),
    );
  });

  it('outro clique no botão fecha o submenu', () => {
    const { internals } = open();

    internals._toggleExportMenu();

    expect(internals._exportMenu).toBeNull();
  });

  it('escolher PNG emite um único export-board-request e nenhum export-request', () => {
    const { el, internals } = open();
    const request = vi.fn();
    const legacy = vi.fn();
    el.addEventListener('export-board-request', request);
    el.addEventListener('export-request', legacy);

    internals._chooseExport('png');

    expect(request).toHaveBeenCalledTimes(1);
    const event = request.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ boardId: 'bd', format: 'png' });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
    expect(internals._exportMenu).toBeNull();
  });

  it('escolher SVG pede o formato svg', () => {
    const { el, internals } = open();
    const request = vi.fn();
    el.addEventListener('export-board-request', request);

    internals._chooseExport('svg');

    expect((request.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      boardId: 'bd',
      format: 'svg',
    });
  });

  it('sem board selecionado, escolher um formato não emite nada', () => {
    const { el, section, internals } = open();
    const request = vi.fn();
    el.addEventListener('export-board-request', request);
    section.setSelection(['other']);
    internals._update();

    internals._chooseExport('png');

    expect(request).not.toHaveBeenCalled();
  });

  it('o submenu fecha quando a seleção deixa de ser o board', () => {
    const { section, internals } = open();

    section.setSelection(['other']);
    internals._update();

    expect(internals._exportMenu).toBeNull();
  });

  it('escolher o formato não muda o documento nem o histórico', () => {
    const { section, internals } = open();
    const before = section.getSnapshot();

    internals._chooseExport('png');

    expect(section.getSnapshot().revision).toBe(before.revision);
    expect(section.getSnapshot().history).toEqual(before.history);
  });
});

describe('<canvas-selection-menu export-board>: textos e partes (US-BE.8)', () => {
  it('tem os textos em pt-BR e en-US', () => {
    expect(defaultI18nPtBR.selectionMenu).toMatchObject({
      exportBoard: 'Exportar board',
      exportBoardMenu: 'Opções de exportação do board',
      exportBoardSvg: 'Exportar board como SVG',
      exportBoardPng: 'Exportar board como PNG',
    });
    expect(defaultI18nEnUS.selectionMenu).toMatchObject({
      exportBoard: 'Export board',
      exportBoardMenu: 'Board export options',
      exportBoardSvg: 'Export board as SVG',
      exportBoardPng: 'Export board as PNG',
    });
  });

  it('em en-US o aria-label e o title do botão vêm do i18n', () => {
    const { el, section, internals } = setup();
    el.messages = defaultI18nEnUS.selectionMenu;
    section.setSelection(['bd']);
    internals._update();

    const html = templateText(el.render());

    expect(html).toContain('aria-label=Export board');
    expect(html).toContain('title=Export board');
  });

  it('documenta as partes novas', () => {
    expect(CANVASH_PARTS.selectionMenu).toEqual(
      expect.arrayContaining([
        'selection-action-export-board',
        'export-board-menu',
        'export-board-item',
      ]),
    );
  });
});
