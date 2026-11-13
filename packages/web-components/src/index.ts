export { WEB_COMPONENTS_VERSION } from './version.js';
export {
  defineCanvasElements,
  DEFAULT_CANVAS_ELEMENTS,
  type DefineCanvasElementsOptions,
} from './define.js';
export { CanvasSurfaceElement, type FitToContentOptions } from './canvas-surface.js';
export type { GridStyle } from '@canvash/renderer-canvas2d';
export {
  CanvasToolbarElement,
  DEFAULT_TOOLBAR_TOOLS,
  DRAW_GROUP_TOOLS,
  SHAPE_GROUP_TOOLS,
  type DrawGroupTool,
  type ShapeGroupTool,
  type ToolbarToolDef,
} from './canvas-toolbar.js';
export { CanvasPropertiesElement } from './canvas-properties.js';
export { CanvasLayersElement } from './canvas-layers.js';
export { CanvasSectionElement, type ShellMenuItem, type ShellUser } from './canvas-section.js';
export { MAX_STACK_AVATARS, type ShellParticipant } from './participants.js';
export {
  CanvasSelectionMenuElement,
  type SelectionMenuAction,
  type SelectionMenuCanvas,
} from './canvas-selection-menu.js';
export {
  CanvasControlsElement,
  ZOOM_ITEMS,
  type ZoomItemId,
  type ZoomTarget,
} from './canvas-controls.js';
export type {
  AvatarClickEvent,
  AvatarClickEventDetail,
  CanvasErrorEvent,
  CanvasErrorEventDetail,
  CanvasReadyEvent,
  CanvasReadyEventDetail,
  DocumentChangeEvent,
  DocumentChangeEventDetail,
  SelectionChangeEvent,
  SelectionChangeEventDetail,
  ShareRequestEvent,
  ShareRequestEventDetail,
  ShareStopEvent,
  FollowChangeEvent,
  FollowChangeEventDetail,
  TextEditSupersededEvent,
  TextEditSupersededEventDetail,
  ShareStopEventDetail,
  ShellSharingState,
  EraserSizeChangeEvent,
  EraserSizeChangeEventDetail,
  ExportBoardRequestEvent,
  ExportBoardRequestEventDetail,
  ExportFormat,
  ExportRequestEvent,
  ExportRequestEventDetail,
  PenSettingsChangeEvent,
  PenSettingsChangeEventDetail,
  StickyColorChangeEvent,
  StickyColorChangeEventDetail,
  InteractionStateChangeEvent,
  InteractionStateChangeEventDetail,
  MenuSelectEvent,
  MenuSelectEventDetail,
  MenuToggleEvent,
  MenuToggleEventDetail,
  PropertiesPanelToggleEvent,
  PropertiesPanelToggleEventDetail,
  TitleChangeEvent,
  TitleChangeEventDetail,
  ToolChangeEvent,
  ToolChangeEventDetail,
  ViewportChangeEvent,
  ViewportChangeEventDetail,
} from './events.js';
export { CANVASH_CSS_TOKENS, CANVASH_PARTS } from './theme.js';
export {
  type CanvashI18nMessages,
  type ToolbarI18nMessages,
  type LayersI18nMessages,
  type PropertiesI18nMessages,
  type CanvasI18nMessages,
  type CanvasControlsI18nMessages,
  type ShellI18nMessages,
  type SelectionMenuI18nMessages,
  type DeepPartial,
  defaultI18nPtBR,
  defaultI18nEnUS,
  getGlobalI18n,
  setGlobalI18n,
  resetGlobalI18n,
  mergeI18n,
} from './i18n.js';
