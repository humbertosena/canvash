import {
  appendInkStroke,
  boardTitleBounds,
  canAppendInkStroke,
  inkInputFromStroke,
  isLabelable,
  screenToWorld,
  shapeLabelArea,
  ERASER_RADII,
  type CanvasSectionApi,
  type BoardNode,
  type Bounds,
  type EraserSize,
  type LabelableNode,
  type Point,
  type PreviewShape,
  type ShapeNode,
  type StickyNode,
  type TextNode,
  type ToolId,
  type Viewport,
} from '@canvash/core';
import {
  computeBoxSnap,
  computePointSnap,
  type GridSnapConfig,
  type SnapGuide,
} from './snapping.js';
import { isPeerLocked } from './peer-lock.js';
import { toPreviewShape } from './transform.js';
import {
  buildCreateShapeInput,
  buildPreviewShape,
  computeCreationGeometry,
  isCreationToolId,
  isCreationValid,
  type CreationToolId,
} from './tools/create.js';
import {
  BOARD_TITLE_MAX_LENGTH,
  boardAdoptees,
  buildBoardCommands,
  buildBoardPreview,
  computeBoardCreation,
  newBoardId,
  nextBoardTitle,
  type BoardBox,
} from './tools/board.js';
import {
  buildArrowCreateInput,
  buildArrowPreviewShape,
  computeArrowCreation,
  findAnchorTargetAtPoint,
  isArrowCreationValid,
  type TargetHitResult,
} from './tools/arrow.js';
import {
  DEFAULT_ERASER_SIZE,
  buildEraseCommands,
  buildErasePreviews,
  eraseSegment,
  isEraserSize,
  type EraserCursor,
  type ErasedInk,
} from './tools/eraser.js';
import {
  DEFAULT_PEN,
  appendRawPoint,
  buildPenPreview,
  finalizeStroke,
  isInkNode,
  mergePenSettings,
  type PenSettings,
} from './tools/pen.js';
import {
  DEFAULT_STICKY_COLOR,
  buildProvisionalSticky,
  buildStickyPreview,
  computeStickyCreation,
  isStickyColor,
  isStickyNode,
} from './tools/sticky.js';
import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_FONT_WEIGHT,
  DEFAULT_TEXT_LINE_HEIGHT,
  buildCreateTextInput,
  computeTextCreationGeometry,
  isTextNode,
} from './tools/text.js';
import { executeClickSelection, isClickGesture, resolveSelectableId } from './tools/select.js';
import {
  computeMarqueeBounds,
  computeMarqueeMode,
  executeMarqueeSelection,
} from './tools/marquee.js';
import {
  buildMovePreviews,
  computeMoveDelta,
  executeMove,
  getMovableNodes,
  findBoardDropTarget,
  getTransformableNodes,
  type MovableNode,
} from './tools/move.js';
import {
  buildResizePatch,
  buildResizePreview,
  findResizeHandleAtPoint,
  getResizeCursor,
  resizeShape,
  type ResizeHandleId,
} from './tools/resize.js';
import {
  buildMultiResizePreviews,
  computeAggregateBounds,
  executeMultiResize,
  findMultiResizeHandleAtPoint,
  scaleMultipleShapes,
} from './tools/resize-multiple.js';
import {
  calculateRotationAngle,
  executeRotation,
  getRotationCenter,
  getRotationHandlePoint,
  isRotationHandleHit,
  rotateShapes,
} from './tools/rotate.js';

export type InteractionStateName =
  | 'idle'
  | 'panning'
  | 'selecting'
  | 'marquee'
  | 'moving'
  | 'creating'
  | 'dragging'
  | 'resizing'
  | 'rotating'
  | 'drawing'
  | 'erasing'
  | 'editing-text';

/** Arrasto mínimo, em pixels CSS, para a nota usar a caixa do gesto e não o tamanho padrão. */
const MIN_STICKY_DRAG_CSS_PX = 8;

export type PanSource = 'hand' | 'middle' | 'space';

export interface PanningStateData {
  readonly pointerId: number;
  readonly startPoint: Point;
  readonly startViewport: Viewport;
  readonly source: PanSource;
}

export interface CreatingStateData {
  readonly pointerId: number;
  readonly tool: CreationToolId | 'text' | 'arrow' | 'sticky' | 'board';
  readonly startWorld: Point;
  readonly currentWorld: Point;
  readonly shiftKey: boolean;
  readonly startTarget?: TargetHitResult | undefined;
}

export interface SelectingStateData {
  readonly pointerId: number;
  /** O arrasto começou no fundo vazio de um board não selecionado: inicia a marquee. */
  readonly marqueeOnDrag?: boolean | undefined;
  readonly startScreen: Point;
  readonly currentScreen: Point;
  readonly startWorld: Point;
  readonly hitId: string | undefined;
  readonly hitLocked: boolean;
  readonly initialSelectedIds: readonly string[];
  readonly shiftKey: boolean;
}

export interface MarqueeStateData {
  readonly pointerId: number;
  readonly startScreen: Point;
  readonly startWorld: Point;
  readonly currentWorld: Point;
  readonly initialSelectedIds: readonly string[];
  readonly shiftKey: boolean;
}

export interface MovingStateData {
  readonly pointerId: number;
  readonly startScreen: Point;
  readonly startWorld: Point;
  readonly currentWorld: Point;
  readonly initialSelectedIds: readonly string[];
  readonly movableNodes: readonly MovableNode[];
  readonly aggregateBounds?: Bounds | null | undefined;
  readonly snappedDelta?: Point | undefined;
}

export interface ResizingStateData {
  readonly pointerId: number;
  readonly handle: ResizeHandleId;
  readonly startWorld: Point;
  readonly currentWorld: Point;
  readonly shiftKey: boolean;
  readonly singleShape?: ShapeNode | BoardNode | undefined;
  readonly multipleNodes?: readonly ShapeNode[] | undefined;
  readonly bounds?: Bounds | undefined;
}

export interface RotatingStateData {
  readonly pointerId: number;
  readonly center: Point;
  readonly startWorld: Point;
  readonly currentWorld: Point;
  readonly initialNodes: readonly ShapeNode[];
  readonly shiftKey: boolean;
}

export interface DrawingStateData {
  readonly pointerId: number;
  /** O elemento que recebe o traço, ou `null` se este traço cria um novo. */
  readonly inkId: string | null;
  /** Pontos brutos do gesto, em mundo. */
  readonly rawPoints: Point[];
  /** Configurações no começo do gesto: mudar a caneta no meio vale só para o próximo traço. */
  readonly settings: PenSettings;
}

export interface ErasingStateData {
  readonly pointerId: number;
  /** Amostras do ponteiro desta passada, em mundo. */
  readonly passPoints: Point[];
  /** Tamanho da borracha no começo da passada. */
  readonly size: EraserSize;
  /** Os elementos de traços tocados até agora, com o estado provisório de cada um. */
  readonly touched: Map<string, ErasedInk>;
}

export interface EditingTextStateData {
  readonly nodeId: string;
  readonly isNew: boolean;
  readonly initialText: string;
  /** O nó em edição; o board edita o `title` (ação `START_BOARD_TITLE_EDIT`), os demais o texto. */
  readonly node: TextNode | StickyNode | LabelableNode | BoardNode;
}

export type StateData =
  | { readonly name: 'idle' }
  | ({ readonly name: 'panning' } & PanningStateData)
  | ({ readonly name: 'creating' } & CreatingStateData)
  | ({ readonly name: 'selecting' } & SelectingStateData)
  | ({ readonly name: 'marquee' } & MarqueeStateData)
  | ({ readonly name: 'moving' } & MovingStateData)
  | ({ readonly name: 'resizing' } & ResizingStateData)
  | ({ readonly name: 'rotating' } & RotatingStateData)
  | ({ readonly name: 'drawing' } & DrawingStateData)
  | ({ readonly name: 'erasing' } & ErasingStateData)
  | ({ readonly name: 'editing-text' } & EditingTextStateData);

