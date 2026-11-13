export { createCanvasSection } from './canvas-section.js';
export type { AttachToBoardCommand, DetachFromBoardCommand } from './boards.js';
export type {
  CanvasSectionApi,
  CreateCanvasSectionOptions,
  ReplaceDocumentOptions,
} from './canvas-section.js';
export { isJsonArray, isJsonObject } from './checks.js';
export type { JsonObject, JsonValue } from './checks.js';
export type {
  CanvasCommand,
  CommandReceipt,
  CreateGroupCommand,
  CreateShapeCommand,
  HistoryReceipt,
  RemoveShapeCommand,
  UngroupCommand,
  UpdateShapeCommand,
} from './commands.js';
export { SCHEMA_VERSION } from './document.js';
export type { CanvasDocument, Layer } from './document.js';
export {
  MAX_PEERS,
  MAX_PEER_IDS,
  MAX_PEER_NAME_LENGTH,
  type CanvasPeer,
  type CanvasPeerDrag,
  type CanvasPeerView,
  type PeerLock,
} from './peers.js';
export type {
  CanvasChange,
  CanvasListener,
  ChangeArea,
  ChangeOrigin,
  ErrorHandler,
} from './events.js';
export {
  boundsContain,
  boundsFromPoints,
  boundsIntersect,
  boundsUnion,
  shapeBounds,
} from './geometry/bounds.js';
export type { Bounds, ShapeBoundsOptions } from './geometry/bounds.js';
export {
  bezierBounds,
  bezierPoint,
  defaultBezierControls,
  flattenBezier,
  mirrorControl,
} from './geometry/bezier.js';
export type { BezierCurve } from './geometry/bezier.js';
export { fitAspect } from './geometry/fit.js';
export { simplifyPolyline } from './geometry/simplify.js';
export { segmentOutsideCapsule } from './geometry/capsule.js';
export {
  ERASER_MIN_PIECE_CSS_PX,
  ERASER_RADII,
  ERASER_SIZE_NAMES,
  eraseFromInk,
  eraseFromStrokes,
  eraserRadiusWorld,
  inkPatchFromWorldStrokes,
  inkStrokesToLocal,
} from './eraser.js';
export type { EraserPass, EraserSize } from './eraser.js';
export {
  DEFAULT_PEN_SETTINGS,
  INK_HIGHLIGHTER_ALPHA,
  INK_KINDS,
  INK_LIMITS,
  INK_WIDTH_NAMES,
  INK_WIDTHS,
  PEN_PALETTE,
  appendInkStroke,
  canAppendInkStroke,
  inkBounds,
  inkInputFromStroke,
  inkPathSegments,
  inkStrokeAlpha,
  inkStrokeWidth,
  inkStrokesToWorld,
  normalizeInkStrokes,
} from './ink.js';
export type { InkAppendPatch, InkGeometry, InkPathSegment, WorldInkStroke } from './ink.js';
export {
  DEFAULT_STICKY_SIZE,
  STICKY_COLORS,
  STICKY_PADDING,
  STICKY_SHADOW,
  fitStickyFontSize,
  stickyFoldColor,
  stickyFoldSize,
  stickyTextColor,
} from './sticky.js';
export type { StickyColorName, StickyFitInput } from './sticky.js';
export { bracePath, braceBounds, braceRadius, flattenBrace } from './geometry/brace.js';
export type { BraceGeometry, BracePath, BraceSegment } from './geometry/brace.js';
export { BOARD_TITLE_BAND, BOARD_TITLE_FONT_SIZE, boardTitleBounds } from './geometry/board.js';
export { shapeInsideRect, shapeIntersectsRect } from './geometry/intersect.js';
export { shapeOutline } from './geometry/outline.js';
export type { OutlineShapeNode } from './geometry/outline.js';
export { distanceToSegment, pointInShape } from './geometry/shapes.js';
export {
  clampZoom,
  DEFAULT_ZOOM_LIMITS,
  rotatePoint,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './geometry/transform.js';
export type { Viewport, ZoomLimits } from './geometry/transform.js';
export { fitViewportToBounds } from './geometry/viewport-fit.js';
export type { FitViewportOptions, ViewportSize } from './geometry/viewport-fit.js';
export type { HistoryState } from './history.js';
export type { Clock, IdGenerator } from './ids.js';
export { DEFAULT_LIMITS } from './limits.js';
export type { CanvasLimits } from './limits.js';
export { computeSiblingReorderIndex } from './layers.js';
export type {
  CreateLayerCommand,
  NodeInfo,
  ReorderLayerCommand,
  ReorderNodeCommand,
  SiblingReorderAction,
  UpdateLayerCommand,
} from './layers.js';
export {
  isBindingEndpoint,
  isFreeEndpoint,
  isZeroLengthArrow,
  resolveAnchorPosition,
  resolveArrowEndpoints,
  resolveEndpoint,
} from './arrows.js';
export type { ArrowEndpoint, ArrowMarkerType, BindingEndpoint, FreeEndpoint } from './arrows.js';
export type {
  CanvasPreview,
  PreviewArrow,
  PreviewBoard,
  PreviewBezier,
  PreviewChevron,
  PreviewBrace,
  PreviewCircle,
  PreviewCross,
  PreviewDiamond,
  PreviewEllipse,
  PreviewInput,
  PreviewLine,
  PreviewRectangle,
  PreviewShape,
  PreviewSquare,
  PreviewPolygon,
  PreviewSticky,
  PreviewInk,
  PreviewText,
  PreviewTriangle,
} from './preview.js';
export type {
  BoundsOptions,
  HitTestOptions,
  MarqueeOptions,
  PreviewOption,
  QueryBoundsOptions,
} from './queries.js';
export type {
  CanvasError,
  CanvasErrorCode,
  Result,
  ValidationIssue,
  ValidationRule,
} from './result.js';
export type { SessionState, ToolId } from './session.js';
export type { CanvasSnapshot } from './snapshot.js';
export { shapeLabelArea, shapeLabelColor } from './label-area.js';
export type { LabelArea, LabelLayoutShape } from './label-area.js';
export {
  DEFAULT_SHAPE_LABEL,
  SHAPE_LABEL_LINE_HEIGHT,
  SHAPE_LABEL_PADDING,
} from './shape-label.js';
export type { LabelVerticalAlign, ShapeLabel } from './shape-label.js';
export {
  FONT_SIZE_PRESETS,
  isBoardNode,
  isBoxShape,
  isLabelable,
  POLYGON_PRESETS,
} from './shapes.js';
export type {
  ArrowInput,
  ArrowNode,
  BezierInput,
  BezierNode,
  CanvasNode,
  BoxGeometry,
  BraceInput,
  BraceNode,
  BraceOrientation,
  BoxShapeNode,
  CircleInput,
  ChevronDirection,
  ChevronInput,
  ChevronNode,
  CircleNode,
  Color,
  CrossInput,
  CrossNode,
  DiamondInput,
  DiamondNode,
  EllipseInput,
  EllipseNode,
  FillStrokeStyle,
  FontSizeMode,
  BoardInput,
  BoardNode,
  BoardStyle,
  GroupNode,
  LabelableNode,
  InkInput,
  InkKind,
  InkNode,
  InkStroke,
  InkStrokeInput,
  InkStyle,
  InkWidth,
  LineInput,
  LineNode,
  Optional,
  Point,
  PolygonInput,
  PolygonNode,
  PolygonPresetTool,
  RectangleInput,
  RectangleNode,
  StickyInput,
  StickyNode,
  ShapeInput,
  ShapeNode,
  ShapePatch,
  SquareInput,
  SquareNode,
  StrokeStyle,
  TextInput,
  TextNode,
  TriangleInput,
  TriangleNode,
  TriangleVariant,
} from './shapes.js';
export { isGroupNode, findGroupOfNode } from './groups.js';
export { containsHtmlTags, defaultTextMetricsAdapter, layoutText } from './text.js';
export type {
  FontWeight,
  TextAlign,
  TextMetrics,
  TextMetricsAdapter,
  TextMetricsOptions,
} from './text.js';
export { validateDocument } from './validate.js';
export type { ValidateOptions } from './validate.js';
