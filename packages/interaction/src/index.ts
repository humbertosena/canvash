import {
  type CanvasSectionApi,
  type EraserSize,
  type InkKind,
  type InkWidth,
  type ZoomLimits,
} from '@canvash/core';
import { PointerAdapter } from './pointer.js';
import {
  InteractionStateMachine,
  type InteractionStateName,
  type StateData,
} from './state-machine.js';
import { WheelAdapter, normalizeWheelDelta, type NormalizedWheelDelta } from './wheel.js';
import { KeyboardAdapter, type KeyboardShortcutMap } from './keyboard.js';
import { isPeerLocked } from './peer-lock.js';
import { BoardTitleEditor } from './board-title-editor.js';
import { TextEditorAdapter, stripHtmlTags } from './text-editor.js';
import type { PenSettings } from './tools/pen.js';
import type { EraserCursor } from './tools/eraser.js';

export { INTERACTION_VERSION } from './version.js';

export type { InteractionStateName, PanSource, StateData } from './state-machine.js';
export { DEFAULT_PEN, PEN_SIMPLIFY_TOLERANCE_CSS_PX, type PenSettings } from './tools/pen.js';
export { DEFAULT_ERASER_SIZE, type EraserCursor } from './tools/eraser.js';
export { normalizeWheelDelta, WheelAdapter };
export type { NormalizedWheelDelta };
export { computeClickSelection, executeClickSelection, isClickGesture } from './tools/select.js';
export {
  computeMarqueeBounds,
  computeMarqueeMode,
  computeMarqueeSelection,
  executeMarqueeSelection,
} from './tools/marquee.js';
export { buildMovePatch, toPreviewShape, translateShape } from './transform.js';
export {
  buildMoveCommands,
  buildMovePreviews,
  computeMoveDelta,
  executeMove,
  getMovableNodes,
} from './tools/move.js';
export {
  buildResizePatch,
  buildResizePreview,
  findResizeHandleAtPoint,
  getLockedAspectRatio,
  getResizeCursor,
  getShapeResizeHandles,
  isAspectRatioLocked,
  normalizeHandleId,
  resizeShape,
  type ResizeHandleId,
  type ResizeHandlePoint,
  type ResizeShapeOptions,
} from './tools/resize.js';
export {
  computeAggregateBounds,
  computeUniformScaleFactor,
  executeMultiResize,
  findMultiResizeHandleAtPoint,
  getMultiResizeHandles,
  getMultiResizeOppositeAnchor,
  scaleMultipleShapes,
  scaleShapeUniform,
  type MultiResizeHandlePoint,
} from './tools/resize-multiple.js';
export {
  ROTATION_HANDLE_OFFSET_CSS,
  calculateRotationAngle,
  executeRotation,
  getRotationCenter,
  getRotationHandlePoint,
  isRotationHandleHit,
  rotateShapes,
  buildRotatePatch,
} from './tools/rotate.js';
export {
  DEFAULT_SHORTCUTS,
  KeyboardAdapter,
  ZOOM_STEP_FACTOR,
  executeDelete,
  executeFitContent,
  executeFitSelection,
  executeGroup,
  executeNudge,
  executeRedo,
  executeReorder,
  executeUndo,
  executeUngroup,
  executeZoomBy,
  executeZoomReset,
  getGroupActions,
  isEditableElement,
  isFocusOnEditor,
  matchKeyboardShortcut,
  type ActionAvailability,
  type GroupActionsAvailability,
  type KeyboardAction,
  type KeyboardAdapterOptions,
  type KeyboardShortcutEvent,
  type KeyboardShortcutMap,
  type ShortcutKeyDefinition,
} from './keyboard.js';
export {
  isSelectionVisible,
  placePanel,
  placeSelectionMenu,
  type PanelPlacement,
  type ScreenRect,
  type ScreenSize,
  type SelectionMenuPlacement,
  type SelectionMenuPlacementOptions,
} from './selection-menu-placement.js';
export { applyPinchPanZoom, computeTouchCenter, computeTouchDistance } from './touch.js';
export {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_FONT_WEIGHT,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_WIDTH,
  MIN_TEXT_WIDTH,
  buildCreateTextInput,
  computeTextCreationGeometry,
  isTextNode,
  type BuildCreateTextInputOptions,
  type TextCreationGeometry,
} from './tools/text.js';
export { BoardTitleEditor, type BoardTitleEditorOptions } from './board-title-editor.js';
export {
  TextEditorAdapter,
  stripHtmlTags,
  type ActiveTextEditSession,
  type TextEditorAdapterOptions,
} from './text-editor.js';
export {
  DEFAULT_MIN_ARROW_LENGTH,
  STANDARD_ANCHORS,
  buildArrowCreateInput,
  buildArrowPreviewShape,
  computeArrowCreation,
  computeNormalizedAnchor,
  findAnchorTargetAtPoint,
  isArrowCreationValid,
  type ArrowCreationResult,
  type BuildArrowInputOptions,
  type BuildArrowPreviewOptions,
  type ComputeArrowCreationParams,
  type TargetHitResult,
} from './tools/arrow.js';

