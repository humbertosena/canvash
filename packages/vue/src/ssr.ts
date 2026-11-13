import { defineComponent, h, shallowReadonly, shallowRef, type PropType } from 'vue';
import type { CanvasSectionApi, CanvasDocument, CanvasSnapshot } from '@canvash/core';
import type {
  SelectionMenuCanvas,
  ShellMenuItem,
  ShellUser,
  ZoomTarget,
} from '@canvash/web-components';

export const CanvasSurface = defineComponent({
  name: 'CanvasSurface',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
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
    ariaLabel: {
      type: String,
      default: 'Canvash Canvas',
    },
  },
  setup(props) {
    return () =>
      h('div', {
        class: 'canvash-placeholder',
        role: 'region',
        'aria-label': props.ariaLabel,
        'data-canvash-ssr': 'true',
        style: {
          display: 'block',
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: '200px',
          backgroundColor: 'var(--canvash-bg, #ffffff)',
        },
      });
  },
});

export const CanvasToolbar = defineComponent({
  name: 'CanvasToolbar',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
    orientation: {
      type: String as PropType<'horizontal' | 'vertical'>,
      default: 'horizontal',
    },
    hideHistory: {
      type: Boolean,
      default: false,
    },
    hideZoom: {
      type: Boolean,
      default: false,
    },
    compactReadonly: {
      type: Boolean,
      default: false,
    },
    propertiesOpen: {
      type: Boolean,
      default: undefined,
    },
  },
  emits: [
    'properties-panel-toggle',
    'sticky-color-change',
    'pen-settings-change',
    'eraser-size-change',
  ],
  setup() {
    return () =>
      h('div', {
        class: 'canvash-toolbar-placeholder',
        'data-canvash-ssr': 'true',
      });
  },
});

export const CanvasControls = defineComponent({
  name: 'CanvasControls',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
    canvas: {
      type: Object as PropType<ZoomTarget>,
      default: undefined,
    },
  },
  setup() {
    return () =>
      h('div', {
        class: 'canvash-controls-placeholder',
        'data-canvash-ssr': 'true',
      });
  },
});

export const CanvasSelectionMenu = defineComponent({
  name: 'CanvasSelectionMenu',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
    canvas: {
      type: Object as PropType<SelectionMenuCanvas>,
      default: undefined,
    },
  },
  setup() {
    return () =>
      h('div', {
        class: 'canvash-selection-menu-placeholder',
        'data-canvash-ssr': 'true',
      });
  },
});

export const CanvasSection = defineComponent({
  name: 'CanvasSection',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
    projectTitle: {
      type: String,
      default: '',
    },
    menuItems: {
      type: Array as PropType<readonly ShellMenuItem[]>,
      default: undefined,
    },
    user: {
      type: Object as PropType<ShellUser>,
      default: undefined,
    },
    hideExport: {
      type: Boolean,
      default: false,
    },
    hideShare: {
      type: Boolean,
      default: false,
    },
  },
  emits: [
    'title-change',
    'menu-toggle',
    'menu-select',
    'export-request',
    'share-request',
    'avatar-click',
  ],
  setup(_props, { slots }) {
    return () =>
      h(
        'div',
        {
          class: 'canvash-shell-placeholder',
          'data-canvash-ssr': 'true',
        },
        slots.default?.(),
      );
  },
});

export const CanvasLayers = defineComponent({
  name: 'CanvasLayers',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
  },
  setup() {
    return () =>
      h('div', {
        class: 'canvash-layers-placeholder',
        'data-canvash-ssr': 'true',
      });
  },
});

export const CanvasProperties = defineComponent({
  name: 'CanvasProperties',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
  },
  setup() {
    return () =>
      h('div', {
        class: 'canvash-properties-placeholder',
        'data-canvash-ssr': 'true',
      });
  },
});

export function useCanvasSnapshot(
  section?: CanvasSectionApi | null,
): Readonly<{ value: CanvasSnapshot | null }> {
  return shallowReadonly(shallowRef(section ? section.getSnapshot() : null));
}