export interface PointerDownInput {
  readonly type: 'POINTER_DOWN';
  readonly pointerId: number;
  readonly pointerType: string;
  readonly point: Point;
  readonly button: number;
  readonly buttons: number;
  readonly shiftKey: boolean;
  readonly spaceKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface PointerMoveInput {
  readonly type: 'POINTER_MOVE';
  readonly pointerId: number;
  readonly point: Point;
  /**
   * Amostras intermediárias entregues pelo navegador junto com este evento (`getCoalescedEvents`),
   * em pontos de tela, da mais antiga à mais nova. O desenho as usa todas e atualiza o preview uma
   * vez só; os demais gestos usam `point`.
   */
  readonly coalescedPoints?: readonly Point[] | undefined;
  readonly buttons: number;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}

export interface PointerUpInput {
  readonly type: 'POINTER_UP';
  readonly pointerId: number;
  readonly point: Point;
  readonly button: number;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}

export interface PointerCancelInput {
  readonly type: 'POINTER_CANCEL';
  readonly pointerId: number;
}

export interface DoubleClickInput {
  readonly type: 'DOUBLE_CLICK';
  readonly point: Point;
  readonly button: number;
}

export interface KeyDownInput {
  readonly type: 'KEY_DOWN';
  readonly key: string;
  readonly code: string;
}

export interface KeyUpInput {
  readonly type: 'KEY_UP';
  readonly key: string;
  readonly code: string;
}

export interface CancelInput {
  readonly type: 'CANCEL';
}

export interface DestroyInput {
  readonly type: 'DESTROY';
}

export type InteractionInput =
  | PointerDownInput
  | PointerMoveInput
  | PointerUpInput
  | PointerCancelInput
  | DoubleClickInput
  | KeyDownInput
  | KeyUpInput
  | CancelInput
  | DestroyInput;

export type InteractionAction =
  | { readonly type: 'CAPTURE_POINTER'; readonly pointerId: number }
  | { readonly type: 'RELEASE_POINTER'; readonly pointerId: number }
  | { readonly type: 'SET_VIEWPORT'; readonly viewport: Viewport }
  | { readonly type: 'SET_CURSOR'; readonly cursor: string }
  | {
      readonly type: 'START_TEXT_EDIT';
      readonly node: TextNode | StickyNode | LabelableNode;
      readonly isNew: boolean;
    }
  | { readonly type: 'START_BOARD_TITLE_EDIT'; readonly node: BoardNode }
  | { readonly type: 'END_TEXT_EDIT' }
  | { readonly type: 'SET_GUIDES'; readonly guides: readonly SnapGuide[] };

export interface StateMachineListener {
  (action: InteractionAction): void;
}

export interface StateMachineOptions {
  readonly snapping?: boolean | (() => boolean) | undefined;
  readonly snapToleranceCssPx?: number | undefined;
  readonly grid?: GridSnapConfig | (() => GridSnapConfig | undefined) | undefined;
  readonly onGuidesChange?: ((guides: readonly SnapGuide[]) => void) | undefined;
  /**
   * O board que receberia o que está sendo arrastado, ou `null` quando nenhum. Chamado só na
   * mudança; o contorno é overlay e não entra no documento.
   */
  readonly onDropTargetChange?: ((boardId: string | null) => void) | undefined;
  /** O indicador da borracha sob o ponteiro, ou `null` quando ele não deve aparecer. */
  readonly onEraserCursorChange?: ((cursor: EraserCursor | null) => void) | undefined;
  /** Chamado a cada mudança do nome do estado (`idle`, `moving`, `drawing`...), nunca repetido. */
  readonly onStateChange?: ((state: InteractionStateName) => void) | undefined;
  /** O título do board novo, dado o número N; o padrão é `Board N`. */
  readonly boardTitle?: ((n: number) => string) | undefined;
}

function findTargetLayerId(
  layers: readonly { readonly id: string; readonly visible: boolean; readonly locked: boolean }[],
): string | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer && layer.visible && !layer.locked) {
      return layer.id;
    }
  }
  return undefined;
}

export class InteractionStateMachine {
  private currentState: StateData = { name: 'idle' };

  /**
   * Estado corrente. Toda atribuição passa por aqui, então a mudança de nome é avisada num só
   * ponto; trocar só os dados do mesmo estado (por exemplo, a tecla Shift) não avisa.
   */
  private get current(): StateData {
    return this.currentState;
  }

  private set current(next: StateData) {
    const changed = this.currentState.name !== next.name;
    this.currentState = next;
    if (changed) this.options?.onStateChange?.(next.name);
  }
  private spacePressed = false;
  private stickyColor: string = DEFAULT_STICKY_COLOR;
  private penSettings: PenSettings = DEFAULT_PEN;
  /** O elemento que recebe os próximos traços enquanto a caneta segue ativa. */
  private currentInkId: string | null = null;
  private eraserSize: EraserSize = DEFAULT_ERASER_SIZE;
  private eraserCursorShown = false;
  private readonly unsubscribeSection: () => void;
  private readonly listeners: StateMachineListener[] = [];

  constructor(
    private readonly section: CanvasSectionApi,
    private readonly options?: StateMachineOptions,
  ) {
    this.unsubscribeSection = section.subscribe((event) => {
      if (event.areas.includes('tool') && event.snapshot.session.activeTool !== 'eraser') {
        this.hideEraserCursor();
      }
      if (this.currentInkId === null) return;
      const toolChanged =
        event.areas.includes('tool') && event.snapshot.session.activeTool !== 'pen';
      const inkGone = event.snapshot.document.nodes[this.currentInkId] === undefined;
      if (toolChanged || inkGone) this.currentInkId = null;
    });
  }

  private dropTarget: string | null = null;

  /** Avisa o board de destino do arrasto, só quando ele muda. */
  private setDropTarget(boardId: string | null): void {
    if (this.dropTarget === boardId) return;
    this.dropTarget = boardId;
    this.options?.onDropTargetChange?.(boardId);
  }

  private setGuides(guides: readonly SnapGuide[] | null): void {
    const list = guides ?? [];
    this.dispatchAction({ type: 'SET_GUIDES', guides: list });
    if (this.options?.onGuidesChange) {
      this.options.onGuidesChange(list);
    }
  }

  public getState(): InteractionStateName {
    return this.current.name;
  }

  public getData(): StateData {
    return this.current;
  }

  /** Cor das próximas notas adesivas; valor que não é `#rrggbb` ou `#rrggbbaa` é ignorado. */
  public setStickyColor(color: string): void {
    if (isStickyColor(color)) this.stickyColor = color.toLowerCase();
  }

  public getStickyColor(): string {
    return this.stickyColor;
  }

  /**
   * Cor, tipo e espessura dos próximos traços. Cada campo inválido é ignorado; um gesto em
   * andamento mantém as configurações com que começou.
   */
  public setPenSettings(patch: {
    readonly color?: unknown;
    readonly kind?: unknown;
    readonly width?: unknown;
  }): void {
    this.penSettings = mergePenSettings(this.penSettings, patch);
  }

  public getPenSettings(): PenSettings {
    return this.penSettings;
  }

  /** Tamanho da borracha (`thin`, `medium` ou `thick`); outro valor é ignorado. */
  public setEraserSize(size: unknown): void {
    if (isEraserSize(size)) this.eraserSize = size;
  }

  public getEraserSize(): EraserSize {
    return this.eraserSize;
  }

  /** Mostra o indicador da borracha sob o ponteiro (ponto em mundo), se há quem o desenhe. */
  private showEraserCursor(world: Point): void {
    const publish = this.options?.onEraserCursorChange;
    if (!publish) return;
    this.eraserCursorShown = true;
    publish({ x: world.x, y: world.y, radius: ERASER_RADII[this.eraserSize] });
  }

  /** Esconde o indicador da borracha: o ponteiro saiu da superfície ou a ferramenta mudou. */
  public hideEraserCursor(): void {
    if (!this.eraserCursorShown) return;
    this.eraserCursorShown = false;
    this.options?.onEraserCursorChange?.(null);
  }

  public isSpacePressed(): boolean {
    return this.spacePressed;
  }

  public onAction(listener: StateMachineListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }

  private dispatchAction(action: InteractionAction): void {
    for (const listener of this.listeners) {
      listener(action);
    }
  }

  private isSnappingActive(altKey?: boolean): boolean {
    if (altKey) return false;
    if (typeof this.options?.snapping === 'function') {
      return this.options.snapping();
    }
    return this.options?.snapping === true;
  }

  private getGridConfig(): GridSnapConfig | undefined {
    if (typeof this.options?.grid === 'function') {
      return this.options.grid();
    }
    return this.options?.grid;
  }

  public process(input: InteractionInput): void {
    switch (input.type) {
      case 'KEY_DOWN': {
        if (input.code === 'Space' || input.key === ' ') {
          this.spacePressed = true;
          if (this.current.name === 'idle') {
            this.dispatchAction({ type: 'SET_CURSOR', cursor: 'grab' });
          }
        }
        if (input.key === 'Escape') {
          this.cancel();
        }
        if (input.key === 'Shift') {
          if (this.current.name === 'creating') {
            this.current = { ...this.current, shiftKey: true };
            this.updateCreationPreview();
          } else if (this.current.name === 'resizing') {
            this.current = { ...this.current, shiftKey: true };
            this.updateResizingPreview();
          } else if (this.current.name === 'rotating') {
            this.current = { ...this.current, shiftKey: true };
            this.updateRotatingPreview();
          } else if (this.current.name === 'selecting') {
            this.current = { ...this.current, shiftKey: true };
          } else if (this.current.name === 'marquee') {
            this.current = { ...this.current, shiftKey: true };
          }
        }
        break;
      }

      case 'KEY_UP': {
        if (input.code === 'Space' || input.key === ' ') {
          this.spacePressed = false;
          if (this.current.name === 'idle') {
            this.dispatchAction({ type: 'SET_CURSOR', cursor: this.handCursorOrDefault() });
          }
        }
        if (input.key === 'Shift') {
          if (this.current.name === 'creating') {
            this.current = { ...this.current, shiftKey: false };
            this.updateCreationPreview();
          } else if (this.current.name === 'resizing') {
            this.current = { ...this.current, shiftKey: false };
            this.updateResizingPreview();
          } else if (this.current.name === 'rotating') {
            this.current = { ...this.current, shiftKey: false };
            this.updateRotatingPreview();
          } else if (this.current.name === 'selecting') {
            this.current = { ...this.current, shiftKey: false };
          } else if (this.current.name === 'marquee') {
            this.current = { ...this.current, shiftKey: false };
          }
        }
        break;
      }

      case 'CANCEL': {
        this.cancel();
        break;
      }

      case 'DESTROY': {
        this.cancel();
        this.hideEraserCursor();
        this.currentInkId = null;
        this.unsubscribeSection();
        this.listeners.length = 0;
        break;
      }

      case 'POINTER_DOWN': {
        this.handlePointerDown(input);
        break;
      }

      case 'POINTER_MOVE': {
        this.handlePointerMove(input);
        break;
      }

      case 'POINTER_UP': {
        this.handlePointerUp(input);
        break;
      }

      case 'POINTER_CANCEL': {
        this.handlePointerCancel(input);
        break;
      }

      case 'DOUBLE_CLICK': {
        this.handleDoubleClick(input);
        break;
      }
    }
  }

