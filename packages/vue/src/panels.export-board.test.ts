// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSection, CanvasSelectionMenu } from './panels.js';

// Exportar board no wrapper Vue (spec board-export, §3 e US-BE.7).

type MenuElement = HTMLElement & { exportBoard?: boolean };

describe('Vue: CanvasSelectionMenu com exportBoard', () => {
  let container: HTMLDivElement | null = null;
  let app: ReturnType<typeof createApp> | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    container?.remove();
    container = null;
  });

  const menu = (): MenuElement => container!.querySelector('canvas-selection-menu') as MenuElement;
  const request = (detail: unknown) =>
    menu().dispatchEvent(new CustomEvent('export-board-request', { detail, bubbles: true }));

  it('exportBoard chega ao elemento e acompanha a prop', async () => {
    const enabled = ref(true);
    app = createApp({ render: () => h(CanvasSelectionMenu, { exportBoard: enabled.value }) });
    app.mount(container!);
    await nextTick();
    expect(menu().exportBoard).toBe(true);

    enabled.value = false;
    await nextTick();

    expect(menu().exportBoard).toBe(false);
  });

  it('sem a prop, exportBoard é false', async () => {
    app = createApp({ render: () => h(CanvasSelectionMenu) });
    app.mount(container!);
    await nextTick();

    expect(menu().exportBoard).toBe(false);
  });

  it('o emit export-board-request recebe o detalhe uma vez por evento', async () => {
    const onRequest = vi.fn();
    app = createApp({
      render: () => h(CanvasSelectionMenu, { exportBoard: true, onExportBoardRequest: onRequest }),
    });
    app.mount(container!);
    await nextTick();

    request({ boardId: 'b1', format: 'png' });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith({ boardId: 'b1', format: 'png' });
  });

  it('o ouvinte sai ao desmontar', async () => {
    const onRequest = vi.fn();
    app = createApp({
      render: () => h(CanvasSelectionMenu, { onExportBoardRequest: onRequest }),
    });
    app.mount(container!);
    await nextTick();
    const el = menu();
    const remove = vi.spyOn(el, 'removeEventListener');

    app.unmount();
    app = null;

    expect(remove).toHaveBeenCalledWith('export-board-request', expect.any(Function));
  });

  it('o export-request da pill continua emitindo só o formato', async () => {
    const onExport = vi.fn();
    const onBoard = vi.fn();
    app = createApp({
      render: () =>
        h(CanvasSection, { onExportRequest: onExport }, () =>
          h(CanvasSelectionMenu, {
            slot: 'overlay',
            exportBoard: true,
            onExportBoardRequest: onBoard,
          }),
        ),
    });
    app.mount(container!);
    await nextTick();

    container!
      .querySelector('canvas-section')!
      .dispatchEvent(new CustomEvent('export-request', { detail: { format: 'svg' } }));

    expect(onExport).toHaveBeenCalledWith('svg');
    expect(onBoard).not.toHaveBeenCalled();
  });
});
