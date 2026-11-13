// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSection, CanvasSelectionMenu } from './panels.js';

// Exportar board no wrapper React (spec board-export, §3 e US-BE.7).

type MenuElement = HTMLElement & { exportBoard?: boolean };

describe('React: CanvasSelectionMenu com exportBoard', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  const menu = (): MenuElement => container!.querySelector('canvas-selection-menu') as MenuElement;
  const request = (detail: unknown) =>
    menu().dispatchEvent(new CustomEvent('export-board-request', { detail, bubbles: true }));

  it('exportBoard chega ao elemento, liga e desliga', () => {
    act(() => root?.render(<CanvasSelectionMenu exportBoard />));
    expect(menu().exportBoard).toBe(true);

    act(() => root?.render(<CanvasSelectionMenu exportBoard={false} />));
    expect(menu().exportBoard).toBe(false);

    act(() => root?.render(<CanvasSelectionMenu />));
    expect(menu().exportBoard).toBe(false);
  });

  it('onExportBoardRequest recebe o detalhe uma vez por evento', () => {
    const onRequest = vi.fn();
    act(() => root?.render(<CanvasSelectionMenu exportBoard onExportBoardRequest={onRequest} />));

    request({ boardId: 'b1', format: 'png' });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith({ boardId: 'b1', format: 'png' });
  });

  it('usa o callback mais recente sem religar o ouvinte', () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => root?.render(<CanvasSelectionMenu onExportBoardRequest={first} />));
    const add = vi.spyOn(menu(), 'addEventListener');

    act(() => root?.render(<CanvasSelectionMenu onExportBoardRequest={second} />));
    request({ boardId: 'b1', format: 'svg' });

    expect(add).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ boardId: 'b1', format: 'svg' });
  });

  it('o ouvinte sai no unmount', () => {
    const onRequest = vi.fn();
    act(() => root?.render(<CanvasSelectionMenu onExportBoardRequest={onRequest} />));
    const el = menu();
    const remove = vi.spyOn(el, 'removeEventListener');

    act(() => root?.render(<div />));

    expect(remove).toHaveBeenCalledWith('export-board-request', expect.any(Function));
    el.dispatchEvent(new CustomEvent('export-board-request', { detail: { boardId: 'b1' } }));
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('o export-request da pill continua entregando só o formato', () => {
    const onExport = vi.fn();
    const onBoard = vi.fn();
    act(() =>
      root?.render(
        <CanvasSection onExportRequest={onExport}>
          <CanvasSelectionMenu slot="overlay" exportBoard onExportBoardRequest={onBoard} />
        </CanvasSection>,
      ),
    );

    container!
      .querySelector('canvas-section')!
      .dispatchEvent(new CustomEvent('export-request', { detail: { format: 'svg' } }));

    expect(onExport).toHaveBeenCalledWith('svg');
    expect(onBoard).not.toHaveBeenCalled();
  });
});