  /** Cursor depois de um pan ou do Espaço: a mão aberta enquanto Pan ou Espaço valem. */
  /**
   * Os nós que o gesto ativo (mover, redimensionar, girar) ou o editor de texto está usando.
   */
  private gestureTargetIds(): readonly string[] {
    const current = this.current;
    switch (current.name) {
      case 'moving':
        return current.movableNodes.map((node) => node.id);
      case 'resizing':
        return current.singleShape
          ? [current.singleShape.id]
          : (current.multipleNodes ?? []).map((node) => node.id);
      case 'rotating':
        return current.initialNodes.map((node) => node.id);
      case 'editing-text':
        return [current.nodeId];
      default:
        return [];
    }
  }

  /**
   * Cancela, pelo caminho do Esc, o gesto ou a edição cujo alvo passou a ser bloqueado por outro
   * participante. Devolve se cancelou. Pode rodar dentro de uma notificação do canvas.
   */
  public cancelIfTargetLocked(): boolean {
    if (!this.gestureTargetIds().some((id) => this.isPeerLocked(id))) return false;
    this.cancel();
    return true;
  }

  /** O nó está bloqueado por outro participante da sessão? */
  private isPeerLocked(id: string): boolean {
    return isPeerLocked(this.section, id);
  }

  private handCursorOrDefault(): string {
    const handActive = this.section.getSnapshot().session.activeTool === 'hand';
    return this.spacePressed || handActive ? 'grab' : 'default';
  }

  public getIdleCursor(): string {
    if (this.spacePressed) return 'grab';
    const activeTool = this.section.getSnapshot().session.activeTool;
    if (activeTool === 'hand') return 'grab';
    if (activeTool === 'text') return 'text';
    if (activeTool === 'eraser') return 'none';
    if (
      isCreationToolId(activeTool) ||
      activeTool === 'arrow' ||
      activeTool === 'sticky' ||
      activeTool === 'board' ||
      activeTool === 'pen'
    ) {
      return 'crosshair';
    }
    return 'default';
  }

