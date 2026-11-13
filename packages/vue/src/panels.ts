import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  watch,
  type PropType,
} from 'vue';
import type { CanvasSectionApi } from '@canvash/core';
import type {
  CanvasControlsElement,
  CanvasLayersElement,
  CanvasPropertiesElement,
  CanvasSelectionMenuElement,
  CanvasSectionElement,
  CanvasToolbarElement,
  ExportBoardRequestEventDetail,
  ExportFormat,
  FollowChangeEventDetail,
  SelectionMenuCanvas,
  ShareRequestEventDetail,
  ShellMenuItem,
  ShellParticipant,
  ShellSharingState,
  ShellUser,
  ZoomTarget,
} from '@canvash/web-components';

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
    /** Esconde desfazer e refazer (por exemplo, com `CanvasControls` no layout). */
    hideHistory: {
      type: Boolean,
      default: false,
    },
    /** Esconde os controles de zoom. */
    hideZoom: {
      type: Boolean,
      default: false,
    },
    /** Em modo leitura, mostra só Seleção e Mão. */
    compactReadonly: {
      type: Boolean,
      default: false,
    },
    /** Painel de propriedades da toolbar aberto. Sem valor, o elemento decide. */
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
  setup(props, { emit, slots }) {
    const elRef = ref<CanvasToolbarElement | null>(null);

    const handlePanel = (event: Event): void => {
      emit('properties-panel-toggle', (event as CustomEvent<{ open: boolean }>).detail.open);
    };
    const handleSticky = (event: Event): void => {
      emit('sticky-color-change', (event as CustomEvent).detail);
    };
    const handlePen = (event: Event): void => {
      emit('pen-settings-change', (event as CustomEvent).detail);
    };
    const handleEraser = (event: Event): void => {
      emit('eraser-size-change', (event as CustomEvent).detail);
    };

    onMounted(() => {
      if (elRef.value) {
        elRef.value.section = props.section ? toRaw(props.section) : undefined;
        elRef.value.orientation = props.orientation;
        elRef.value.hideHistory = props.hideHistory;
        elRef.value.hideZoom = props.hideZoom;
        elRef.value.compactReadonly = props.compactReadonly;
        if (props.propertiesOpen !== undefined) elRef.value.propertiesOpen = props.propertiesOpen;
        elRef.value.addEventListener('properties-panel-toggle', handlePanel);
        elRef.value.addEventListener('sticky-color-change', handleSticky);
        elRef.value.addEventListener('pen-settings-change', handlePen);
        elRef.value.addEventListener('eraser-size-change', handleEraser);
      }
    });
    // Antes de desmontar: depois, o Vue já zerou a referência ao elemento.
    onBeforeUnmount(() => {
      elRef.value?.removeEventListener('properties-panel-toggle', handlePanel);
      elRef.value?.removeEventListener('sticky-color-change', handleSticky);
      elRef.value?.removeEventListener('pen-settings-change', handlePen);
      elRef.value?.removeEventListener('eraser-size-change', handleEraser);
    });

    watch(
      () =>
        [
          props.section,
          props.orientation,
          props.hideHistory,
          props.hideZoom,
          props.compactReadonly,
          props.propertiesOpen,
        ] as const,
      ([b, o, history, zoom, compact, propertiesOpen]) => {
        if (elRef.value) {
          elRef.value.section = b ? toRaw(b) : undefined;
          elRef.value.orientation = o ?? 'horizontal';
          elRef.value.hideHistory = history;
          elRef.value.hideZoom = zoom;
          elRef.value.compactReadonly = compact;
          if (propertiesOpen !== undefined) elRef.value.propertiesOpen = propertiesOpen;
        }
      },
    );

    return () =>
      h(
        'canvas-toolbar',
        {
          ref: elRef,
          orientation: props.orientation,
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
  setup(props) {
    const elRef = ref<CanvasLayersElement | null>(null);

    onMounted(() => {
      if (elRef.value) {
        elRef.value.section = props.section ? toRaw(props.section) : undefined;
      }
    });

    watch(
      () => props.section,
      (b) => {
        if (elRef.value) {
          elRef.value.section = b ? toRaw(b) : undefined;
        }
      },
    );

    return () =>
      h('canvas-layers', {
        ref: elRef,
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
  setup(props) {
    const elRef = ref<CanvasPropertiesElement | null>(null);

    onMounted(() => {
      if (elRef.value) {
        elRef.value.section = props.section ? toRaw(props.section) : undefined;
      }
    });

    watch(
      () => props.section,
      (b) => {
        if (elRef.value) {
          elRef.value.section = b ? toRaw(b) : undefined;
        }
      },
    );

    return () =>
      h('canvas-properties', {
        ref: elRef,
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
    /** O `<canvas-surface>` do mesmo canvas: ancora o zoom e habilita os enquadramentos. */
    canvas: {
      type: Object as PropType<ZoomTarget>,
      default: undefined,
    },
  },
  setup(props) {
    const elRef = ref<CanvasControlsElement | null>(null);

    const sync = (): void => {
      // O elemento existe sempre que isto roda: depois de montar e enquanto os observadores
      // vivem, que o Vue para antes de desmontá-lo.
      const el = elRef.value!;
      el.section = props.section ? toRaw(props.section) : undefined;
      el.canvas = props.canvas ? toRaw(props.canvas) : undefined;
    };

    onMounted(sync);
    watch(() => [props.section, props.canvas], sync);

    return () =>
      h('canvas-controls', {
        ref: elRef,
      });
  },
});

export const CanvasSection = defineComponent({
  name: 'CanvasSection',
  props: {
    /** Só para o shell saber do modo leitura: em leitura o título não se edita. */
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
    /** Título do projeto. O shell só o exibe: atualize-o em `title-change`, se aceitar a mudança. */
    projectTitle: {
      type: String,
      default: '',
    },
    /**
     * Itens do menu hambúrguer, desenhados antes do conteúdo do slot `menu`. Atribua outro array
     * para mudar a lista: mexer no mesmo array não redesenha.
     */
    menuItems: {
      type: Array as PropType<readonly ShellMenuItem[]>,
      default: undefined,
    },
    /** Pessoa logada: mostra o avatar depois da pill Exportar. Sem ela, não há avatar. */
    user: {
      type: Object as PropType<ShellUser>,
      default: undefined,
    },
    /** Esconde a pill Exportar. */
    hideExport: {
      type: Boolean,
      default: false,
    },
    /** Esconde a pill Compartilhar. */
    hideShare: {
      type: Boolean,
      default: false,
    },
    /** Estado do compartilhamento ao vivo: o ponto de status e o nome acessível da pill. */
    sharing: {
      type: String as PropType<ShellSharingState>,
      default: 'off',
    },
    /**
     * Participantes da sessão, a pessoa local (`self`) incluída: a pilha de avatares e a ilha
     * aparecem com `sharing = 'on'` e pelo menos uma outra pessoa. Atribua outro array para mudar
     * a lista: mexer no mesmo array não redesenha.
     */
    participants: {
      type: Array as PropType<readonly ShellParticipant[]>,
      default: undefined,
    },
    /** Esconde a pilha de avatares mesmo com participantes. */
    hideParticipants: {
      type: Boolean,
      default: false,
    },
    /** `id` da pessoa que a sessão local segue, ou `null`: a faixa, a moldura e o botão Seguindo. */
    following: {
      type: String as PropType<string | null>,
      default: null,
    },
  },
  emits: [
    'title-change',
    'menu-toggle',
    'menu-select',
    'export-request',
    'share-request',
    'share-stop',
    'follow-change',
    'avatar-click',
  ],
  setup(props, { emit, slots }) {
    const elRef = ref<CanvasSectionElement | null>(null);

    const sync = (): void => {
      // O elemento existe sempre que isto roda: depois de montar e enquanto os observadores
      // vivem, que o Vue para antes de desmontá-lo.
      const el = elRef.value!;
      el.section = props.section ? toRaw(props.section) : undefined;
      el.projectTitle = props.projectTitle;
      el.menuItems = props.menuItems ? toRaw(props.menuItems) : [];
      el.user = props.user ? toRaw(props.user) : undefined;
      el.hideExport = props.hideExport;
      el.hideShare = props.hideShare;
      el.sharing = props.sharing;
      el.participants = props.participants ? toRaw(props.participants) : [];
      el.hideParticipants = props.hideParticipants;
      el.following = props.following;
    };

    const handleTitle = (event: Event): void => {
      emit('title-change', (event as CustomEvent<{ title: string }>).detail.title);
    };
    const handleMenu = (event: Event): void => {
      emit('menu-toggle', (event as CustomEvent<{ open: boolean }>).detail.open);
    };
    const handleSelect = (event: Event): void => {
      emit('menu-select', (event as CustomEvent<{ id: string }>).detail.id);
    };
    const handleExport = (event: Event): void => {
      emit('export-request', (event as CustomEvent<{ format: ExportFormat }>).detail.format);
    };
    const handleShare = (event: Event): void => {
      emit('share-request', (event as CustomEvent<ShareRequestEventDetail>).detail);
    };
    const handleShareStop = (): void => emit('share-stop');
    const handleFollow = (event: Event): void => {
      emit('follow-change', (event as CustomEvent<FollowChangeEventDetail>).detail.sessionId);
    };
    const handleAvatar = (): void => emit('avatar-click');

    onMounted(() => {
      sync();
      elRef.value!.addEventListener('title-change', handleTitle);
      elRef.value!.addEventListener('menu-toggle', handleMenu);
      elRef.value!.addEventListener('menu-select', handleSelect);
      elRef.value!.addEventListener('export-request', handleExport);
      elRef.value!.addEventListener('share-request', handleShare);
      elRef.value!.addEventListener('share-stop', handleShareStop);
      elRef.value!.addEventListener('follow-change', handleFollow);
      elRef.value!.addEventListener('avatar-click', handleAvatar);
    });
    // Antes de desmontar: depois, o Vue já zerou a referência ao elemento.
    onBeforeUnmount(() => {
      elRef.value?.removeEventListener('title-change', handleTitle);
      elRef.value?.removeEventListener('menu-toggle', handleMenu);
      elRef.value?.removeEventListener('menu-select', handleSelect);
      elRef.value?.removeEventListener('export-request', handleExport);
      elRef.value?.removeEventListener('share-request', handleShare);
      elRef.value?.removeEventListener('share-stop', handleShareStop);
      elRef.value?.removeEventListener('follow-change', handleFollow);
      elRef.value?.removeEventListener('avatar-click', handleAvatar);
    });
    watch(
      () => [
        props.section,
        props.projectTitle,
        props.menuItems,
        props.user,
        props.hideExport,
        props.hideShare,
        props.sharing,
        props.participants,
        props.hideParticipants,
        props.following,
      ],
      sync,
    );

    return () => h('canvas-section', { ref: elRef }, slots.default?.());
  },
});

export const CanvasSelectionMenu = defineComponent({
  name: 'CanvasSelectionMenu',
  props: {
    section: {
      type: Object as PropType<CanvasSectionApi>,
      default: undefined,
    },
    /** O `<canvas-surface>` do mesmo canvas: dá o estado da interação, a caixa e o foco. */
    canvas: {
      type: Object as PropType<SelectionMenuCanvas>,
      default: undefined,
    },
    /** Mostra Exportar board com um board selecionado (`export-board`). */
    exportBoard: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['export-board-request'],
  setup(props, { emit, slots }) {
    const elRef = ref<CanvasSelectionMenuElement | null>(null);

    const sync = (): void => {
      // O elemento existe sempre que isto roda: depois de montar e enquanto os observadores
      // vivem, que o Vue para antes de desmontá-lo.
      const el = elRef.value!;
      el.section = props.section ? toRaw(props.section) : undefined;
      el.canvas = props.canvas ? toRaw(props.canvas) : undefined;
      el.exportBoard = props.exportBoard;
    };
    const handleExportBoard = (event: Event): void => {
      emit('export-board-request', (event as CustomEvent<ExportBoardRequestEventDetail>).detail);
    };

    onMounted(() => {
      sync();
      elRef.value!.addEventListener('export-board-request', handleExportBoard);
    });
    // Antes de desmontar: depois, o Vue já zerou a referência ao elemento.
    onBeforeUnmount(() => {
      elRef.value?.removeEventListener('export-board-request', handleExportBoard);
    });
    watch(() => [props.section, props.canvas, props.exportBoard], sync);

    return () => h('canvas-selection-menu', { ref: elRef }, slots.default?.());
  },
});
