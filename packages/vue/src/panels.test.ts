// @vitest-environment jsdom
import { createApp, h, nextTick, ref, shallowRef } from 'vue';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import type {
  CanvasLayersElement,
  CanvasPropertiesElement,
  CanvasToolbarElement,
} from '@canvash/web-components';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  CanvasControls,
  CanvasLayers,
  CanvasProperties,
  CanvasSelectionMenu,
  CanvasSection,
  CanvasToolbar,
} from './panels.js';

/** O que o mini-menu usa do `<canvas-surface>`, sem elemento de verdade. */
function fakeSelectionCanvas() {
  return {
    interactionState: 'idle' as const,
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    addEventListener() {},
    removeEventListener() {},
  };
}

describe('Vue Panel Wrappers', () => {
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

  it('CanvasToolbar sincroniza section e orientation reativamente', async () => {
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const currentSection = shallowRef<CanvasSectionApi | undefined>(sectionA);
    const orientation = ref<'horizontal' | 'vertical' | undefined>('horizontal');

    app = createApp({
      render: () =>
        h(CanvasToolbar, {
          section: currentSection.value,
          orientation: orientation.value,
        }),
    });
    app.mount(container!);
    await nextTick();

    const el = container!.querySelector('canvas-toolbar') as CanvasToolbarElement;
    expect(el).not.toBeNull();
    expect(el.section).toBe(sectionA);
    expect(el.orientation).toBe('horizontal');

    orientation.value = 'vertical';
    currentSection.value = sectionB;
    await nextTick();

    expect(el.section).toBe(sectionB);
    expect(el.orientation).toBe('vertical');

    // Transição para undefined
    orientation.value = undefined;
    currentSection.value = undefined;
    await nextTick();

    expect(el.section).toBeUndefined();
    expect(el.orientation).toBe('horizontal');
  });

  it('CanvasToolbar funciona sem props fornecidas', async () => {
    app = createApp({
      render: () => h(CanvasToolbar),
    });
    app.mount(container!);
    await nextTick();

    const el = container!.querySelector('canvas-toolbar') as CanvasToolbarElement;
    expect(el).not.toBeNull();
    expect(el.section).toBeUndefined();
    expect(el.orientation).toBe('horizontal');
  });

  it('CanvasLayers sincroniza section reativamente e no mount direto', async () => {
    const section = createCanvasSection();
    const currentSection = shallowRef<CanvasSectionApi | undefined>(undefined);

    app = createApp({
      render: () => h(CanvasLayers, { section: currentSection.value }),
    });
    app.mount(container!);
    await nextTick();

    const el = container!.querySelector('canvas-layers') as CanvasLayersElement;
    expect(el).not.toBeNull();
    expect(el.section).toBeUndefined();

    currentSection.value = section;
    await nextTick();

    expect(el.section).toBe(section);

    currentSection.value = undefined;
    await nextTick();
    expect(el.section).toBeUndefined();

    app.unmount();
    app = createApp({
      render: () => h(CanvasLayers, { section }),
    });
    app.mount(container!);
    await nextTick();
    const el2 = container!.querySelector('canvas-layers') as CanvasLayersElement;
    expect(el2.section).toBe(section);
  });

  it('CanvasProperties sincroniza section reativamente e no mount direto', async () => {
    const section = createCanvasSection();
    const currentSection = shallowRef<CanvasSectionApi | undefined>(undefined);

    app = createApp({
      render: () => h(CanvasProperties, { section: currentSection.value }),
    });
    app.mount(container!);
    await nextTick();

    const el = container!.querySelector('canvas-properties') as CanvasPropertiesElement;
    expect(el).not.toBeNull();
    expect(el.section).toBeUndefined();

    currentSection.value = section;
    await nextTick();

    expect(el.section).toBe(section);

    currentSection.value = undefined;
    await nextTick();
    expect(el.section).toBeUndefined();

    app.unmount();
    app = createApp({
      render: () => h(CanvasProperties, { section }),
    });
    app.mount(container!);
    await nextTick();
    const el2 = container!.querySelector('canvas-properties') as CanvasPropertiesElement;
    expect(el2.section).toBe(section);
  });
  it('CanvasControls sincroniza section e canvas reativamente', async () => {
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const currentSection = shallowRef<CanvasSectionApi | undefined>(sectionA);
    const canvasA = { zoomBy() {}, zoomTo() {}, fitToContent() {}, fitToSelection() {} };
    const canvasB = { zoomBy() {}, zoomTo() {}, fitToContent() {}, fitToSelection() {} };
    const currentCanvas = shallowRef<typeof canvasA | undefined>(canvasA);

    app = createApp({
      render: () =>
        h(CanvasControls, { section: currentSection.value, canvas: currentCanvas.value }),
    });
    app.mount(container!);
    await nextTick();

    const el = container?.querySelector('canvas-controls') as HTMLElement & {
      section?: unknown;
      canvas?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(sectionA);
    expect(el.canvas).toBe(canvasA);

    currentSection.value = sectionB;
    currentCanvas.value = canvasB;
    await nextTick();
    expect(el.section).toBe(sectionB);
    expect(el.canvas).toBe(canvasB);

    currentSection.value = undefined;
    currentCanvas.value = undefined;
    await nextTick();
    expect(el.section).toBeUndefined();
    expect(el.canvas).toBeUndefined();
  });
  it('CanvasToolbar repassa hideHistory, hideZoom e compactReadonly ao elemento', async () => {
    const hide = ref(true);

    app = createApp({
      render: () =>
        h(CanvasToolbar, {
          hideHistory: hide.value,
          hideZoom: hide.value,
          compactReadonly: hide.value,
        }),
    });
    app.mount(container!);
    await nextTick();

    const el = container?.querySelector('canvas-toolbar') as HTMLElement & {
      hideHistory?: boolean;
      hideZoom?: boolean;
      compactReadonly?: boolean;
    };
    expect(el.hideHistory).toBe(true);
    expect(el.hideZoom).toBe(true);
    expect(el.compactReadonly).toBe(true);

    hide.value = false;
    await nextTick();
    expect(el.hideHistory).toBe(false);
    expect(el.hideZoom).toBe(false);
    expect(el.compactReadonly).toBe(false);
  });
  it('CanvasSection renderiza <canvas-section> com section, título e filhos nos slots', async () => {
    const section = createCanvasSection();

    app = createApp({
      render: () =>
        h(CanvasSection, { section, projectTitle: 'Plano' }, () => [
          h('div', { slot: 'menu', id: 'conteudo-menu' }),
          h(CanvasToolbar, { slot: 'toolbar' }),
        ]),
    });
    app.mount(container!);
    await nextTick();

    const el = container?.querySelector('canvas-section') as HTMLElement & {
      section?: unknown;
      projectTitle?: string;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.projectTitle).toBe('Plano');
    expect(el.querySelector('#conteudo-menu')?.getAttribute('slot')).toBe('menu');
    expect(el.querySelector('canvas-toolbar')?.getAttribute('slot')).toBe('toolbar');
  });

  it('CanvasSection sincroniza section e título reativamente', async () => {
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const currentSection = shallowRef<CanvasSectionApi | undefined>(sectionA);
    const title = ref('A');

    app = createApp({
      render: () => h(CanvasSection, { section: currentSection.value, projectTitle: title.value }),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement & {
      section?: unknown;
      projectTitle?: string;
    };

    currentSection.value = sectionB;
    title.value = 'B';
    await nextTick();
    expect(el.section).toBe(sectionB);
    expect(el.projectTitle).toBe('B');

    currentSection.value = undefined;
    await nextTick();
    expect(el.section).toBeUndefined();
  });

  it('CanvasSection emite title-change e menu-toggle e remove os ouvintes ao desmontar', async () => {
    const onTitle = vi.fn();
    const onToggle = vi.fn();

    app = createApp({
      render: () =>
        h(CanvasSection, { onTitleChange: onTitle, onMenuToggle: onToggle } as Record<
          string,
          unknown
        >),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('title-change', { detail: { title: 'Novo' } }));
    el.dispatchEvent(new CustomEvent('menu-toggle', { detail: { open: true } }));
    expect(onTitle).toHaveBeenCalledWith('Novo');
    expect(onToggle).toHaveBeenCalledWith(true);

    app.unmount();
    app = null;
    expect(remove).toHaveBeenCalledWith('title-change', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('menu-toggle', expect.any(Function));
  });

  it('CanvasToolbar repassa o conteúdo padrão, por exemplo um botão no slot end', async () => {
    app = createApp({
      render: () =>
        h(CanvasToolbar, { slot: 'toolbar' }, () =>
          h('button', { slot: 'end', id: 'btn-extra', type: 'button' }, 'Extra'),
        ),
    });
    app.mount(container!);
    await nextTick();

    const extra = container?.querySelector('canvas-toolbar > #btn-extra');
    expect(extra?.getAttribute('slot')).toBe('end');
    expect(extra?.textContent).toBe('Extra');
  });

  it('CanvasSection atribui menuItems, user, hideExport e hideShare como propriedades e acompanha as trocas', async () => {
    const itemsA = [{ id: 'new', label: 'Novo projeto' }];
    const itemsB = [{ id: 'open', label: 'Abrir projeto…' }];
    const items = shallowRef(itemsA);
    const user = shallowRef<{ name: string; avatarUrl?: string } | undefined>({ name: 'Ana' });
    const hidden = ref(true);

    app = createApp({
      render: () =>
        h(CanvasSection, {
          menuItems: items.value,
          user: user.value,
          hideExport: hidden.value,
          hideShare: hidden.value,
        }),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement & {
      menuItems?: unknown;
      user?: unknown;
      hideExport?: boolean;
      hideShare?: boolean;
    };

    expect(el.menuItems).toBe(itemsA);
    expect(el.user).toEqual({ name: 'Ana' });
    expect(el.hideExport).toBe(true);
    expect(el.hideShare).toBe(true);
    expect(el.hasAttribute('menu-items')).toBe(false);

    items.value = itemsB;
    user.value = undefined;
    hidden.value = false;
    await nextTick();
    expect(el.menuItems).toBe(itemsB);
    expect(el.user).toBeUndefined();
    expect(el.hideExport).toBe(false);
    expect(el.hideShare).toBe(false);
  });

  it('CanvasSection sem as props novas usa os padrões', async () => {
    app = createApp({ render: () => h(CanvasSection) });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement & {
      menuItems?: unknown;
      user?: unknown;
      hideExport?: boolean;
      hideShare?: boolean;
    };

    expect(el.menuItems).toEqual([]);
    expect(el.user).toBeUndefined();
    expect(el.hideExport).toBe(false);
    expect(el.hideShare).toBe(false);
  });

  it('CanvasSection emite menu-select, export-request, share-request e avatar-click e remove os ouvintes ao desmontar', async () => {
    const onMenuSelect = vi.fn();
    const onExportRequest = vi.fn();
    const onShareRequest = vi.fn();
    const onAvatarClick = vi.fn();

    app = createApp({
      render: () =>
        h(CanvasSection, {
          onMenuSelect,
          onExportRequest,
          onShareRequest,
          onAvatarClick,
        } as Record<string, unknown>),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('menu-select', { detail: { id: 'open' } }));
    el.dispatchEvent(new CustomEvent('export-request', { detail: { format: 'png' } }));
    el.dispatchEvent(new CustomEvent('share-request', { detail: {} }));
    el.dispatchEvent(new CustomEvent('avatar-click', { detail: {} }));
    expect(onMenuSelect).toHaveBeenCalledWith('open');
    expect(onExportRequest).toHaveBeenCalledWith('png');
    expect(onShareRequest).toHaveBeenCalledTimes(1);
    expect(onAvatarClick).toHaveBeenCalledTimes(1);

    app.unmount();
    app = null;
    for (const type of ['menu-select', 'export-request', 'share-request', 'avatar-click']) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
    }
  });

  it('CanvasSection passa sharing ao elemento e acompanha as trocas', async () => {
    const sharing = ref<'off' | 'connecting' | 'on'>('connecting');
    app = createApp({ render: () => h(CanvasSection, { sharing: sharing.value }) });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement & { sharing?: string };

    expect(el.sharing).toBe('connecting');
    sharing.value = 'on';
    await nextTick();
    expect(el.sharing).toBe('on');
  });

  it('CanvasSection emite o detalhe do share-request e share-stop uma vez por evento', async () => {
    const onShareRequest = vi.fn();
    const onShareStop = vi.fn();
    app = createApp({
      render: () => h(CanvasSection, { onShareRequest, onShareStop } as Record<string, unknown>),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('share-request', { detail: { sharing: 'on' } }));
    el.dispatchEvent(new CustomEvent('share-stop', { detail: {} }));
    expect(onShareRequest).toHaveBeenCalledWith({ sharing: 'on' });
    expect(onShareStop).toHaveBeenCalledTimes(1);

    app.unmount();
    app = null;
    expect(remove).toHaveBeenCalledWith('share-stop', expect.any(Function));
  });

  it('CanvasSection passa participants e hideParticipants ao elemento e acompanha as trocas', async () => {
    const participants = [
      { id: 'eu', name: 'Pessoa', color: '#2563eb', self: true },
      { id: 'a', name: 'Ana', color: '#dc2626' },
    ];
    const list = shallowRef<typeof participants | undefined>(participants);
    const hidden = ref(true);
    app = createApp({
      render: () =>
        h(CanvasSection, { participants: list.value, hideParticipants: hidden.value } as Record<
          string,
          unknown
        >),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement & {
      participants?: unknown;
      hideParticipants?: boolean;
    };
    expect(el.participants).toBe(participants);
    expect(el.hideParticipants).toBe(true);

    const next = [...participants, { id: 'b', name: 'Caio', color: '#16a34a' }];
    list.value = next;
    hidden.value = false;
    await nextTick();
    expect(el.participants).toBe(next);
    expect(el.hideParticipants).toBe(false);

    list.value = undefined;
    await nextTick();
    expect(el.participants).toEqual([]);
  });

  it('CanvasSection passa following ao elemento e emite follow-change', async () => {
    const following = ref<string | null>('a');
    const onFollowChange = vi.fn();
    app = createApp({
      render: () =>
        h(CanvasSection, { following: following.value, onFollowChange } as Record<string, unknown>),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-section') as HTMLElement & { following?: unknown };
    expect(el.following).toBe('a');

    following.value = null;
    await nextTick();
    expect(el.following).toBeNull();

    el.dispatchEvent(new CustomEvent('follow-change', { detail: { sessionId: 'b' } }));
    expect(onFollowChange).toHaveBeenCalledWith('b');

    app.unmount();
    app = null;
    el.dispatchEvent(new CustomEvent('follow-change', { detail: { sessionId: 'c' } }));
    expect(onFollowChange).toHaveBeenCalledTimes(1);
  });

  it('CanvasSelectionMenu renderiza <canvas-selection-menu> com section, canvas e o painel no slot', async () => {
    const section = createCanvasSection();
    const canvas = fakeSelectionCanvas();

    app = createApp({
      render: () =>
        h(CanvasSelectionMenu, { section, canvas, slot: 'overlay' }, () =>
          h(CanvasProperties, { slot: 'properties' }),
        ),
    });
    app.mount(container!);
    await nextTick();

    const el = container?.querySelector('canvas-selection-menu') as HTMLElement & {
      section?: unknown;
      canvas?: unknown;
    };
    expect(el).not.toBeNull();
    expect(el.section).toBe(section);
    expect(el.canvas).toBe(canvas);
    expect(el.getAttribute('slot')).toBe('overlay');
    expect(el.querySelector('canvas-properties')?.getAttribute('slot')).toBe('properties');
  });

  it('CanvasSelectionMenu sincroniza section e canvas reativamente', async () => {
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const currentSection = shallowRef<CanvasSectionApi | undefined>(sectionA);
    const canvasA = fakeSelectionCanvas();
    const canvasB = fakeSelectionCanvas();
    const currentCanvas = shallowRef<typeof canvasA | undefined>(canvasA);

    app = createApp({
      render: () =>
        h(CanvasSelectionMenu, { section: currentSection.value, canvas: currentCanvas.value }),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-selection-menu') as HTMLElement & {
      section?: unknown;
      canvas?: unknown;
    };
    expect(el.section).toBe(sectionA);
    expect(el.canvas).toBe(canvasA);

    currentSection.value = sectionB;
    currentCanvas.value = canvasB;
    await nextTick();
    expect(el.section).toBe(sectionB);
    expect(el.canvas).toBe(canvasB);

    currentSection.value = undefined;
    currentCanvas.value = undefined;
    await nextTick();
    expect(el.section).toBeUndefined();
    expect(el.canvas).toBeUndefined();
  });

  it('CanvasToolbar emite properties-panel-toggle e remove o ouvinte ao desmontar', async () => {
    const onToggle = vi.fn();

    app = createApp({
      render: () =>
        h(CanvasToolbar, { onPropertiesPanelToggle: onToggle } as Record<string, unknown>),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-toolbar') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('properties-panel-toggle', { detail: { open: true } }));
    expect(onToggle).toHaveBeenCalledWith(true);

    app.unmount();
    app = null;
    expect(remove).toHaveBeenCalledWith('properties-panel-toggle', expect.any(Function));
  });

  it('CanvasToolbar sincroniza propertiesOpen com o elemento', async () => {
    const open = ref(true);
    app = createApp({ render: () => h(CanvasToolbar, { propertiesOpen: open.value }) });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-toolbar') as HTMLElement & {
      propertiesOpen: boolean;
    };
    expect(el.propertiesOpen).toBe(true);

    open.value = false;
    await nextTick();
    expect(el.propertiesOpen).toBe(false);
  });

  it('CanvasToolbar emite os eventos de nota, caneta e borracha e remove os ouvintes ao desmontar', async () => {
    const sticky = vi.fn();
    const pen = vi.fn();
    const eraser = vi.fn();

    app = createApp({
      render: () =>
        h(CanvasToolbar, {
          onStickyColorChange: sticky,
          onPenSettingsChange: pen,
          onEraserSizeChange: eraser,
        } as Record<string, unknown>),
    });
    app.mount(container!);
    await nextTick();
    const el = container?.querySelector('canvas-toolbar') as HTMLElement;
    const remove = vi.spyOn(el, 'removeEventListener');

    el.dispatchEvent(new CustomEvent('sticky-color-change', { detail: { color: '#fff' } }));
    el.dispatchEvent(
      new CustomEvent('pen-settings-change', { detail: { settings: { kind: 'pen' } } }),
    );
    el.dispatchEvent(new CustomEvent('eraser-size-change', { detail: { size: 'thick' } }));
    expect(sticky).toHaveBeenCalledWith({ color: '#fff' });
    expect(pen).toHaveBeenCalledWith({ settings: { kind: 'pen' } });
    expect(eraser).toHaveBeenCalledWith({ size: 'thick' });

    app.unmount();
    app = null;
    for (const type of ['sticky-color-change', 'pen-settings-change', 'eraser-size-change']) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
    }
  });
});