export {
  DEFAULT_SNAP_TOLERANCE_CSS_PX,
  collectObjectSnapTargets,
  computeBoxSnap,
  computePointSnap,
  computeSnap,
  type ComputeSnapOptions,
  type GridSnapConfig,
  type SnapAxis,
  type SnapGuide,
  type SnapResult,
  type SnapTarget,
  type SnapTargetType,
} from './snapping.js';

export interface AttachInteractionsOptions {
  section: CanvasSectionApi;
  element: HTMLElement;
  zoomLimits?: ZoomLimits;
  shortcuts?: KeyboardShortcutMap;
  additionalFocusRoots?: readonly HTMLElement[];
  snapping?: boolean | (() => boolean);
  snapToleranceCssPx?: number;
  grid?:
    | import('./snapping.js').GridSnapConfig
    | (() => import('./snapping.js').GridSnapConfig | undefined);
  onGuidesChange?: (guides: readonly import('./snapping.js').SnapGuide[]) => void;
  renderer?: {
    setGuides: (guides: readonly import('./snapping.js').SnapGuide[] | null) => void;
    /** Contorna (ou apaga, com `null`) o board que receberia o arrasto. Opcional. */
    setDropTarget?: (boardId: string | null) => void;
    /** Desenha (ou esconde, com `null`) o indicador da borracha. Opcional. */
    setEraserCursor?: (cursor: EraserCursor | null) => void;
    /** Recebe a posição do ponteiro para o realce do grid, ou `null`. Opcional. */
    setGridPointer?: (point: { x: number; y: number } | null) => void;
  };
  /** Recebe o board de destino do arrasto, ou `null`; padrão: `renderer.setDropTarget`. */
  onDropTargetChange?: (boardId: string | null) => void;
  /** Recebe o indicador da borracha; padrão: `renderer.setEraserCursor`. */
  onEraserCursorChange?: (cursor: EraserCursor | null) => void;
  /**
   * Recebe a posição do mouse ou da caneta sobre o elemento, em CSS px relativos a ele, e `null`
   * quando ela some (saída, cancelamento, toque ou destruição); padrão: `renderer.setGridPointer`.
   */
  onGridPointerChange?: (point: { x: number; y: number } | null) => void;
  /**
   * Chamado a cada mudança de estado da interação (`idle`, `moving`, `resizing`, `drawing`...).
   * Só nas transições: os movimentos dentro de um mesmo gesto não chamam.
   */
  onStateChange?: (state: InteractionStateName) => void;
  /**
   * O título do board novo, dado o número N (o menor inteiro a partir de 1 que nenhum board
   * usa). O padrão é `Board N`; quem tem i18n passa o texto da própria língua.
   */
  boardTitle?: (n: number) => string;
  /** O `aria-label` do editor do título do board. O padrão é "Título do board". */
  boardTitleLabel?: string;
  /**
   * Chamado quando outro participante passa a deter o nó que a pessoa estava editando: o editor
   * fecha sem gravar, e o host decide como devolver o texto digitado (`text`, já sem tags HTML).
   */
  onTextEditSuperseded?: (nodeId: string, text: string) => void;
}

export interface InteractionHandle {
  /** Cancela o gesto ativo, descartando previews e restaurando o estado anterior. */
  cancel(): void;
  /** Encerra a interação, removendo todos os listeners do elemento e da janela. */
  destroy(): void;
  /** Consulta o estado atual da máquina de estados. */
  getState(): InteractionStateName;
  /** Consulta os dados do estado corrente da máquina de estados. */
  getData(): StateData;
  /** Consulta o adaptador do editor de texto, se anexado. */
  getTextEditor?(): TextEditorAdapter;
  /** Define a cor das próximas notas adesivas (`#rrggbb` ou `#rrggbbaa`); outro valor é ignorado. */
  setStickyColor(color: string): void;
  /** Cor das próximas notas adesivas. O padrão é o amarelo da paleta. */
  getStickyColor(): string;
  /**
   * Define cor, tipo e espessura dos próximos traços da caneta. Cada campo inválido é ignorado e
   * um gesto em andamento mantém as configurações com que começou.
   */
  setPenSettings(settings: {
    readonly color?: string | undefined;
    readonly kind?: InkKind | undefined;
    readonly width?: InkWidth | undefined;
  }): void;
  /** Configurações da caneta. O padrão é grafite, caneta, média. */
  getPenSettings(): PenSettings;
  /** Tamanho da borracha: `thin`, `medium` (padrão) ou `thick`. Outro valor é ignorado. */
  setEraserSize(size: EraserSize): void;
  getEraserSize(): EraserSize;
}

