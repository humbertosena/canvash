// @vitest-environment jsdom
import { createApp, h } from 'vue';
import { createCanvasSection } from '@canvash/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CanvasSurface,
  CanvasControls,
  CanvasSelectionMenu,
  CanvasLayers,
  CanvasSection,
  CanvasProperties,
  CanvasToolbar,
  useCanvasSnapshot,
} from './ssr.js';

describe('Vue SSR placeholders', () => {
  let container: HTMLDivElement | null = null;
  let app: ReturnType<typeof createApp> | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('renderiza placeholders estáticos com atributos data-canvash-ssr', () => {
    app = createApp({
      render: () =>
        h('div', [
          h(CanvasToolbar),
          h(CanvasSurface, { ariaLabel: 'SSR Canvas' }),
          h(CanvasLayers),
          h(CanvasProperties),
        ]),
    });
    app.mount(container!);

    const placeholders = container!.querySelectorAll('[data-canvash-ssr]');
    expect(placeholders.length).toBe(4);

    const canvas = container!.querySelector('.canvash-placeholder');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-label')).toBe('SSR Canvas');
    expect(canvas?.getAttribute('role')).toBe('region');
  });

  it('renderiza o placeholder dos controles do canvas', () => {
    app = createApp({ render: () => h(CanvasControls) });
    app.mount(container!);

    const placeholder = container!.querySelector('.canvash-controls-placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('data-canvash-ssr')).toBe('true');
  });

  it('renderiza o placeholder do mini-menu da seleção', () => {
    app = createApp({ render: () => h(CanvasSelectionMenu) });
    app.mount(container!);

    const placeholder = container!.querySelector('.canvash-selection-menu-placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('data-canvash-ssr')).toBe('true');
  });

  it('renderiza o placeholder do shell com os filhos', () => {
    app = createApp({
      render: () => h(CanvasSection, null, () => h(CanvasSurface, { ariaLabel: 'No shell' })),
    });
    app.mount(container!);

    const shell = container!.querySelector('.canvash-shell-placeholder');
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute('data-canvash-ssr')).toBe('true');
    expect(shell?.querySelector('.canvash-placeholder')?.getAttribute('aria-label')).toBe(
      'No shell',
    );
  });

  it('o placeholder do shell consome menuItems, user, hideExport e hideShare sem vazá-los como atributos', () => {
    app = createApp({
      render: () =>
        h(CanvasSection, {
          menuItems: [{ id: 'new', label: 'Novo' }],
          user: { name: 'Ana' },
          hideExport: true,
          hideShare: true,
        }),
    });
    app.mount(container!);

    const shell = container!.querySelector('.canvash-shell-placeholder');
    expect(shell).not.toBeNull();
    expect([...(shell?.getAttributeNames() ?? [])].sort()).toEqual(['class', 'data-canvash-ssr']);
  });

  it('useCanvasSnapshot SSR retorna snapshot estático ou null', () => {
    const emptySnap = useCanvasSnapshot();
    expect(emptySnap.value).toBeNull();

    const section = createCanvasSection();
    const snap = useCanvasSnapshot(section);
    expect(snap.value).not.toBeNull();
    expect(snap.value?.revision).toBe(0);
  });
});
