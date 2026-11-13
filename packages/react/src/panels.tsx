import React, { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { CanvasSectionApi } from '@canvash/core';
import type {
  CanvasControlsElement,
  CanvasLayersElement,
  CanvasPropertiesElement,
  CanvasSelectionMenuElement,
  CanvasSectionElement,
  CanvasToolbarElement,
  EraserSizeChangeEventDetail,
  ExportBoardRequestEventDetail,
  FollowChangeEventDetail,
  ExportFormat,
  PenSettingsChangeEventDetail,
  SelectionMenuCanvas,
  ShareRequestEventDetail,
  ShellMenuItem,
  ShellParticipant,
  ShellSharingState,
  ShellUser,
  StickyColorChangeEventDetail,
  ZoomTarget,
} from '@canvash/web-components';

export interface CanvasToolbarProps {
  /** Região do `CanvasSection` que a ilha ocupa (por exemplo, `toolbar`, `left` ou `controls`). */
  slot?: string | undefined;
  section?: CanvasSectionApi | undefined;
  orientation?: 'horizontal' | 'vertical' | undefined;
  /** Esconde desfazer e refazer (por exemplo, com `CanvasControls` no layout). */
  hideHistory?: boolean | undefined;
  /** Esconde os controles de zoom. */
  hideZoom?: boolean | undefined;
  /** Em modo leitura, mostra só Seleção e Mão. */
  compactReadonly?: boolean | undefined;
  /** Painel de propriedades da toolbar aberto. Sem valor, o elemento decide. */
  propertiesOpen?: boolean | undefined;
  /** O painel de propriedades abriu (`true`) ou fechou. */
  onPropertiesPanelToggle?: ((open: boolean) => void) | undefined;
  /** A cor das próximas notas mudou. */
  onStickyColorChange?: ((detail: StickyColorChangeEventDetail) => void) | undefined;
  /** Tipo, espessura ou cor da caneta mudaram. */
  onPenSettingsChange?: ((detail: PenSettingsChangeEventDetail) => void) | undefined;
  /** O tamanho da borracha mudou. */
  onEraserSizeChange?: ((detail: EraserSizeChangeEventDetail) => void) | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /**
   * Conteúdo da toolbar: um filho com `slot="end"` fica depois de um divisor, no fim dela, e um
   * `CanvasProperties` com `slot="properties"` vai dentro do painel de propriedades.
   */
  children?: ReactNode;
}

export function CanvasToolbar(props: CanvasToolbarProps): React.ReactElement {
  const {
    section,
    orientation = 'horizontal',
    hideHistory = false,
    hideZoom = false,
    compactReadonly = false,
    propertiesOpen,
    onPropertiesPanelToggle,
    onStickyColorChange,
    onPenSettingsChange,
    onEraserSizeChange,
    slot,
    className,
    style,
    children,
  } = props;
  const ref = useRef<CanvasToolbarElement | null>(null);
  const callbacks = useRef({
    onPropertiesPanelToggle,
    onStickyColorChange,
    onPenSettingsChange,
    onEraserSizeChange,
  });
  callbacks.current = {
    onPropertiesPanelToggle,
    onStickyColorChange,
    onPenSettingsChange,
    onEraserSizeChange,
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.section = section;
    el.orientation = orientation;
    el.hideHistory = hideHistory;
    el.hideZoom = hideZoom;
    el.compactReadonly = compactReadonly;
    if (propertiesOpen !== undefined) el.propertiesOpen = propertiesOpen;
  }, [section, orientation, hideHistory, hideZoom, compactReadonly, propertiesOpen]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handlePanel = (event: Event) => {
      callbacks.current.onPropertiesPanelToggle?.(
        (event as CustomEvent<{ open: boolean }>).detail.open,
      );
    };
    const handleSticky = (event: Event) => {
      callbacks.current.onStickyColorChange?.(
        (event as CustomEvent<StickyColorChangeEventDetail>).detail,
      );
    };
    const handlePen = (event: Event) => {
      callbacks.current.onPenSettingsChange?.(
        (event as CustomEvent<PenSettingsChangeEventDetail>).detail,
      );
    };
    const handleEraser = (event: Event) => {
      callbacks.current.onEraserSizeChange?.(
        (event as CustomEvent<EraserSizeChangeEventDetail>).detail,
      );
    };
    el.addEventListener('properties-panel-toggle', handlePanel);
    el.addEventListener('sticky-color-change', handleSticky);
    el.addEventListener('pen-settings-change', handlePen);
    el.addEventListener('eraser-size-change', handleEraser);
    return () => {
      el.removeEventListener('properties-panel-toggle', handlePanel);
      el.removeEventListener('sticky-color-change', handleSticky);
      el.removeEventListener('pen-settings-change', handlePen);
      el.removeEventListener('eraser-size-change', handleEraser);
    };
  }, []);

  return React.createElement(
    'canvas-toolbar',
    {
      ref,
      class: className,
      style,
      slot,
      orientation,
    },
    children,
  );
}