/**
 * Anexa o adaptador de interações a um elemento e ao canvas.
 * Handle retornado expõe `cancel()` e `destroy()`.
 */
export function attachInteractions(options: AttachInteractionsOptions): InteractionHandle {
  const { section, element, zoomLimits, shortcuts, additionalFocusRoots } = options;
  const onGuidesChange =
    options.onGuidesChange ??
    (options.renderer ? (guides) => options.renderer?.setGuides(guides) : undefined);
  const stateMachine = new InteractionStateMachine(section, {
    snapping: options.snapping,
    snapToleranceCssPx: options.snapToleranceCssPx,
    grid: options.grid,
    onGuidesChange,
    onStateChange: options.onStateChange,
    boardTitle: options.boardTitle,
    onDropTargetChange:
      options.onDropTargetChange ??
      (options.renderer?.setDropTarget
        ? (boardId) => options.renderer?.setDropTarget?.(boardId)
        : undefined),
    onEraserCursorChange:
      options.onEraserCursorChange ??
      (options.renderer?.setEraserCursor
        ? (cursor) => options.renderer?.setEraserCursor?.(cursor)
        : undefined),
  });
  const onGridPointerChange =
    options.onGridPointerChange ??
    (options.renderer?.setGridPointer
      ? (point: { x: number; y: number } | null) => options.renderer?.setGridPointer?.(point)
      : undefined);
  const pointerAdapter = new PointerAdapter({
    element,
    stateMachine,
    section,
    zoomLimits,
    onGridPointerChange,
  });
  const wheelAdapter = new WheelAdapter({ element, section, zoomLimits });
  const keyboardAdapter = new KeyboardAdapter({
    element,
    section,
    shortcuts,
    additionalFocusRoots,
    onEditText: () => stateMachine.editSelectedText(),
  });

  const textEditor = new TextEditorAdapter({
    container: element,
    section,
    onCommit: (_nodeId, newText) => {
      if (stateMachine.getState() === 'editing-text') {
        stateMachine.commitTextEdit(newText);
      }
    },
    onCancel: () => {
      if (stateMachine.getState() === 'editing-text') {
        stateMachine.cancelTextEdit();
      }
    },
  });

  const boardTitleEditor = new BoardTitleEditor({
    container: element,
    section,
    label: options.boardTitleLabel ?? 'Título do board',
    onCommit: (_boardId, text) => {
      if (stateMachine.getState() === 'editing-text') {
        stateMachine.commitBoardTitle(text);
      }
    },
    onCancel: () => {
      if (stateMachine.getState() === 'editing-text') {
        stateMachine.cancelBoardTitle();
      }
    },
  });

  // Outro participante passou a deter o alvo do gesto ou do editor: cancela como um Esc.
  const unsubscribePeers = section.subscribe((change) => {
    if (!change.areas.includes('peers')) return;
    const data = stateMachine.getData();
    if (data.name === 'editing-text' && isPeerLocked(section, data.nodeId)) {
      const buffer =
        textEditor.getTextArea()?.value ?? boardTitleEditor.getInput()?.value ?? data.initialText;
      options.onTextEditSuperseded?.(data.nodeId, stripHtmlTags(buffer));
    }
    stateMachine.cancelIfTargetLocked();
  });

  const unbindStateMachine = stateMachine.onAction((action) => {
    if (action.type === 'START_TEXT_EDIT') {
      textEditor.start(action.node, action.isNew);
    } else if (action.type === 'START_BOARD_TITLE_EDIT') {
      boardTitleEditor.start(action.node);
    } else if (action.type === 'END_TEXT_EDIT') {
      if (textEditor.isActive()) {
        textEditor.cancel();
      }
      if (boardTitleEditor.isActive()) {
        boardTitleEditor.cancel();
      }
    }
  });

  return {
    cancel(): void {
      stateMachine.cancel();
    },
    destroy(): void {
      unsubscribePeers();
      unbindStateMachine();
      textEditor.destroy();
      boardTitleEditor.destroy();
      pointerAdapter.destroy();
      wheelAdapter.destroy();
      keyboardAdapter.destroy();
    },
    getState(): InteractionStateName {
      return stateMachine.getState();
    },
    getData(): StateData {
      return stateMachine.getData();
    },
    getTextEditor(): TextEditorAdapter {
      return textEditor;
    },
    setStickyColor(color: string): void {
      stateMachine.setStickyColor(color);
    },
    getStickyColor(): string {
      return stateMachine.getStickyColor();
    },
    setPenSettings(settings): void {
      stateMachine.setPenSettings(settings);
    },
    getPenSettings(): PenSettings {
      return stateMachine.getPenSettings();
    },
    setEraserSize(size: EraserSize): void {
      stateMachine.setEraserSize(size);
    },
    getEraserSize(): EraserSize {
      return stateMachine.getEraserSize();
    },
  };
}