  public cancel(): void {
    this.setGuides(null);
    this.setDropTarget(null);
    if (this.current.name === 'panning') {
      const { pointerId, startViewport } = this.current;
      this.section.setViewport(startViewport);
      this.dispatchAction({ type: 'SET_VIEWPORT', viewport: startViewport });
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.handCursorOrDefault(),
      });
    } else if (this.current.name === 'creating') {
      const { pointerId } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'selecting') {
      const { pointerId } = this.current;
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'marquee') {
      const { pointerId } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'moving') {
      const { pointerId, initialSelectedIds } = this.current;
      this.section.setPreview(null);
      this.section.setSelection(initialSelectedIds);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'resizing') {
      const { pointerId } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'rotating') {
      const { pointerId } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'drawing') {
      const { pointerId } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'erasing') {
      const { pointerId } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });
    } else if (this.current.name === 'editing-text') {
      this.cancelTextEdit();
    } else {
      this.current = { name: 'idle' };
    }
  }

  private updateDrawingPreview(): void {
    if (this.current.name !== 'drawing') return;
    this.section.setPreview({
      additions: [buildPenPreview(this.current.rawPoints, this.current.settings)],
    });
  }

  /** O elemento onde o próximo traço continua: existe, está visível e não está bloqueado. */
  private resolveCurrentInk(): string | null {
    const id = this.currentInkId;
    if (id === null) return null;
    const snapshot = this.section.getSnapshot();
    const node = snapshot.document.nodes[id];
    if (!node || !isInkNode(node) || !node.visible || !this.isEditableNode(node)) return null;
    return id;
  }

  private startDrawing(input: PointerDownInput): void {
    const snapshot = this.section.getSnapshot();
    if (snapshot.session.readOnly) return;
    // Sem camada visível e desbloqueada não há onde desenhar.
    if (findTargetLayerId(snapshot.document.layers) === undefined) return;

    const startWorld = screenToWorld(snapshot.session.viewport, input.point);
    this.current = {
      name: 'drawing',
      pointerId: input.pointerId,
      inkId: this.resolveCurrentInk(),
      rawPoints: [startWorld],
      settings: this.penSettings,
    };
    this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
    this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
    this.updateDrawingPreview();
  }

  private finishDrawing(input: PointerUpInput): void {
    if (this.current.name !== 'drawing') return;
    const { pointerId, rawPoints, settings } = this.current;
    const viewport = this.section.getSnapshot().session.viewport;
    appendRawPoint(rawPoints, screenToWorld(viewport, input.point));

    this.section.setPreview(null);
    this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
    this.current = { name: 'idle' };
    this.dispatchAction({ type: 'SET_CURSOR', cursor: this.getIdleCursor() });

    const worldPoints = finalizeStroke(rawPoints, viewport.zoom);
    if (worldPoints.length === 0) return;
    const stroke = {
      color: settings.color,
      kind: settings.kind,
      width: settings.width,
      worldPoints,
    };

    // O elemento pode ter mudado desde o começo do gesto (desfazer, remoção, bloqueio).
    const inkId = this.resolveCurrentInk();
    const node = inkId === null ? undefined : this.section.getSnapshot().document.nodes[inkId];
    if (inkId !== null && node && isInkNode(node) && canAppendInkStroke(node, worldPoints.length)) {
      const result = this.section.dispatch({
        type: 'shape.update',
        id: inkId,
        patch: appendInkStroke(node, stroke),
      });
      if (result.ok) return;
    }

    const layerId = findTargetLayerId(this.section.getSnapshot().document.layers);
    if (layerId === undefined) return;
    const result = this.section.dispatch({
      type: 'shape.create',
      shape: inkInputFromStroke(stroke),
      layerId,
    });
    if (result.ok) {
      this.currentInkId = result.value.createdIds[0] ?? result.value.affectedIds[0] ?? null;
    }
  }

  private startErasing(input: PointerDownInput): void {
    const snapshot = this.section.getSnapshot();
    // O indicador segue o ponteiro mesmo sem poder apagar (readOnly).
    const start = screenToWorld(snapshot.session.viewport, input.point);
    this.showEraserCursor(start);
    if (snapshot.session.readOnly) return;

    const touched = new Map<string, ErasedInk>();
    this.current = {
      name: 'erasing',
      pointerId: input.pointerId,
      passPoints: [start],
      size: this.eraserSize,
      touched,
    };
    this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
    this.dispatchAction({ type: 'SET_CURSOR', cursor: 'none' });
    // Um clique é uma passada de um ponto: apaga um círculo.
    if (
      eraseSegment(
        this.section,
        touched,
        start,
        start,
        this.eraserSize,
        snapshot.session.viewport.zoom,
      )
    ) {
      this.updateErasingPreview();
    }
  }

  private continueErasing(input: PointerMoveInput): void {
    if (this.current.name !== 'erasing') return;
    const { passPoints, touched, size } = this.current;
    const viewport = this.section.getSnapshot().session.viewport;
    const samples =
      input.coalescedPoints !== undefined && input.coalescedPoints.length > 0
        ? input.coalescedPoints
        : [input.point];
    let changed = false;
    let latest = passPoints[passPoints.length - 1]!;
    for (const sample of samples) {
      const world = screenToWorld(viewport, sample);
      if (world.x === latest.x && world.y === latest.y) continue;
      // Só o último trecho da passada é calculado, sobre o que já foi apagado.
      if (eraseSegment(this.section, touched, latest, world, size, viewport.zoom)) changed = true;
      passPoints.push(world);
      latest = world;
    }
    this.showEraserCursor(latest);
    if (changed) this.updateErasingPreview();
  }

  private updateErasingPreview(): void {
    if (this.current.name !== 'erasing') return;
    const updates = buildErasePreviews(this.current.touched);
    this.section.setPreview(updates.length > 0 ? { updates } : null);
  }

  private finishErasing(input: PointerUpInput): void {
    if (this.current.name !== 'erasing') return;
    const { pointerId, passPoints, touched, size } = this.current;
    const viewport = this.section.getSnapshot().session.viewport;
    const last = passPoints[passPoints.length - 1]!;
    const end = screenToWorld(viewport, input.point);
    if (end.x !== last.x || end.y !== last.y) {
      eraseSegment(this.section, touched, last, end, size, viewport.zoom);
    }

    this.section.setPreview(null);
    this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
    this.current = { name: 'idle' };
    this.dispatchAction({ type: 'SET_CURSOR', cursor: this.getIdleCursor() });
    this.showEraserCursor(end);

    // Uma passada que não tocou nenhum traço não gera transação nem histórico.
    const commands = buildEraseCommands(touched);
    if (commands.length > 0) this.section.transact(commands);
  }

  private updateRotatingPreview(): void {
    if (this.current.name !== 'rotating') return;
    const { center, startWorld, currentWorld, initialNodes, shiftKey } = this.current;
    const deltaAngle = calculateRotationAngle(center, startWorld, currentWorld, shiftKey);
    const rotated = rotateShapes(initialNodes, center, deltaAngle);
    const updates = rotated.map((shape) => buildResizePreview(shape));
    this.section.setPreview({ updates });
  }

  private updateResizingPreview(): void {
    if (this.current.name !== 'resizing') return;

    if (this.current.singleShape) {
      const resized = resizeShape(
        this.current.singleShape,
        this.current.handle,
        this.current.currentWorld,
        { preserveAspectRatio: this.current.shiftKey },
      );
      const preview = buildResizePreview(resized);
      this.section.setPreview({ updates: [preview] });
      return;
    }

    if (this.current.multipleNodes && this.current.bounds) {
      const scaled = scaleMultipleShapes(
        this.current.multipleNodes,
        this.current.bounds,
        this.current.handle,
        this.current.currentWorld,
      );
      const previews = buildMultiResizePreviews(scaled);
      this.section.setPreview({ updates: previews });
    }
  }

  /** Arrasto mínimo, em unidades de mundo, para a nota usar a caixa do gesto e não o tamanho padrão. */
  private minStickyDrag(): number {
    const zoom = this.section.getSnapshot().session.viewport.zoom;
    return MIN_STICKY_DRAG_CSS_PX / (zoom > 0 ? zoom : 1);
  }

  /**
   * Cria o board da ferramenta na camada da frente que está visível e desbloqueada e adota os nós
   * sob ele, numa só transação. Depois seleciona o board e devolve a ferramenta a Selecionar.
   */
  private commitBoardCreation(box: BoardBox): void {
    const snapshot = this.section.getSnapshot();
    const layerId = findTargetLayerId(snapshot.document.layers);
    if (layerId === undefined || snapshot.session.readOnly) return;

    const boardId = newBoardId(snapshot.document);
    const title = nextBoardTitle(snapshot.document, this.options?.boardTitle);
    const adoptees = boardAdoptees(this.section, layerId, box);
    const result = this.section.transact(
      buildBoardCommands(boardId, box, title, layerId, adoptees),
    );
    if (!result.ok) return;
    this.section.setSelection([boardId]);
    this.section.setTool('select');
  }

  private updateCreationPreview(): void {
    if (this.current.name !== 'creating') return;

    if (this.current.tool === 'text') {
      const geo = computeTextCreationGeometry(this.current.startWorld, this.current.currentWorld);
      const preview: PreviewShape = {
        id: '__preview_text__',
        type: 'text',
        x: geo.x,
        y: geo.y,
        width: geo.width,
        height: geo.height,
        rotation: 0,
        text: '',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 'normal',
        textAlign: 'left',
        lineHeight: 1.25,
        style: {
          fill: '#111827',
          stroke: '#3b82f6',
          strokeWidth: 1,
          opacity: 0.7,
        },
      };
      this.section.setPreview({ additions: [preview] });
      return;
    }

    if (this.current.tool === 'sticky') {
      const box = computeStickyCreation(
        this.current.startWorld,
        this.current.currentWorld,
        this.minStickyDrag(),
      );
      this.section.setPreview({
        additions: [buildStickyPreview(box, this.stickyColor, '__preview_sticky__')],
      });
      return;
    }

    if (this.current.tool === 'board') {
      const box = computeBoardCreation(
        this.current.startWorld,
        this.current.currentWorld,
        this.minStickyDrag(),
      );
      const title = nextBoardTitle(this.section.getSnapshot().document, this.options?.boardTitle);
      this.section.setPreview({ additions: [buildBoardPreview(box, title, '__preview_board__')] });
      return;
    }

    if (this.current.tool === 'arrow') {
      const doc = this.section.getSnapshot().document;
      const endTarget = findAnchorTargetAtPoint(
        this.current.currentWorld,
        doc,
        (pt, opts) => this.section.hitTest(pt, { includePreview: false, ...opts }),
        this.current.startTarget?.targetId,
      );

      const arrowGeo = computeArrowCreation({
        startWorld: this.current.startWorld,
        currentWorld: this.current.currentWorld,
        startTarget: this.current.startTarget,
        endTarget,
        shiftKey: this.current.shiftKey,
      });

      if (!isArrowCreationValid(arrowGeo.length)) {
        this.section.setPreview(null);
        return;
      }

      const preview = buildArrowPreviewShape({
        start: arrowGeo.start,
        end: arrowGeo.end,
      });
      this.section.setPreview({ additions: [preview] });
      return;
    }

    const geometry = computeCreationGeometry({
      tool: this.current.tool,
      startWorld: this.current.startWorld,
      currentWorld: this.current.currentWorld,
      shiftKey: this.current.shiftKey,
    });

    if (!isCreationValid(geometry)) {
      this.section.setPreview(null);
      return;
    }

    const preview = buildPreviewShape(geometry);
    this.section.setPreview({ additions: [preview] });
  }

  private handlePointerDown(input: PointerDownInput): void {
    if (this.current.name !== 'idle') return;

    const currentTool: ToolId = this.section.getSnapshot().session.activeTool;
    const isMiddleButton = input.button === 1;
    const isHandTool = currentTool === 'hand' && input.button === 0;
    const isSpacePan = (input.spaceKey || this.spacePressed) && input.button === 0;

    if (isHandTool || isMiddleButton || isSpacePan) {
      const source: PanSource = isMiddleButton ? 'middle' : isSpacePan ? 'space' : 'hand';
      const startViewport = this.section.getSnapshot().session.viewport;

      this.current = {
        name: 'panning',
        pointerId: input.pointerId,
        startPoint: input.point,
        startViewport,
        source,
      };

      this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
      this.dispatchAction({ type: 'SET_CURSOR', cursor: 'grabbing' });
      return;
    }

    if (currentTool === 'pen' && input.button === 0) {
      this.startDrawing(input);
      return;
    }

    if (currentTool === 'eraser' && input.button === 0) {
      this.startErasing(input);
      return;
    }

    if (currentTool === 'sticky' && input.button === 0) {
      if (this.section.getSnapshot().session.readOnly) {
        return;
      }

      const viewport = this.section.getSnapshot().session.viewport;
      const startWorld = screenToWorld(viewport, input.point);

      // Clicar numa nota existente a edita, como o texto.
      const hitId = this.section.hitTest(startWorld, {
        includeLocked: false,
        includePreview: false,
      });
      const hitNode = hitId ? this.section.getSnapshot().document.nodes[hitId] : undefined;
      if (hitNode && isStickyNode(hitNode) && this.isEditableNode(hitNode)) {
        this.startTextEdit(hitNode, false);
        return;
      }

      this.current = {
        name: 'creating',
        pointerId: input.pointerId,
        tool: 'sticky',
        startWorld,
        currentWorld: startWorld,
        shiftKey: input.shiftKey,
      };

      this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
      this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
      return;
    }

    if (currentTool === 'text' && input.button === 0) {
      if (this.section.getSnapshot().session.readOnly) {
        return;
      }

      const viewport = this.section.getSnapshot().session.viewport;
      const startWorld = screenToWorld(viewport, input.point);

      // Se clicar diretamente sobre nó de texto existente, entra em edição
      const hitId = this.section.hitTest(startWorld, {
        includeLocked: false,
        includePreview: false,
      });
      if (hitId) {
        const hitNode = this.section.getSnapshot().document.nodes[hitId];
        if (hitNode && isTextNode(hitNode) && !hitNode.locked && !this.isPeerLocked(hitNode.id)) {
          const layer = this.section
            .getSnapshot()
            .document.layers.find((l) => l.childIds.includes(hitNode.id));
          if (!layer || (!layer.locked && layer.visible)) {
            this.startTextEdit(hitNode, false);
            return;
          }
        }
      }

      this.current = {
        name: 'creating',
        pointerId: input.pointerId,
        tool: 'text',
        startWorld,
        currentWorld: startWorld,
        shiftKey: input.shiftKey,
      };

      this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
      this.dispatchAction({ type: 'SET_CURSOR', cursor: 'text' });
      return;
    }

    if (currentTool === 'board' && input.button === 0) {
      if (this.section.getSnapshot().session.readOnly) {
        return;
      }

      const viewport = this.section.getSnapshot().session.viewport;
      const startWorld = screenToWorld(viewport, input.point);

      this.current = {
        name: 'creating',
        pointerId: input.pointerId,
        tool: 'board',
        startWorld,
        currentWorld: startWorld,
        shiftKey: input.shiftKey,
      };

      this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
      this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
      return;
    }

    if (isCreationToolId(currentTool) && input.button === 0) {
      if (this.section.getSnapshot().session.readOnly) {
        return;
      }

      const viewport = this.section.getSnapshot().session.viewport;
      const startWorld = screenToWorld(viewport, input.point);

      this.current = {
        name: 'creating',
        pointerId: input.pointerId,
        tool: currentTool,
        startWorld,
        currentWorld: startWorld,
        shiftKey: input.shiftKey,
      };

      this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
      this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
      return;
    }

    if (currentTool === 'arrow' && input.button === 0) {
      if (this.section.getSnapshot().session.readOnly) {
        return;
      }

      const viewport = this.section.getSnapshot().session.viewport;
      const startWorld = screenToWorld(viewport, input.point);
      const doc = this.section.getSnapshot().document;

      const startTarget = findAnchorTargetAtPoint(startWorld, doc, (pt, opts) =>
        this.section.hitTest(pt, { includePreview: false, ...opts }),
      );

      this.current = {
        name: 'creating',
        pointerId: input.pointerId,
        tool: 'arrow',
        startWorld,
        currentWorld: startWorld,
        shiftKey: input.shiftKey,
        startTarget,
      };

      this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
      this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
      return;
    }

    if (currentTool === 'select' && input.button === 0) {
      const isReadOnly = this.section.getSnapshot().session.readOnly;
      const viewport = this.section.getSnapshot().session.viewport;
      const startWorld = screenToWorld(viewport, input.point);
      const initialSelectedIds = this.section.getSnapshot().session.selectedIds;
      const selectedId = initialSelectedIds.length === 1 ? initialSelectedIds[0] : undefined;
      const selectedNode =
        selectedId !== undefined
          ? this.section.getSnapshot().document.nodes[selectedId]
          : undefined;

      if (!isReadOnly && selectedId !== undefined && selectedNode !== undefined) {
        if (
          selectedNode.type !== 'group' &&
          !selectedNode.locked &&
          !this.isPeerLocked(selectedId)
        ) {
          // Bloqueio da camada (ou do board, para um filho): o que `Layer.childIds` não diz, porque
          // o filho de board não está na lista da camada.
          if (this.section.getNodeInfo(selectedId)?.locked !== true) {
            const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
            const toleranceWorld = 14 / zoom;

            // 1. Verifica handle de rotação para nó único (o board não gira)
            const rotHandle =
              selectedNode.type === 'board' ? null : getRotationHandlePoint([selectedNode], zoom);
            if (
              selectedNode.type !== 'board' &&
              rotHandle &&
              isRotationHandleHit(rotHandle, startWorld, toleranceWorld)
            ) {
              const center = getRotationCenter([selectedNode]);
              if (center) {
                this.current = {
                  name: 'rotating',
                  pointerId: input.pointerId,
                  center,
                  startWorld,
                  currentWorld: startWorld,
                  initialNodes: [selectedNode],
                  shiftKey: input.shiftKey,
                };
                this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
                this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
                return;
              }
            }

            // 2. Verifica handles de redimensionamento
            const hitHandle = findResizeHandleAtPoint(selectedNode, startWorld, toleranceWorld);
            if (hitHandle !== null) {
              this.current = {
                name: 'resizing',
                pointerId: input.pointerId,
                singleShape: selectedNode,
                handle: hitHandle,
                startWorld,
                currentWorld: startWorld,
                shiftKey: input.shiftKey,
              };
              this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
              const rotation = 'rotation' in selectedNode ? selectedNode.rotation : 0;
              this.dispatchAction({
                type: 'SET_CURSOR',
                cursor: getResizeCursor(hitHandle, rotation),
              });
              return;
            }
          }
        }
      }

      const isGroupSelected = selectedId !== undefined && selectedNode?.type === 'group';
      // Uma seleção com board não tem alças de redimensionar nem de girar.
      const selectionHasBoard = initialSelectedIds.some(
        (id) => this.section.getSnapshot().document.nodes[id]?.type === 'board',
      );
      if (!isReadOnly && !selectionHasBoard && (initialSelectedIds.length > 1 || isGroupSelected)) {
        const movableNodes = getTransformableNodes(this.section, initialSelectedIds);
        if (movableNodes.length > 1) {
          const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
          const toleranceWorld = 14 / zoom;

          // 1. Verifica handle de rotação para seleção múltipla ou grupo
          const rotHandle = getRotationHandlePoint(movableNodes, zoom);
          if (rotHandle && isRotationHandleHit(rotHandle, startWorld, toleranceWorld)) {
            const center = getRotationCenter(movableNodes);
            if (center) {
              this.current = {
                name: 'rotating',
                pointerId: input.pointerId,
                center,
                startWorld,
                currentWorld: startWorld,
                initialNodes: movableNodes,
                shiftKey: input.shiftKey,
              };
              this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
              this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
              return;
            }
          }

          // 2. Verifica handles de redimensionamento
          const bounds = computeAggregateBounds(movableNodes);
          if (bounds) {
            const hitHandle = findMultiResizeHandleAtPoint(bounds, startWorld, toleranceWorld);
            if (hitHandle !== null) {
              this.current = {
                name: 'resizing',
                pointerId: input.pointerId,
                multipleNodes: movableNodes,
                bounds,
                handle: hitHandle,
                startWorld,
                currentWorld: startWorld,
                shiftKey: input.shiftKey,
              };
              this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
              this.dispatchAction({
                type: 'SET_CURSOR',
                cursor: getResizeCursor(hitHandle, 0),
              });
              return;
            }
          }
        }
      }

      const rawHitId = this.section.hitTest(startWorld, {
        includeLocked: false,
        includePreview: false,
      });
      const rawHitAnyId = this.section.hitTest(startWorld, {
        includeLocked: true,
        includePreview: false,
      });
      const doc = this.section.getSnapshot().document;
      let hitId = resolveSelectableId(doc, rawHitId);
      const hitAnyId = resolveSelectableId(doc, rawHitAnyId);
      if (hitId) {
        const node = doc.nodes[hitId];
        if (node && node.locked) {
          hitId = undefined;
        }
        // Bloqueado por outro participante: não seleciona, não arrasta e não deixa passar o clique.
        if (hitId && this.isPeerLocked(hitId)) {
          hitId = undefined;
        }
      }
      const hitLocked = hitId === undefined && hitAnyId !== undefined;

      // Board que não estava selecionado: o título o seleciona já na descida (e o arrasto o move);
      // o fundo vazio seleciona no clique e inicia a marquee no arrasto.
      let selectedAtDown = initialSelectedIds;
      let marqueeOnDrag = false;
      const hitBoard = hitId === undefined ? undefined : doc.nodes[hitId];
      if (hitBoard?.type === 'board' && !initialSelectedIds.includes(hitBoard.id)) {
        const title = boardTitleBounds(hitBoard);
        const inTitle =
          startWorld.x >= title.x &&
          startWorld.x <= title.x + title.width &&
          startWorld.y >= title.y &&
          startWorld.y <= title.y + title.height;
        if (inTitle && !input.shiftKey && !isReadOnly) {
          this.section.setSelection([hitBoard.id]);
          selectedAtDown = [hitBoard.id];
        } else if (!inTitle) {
          marqueeOnDrag = true;
        }
      }

      this.current = {
        name: 'selecting',
        pointerId: input.pointerId,
        startScreen: input.point,
        currentScreen: input.point,
        startWorld,
        hitId,
        hitLocked,
        initialSelectedIds: selectedAtDown,
        shiftKey: input.shiftKey,
        marqueeOnDrag,
      };

      this.dispatchAction({ type: 'CAPTURE_POINTER', pointerId: input.pointerId });
    }
  }

  private handlePointerMove(input: PointerMoveInput): void {
    if (this.current.name === 'panning') {
      if (input.pointerId !== this.current.pointerId) return;

      const dx = input.point.x - this.current.startPoint.x;
      const dy = input.point.y - this.current.startPoint.y;

      const nextViewport: Viewport = {
        x: this.current.startViewport.x + dx,
        y: this.current.startViewport.y + dy,
        zoom: this.current.startViewport.zoom,
      };

      this.section.setViewport(nextViewport);
      this.dispatchAction({ type: 'SET_VIEWPORT', viewport: nextViewport });
      return;
    }

    if (this.current.name === 'erasing') {
      if (input.pointerId !== this.current.pointerId) return;
      this.continueErasing(input);
      return;
    }

    if (
      this.current.name === 'idle' &&
      this.section.getSnapshot().session.activeTool === 'eraser'
    ) {
      const viewport = this.section.getSnapshot().session.viewport;
      this.showEraserCursor(screenToWorld(viewport, input.point));
      return;
    }

    if (this.current.name === 'drawing') {
      if (input.pointerId !== this.current.pointerId) return;
      const viewport = this.section.getSnapshot().session.viewport;
      const samples =
        input.coalescedPoints !== undefined && input.coalescedPoints.length > 0
          ? input.coalescedPoints
          : [input.point];
      let added = false;
      for (const sample of samples) {
        if (appendRawPoint(this.current.rawPoints, screenToWorld(viewport, sample))) added = true;
      }
      if (added) this.updateDrawingPreview();
      return;
    }

    if (this.current.name === 'creating') {
      if (input.pointerId !== this.current.pointerId) return;

      const viewport = this.section.getSnapshot().session.viewport;
      const rawWorld = screenToWorld(viewport, input.point);

      let effectiveWorld = rawWorld;
      if (this.isSnappingActive(input.altKey)) {
        const doc = this.section.getSnapshot().document;
        const snap = computePointSnap(rawWorld, doc, {
          zoom: viewport.zoom,
          toleranceCssPx: this.options?.snapToleranceCssPx,
          altKey: input.altKey,
          grid: this.getGridConfig(),
        });
        effectiveWorld = {
          x: rawWorld.x + snap.delta.x,
          y: rawWorld.y + snap.delta.y,
        };
        this.setGuides(snap.guides);
      } else {
        this.setGuides(null);
      }

      this.current = {
        ...this.current,
        currentWorld: effectiveWorld,
      };

      this.updateCreationPreview();
      return;
    }

    if (this.current.name === 'selecting') {
      if (input.pointerId !== this.current.pointerId) return;

      this.current = {
        ...this.current,
        currentScreen: input.point,
      };

      // Se clicou sobre um shape bloqueado, não inicia marquee nem moving
      if (this.current.hitLocked) return;

      // Se clicou no vazio (ou no fundo de um board não selecionado) e ultrapassou o threshold,
      // inicia marquee
      if (
        (this.current.hitId === undefined || this.current.marqueeOnDrag === true) &&
        !isClickGesture(this.current.startScreen, input.point)
      ) {
        const viewport = this.section.getSnapshot().session.viewport;
        const currentWorld = screenToWorld(viewport, input.point);

        this.current = {
          name: 'marquee',
          pointerId: this.current.pointerId,
          startScreen: this.current.startScreen,
          startWorld: this.current.startWorld,
          currentWorld,
          initialSelectedIds: this.current.initialSelectedIds,
          shiftKey: this.current.shiftKey,
        };

        const bounds = computeMarqueeBounds(this.current.startWorld, currentWorld);
        this.section.setPreview({ marquee: bounds });
        return;
      }

      // Se clicou sobre um shape selecionado e ultrapassou o threshold, inicia moving da seleção inteira
      if (
        !this.section.getSnapshot().session.readOnly &&
        this.current.hitId !== undefined &&
        this.current.initialSelectedIds.includes(this.current.hitId) &&
        !isClickGesture(this.current.startScreen, input.point)
      ) {
        const viewport = this.section.getSnapshot().session.viewport;
        const currentWorld = screenToWorld(viewport, input.point);

        const movableNodes = getMovableNodes(this.section, this.current.initialSelectedIds);
        if (movableNodes.length === 0) return;

        const aggregateBounds = computeAggregateBounds(movableNodes);
        const rawDelta = computeMoveDelta(this.current.startWorld, currentWorld);

        let finalDelta = rawDelta;
        if (this.isSnappingActive(input.altKey) && aggregateBounds) {
          const doc = this.section.getSnapshot().document;
          const movedBox: Bounds = {
            x: aggregateBounds.x + rawDelta.x,
            y: aggregateBounds.y + rawDelta.y,
            width: aggregateBounds.width,
            height: aggregateBounds.height,
          };
          const snap = computeBoxSnap(movedBox, doc, {
            zoom: viewport.zoom,
            toleranceCssPx: this.options?.snapToleranceCssPx,
            altKey: input.altKey,
            grid: this.getGridConfig(),
            excludedIds: this.current.initialSelectedIds,
          });
          finalDelta = {
            x: rawDelta.x + snap.delta.x,
            y: rawDelta.y + snap.delta.y,
          };
          this.setGuides(snap.guides);
        } else {
          this.setGuides(null);
        }

        this.current = {
          name: 'moving',
          pointerId: this.current.pointerId,
          startScreen: this.current.startScreen,
          startWorld: this.current.startWorld,
          currentWorld,
          initialSelectedIds: this.current.initialSelectedIds,
          movableNodes,
          aggregateBounds,
          snappedDelta: finalDelta,
        };

        const updates = buildMovePreviews(movableNodes, finalDelta);
        this.section.setPreview({ updates });
        this.setDropTarget(
          findBoardDropTarget(this.section, this.current.initialSelectedIds, finalDelta) ?? null,
        );
        this.dispatchAction({ type: 'SET_CURSOR', cursor: 'move' });
        return;
      }

      return;
    }

    if (this.current.name === 'marquee') {
      if (input.pointerId !== this.current.pointerId) return;

      const viewport = this.section.getSnapshot().session.viewport;
      const currentWorld = screenToWorld(viewport, input.point);

      this.current = {
        ...this.current,
        currentWorld,
      };

      const bounds = computeMarqueeBounds(this.current.startWorld, currentWorld);
      this.section.setPreview({ marquee: bounds });
      return;
    }

    if (this.current.name === 'moving') {
      if (input.pointerId !== this.current.pointerId) return;

      const viewport = this.section.getSnapshot().session.viewport;
      const currentWorld = screenToWorld(viewport, input.point);

      const rawDelta = computeMoveDelta(this.current.startWorld, currentWorld);
      let finalDelta = rawDelta;
      if (this.isSnappingActive(input.altKey) && this.current.aggregateBounds) {
        const doc = this.section.getSnapshot().document;
        const origBox = this.current.aggregateBounds;
        const movedBox: Bounds = {
          x: origBox.x + rawDelta.x,
          y: origBox.y + rawDelta.y,
          width: origBox.width,
          height: origBox.height,
        };
        const snap = computeBoxSnap(movedBox, doc, {
          zoom: viewport.zoom,
          toleranceCssPx: this.options?.snapToleranceCssPx,
          altKey: input.altKey,
          grid: this.getGridConfig(),
          excludedIds: this.current.initialSelectedIds,
        });
        finalDelta = {
          x: rawDelta.x + snap.delta.x,
          y: rawDelta.y + snap.delta.y,
        };
        this.setGuides(snap.guides);
      } else {
        this.setGuides(null);
      }

      this.current = {
        ...this.current,
        currentWorld,
        snappedDelta: finalDelta,
      };

      const updates = buildMovePreviews(this.current.movableNodes, finalDelta);
      this.section.setPreview({ updates });
      this.setDropTarget(
        findBoardDropTarget(this.section, this.current.initialSelectedIds, finalDelta) ?? null,
      );
      return;
    }

    if (this.current.name === 'resizing') {
      if (input.pointerId !== this.current.pointerId) return;

      const viewport = this.section.getSnapshot().session.viewport;
      const rawWorld = screenToWorld(viewport, input.point);

      let effectiveWorld = rawWorld;
      if (this.isSnappingActive(input.altKey)) {
        const doc = this.section.getSnapshot().document;
        const excludedIds = this.current.singleShape
          ? [this.current.singleShape.id]
          : (this.current.multipleNodes?.map((n) => n.id) ?? []);

        const snap = computePointSnap(rawWorld, doc, {
          zoom: viewport.zoom,
          toleranceCssPx: this.options?.snapToleranceCssPx,
          altKey: input.altKey,
          grid: this.getGridConfig(),
          excludedIds,
        });
        effectiveWorld = {
          x: rawWorld.x + snap.delta.x,
          y: rawWorld.y + snap.delta.y,
        };
        this.setGuides(snap.guides);
      } else {
        this.setGuides(null);
      }

      this.current = {
        ...this.current,
        currentWorld: effectiveWorld,
      };

      this.updateResizingPreview();
      return;
    }

    if (this.current.name === 'rotating') {
      if (input.pointerId !== this.current.pointerId) return;

      const viewport = this.section.getSnapshot().session.viewport;
      const currentWorld = screenToWorld(viewport, input.point);

      this.current = {
        ...this.current,
        currentWorld,
      };

      this.updateRotatingPreview();
      return;
    }

    if (this.current.name === 'idle') {
      const tool = this.section.getSnapshot().session.activeTool;
      if (tool === 'select' && !this.spacePressed) {
        const viewport = this.section.getSnapshot().session.viewport;
        const currentWorld = screenToWorld(viewport, input.point);
        const selectedIds = this.section.getSnapshot().session.selectedIds;
        const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
        const toleranceWorld = 14 / zoom;

        const isSingleGroup =
          selectedIds.length === 1 &&
          this.section.getSnapshot().document.nodes[selectedIds[0]!]?.type === 'group';

        if (selectedIds.length === 1 && !isSingleGroup) {
          const selectedId = selectedIds[0]!;
          const selectedNode = this.section.getSnapshot().document.nodes[selectedId];
          if (
            selectedNode &&
            selectedNode.type !== 'group' &&
            !selectedNode.locked &&
            !this.isPeerLocked(selectedId)
          ) {
            const rotHandle =
              selectedNode.type === 'board' ? null : getRotationHandlePoint([selectedNode], zoom);
            if (rotHandle && isRotationHandleHit(rotHandle, currentWorld, toleranceWorld)) {
              this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
              return;
            }
            const hitHandle = findResizeHandleAtPoint(selectedNode, currentWorld, toleranceWorld);
            if (hitHandle !== null) {
              const rotation = 'rotation' in selectedNode ? selectedNode.rotation : 0;
              this.dispatchAction({
                type: 'SET_CURSOR',
                cursor: getResizeCursor(hitHandle, rotation),
              });
              return;
            }
            const rawHitId = this.section.hitTest(currentWorld, {
              includeLocked: false,
              includePreview: false,
            });
            const hitId = resolveSelectableId(this.section.getSnapshot().document, rawHitId);
            if (hitId === selectedId) {
              this.dispatchAction({ type: 'SET_CURSOR', cursor: 'move' });
              return;
            }
          }
        } else if (
          (selectedIds.length > 1 || isSingleGroup) &&
          !selectedIds.some((id) => this.section.getSnapshot().document.nodes[id]?.type === 'board')
        ) {
          const movableNodes = getTransformableNodes(this.section, selectedIds);
          if (movableNodes.length > 1) {
            const rotHandle = getRotationHandlePoint(movableNodes, zoom);
            if (rotHandle && isRotationHandleHit(rotHandle, currentWorld, toleranceWorld)) {
              this.dispatchAction({ type: 'SET_CURSOR', cursor: 'crosshair' });
              return;
            }
            const bounds = computeAggregateBounds(movableNodes);
            if (bounds) {
              const hitHandle = findMultiResizeHandleAtPoint(bounds, currentWorld, toleranceWorld);
              if (hitHandle !== null) {
                this.dispatchAction({
                  type: 'SET_CURSOR',
                  cursor: getResizeCursor(hitHandle, 0),
                });
                return;
              }
            }
            const rawHitId = this.section.hitTest(currentWorld, {
              includeLocked: false,
              includePreview: false,
            });
            const hitId = resolveSelectableId(this.section.getSnapshot().document, rawHitId);
            if (hitId && selectedIds.includes(hitId)) {
              this.dispatchAction({ type: 'SET_CURSOR', cursor: 'move' });
              return;
            }
          }
        }
        // Sobre um nó bloqueado por outro participante o ponteiro avisa que não dá para usar.
        const hoverId = resolveSelectableId(
          this.section.getSnapshot().document,
          this.section.hitTest(currentWorld, { includeLocked: false, includePreview: false }),
        );
        const hoveredLocked = hoverId !== undefined && this.isPeerLocked(hoverId);
        this.dispatchAction({
          type: 'SET_CURSOR',
          cursor: hoveredLocked ? 'not-allowed' : 'default',
        });
      } else if (tool === 'text' && !this.spacePressed) {
        this.dispatchAction({ type: 'SET_CURSOR', cursor: 'text' });
      }
    }
  }

  private handlePointerUp(input: PointerUpInput): void {
    if (this.current.name === 'panning') {
      if (input.pointerId !== this.current.pointerId) return;

      const { pointerId } = this.current;
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.handCursorOrDefault(),
      });
      return;
    }

    if (this.current.name === 'drawing') {
      if (input.pointerId !== this.current.pointerId) return;
      this.finishDrawing(input);
      return;
    }

    if (this.current.name === 'erasing') {
      if (input.pointerId !== this.current.pointerId) return;
      this.finishErasing(input);
      return;
    }

    if (this.current.name === 'creating') {
      this.setGuides(null);
      if (input.pointerId !== this.current.pointerId) return;

      const { pointerId, tool, startWorld, currentWorld, shiftKey, startTarget } = this.current;

      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.getIdleCursor(),
      });

      const viewport = this.section.getSnapshot().session.viewport;
      const upWorld = screenToWorld(viewport, input.point);
      const effectiveWorld =
        Math.hypot(upWorld.x - startWorld.x, upWorld.y - startWorld.y) > 0 ? upWorld : currentWorld;

      if (tool === 'sticky') {
        const box = computeStickyCreation(startWorld, effectiveWorld, this.minStickyDrag());
        this.startTextEdit(
          buildProvisionalSticky(box, this.stickyColor, `sticky-${Date.now()}`),
          true,
        );
        return;
      }

      if (tool === 'board') {
        this.commitBoardCreation(
          computeBoardCreation(startWorld, effectiveWorld, this.minStickyDrag()),
        );
        return;
      }

      if (tool === 'text') {
        const geo = computeTextCreationGeometry(startWorld, effectiveWorld);
        const textInput = buildCreateTextInput({
          x: geo.x,
          y: geo.y,
          width: geo.width,
        });
        const provisionalNode: TextNode = {
          id: `text-${Date.now()}`,
          type: 'text',
          x: textInput.x,
          y: textInput.y,
          width: textInput.width,
          height: geo.height,
          rotation: 0,
          text: textInput.text,
          fontSize: textInput.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
          fontSizeMode: 'auto',
          fontFamily: textInput.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
          fontWeight: textInput.fontWeight ?? DEFAULT_TEXT_FONT_WEIGHT,
          textAlign: textInput.textAlign ?? DEFAULT_TEXT_ALIGN,
          lineHeight: textInput.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
          visible: true,
          locked: false,
          style: {
            fill: textInput.style?.fill ?? '#111827',
            stroke: null,
            strokeWidth: 0,
            opacity: 1,
          },
        };
        this.startTextEdit(provisionalNode, true);
        return;
      }

      if (tool === 'arrow') {
        const doc = this.section.getSnapshot().document;
        const endTarget = findAnchorTargetAtPoint(
          effectiveWorld,
          doc,
          (pt, opts) => this.section.hitTest(pt, { includePreview: false, ...opts }),
          startTarget?.targetId,
        );

        const arrowGeo = computeArrowCreation({
          startWorld,
          currentWorld: effectiveWorld,
          startTarget,
          endTarget,
          shiftKey,
        });

        if (isArrowCreationValid(arrowGeo.length)) {
          const shapeInput = buildArrowCreateInput({
            start: arrowGeo.start,
            end: arrowGeo.end,
          });
          const targetLayerId = findTargetLayerId(doc.layers);
          const result = this.section.dispatch({
            type: 'shape.create',
            shape: shapeInput,
            ...(targetLayerId !== undefined ? { layerId: targetLayerId } : {}),
          });

          if (result.ok) {
            const createdId = result.value.createdIds[0] ?? result.value.affectedIds[0];
            if (createdId) {
              this.section.setSelection([createdId]);
            }
          }
        }
        return;
      }

      const geometry = computeCreationGeometry({
        tool,
        startWorld,
        currentWorld,
        shiftKey,
      });

      if (isCreationValid(geometry)) {
        const shapeInput = buildCreateShapeInput(geometry);
        const targetLayerId = findTargetLayerId(this.section.getSnapshot().document.layers);
        const result = this.section.dispatch({
          type: 'shape.create',
          shape: shapeInput,
          ...(targetLayerId !== undefined ? { layerId: targetLayerId } : {}),
        });

        if (result.ok) {
          const createdId = result.value.createdIds[0] ?? result.value.affectedIds[0];
          if (createdId) {
            this.section.setSelection([createdId]);
          }
        }
      }
      return;
    }

    if (this.current.name === 'selecting') {
      if (input.pointerId !== this.current.pointerId) return;

      const { pointerId, startScreen, startWorld, shiftKey } = this.current;
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.spacePressed ? 'grab' : 'default',
      });

      if (isClickGesture(startScreen, input.point)) {
        executeClickSelection(this.section, startWorld, shiftKey);
      }
      return;
    }

    if (this.current.name === 'marquee') {
      if (input.pointerId !== this.current.pointerId) return;

      const { pointerId, startWorld, currentWorld, shiftKey, initialSelectedIds } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.spacePressed ? 'grab' : 'default',
      });

      const bounds = computeMarqueeBounds(startWorld, currentWorld);
      const mode = computeMarqueeMode(startWorld, currentWorld);
      executeMarqueeSelection(this.section, bounds, mode, shiftKey, initialSelectedIds);
      return;
    }

    if (this.current.name === 'moving') {
      if (input.pointerId !== this.current.pointerId) return;

      const {
        pointerId,
        startWorld,
        currentWorld,
        movableNodes,
        snappedDelta,
        initialSelectedIds,
      } = this.current;
      this.setGuides(null);
      this.setDropTarget(null);
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.spacePressed ? 'grab' : 'default',
      });

      const delta = snappedDelta ?? computeMoveDelta(startWorld, currentWorld);
      executeMove(this.section, movableNodes, delta, { selectedIds: initialSelectedIds });
      return;
    }

    if (this.current.name === 'resizing') {
      if (input.pointerId !== this.current.pointerId) return;

      const { pointerId, singleShape, multipleNodes, bounds, handle, currentWorld, shiftKey } =
        this.current;
      this.setGuides(null);
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.spacePressed ? 'grab' : 'default',
      });

      if (singleShape) {
        const resized = resizeShape(singleShape, handle, currentWorld, {
          preserveAspectRatio: shiftKey,
        });
        const patch = buildResizePatch(resized);
        this.section.dispatch({
          type: 'shape.update',
          id: singleShape.id,
          patch,
        });
        return;
      }

      if (multipleNodes && bounds) {
        const scaled = scaleMultipleShapes(multipleNodes, bounds, handle, currentWorld);
        executeMultiResize(this.section, scaled);
        return;
      }

      return;
    }

    if (this.current.name === 'rotating') {
      if (input.pointerId !== this.current.pointerId) return;

      const { pointerId, center, startWorld, currentWorld, initialNodes, shiftKey } = this.current;
      this.section.setPreview(null);
      this.dispatchAction({ type: 'RELEASE_POINTER', pointerId });
      this.current = { name: 'idle' };
      this.dispatchAction({
        type: 'SET_CURSOR',
        cursor: this.spacePressed ? 'grab' : 'default',
      });

      const deltaAngle = calculateRotationAngle(center, startWorld, currentWorld, shiftKey);
      if (Math.abs(deltaAngle) > 0.0001) {
        const rotated = rotateShapes(initialNodes, center, deltaAngle);
        executeRotation(this.section, rotated);
      }
      return;
    }
  }

  private handlePointerCancel(input: PointerCancelInput): void {
    if (this.current.name === 'panning' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'creating' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'selecting' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'marquee' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'moving' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'resizing' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'rotating' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'drawing' && input.pointerId === this.current.pointerId) {
      this.cancel();
    } else if (this.current.name === 'erasing' && input.pointerId === this.current.pointerId) {
      this.cancel();
    }
  }

  private handleDoubleClick(input: DoubleClickInput): void {
    if (this.current.name !== 'idle' || input.button !== 0) return;
    if (this.section.getSnapshot().session.readOnly) return;

    const viewport = this.section.getSnapshot().session.viewport;
    const worldPoint = screenToWorld(viewport, input.point);
    // `labelAreas`: o interior de uma forma fechada ainda sem texto também abre o editor dela.
    const hitId = this.section.hitTest(worldPoint, {
      includeLocked: false,
      includePreview: false,
      labelAreas: true,
    });
    if (!hitId) return;

    const node = this.section.getSnapshot().document.nodes[hitId];
    if (!node || !this.isEditableNode(node)) return;
    if (node.type === 'board') {
      // Só a faixa do título abre o editor; o corpo do board não faz nada no duplo clique.
      const title = boardTitleBounds(node);
      if (
        worldPoint.x >= title.x &&
        worldPoint.x <= title.x + title.width &&
        worldPoint.y >= title.y &&
        worldPoint.y <= title.y + title.height
      ) {
        this.startBoardTitleEdit(node);
      }
      return;
    }
    if (
      isTextNode(node) ||
      isStickyNode(node) ||
      (isLabelable(node) && shapeLabelArea(node) !== null)
    ) {
      this.startTextEdit(node, false);
    }
  }

  /**
   * O nó que a edição de texto abre: livre de bloqueio do nó, do grupo e da camada, visível de
   * fato (nó, grupo e camada) e não bloqueado por outra sessão. Um nó dentro de grupo conta pelo
   * grupo e pela camada que o contêm, que só `getNodeInfo` soma.
   */
  private isEditableNode(node: { readonly id: string }): boolean {
    if (this.isPeerLocked(node.id)) return false;
    const info = this.section.getNodeInfo(node.id);
    return info !== undefined && !info.locked && info.visible;
  }

  /**
   * Abre o editor do texto da forma selecionada (a ação `edit-text`, o Enter): só com exatamente
   * um nó selecionado, elegível, com área inscrita e editável pelas mesmas regras do duplo clique.
   * Devolve `true` quando abriu.
   */
  public editSelectedText(): boolean {
    if (this.current.name !== 'idle') return false;
    const { document, session } = this.section.getSnapshot();
    if (session.readOnly || session.selectedIds.length !== 1) return false;
    const node = document.nodes[session.selectedIds[0]!];
    if (!node || !isLabelable(node) || shapeLabelArea(node) === null) return false;
    if (!this.isEditableNode(node)) return false;
    this.startTextEdit(node, false);
    return true;
  }

  public startTextEdit(node: TextNode | StickyNode | LabelableNode, isNew = false): void {
    if (this.current.name !== 'idle' && this.current.name !== 'creating') {
      this.cancel();
    }

    // Editar mantém o nó selecionado: é a seleção que o torna bloqueado para os outros.
    if (!isNew && !this.section.getSnapshot().session.selectedIds.includes(node.id)) {
      this.section.setSelection([node.id]);
    }

    const initialText = isLabelable(node) ? (node.label?.text ?? '') : node.text;
    this.current = {
      name: 'editing-text',
      nodeId: node.id,
      isNew,
      initialText,
      node,
    };

    // O texto existente some atrás do editor; a nota fica à vista e o editor a cobre. A forma
    // com texto continua visível, mas sem o texto, para ele não aparecer duas vezes.
    if (!isNew && node.type === 'text') {
      this.section.setPreview({
        updates: [{ ...node, style: { ...node.style, opacity: 0 } }],
      });
    } else if (!isNew && isLabelable(node) && node.label !== undefined && node.label.text !== '') {
      this.section.setPreview({
        updates: [toPreviewShape({ ...node, label: { ...node.label, text: '' } })],
      });
    }

    this.dispatchAction({
      type: 'START_TEXT_EDIT',
      node,
      isNew,
    });
  }

  public commitTextEdit(newText: string): void {
    if (this.current.name !== 'editing-text') return;

    const { node, isNew, initialText } = this.current;
    this.section.setPreview(null);
    this.current = { name: 'idle' };
    this.dispatchAction({ type: 'END_TEXT_EDIT' });
    this.dispatchAction({ type: 'SET_CURSOR', cursor: this.getIdleCursor() });

    const sanitized = newText.replace(
      /<(?:\/[a-zA-Z]|[a-zA-Z])[a-zA-Z0-9:-]*(?:\s+[^>]*)?\/?>/g,
      '',
    );

    if (isNew && node.type === 'sticky') {
      // Uma nota vazia é válida: nasce com o texto que houver, numa só entrada de histórico.
      const targetLayerId = findTargetLayerId(this.section.getSnapshot().document.layers);
      const res = this.section.dispatch({
        type: 'shape.create',
        shape: {
          id: node.id,
          type: 'sticky',
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          text: sanitized,
          fontSize: node.fontSize,
          fontSizeMode: node.fontSizeMode,
          fontFamily: node.fontFamily,
          fontWeight: node.fontWeight,
          textAlign: node.textAlign,
          lineHeight: node.lineHeight,
          style: node.style,
        },
        ...(targetLayerId !== undefined ? { layerId: targetLayerId } : {}),
      });
      if (res.ok) {
        this.section.setSelection([node.id]);
        this.section.setTool('select');
      }
      return;
    }

    if (isNew) {
      if (sanitized.trim().length === 0) {
        return;
      }

      // Só o texto livre e a nota nascem pelo editor; a forma já existe quando ele abre.
      const draft = node as TextNode;
      const targetLayerId = findTargetLayerId(this.section.getSnapshot().document.layers);
      const res = this.section.dispatch({
        type: 'shape.create',
        shape: {
          id: draft.id,
          type: 'text',
          x: draft.x,
          y: draft.y,
          width: draft.width,
          text: sanitized,
          fontSize: draft.fontSize,
          fontFamily: draft.fontFamily,
          fontWeight: draft.fontWeight,
          textAlign: draft.textAlign,
          lineHeight: draft.lineHeight,
          style: draft.style,
        },
        ...(targetLayerId !== undefined ? { layerId: targetLayerId } : {}),
      });

      if (res.ok) {
        this.section.setSelection([node.id]);
        this.section.setTool('select');
      }
    } else {
      if (sanitized !== initialText) {
        this.section.dispatch({
          type: 'shape.update',
          id: node.id,
          patch: isLabelable(node) ? { label: { text: sanitized } } : { text: sanitized },
        });
      }
      this.section.setSelection([node.id]);
    }
  }

  /**
   * Abre o editor do título do board: seleciona o board (a seleção o bloqueia para os outros) e
   * guarda o título de partida. Não mexe no documento nem no preview.
   */
  public startBoardTitleEdit(node: BoardNode): void {
    if (this.current.name !== 'idle') {
      this.cancel();
    }
    if (!this.section.getSnapshot().session.selectedIds.includes(node.id)) {
      this.section.setSelection([node.id]);
    }
    this.current = {
      name: 'editing-text',
      nodeId: node.id,
      isNew: false,
      initialText: node.title,
      node,
    };
    this.dispatchAction({ type: 'START_BOARD_TITLE_EDIT', node });
  }

  /**
   * Fecha o editor do título e grava `text` sem espaços nas pontas e com no máximo
   * `BOARD_TITLE_MAX_LENGTH` caracteres; vazio ou igual ao título atual não gera comando.
   */
  public commitBoardTitle(text: string): void {
    if (this.current.name !== 'editing-text' || this.current.node.type !== 'board') return;

    const { nodeId } = this.current;
    this.current = { name: 'idle' };
    this.dispatchAction({ type: 'END_TEXT_EDIT' });
    this.dispatchAction({ type: 'SET_CURSOR', cursor: this.getIdleCursor() });

    const title = text.trim().slice(0, BOARD_TITLE_MAX_LENGTH).trim();
    const current = this.section.getSnapshot().document.nodes[nodeId];
    if (title.length > 0 && current?.type === 'board' && current.title !== title) {
      this.section.dispatch({ type: 'shape.update', id: nodeId, patch: { title } });
    }
    this.section.setSelection([nodeId]);
  }

  /** Fecha o editor do título sem gravar. */
  public cancelBoardTitle(): void {
    if (this.current.name !== 'editing-text' || this.current.node.type !== 'board') return;
    this.cancelTextEdit();
  }

  public cancelTextEdit(): void {
    if (this.current.name !== 'editing-text') return;

    this.section.setPreview(null);
    this.current = { name: 'idle' };
    this.dispatchAction({ type: 'END_TEXT_EDIT' });
    this.dispatchAction({ type: 'SET_CURSOR', cursor: this.getIdleCursor() });
  }
}
