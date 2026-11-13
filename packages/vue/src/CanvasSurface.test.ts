// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import type { CanvasSurfaceElement } from '@canvash/web-components';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSurface, type CanvasSurfaceInstance } from './CanvasSurface.js';

describe('CanvasSurface (Vue Component)', () => {
  let container: HTMLDivElement | null = null;
  let app: ReturnType<typeof createApp> | null = null;
  let getContextSpy: { mockRestore(): void } | null = null;

  beforeEach(() => {
    // O jsdom não implementa canvas 2D; sem o espião, cada render imprime "Not implemented".
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    getContextSpy?.mockRestore();
    getContextSpy = null;
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('lança TypeError se canvas externo e initialDocument forem combinados', () => {
    const section = createCanvasSection();
    const doc = section.getSnapshot().document;

    expect(() => {
      app = createApp({
        render: () => h(CanvasSurface, { section, initialDocument: doc }),
      });
      app.mount(container!);
    }).toThrow(TypeError);
  });

  it('no modo interno cria uma instância própria e expõe métodos e propriedades', async () => {
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);

    const Host = defineComponent({
      setup() {
        return () =>
          h(CanvasSurface, {
            ref: canvasRef,
            grid: true,
            gridSize: 30,
            ariaLabel: 'Vue Test Canvas',
          });
      },
    });

    app = createApp(Host);
    app.mount(container!);
    await nextTick();

    const instance = canvasRef.value;
    expect(instance).not.toBeNull();
    expect(instance?.section).not.toBeNull();
    expect(instance?.element).not.toBeNull();
    expect(instance?.element?.tagName.toLowerCase()).toBe('canvas-surface');

    const el = instance?.element as CanvasSurfaceElement;
    expect(el.grid).toBe(true);
    expect(el.gridSize).toBe(30);
    expect(el.ariaLabel).toBe('Vue Test Canvas');

    // Métodos expostos
    const focusSpy = vi.spyOn(el, 'focus');
    instance?.focus();
    expect(focusSpy).toHaveBeenCalled();

    const fitSpy = vi.spyOn(el, 'fitToContent');
    instance?.fitToContent({ padding: 15 });
    expect(fitSpy).toHaveBeenCalledWith({ padding: 15 });

    const zoomBySpy = vi.spyOn(el, 'zoomBy');
    instance?.zoomBy(1.2);
    expect(zoomBySpy).toHaveBeenCalledWith(1.2);

    const zoomToSpy = vi.spyOn(el, 'zoomTo');
    instance?.zoomTo(2);
    expect(zoomToSpy).toHaveBeenCalledWith(2);

    const selectionSpy = vi.spyOn(el, 'fitToSelection');
    instance?.fitToSelection({ padding: 10 });
    expect(selectionSpy).toHaveBeenCalledWith({ padding: 10 });
  });

  it('no modo interno aceita initialDocument', async () => {
    const base = createCanvasSection();
    base.dispatch({
      type: 'shape.create',
      shape: {
        id: 'init-shape',
        type: 'rectangle',
        x: 15,
        y: 15,
        width: 40,
        height: 40,
        rotation: 0,
      },
    });
    const initialDoc = base.getSnapshot().document;

    const canvasRef = ref<CanvasSurfaceInstance | null>(null);
    app = createApp({
      render: () => h(CanvasSurface, { ref: canvasRef, initialDocument: initialDoc }),
    });
    app.mount(container!);
    await nextTick();

    const section = canvasRef.value?.section;
    expect(section?.getSnapshot().document.nodes['init-shape']).toBeDefined();
  });

  it('no modo externo usa a instância fornecida e não a destrói no unmount', async () => {
    const externalSection = createCanvasSection();
    const destroySpy = vi.spyOn(externalSection, 'destroy');
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);

    app = createApp({
      render: () => h(CanvasSurface, { ref: canvasRef, section: externalSection }),
    });
    app.mount(container!);
    await nextTick();

    expect(canvasRef.value?.section).toBe(externalSection);

    app.unmount();
    app = null;

    // Canvas externo nunca deve ser destruído pelo wrapper (WC-05 / ADAPTER-03)
    expect(destroySpy).not.toHaveBeenCalled();
    expect(externalSection.getSnapshot().revision).toBe(0);
  });

  it('no modo interno destrói a instância no unmount', async () => {
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);

    app = createApp({
      render: () => h(CanvasSurface, { ref: canvasRef }),
    });
    app.mount(container!);
    await nextTick();

    const section = canvasRef.value?.section as CanvasSectionApi;
    expect(section).toBeDefined();
    const destroySpy = vi.spyOn(section, 'destroy');

    app.unmount();
    app = null;

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('reage a alterações de props (readOnly, grid, gridSize, section)', async () => {
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const currentSection = shallowRef<CanvasSectionApi | undefined>(sectionA);
    const readOnly = ref(false);
    const grid = ref(false);
    const gridSize = ref(20);
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);

    app = createApp({
      render: () =>
        h(CanvasSurface, {
          ref: canvasRef,
          section: currentSection.value,
          readOnly: readOnly.value,
          grid: grid.value,
          gridSize: gridSize.value,
        }),
    });
    app.mount(container!);
    await nextTick();

    const el = canvasRef.value?.element as CanvasSurfaceElement;
    expect(el.section).toBe(sectionA);
    expect(el.readOnly).toBe(false);
    expect(el.grid).toBe(false);
    expect(el.gridSize).toBe(20);

    // Muta props
    readOnly.value = true;
    grid.value = true;
    gridSize.value = 50;
    currentSection.value = sectionB;
    await nextTick();

    expect(el.section).toBe(sectionB);
    expect(el.readOnly).toBe(true);
    expect(el.grid).toBe(true);
    expect(el.gridSize).toBe(50);

    currentSection.value = undefined;
    await nextTick();
    expect(el.section).toBeUndefined();
  });

  it('repassa gridStyle ao elemento, com pontos como padrão, e reage à mudança', async () => {
    const gridStyle = ref<'dots' | 'lines' | undefined>(undefined);
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);

    app = createApp({
      render: () =>
        h(CanvasSurface, {
          ref: canvasRef,
          ...(gridStyle.value ? { gridStyle: gridStyle.value } : {}),
        }),
    });
    app.mount(container!);
    await nextTick();

    const el = canvasRef.value?.element as CanvasSurfaceElement;
    expect(el.gridStyle).toBe('dots');

    gridStyle.value = 'lines';
    await nextTick();
    expect(el.gridStyle).toBe('lines');
  });

  it('repassa gridHighlight ao elemento, ligado por padrão, e reage à mudança', async () => {
    const gridHighlight = ref<'on' | 'off' | undefined>(undefined);
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);

    app = createApp({
      render: () =>
        h(CanvasSurface, {
          ref: canvasRef,
          ...(gridHighlight.value ? { gridHighlight: gridHighlight.value } : {}),
        }),
    });
    app.mount(container!);
    await nextTick();

    const el = canvasRef.value?.element as CanvasSurfaceElement;
    expect(el.gridHighlight).toBe('on');
    expect(
      (CanvasSurface.props as Record<string, { default: unknown }>)['gridHighlight']?.default,
    ).toBe('on');

    gridHighlight.value = 'off';
    await nextTick();
    expect(el.gridHighlight).toBe('off');
  });

  it('emite text-edit-superseded ao host Vue e solta o ouvinte ao desmontar', async () => {
    const onTextEditSuperseded = vi.fn();
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);
    app = createApp({
      render: () =>
        h(CanvasSurface, { ref: canvasRef, onTextEditSuperseded } as Record<string, unknown>),
    });
    app.mount(container!);
    await nextTick();
    const el = canvasRef.value?.element as CanvasSurfaceElement;

    el.dispatchEvent(
      new CustomEvent('text-edit-superseded', { detail: { nodeId: 'n1', text: 'rascunho' } }),
    );
    expect(onTextEditSuperseded).toHaveBeenCalledWith({ nodeId: 'n1', text: 'rascunho' });

    app.unmount();
    app = null;
    el.dispatchEvent(
      new CustomEvent('text-edit-superseded', { detail: { nodeId: 'n1', text: 'outro' } }),
    );
    expect(onTextEditSuperseded).toHaveBeenCalledTimes(1);
  });

  it('remove os sete ouvintes do elemento ao desmontar', async () => {
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);
    app = createApp({
      render: () => h(CanvasSurface, { ref: canvasRef }),
    });
    app.mount(container!);
    await nextTick();
    const el = canvasRef.value?.element as CanvasSurfaceElement;
    const removeSpy = vi.spyOn(el, 'removeEventListener');

    app.unmount();
    app = null;

    expect(removeSpy.mock.calls.map(([type]) => type).sort()).toEqual([
      'canvas-error',
      'canvas-ready',
      'document-change',
      'selection-change',
      'text-edit-superseded',
      'tool-change',
      'viewport-change',
    ]);
  });

  it('ao desmontar, remove exatamente as funções que registrou ao montar', async () => {
    // O Vue ignora emit depois do unmount, então só os pares (tipo, função) mostram o vazamento.
    const adapterEvents = new Set([
      'canvas-error',
      'canvas-ready',
      'document-change',
      'selection-change',
      'text-edit-superseded',
      'tool-change',
      'viewport-change',
    ]);
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const canvasRef = ref<CanvasSurfaceInstance | null>(null);
    app = createApp({
      render: () => h(CanvasSurface, { ref: canvasRef }),
    });
    app.mount(container!);
    await nextTick();
    const el = canvasRef.value?.element as CanvasSurfaceElement;

    app.unmount();
    app = null;

    const pairsOn = (spy: typeof addSpy) =>
      spy.mock.calls
        .filter(([type], i) => spy.mock.contexts[i] === el && adapterEvents.has(type))
        .map(([type, listener]) => [type, listener] as const);
    const added = pairsOn(addSpy);
    const removed = pairsOn(removeSpy);
    addSpy.mockRestore();
    removeSpy.mockRestore();

    expect(added).toHaveLength(adapterEvents.size);
    expect(removed).toHaveLength(added.length);
    for (const [type, listener] of added) {
      expect(removed).toContainEqual([type, listener]);
    }
  });

  it('emite eventos para o host Vue ao disparar eventos customizados', async () => {
    const onCanvasReady = vi.fn();
    const onDocumentChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onViewportChange = vi.fn();
    const onToolChange = vi.fn();
    const onCanvasError = vi.fn();

    const canvasRef = ref<CanvasSurfaceInstance | null>(null);

    app = createApp({
      render: () =>
        h(CanvasSurface, {
          ref: canvasRef,
          onCanvasReady,
          onDocumentChange,
          onSelectionChange,
          onViewportChange,
          onToolChange,
          onCanvasError,
        }),
    });
    app.mount(container!);
    await nextTick();

    const el = canvasRef.value?.element as CanvasSurfaceElement;
    expect(el).not.toBeNull();

    // Limpa chamadas decorrentes do mount no JSDOM
    onCanvasReady.mockClear();
    onDocumentChange.mockClear();
    onSelectionChange.mockClear();
    onViewportChange.mockClear();
    onToolChange.mockClear();
    onCanvasError.mockClear();

    // Disparar eventos simulados
    el.dispatchEvent(new CustomEvent('canvas-ready', { detail: { section: {} } }));
    el.dispatchEvent(new CustomEvent('document-change', { detail: { revision: 1 } }));
    el.dispatchEvent(new CustomEvent('selection-change', { detail: { selectedIds: ['s1'] } }));
    el.dispatchEvent(
      new CustomEvent('viewport-change', {
        detail: { viewport: { x: 0, y: 0, zoom: 1 } },
      }),
    );
    el.dispatchEvent(new CustomEvent('tool-change', { detail: { tool: 'select' } }));
    el.dispatchEvent(new CustomEvent('canvas-error', { detail: { error: new Error('test') } }));

    expect(onCanvasReady).toHaveBeenCalledTimes(1);
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onToolChange).toHaveBeenCalledTimes(1);
    expect(onCanvasError).toHaveBeenCalledTimes(1);
  });
});
