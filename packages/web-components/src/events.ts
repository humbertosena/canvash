import type {
  CanvasSectionApi,
  CanvasDocument,
  CanvasSnapshot,
  ChangeOrigin,
  Viewport,
} from '@canvash/core';
import type { InteractionStateName } from '@canvash/interaction';

export interface CanvasReadyEventDetail {
  readonly section: CanvasSectionApi;
}

export interface DocumentChangeEventDetail {
  readonly snapshot: CanvasSnapshot;
  readonly revision: number;
  readonly origin: ChangeOrigin;
  readonly affectedIds: readonly string[];
  readonly document: CanvasDocument;
}

export interface SelectionChangeEventDetail {
  readonly selectedIds: readonly string[];
  readonly snapshot: CanvasSnapshot;
}

export interface ViewportChangeEventDetail {
  readonly viewport: Viewport;
  readonly snapshot: CanvasSnapshot;
}

export interface ToolChangeEventDetail {
  readonly activeTool: string;
  readonly snapshot: CanvasSnapshot;
}

export interface CanvasErrorEventDetail {
  readonly error: unknown;
}

export interface TextEditSupersededEventDetail {
  /** Nó cujo texto outra pessoa passou a editar. */
  readonly nodeId: string;
  /** O que a pessoa tinha digitado, sem tags HTML. O editor fechou sem gravar. */
  readonly text: string;
}

export interface StickyColorChangeEventDetail {
  /** Cor das próximas notas adesivas: `#rrggbb`. */
  readonly color: string;
  /** Canvas da toolbar que emitiu: o canvas só reage ao evento do próprio canvas. */
  readonly section: CanvasSectionApi | undefined;
}

export interface PenSettingsChangeEventDetail {
  /** Cor, tipo e espessura dos próximos traços. */
  readonly settings: {
    readonly color: string;
    readonly kind: 'pen' | 'marker' | 'highlighter';
    readonly width: 'thin' | 'medium' | 'thick';
  };
  /** Canvas da toolbar que emitiu: o canvas só reage ao evento do próprio canvas. */
  readonly section: CanvasSectionApi | undefined;
}

export interface EraserSizeChangeEventDetail {
  /** Tamanho da borracha: raio de 4, 8 ou 16 CSS px. */
  readonly size: 'thin' | 'medium' | 'thick';
  /** Canvas da toolbar que emitiu: o canvas só reage ao evento do próprio canvas. */
  readonly section: CanvasSectionApi | undefined;
}

export interface InteractionStateChangeEventDetail {
  /** Estado da interação que começou: `idle` quando o gesto terminou ou foi cancelado. */
  readonly state: InteractionStateName;
}

export interface PropertiesPanelToggleEventDetail {
  /** O painel de propriedades do `<canvas-selection-menu>` ficou aberto (`true`) ou fechado. */
  readonly open: boolean;
}

export interface MenuToggleEventDetail {
  /** O menu hambúrguer do `<canvas-section>` ficou aberto (`true`) ou fechado. */
  readonly open: boolean;
}

export interface MenuSelectEventDetail {
  /** `id` do item de `menuItems` que a pessoa escolheu. */
  readonly id: string;
}

/** Formatos que a ilha de exportação do `<canvas-section>` pede ao host. */
export type ExportFormat = 'svg' | 'png';

export interface ExportRequestEventDetail {
  /** Formato escolhido; quem exporta (e baixa o arquivo) é o host. */
  readonly format: ExportFormat;
}

/** O pedido de exportação de um board, feito pelo menu de seleção (`export-board-request`). */
export interface ExportBoardRequestEventDetail {
  /** ID do board selecionado; quem exporta (e baixa o arquivo) é o host. */
  readonly boardId: string;
  readonly format: ExportFormat;
}

/** Estado do compartilhamento ao vivo, que só o host muda (`sharing` do `<canvas-section>`). */
export type ShellSharingState = 'off' | 'connecting' | 'on';

export interface ShareRequestEventDetail {
  /** Estado do compartilhamento no momento do clique; o host decide se liga a colaboração. */
  readonly sharing: ShellSharingState;
}

export interface FollowChangeEventDetail {
  /** Quem a pessoa pediu para seguir, ou `null` para parar de seguir. O host decide. */
  readonly sessionId: string | null;
}

/** `share-stop` e `avatar-click` não levam dados: só avisam que a pessoa pediu. */
export type ShareStopEventDetail = Record<string, never>;
export type AvatarClickEventDetail = Record<string, never>;

export interface TitleChangeEventDetail {
  /** Novo título do projeto, aparado e com no máximo 120 caracteres. */
  readonly title: string;
}

export type EraserSizeChangeEvent = CustomEvent<EraserSizeChangeEventDetail>;
export type PenSettingsChangeEvent = CustomEvent<PenSettingsChangeEventDetail>;
export type StickyColorChangeEvent = CustomEvent<StickyColorChangeEventDetail>;
export type CanvasReadyEvent = CustomEvent<CanvasReadyEventDetail>;
export type DocumentChangeEvent = CustomEvent<DocumentChangeEventDetail>;
export type SelectionChangeEvent = CustomEvent<SelectionChangeEventDetail>;
export type ViewportChangeEvent = CustomEvent<ViewportChangeEventDetail>;
export type ToolChangeEvent = CustomEvent<ToolChangeEventDetail>;
export type CanvasErrorEvent = CustomEvent<CanvasErrorEventDetail>;
export type TextEditSupersededEvent = CustomEvent<TextEditSupersededEventDetail>;

declare global {
  interface HTMLElementEventMap {
    'canvas-ready': CanvasReadyEvent;
    'document-change': DocumentChangeEvent;
    'selection-change': SelectionChangeEvent;
    'viewport-change': ViewportChangeEvent;
    'tool-change': ToolChangeEvent;
    'canvas-error': CanvasErrorEvent;
    'text-edit-superseded': TextEditSupersededEvent;
    'sticky-color-change': StickyColorChangeEvent;
    'pen-settings-change': PenSettingsChangeEvent;
    'eraser-size-change': EraserSizeChangeEvent;
  }
}
export type MenuToggleEvent = CustomEvent<MenuToggleEventDetail>;
export type MenuSelectEvent = CustomEvent<MenuSelectEventDetail>;
export type ExportRequestEvent = CustomEvent<ExportRequestEventDetail>;
export type ExportBoardRequestEvent = CustomEvent<ExportBoardRequestEventDetail>;
export type ShareRequestEvent = CustomEvent<ShareRequestEventDetail>;
export type ShareStopEvent = CustomEvent<ShareStopEventDetail>;
export type FollowChangeEvent = CustomEvent<FollowChangeEventDetail>;
export type AvatarClickEvent = CustomEvent<AvatarClickEventDetail>;
export type TitleChangeEvent = CustomEvent<TitleChangeEventDetail>;
export type InteractionStateChangeEvent = CustomEvent<InteractionStateChangeEventDetail>;
export type PropertiesPanelToggleEvent = CustomEvent<PropertiesPanelToggleEventDetail>;
