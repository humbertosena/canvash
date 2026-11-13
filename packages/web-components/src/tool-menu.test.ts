import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOVER_CLOSE_MS, HOVER_OPEN_MS, ToolMenu, type ToolMenuHost } from './tool-menu.js';

function setup(
  options: {
    canHover?: () => boolean;
    box?: { left: number; right: number; bottom: number; width: number; height: number };
    barRight?: number;
  } = {},
) {
  const focus = vi.fn();
  const requestUpdate = vi.fn();
  const host = {
    orientation: 'vertical',
    updateComplete: Promise.resolve(),
    requestUpdate,
    renderRoot: {
      querySelector: () => ({ focus, getBoundingClientRect: () => options.box }),
      contains: () => false,
    },
    getBoundingClientRect: () => ({ right: options.barRight ?? 0, top: 0 }),
  } as unknown as ToolMenuHost;
  const menu = new ToolMenu({
    host,
    columns: 4,
    count: 8,
    groupSelector: '.group',
    menuSelector: '.menu',
    toggleSelector: '.toggle',
    entrySelector: (index) => `.entry-${index}`,
    initialIndex: () => 0,
    canHover: options.canHover,
  });
  return { menu, focus, requestUpdate };
}

const mouse = { pointerType: 'mouse' } as PointerEvent;