export interface CanvasLayersProps {
  /** Região do `CanvasSection` que a ilha ocupa (por exemplo, `toolbar`, `left` ou `controls`). */
  slot?: string | undefined;
  section?: CanvasSectionApi | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export function CanvasLayers(props: CanvasLayersProps): React.ReactElement {
  const { section, slot, className, style } = props;
  const ref = useRef<CanvasLayersElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.section = section;
  }, [section]);

  return React.createElement('canvas-layers', {
    ref,
    class: className,
    style,
    slot,
  });
}

export interface CanvasPropertiesProps {
  /** Região do `CanvasSection` que a ilha ocupa (por exemplo, `toolbar`, `left` ou `controls`). */
  slot?: string | undefined;
  section?: CanvasSectionApi | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export function CanvasProperties(props: CanvasPropertiesProps): React.ReactElement {
  const { section, slot, className, style } = props;
  const ref = useRef<CanvasPropertiesElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.section = section;
  }, [section]);

  return React.createElement('canvas-properties', {
    ref,
    class: className,
    style,
    slot,
  });
}

export interface CanvasControlsProps {
  /** Região do `CanvasSection` que a ilha ocupa (por exemplo, `toolbar`, `left` ou `controls`). */
  slot?: string | undefined;
  section?: CanvasSectionApi | undefined;
  /** O `<canvas-surface>` do mesmo canvas (`handle.element`): ancora o zoom e habilita os enquadramentos. */
  canvas?: ZoomTarget | null | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export function CanvasControls(props: CanvasControlsProps): React.ReactElement {
  const { section, canvas, slot, className, style } = props;
  const ref = useRef<CanvasControlsElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.section = section;
    el.canvas = canvas ?? undefined;
  }, [section, canvas]);

  return React.createElement('canvas-controls', {
    ref,
    class: className,
    style,
    slot,
  });
}

export interface CanvasSectionProps {
  /** Só para o shell saber do modo leitura: em leitura o título não se edita. */
  section?: CanvasSectionApi | undefined;
  /** Título do projeto. O shell só o exibe: atualize-o em `onTitleChange`, se aceitar a mudança. */
  projectTitle?: string | undefined;
  /** O usuário confirmou outro título (aparado, com até 120 caracteres). */
  onTitleChange?: ((title: string) => void) | undefined;
  /** O menu hambúrguer abriu (`true`) ou fechou. */
  onMenuToggle?: ((open: boolean) => void) | undefined;
  /**
   * Itens do menu hambúrguer, desenhados antes do conteúdo do slot `menu`. Atribuir outro array
   * redesenha a lista: mantenha a referência estável entre renderizações.
   */
  menuItems?: readonly ShellMenuItem[] | undefined;
  /** A pessoa escolheu um item de `menuItems`. */
  onMenuSelect?: ((id: string) => void) | undefined;
  /** Pessoa logada: mostra o avatar depois da pill Exportar. Sem ela, não há avatar. */
  user?: ShellUser | undefined;
  /** O avatar foi clicado. */
  onAvatarClick?: (() => void) | undefined;
  /** Esconde a pill Exportar. */
  hideExport?: boolean | undefined;
  /** A pessoa escolheu um formato na ilha de exportação. Quem exporta é a aplicação. */
  onExportRequest?: ((format: ExportFormat) => void) | undefined;
  /** Esconde a pill Compartilhar. */
  hideShare?: boolean | undefined;
  /** Estado do compartilhamento ao vivo: o ponto de status e o nome acessível da pill. */
  sharing?: ShellSharingState | undefined;
  /** A pill Compartilhar foi clicada, com o estado do momento. Quem compartilha é a aplicação. */
  onShareRequest?: ((detail: ShareRequestEventDetail) => void) | undefined;
  /** A pessoa pediu para parar de compartilhar. Quem para é a aplicação. */
  onShareStop?: (() => void) | undefined;
  /**
   * Participantes da sessão, a pessoa local (`self`) incluída: a pilha de avatares e a ilha de
   * participantes aparecem com `sharing = 'on'` e pelo menos uma outra pessoa. Atribuir outro
   * array redesenha a lista: mantenha a referência estável entre renderizações.
   */
  participants?: readonly ShellParticipant[] | undefined;
  /** Esconde a pilha de avatares mesmo com participantes. */
  hideParticipants?: boolean | undefined;
  /** `id` da pessoa que a sessão local segue, ou `null`: a faixa, a moldura e o botão Seguindo. */
  following?: string | null | undefined;
  /**
   * A pessoa pediu para seguir alguém (`sessionId`) ou para parar (`null`). Quem decide, e depois
   * atualiza `following`, é a aplicação.
   */
  onFollowChange?: ((sessionId: string | null) => void) | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** O canvas e as ilhas, cada ilha na sua região pela prop `slot`. */
  children?: ReactNode;
}

