import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  toRaw,
  watch,
  type PropType,
} from 'vue';
import { createCanvasSection, type CanvasSectionApi, type CanvasDocument } from '@canvash/core';
import {
  defineCanvasElements,
  type CanvasSurfaceElement,
  type CanvasErrorEventDetail,
  type TextEditSupersededEventDetail,
  type CanvasReadyEventDetail,
  type DocumentChangeEventDetail,
  type FitToContentOptions,
  type GridStyle,
  type SelectionChangeEventDetail,
  type ToolChangeEventDetail,
  type ViewportChangeEventDetail,
} from '@canvash/web-components';

// Garante registro idempotente no cliente
if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  defineCanvasElements();
}

export interface CanvasSurfaceInstance {
  readonly section: CanvasSectionApi | null;
  focus(options?: FocusOptions): void;
  fitToContent(options?: FitToContentOptions): void;
  /** Enquadra os nós selecionados; sem seleção, não faz nada. */
  fitToSelection(options?: FitToContentOptions): void;
  /** Multiplica o zoom por `factor`, mantendo no lugar o ponto central do canvas. */
  zoomBy(factor: number): void;
  /** Leva o zoom a `zoom` (dentro dos limites), mantendo no lugar o ponto central do canvas. */
  zoomTo(zoom: number): void;
  readonly element: CanvasSurfaceElement | null;
}

export const CanvasSurface = defineComponent({
  name: 'CanvasSurface',
  props: {
    /** Instância externa de canvas gerenciada pelo host. */
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
    /** Documento inicial para o modo interno. Não combina com canvas externo. */
    initialDocument: {
      type: Object as PropType<CanvasDocument>,
      default: undefined,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    grid: {
      type: Boolean,
      default: false,
    },
    gridSize: {
      type: Number,
      default: 20,
    },
    /** Aparência da grade: pontos (padrão) ou linhas. */
    gridStyle: {
      type: String as PropType<GridStyle>,
      default: 'dots',
    },
    /** Realce da grade sob o mouse: ligado (padrão) ou desligado. */
    gridHighlight: {
      type: String as PropType<'on' | 'off'>,
      default: 'on',
    },
    ariaLabel: {
      type: String,
      default: 'Canvash Canvas',
    },
  },
  emits: [
    'canvas-ready',
    'document-change',
    'selection-change',
    'viewport-change',
    'tool-change',
    'canvas-error',
    'text-edit-superseded',
  ],
  setup(props, { emit, expose }) {
    if (props.section && props.initialDocument) {
      throw new TypeError(
        'Cannot combine initialDocument with external section prop: initialDocument is only supported in internal mode.',
      );
    }

    const customElementRef = ref<CanvasSurfaceElement | null>(null);
    let internalSection: CanvasSectionApi | null = null;

    if (!props.section) {
      internalSection = createCanvasSection();
      if (props.initialDocument) {
        internalSection.replaceDocument(props.initialDocument);
      }
    }

    const effectiveSection = computed(() => props.section ?? internalSection);

    const handleCanvasReady = (e: Event) => {
      emit('canvas-ready', (e as CustomEvent<CanvasReadyEventDetail>).detail);
    };
    const handleDocumentChange = (e: Event) => {
      emit('document-change', (e as CustomEvent<DocumentChangeEventDetail>).detail);
    };
    const handleSelectionChange = (e: Event) => {
      emit('selection-change', (e as CustomEvent<SelectionChangeEventDetail>).detail);
    };
    const handleViewportChange = (e: Event) => {
      emit('viewport-change', (e as CustomEvent<ViewportChangeEventDetail>).detail);
    };
    const handleToolChange = (e: Event) => {
      emit('tool-change', (e as CustomEvent<ToolChangeEventDetail>).detail);
    };
    const handleCanvasError = (e: Event) => {
      emit('canvas-error', (e as CustomEvent<CanvasErrorEventDetail>).detail);
    };
    const handleTextEditSuperseded = (e: Event) => {
      emit('text-edit-superseded', (e as CustomEvent<TextEditSupersededEventDetail>).detail);
    };

    onMounted(() => {
      const el = customElementRef.value;
      if (!el) return;

      el.section = effectiveSection.value ? toRaw(effectiveSection.value) : undefined;
      el.readOnly = props.readOnly;
      el.grid = props.grid;
      el.gridSize = props.gridSize;
      el.gridStyle = props.gridStyle;
      el.gridHighlight = props.gridHighlight;
      el.ariaLabel = props.ariaLabel;

      el.addEventListener('canvas-ready', handleCanvasReady);
      el.addEventListener('document-change', handleDocumentChange);
      el.addEventListener('selection-change', handleSelectionChange);
      el.addEventListener('viewport-change', handleViewportChange);
      el.addEventListener('tool-change', handleToolChange);
      el.addEventListener('canvas-error', handleCanvasError);
      el.addEventListener('text-edit-superseded', handleTextEditSuperseded);
    });

    // Antes de desmontar: depois, o Vue já zerou a referência ao elemento.
    onBeforeUnmount(() => {
      customElementRef.value?.removeEventListener('canvas-ready', handleCanvasReady);
      customElementRef.value?.removeEventListener('document-change', handleDocumentChange);
      customElementRef.value?.removeEventListener('selection-change', handleSelectionChange);
      customElementRef.value?.removeEventListener('viewport-change', handleViewportChange);
      customElementRef.value?.removeEventListener('tool-change', handleToolChange);
      customElementRef.value?.removeEventListener('canvas-error', handleCanvasError);
      customElementRef.value?.removeEventListener('text-edit-superseded', handleTextEditSuperseded);
    });

    onUnmounted(() => {
      // No unmount, apenas instâncias internas são destruídas (WC-05 / ADAPTER-03)
      if (!props.section && internalSection) {
        internalSection.destroy();
        internalSection = null;
      }
    });

    watch(
      () => props.section,
      (newSection) => {
        const el = customElementRef.value;
        if (el) {
          el.section = newSection ? toRaw(newSection) : (internalSection ?? undefined);
        }
      },
    );

    watch(
      () => props.readOnly,
      (newVal) => {
        const el = customElementRef.value;
        if (el) el.readOnly = newVal;
      },
    );

    watch(
      () => [props.grid, props.gridSize, props.gridStyle, props.gridHighlight] as const,
      ([newGrid, newSize, newStyle, newHighlight]) => {
        const el = customElementRef.value;
        if (el) {
          el.grid = Boolean(newGrid);
          el.gridSize = Number(newSize);
          el.gridStyle = newStyle;
          el.gridHighlight = newHighlight;
        }
      },
    );

    expose({
      get section(): CanvasSectionApi | null {
        return effectiveSection.value;
      },
      focus(options?: FocusOptions) {
        customElementRef.value?.focus(options);
      },
      fitToContent(options?: FitToContentOptions) {
        customElementRef.value?.fitToContent(options);
      },
      fitToSelection(options?: FitToContentOptions) {
        customElementRef.value?.fitToSelection(options);
      },
      zoomBy(factor: number) {
        customElementRef.value?.zoomBy(factor);
      },
      zoomTo(zoom: number) {
        customElementRef.value?.zoomTo(zoom);
      },
      get element(): CanvasSurfaceElement | null {
        return customElementRef.value;
      },
    });

    return () =>
      h('canvas-surface', {
        ref: customElementRef,
        'aria-label': props.ariaLabel,
      });
  },
});