describe('ToolMenu: abertura por hover', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('o mouse abre em 80 ms, sem fixar a ilha e sem tirar o foco de onde estava', async () => {
    const { menu, focus } = setup();
    menu.onPointerEnter(mouse);

    vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
    expect(menu.open).toBe(false);
    vi.advanceTimersByTime(1);
    expect(menu.open).toBe(true);
    expect(menu.pinned).toBe(false);

    await vi.runAllTimersAsync();
    expect(focus).not.toHaveBeenCalled();
  });

  it('a caneta também abre, e o toque não', () => {
    const pen = setup();
    pen.menu.onPointerEnter({ pointerType: 'pen' } as PointerEvent);
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    expect(pen.menu.open).toBe(true);

    const touch = setup();
    touch.menu.onPointerEnter({ pointerType: 'touch' } as PointerEvent);
    vi.advanceTimersByTime(HOVER_OPEN_MS * 10);
    expect(touch.menu.open).toBe(false);
  });

  it('sair antes dos 80 ms cancela a abertura', () => {
    const { menu } = setup();
    menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS - 10);
    menu.onPointerLeave(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS * 10);
    expect(menu.open).toBe(false);
  });

  it('sair da área fecha em 250 ms, e voltar antes disso cancela o fechamento', () => {
    const { menu } = setup();
    menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS);

    menu.onPointerLeave(mouse);
    vi.advanceTimersByTime(HOVER_CLOSE_MS - 1);
    expect(menu.open).toBe(true);
    menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_CLOSE_MS * 4);
    expect(menu.open).toBe(true);

    menu.onPointerLeave(mouse);
    vi.advanceTimersByTime(HOVER_CLOSE_MS);
    expect(menu.open).toBe(false);
  });

  it('a ilha fixada por clique ou teclado não fecha ao sair com o ponteiro', () => {
    const { menu } = setup();
    menu.openMenu();
    expect(menu.pinned).toBe(true);

    menu.onPointerEnter(mouse);
    menu.onPointerLeave(mouse);
    vi.advanceTimersByTime(HOVER_CLOSE_MS * 4);
    expect(menu.open).toBe(true);
  });

  it('o clique na ilha aberta por hover a fixa; o clique seguinte a fecha', () => {
    const { menu } = setup();
    menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS);

    menu.toggle();
    expect(menu.open).toBe(true);
    expect(menu.pinned).toBe(true);

    menu.onPointerLeave(mouse);
    vi.advanceTimersByTime(HOVER_CLOSE_MS * 4);
    expect(menu.open).toBe(true);

    menu.toggle();
    expect(menu.open).toBe(false);
    expect(menu.pinned).toBe(false);
  });

  it('o clique que chega antes do hover fixa a ilha, e o timer do hover não a desfaz', () => {
    const { menu } = setup();
    menu.onPointerEnter(mouse);
    menu.toggle();
    vi.advanceTimersByTime(HOVER_OPEN_MS * 4);
    expect(menu.open).toBe(true);
    expect(menu.pinned).toBe(true);
  });

  it('fechar a ilha limpa a fixação, para o próximo hover abrir solto', () => {
    const { menu } = setup();
    menu.openMenu();
    menu.close({ restoreFocus: false });
    menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    expect(menu.open).toBe(true);
    expect(menu.pinned).toBe(false);
  });

  it('abrir por teclado leva o foco à entrada ativa', async () => {
    const { menu, focus } = setup();
    menu.openMenu();
    await vi.runAllTimersAsync();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('sem permissão para hover (sem canvas, por exemplo), o mouse não abre', () => {
    const { menu } = setup({ canHover: () => false });
    menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS * 4);
    expect(menu.open).toBe(false);
  });

  it('o foco que sai por um pressionar dentro do grupo não fecha a ilha (Safari foca o ancestral)', () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('document', {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    const { menu } = setup();
    menu.openMenu();
    const outside = { relatedTarget: {} } as FocusEvent;

    menu.onGroupPointerDown();
    menu.onFocusOut(outside);
    expect(menu.open).toBe(true);

    // Soltar o ponteiro, onde for, encerra o pressionar: o foco que sai de verdade volta a fechar,
    // mesmo logo depois do clique.
    listeners.get('pointerup')?.();
    menu.onFocusOut(outside);
    expect(menu.open).toBe(false);
  });

  it('a inversão de lado medida depois do hover é desenhada logo, sem esperar outro evento', async () => {
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
    const { menu, requestUpdate } = setup({
      box: { left: -120, right: 30, bottom: 100, width: 150, height: 100 },
      barRight: 500,
    });
    menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    expect(requestUpdate).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    expect(menu.flipped).toBe(true);
    expect(requestUpdate).toHaveBeenCalledTimes(2);
  });

  it('dispose com timer pendente não abre nem fecha nada depois', () => {
    const opening = setup();
    opening.menu.onPointerEnter(mouse);
    opening.menu.dispose();
    vi.advanceTimersByTime(HOVER_OPEN_MS * 4);
    expect(opening.menu.open).toBe(false);

    const closing = setup();
    closing.menu.onPointerEnter(mouse);
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    closing.menu.onPointerLeave(mouse);
    closing.menu.dispose();
    vi.advanceTimersByTime(HOVER_CLOSE_MS * 4);
    expect(closing.menu.open).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ToolMenu: aviso de abertura', () => {
  it('avisa ao abrir, por clique ou por hover, e não avisa de novo com a ilha já aberta', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const host = {
      orientation: 'vertical',
      updateComplete: Promise.resolve(),
      requestUpdate: vi.fn(),
      renderRoot: { querySelector: () => null, contains: () => false },
    } as unknown as ToolMenuHost;
    const menu = new ToolMenu({
      host,
      columns: 4,
      count: 4,
      groupSelector: '.group',
      menuSelector: '.menu',
      toggleSelector: '.toggle',
      entrySelector: () => '.entry',
      initialIndex: () => 0,
      onOpen,
    });

    menu.openMenu();
    menu.openMenu();
    expect(onOpen).toHaveBeenCalledTimes(1);

    menu.close({ restoreFocus: false });
    menu.onPointerEnter({ pointerType: 'mouse' });
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    expect(onOpen).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('ToolMenu: grade em blocos (ilha de Desenho)', () => {
  // Opções (4 colunas), depois tipo (3), espessura (3) e cores (9), em 3 colunas.
  const BLOCKS = [
    { start: 0, count: 4, columns: 4 },
    { start: 4, count: 3, columns: 3 },
    { start: 7, count: 3, columns: 3 },
    { start: 10, count: 9, columns: 3 },
  ];

  function blockMenu(blocks: () => typeof BLOCKS = () => BLOCKS) {
    const host = {
      orientation: 'vertical',
      updateComplete: Promise.resolve(),
      requestUpdate: vi.fn(),
      renderRoot: { querySelector: () => null, contains: () => false },
    } as unknown as ToolMenuHost;
    return new ToolMenu({
      host,
      columns: 4,
      count: () => blocks().reduce((total, block) => total + block.count, 0),
      blocks,
      groupSelector: '.group',
      menuSelector: '.menu',
      toggleSelector: '.toggle',
      entrySelector: (index) => `.entry-${index}`,
      initialIndex: () => 0,
    });
  }

  function press(menu: ToolMenu, key: string, from: number): number {
    menu.focusedIndex = from;
    menu.onMenuKeydown({ key, preventDefault: () => {} } as KeyboardEvent);
    return menu.focusedIndex;
  }

  it('seta para baixo mantém a coluna ao mudar de bloco e vai à última quando ela não existe', () => {
    const menu = blockMenu();
    expect(press(menu, 'ArrowDown', 0)).toBe(4);
    expect(press(menu, 'ArrowDown', 2)).toBe(6);
    // A 4ª coluna das opções cai na última do bloco de 3.
    expect(press(menu, 'ArrowDown', 3)).toBe(6);
    expect(press(menu, 'ArrowDown', 5)).toBe(8);
    expect(press(menu, 'ArrowDown', 8)).toBe(11);
  });

  it('seta para baixo anda uma linha dentro do bloco, e no último bloco não passa do fim', () => {
    const menu = blockMenu();
    expect(press(menu, 'ArrowDown', 10)).toBe(13);
    expect(press(menu, 'ArrowDown', 13)).toBe(16);
    expect(press(menu, 'ArrowDown', 16)).toBe(16);
    expect(press(menu, 'ArrowDown', 18)).toBe(18);
  });

  it('seta para cima faz o caminho de volta e para no início', () => {
    const menu = blockMenu();
    expect(press(menu, 'ArrowUp', 13)).toBe(10);
    expect(press(menu, 'ArrowUp', 10)).toBe(7);
    expect(press(menu, 'ArrowUp', 7)).toBe(4);
    expect(press(menu, 'ArrowUp', 6)).toBe(2);
    expect(press(menu, 'ArrowUp', 0)).toBe(0);
  });

  it('setas laterais, Home e End seguem lineares pelo total de entradas', () => {
    const menu = blockMenu();
    expect(press(menu, 'ArrowRight', 3)).toBe(4);
    expect(press(menu, 'ArrowLeft', 4)).toBe(3);
    expect(press(menu, 'Home', 9)).toBe(0);
    expect(press(menu, 'End', 0)).toBe(18);
  });

  it('com menos blocos (borracha), os limites acompanham a lista atual', () => {
    let blocks = [BLOCKS[0]!, { start: 4, count: 3, columns: 3 }];
    const menu = blockMenu(() => blocks);
    expect(press(menu, 'End', 0)).toBe(6);
    expect(press(menu, 'ArrowDown', 6)).toBe(6);
    blocks = [BLOCKS[0]!];
    expect(press(menu, 'End', 0)).toBe(3);
    expect(press(menu, 'ArrowDown', 1)).toBe(1);
  });
});