export function CanvasSection(props: CanvasSectionProps): React.ReactElement {
  const {
    section,
    projectTitle = '',
    onTitleChange,
    onMenuToggle,
    menuItems,
    onMenuSelect,
    user,
    onAvatarClick,
    hideExport = false,
    onExportRequest,
    hideShare = false,
    sharing = 'off',
    participants,
    hideParticipants = false,
    following = null,
    onFollowChange,
    onShareRequest,
    onShareStop,
    className,
    style,
    children,
  } = props;
  const ref = useRef<CanvasSectionElement | null>(null);
  const callbacks = useRef({
    onTitleChange,
    onMenuToggle,
    onMenuSelect,
    onAvatarClick,
    onExportRequest,
    onShareRequest,
    onShareStop,
    onFollowChange,
  });
  callbacks.current = {
    onTitleChange,
    onMenuToggle,
    onMenuSelect,
    onAvatarClick,
    onExportRequest,
    onShareRequest,
    onShareStop,
    onFollowChange,
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.section = section;
    el.projectTitle = projectTitle;
    el.menuItems = menuItems ?? [];
    el.user = user;
    el.hideExport = hideExport;
    el.hideShare = hideShare;
    el.sharing = sharing;
    el.participants = participants ?? [];
    el.hideParticipants = hideParticipants;
    el.following = following;
  }, [
    section,
    projectTitle,
    menuItems,
    user,
    hideExport,
    hideShare,
    sharing,
    participants,
    hideParticipants,
    following,
  ]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleTitle = (event: Event) => {
      callbacks.current.onTitleChange?.((event as CustomEvent<{ title: string }>).detail.title);
    };
    const handleMenu = (event: Event) => {
      callbacks.current.onMenuToggle?.((event as CustomEvent<{ open: boolean }>).detail.open);
    };
    const handleSelect = (event: Event) => {
      callbacks.current.onMenuSelect?.((event as CustomEvent<{ id: string }>).detail.id);
    };
    const handleExport = (event: Event) => {
      callbacks.current.onExportRequest?.(
        (event as CustomEvent<{ format: ExportFormat }>).detail.format,
      );
    };
    const handleShare = (event: Event) => {
      callbacks.current.onShareRequest?.((event as CustomEvent<ShareRequestEventDetail>).detail);
    };
    const handleShareStop = () => callbacks.current.onShareStop?.();
    const handleFollow = (event: Event) => {
      callbacks.current.onFollowChange?.(
        (event as CustomEvent<FollowChangeEventDetail>).detail.sessionId,
      );
    };
    const handleAvatar = () => callbacks.current.onAvatarClick?.();
    el.addEventListener('title-change', handleTitle);
    el.addEventListener('menu-toggle', handleMenu);
    el.addEventListener('menu-select', handleSelect);
    el.addEventListener('export-request', handleExport);
    el.addEventListener('share-request', handleShare);
    el.addEventListener('share-stop', handleShareStop);
    el.addEventListener('follow-change', handleFollow);
    el.addEventListener('avatar-click', handleAvatar);
    return () => {
      el.removeEventListener('title-change', handleTitle);
      el.removeEventListener('menu-toggle', handleMenu);
      el.removeEventListener('menu-select', handleSelect);
      el.removeEventListener('export-request', handleExport);
      el.removeEventListener('share-request', handleShare);
      el.removeEventListener('share-stop', handleShareStop);
      el.removeEventListener('follow-change', handleFollow);
      el.removeEventListener('avatar-click', handleAvatar);
    };
  }, []);

  return React.createElement('canvas-section', { ref, class: className, style }, children);
}

export interface CanvasSelectionMenuProps {
  /** Região do `CanvasSection` que o mini-menu ocupa: `overlay`. */
  slot?: string | undefined;
  section?: CanvasSectionApi | undefined;
  /** O `<canvas-surface>` do mesmo canvas (`handle.element`): dá o estado da interação, a caixa e o foco. */
  canvas?: SelectionMenuCanvas | null | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Mostra Exportar board com um board selecionado (`export-board`). Padrão: `false`. */
  exportBoard?: boolean | undefined;
  /** O pedido de exportar o board selecionado; quem exporta e baixa o arquivo é o host. */
  onExportBoardRequest?: ((detail: ExportBoardRequestEventDetail) => void) | undefined;
  /** Conteúdo do elemento. As propriedades da seleção vão no `CanvasToolbar`, com `slot="properties"`. */
  children?: ReactNode;
}

export function CanvasSelectionMenu(props: CanvasSelectionMenuProps): React.ReactElement {
  const { section, canvas, slot, className, style, exportBoard, onExportBoardRequest, children } =
    props;
  const ref = useRef<CanvasSelectionMenuElement | null>(null);
  const onRequest = useRef(onExportBoardRequest);
  onRequest.current = onExportBoardRequest;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.section = section;
    el.canvas = canvas ?? undefined;
  }, [section, canvas]);

  useEffect(() => {
    const el = ref.current;
    if (el) el.exportBoard = exportBoard === true;
  }, [exportBoard]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = (event: Event) => {
      onRequest.current?.((event as CustomEvent<ExportBoardRequestEventDetail>).detail);
    };
    el.addEventListener('export-board-request', handle);
    return () => el.removeEventListener('export-board-request', handle);
  }, []);

  return React.createElement(
    'canvas-selection-menu',
    { ref, class: className, style, slot },
    children,
  );
}
