import type { CanvasSectionApi, Point, ZoomLimits } from '@canvash/core';
import type { InteractionAction, InteractionStateMachine } from './state-machine.js';
import { applyPinchPanZoom, computeTouchCenter, computeTouchDistance } from './touch.js';

export interface PointerAdapterOptions {
  element: HTMLElement;
  stateMachine: InteractionStateMachine;
  section?: CanvasSectionApi;
  zoomLimits?: ZoomLimits;
  /** Recebe a posição do mouse ou da caneta (CSS px do elemento) e `null` quando ela some. */
  onGridPointerChange?: (point: Point | null) => void;
}

interface PinchState {
  pointer1Id: number;
  pointer2Id: number;
  prevCenter: Point;
  prevDistance: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

const ACTIVATABLE_ROLES = new Set(['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox']);

/**
 * O controle (botão ou item de menu) que originou o evento, ou `null`. O evento chega à janela
 * com o alvo trocado pelo dono do Shadow DOM: o controle verdadeiro é o primeiro do caminho
 * composto.
 */
function controlOf(event: KeyboardEvent): HTMLElement | null {
  const origin = typeof event.composedPath === 'function' ? event.composedPath()[0] : event.target;
  if (!(origin instanceof HTMLElement)) return null;
  const isControl =
    origin.tagName.toUpperCase() === 'BUTTON' ||
    ACTIVATABLE_ROLES.has(origin.getAttribute('role') ?? '');
  return isControl ? origin : null;
}

export class PointerAdapter {
  private readonly element: HTMLElement;
  private readonly stateMachine: InteractionStateMachine;
  private readonly section?: CanvasSectionApi;
  private readonly zoomLimits?: ZoomLimits;
  private readonly onGridPointerChange?: (point: Point | null) => void;
  private readonly initialTouchAction: string;
  private readonly initialCursor: string;
  private readonly activeTouches = new Map<number, Point>();
  private pinchState: PinchState | null = null;
  private unbindAction: (() => void) | null = null;
  private destroyed = false;
  /** O último gesto do usuário foi com o ponteiro: um botão focado assim não é do teclado. */
  private lastInputWasPointer = false;

  constructor(options: PointerAdapterOptions) {
    this.element = options.element;
    this.stateMachine = options.stateMachine;
    this.section = options.section;
    this.zoomLimits = options.zoomLimits;
    this.onGridPointerChange = options.onGridPointerChange;

    this.initialTouchAction = this.element.style.touchAction;
    this.initialCursor = this.element.style.cursor;
    this.element.style.touchAction = 'none';

    this.bindEvents();
  }

  private bindEvents(): void {
    this.unbindAction = this.stateMachine.onAction((action: InteractionAction) => {
      this.handleAction(action);
    });

    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('mousedown', this.onMouseDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerCancel);
    this.element.addEventListener('lostpointercapture', this.onLostPointerCapture);
    this.element.addEventListener('pointerleave', this.onPointerLeave);
    this.element.addEventListener('contextmenu', this.onContextMenu);
    this.element.addEventListener('auxclick', this.onAuxClick);
    this.element.addEventListener('dblclick', this.onDoubleClick);

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.onAnyPointerDown, true);
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onWindowBlur);
    }
  }

  private handleAction(action: InteractionAction): void {
    if (this.destroyed) return;

    switch (action.type) {
      case 'CAPTURE_POINTER': {
        try {
          this.element.setPointerCapture(action.pointerId);
        } catch {
          // Navegador pode recusar se o pointerId já expirou
        }
        break;
      }

      case 'RELEASE_POINTER': {
        try {
          if (this.element.hasPointerCapture(action.pointerId)) {
            this.element.releasePointerCapture(action.pointerId);
          }
        } catch {
          // Ignora se já liberado
        }
        break;
      }

      case 'SET_CURSOR': {
        this.element.style.cursor = action.cursor;
        break;
      }

      case 'SET_VIEWPORT': {
        // O viewport é atualizado diretamente no canvas pela state-machine
        break;
      }
    }
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (isEditableTarget(event.target)) return;

    const rect = this.element.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    this.stateMachine.process({
      type: 'DOUBLE_CLICK',
      point,
      button: event.button,
    });
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (isEditableTarget(event.target)) return;

    if (event.button === 1) {
      event.preventDefault();
    }

    const rect = this.element.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    if (event.pointerType === 'touch') {
      this.onGridPointerChange?.(null);
      this.activeTouches.set(event.pointerId, point);

      if (this.activeTouches.size === 2) {
        // Segundo toque detectado: cancela preview de edição ativa antes de navegar (INPUT-05)
        if (this.stateMachine.getState() !== 'idle') {
          this.stateMachine.cancel();
        }

        const entries = Array.from(this.activeTouches.entries());
        const [id1, p1] = entries[0]!;
        const [id2, p2] = entries[1]!;

        this.pinchState = {
          pointer1Id: id1,
          pointer2Id: id2,
          prevCenter: computeTouchCenter(p1, p2),
          prevDistance: computeTouchDistance(p1, p2),
        };
        return;
      }

      if (this.activeTouches.size > 2) {
        return;
      }
    }

    this.stateMachine.process({
      type: 'POINTER_DOWN',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      point,
      button: event.button,
      buttons: event.buttons,
      shiftKey: event.shiftKey,
      spaceKey: this.stateMachine.isSpacePressed(),
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    if (event.pointerType !== 'touch') {
      this.onGridPointerChange?.({ x: point.x, y: point.y });
    }

    if (event.pointerType === 'touch' && this.activeTouches.has(event.pointerId)) {
      this.activeTouches.set(event.pointerId, point);

      if (this.pinchState) {
        const p1 = this.activeTouches.get(this.pinchState.pointer1Id);
        const p2 = this.activeTouches.get(this.pinchState.pointer2Id);

        if (p1 && p2 && this.section) {
          const newCenter = computeTouchCenter(p1, p2);
          const newDistance = computeTouchDistance(p1, p2);

          const currentVp = this.section.getSnapshot().session.viewport;
          const nextVp = applyPinchPanZoom(
            currentVp,
            this.pinchState.prevCenter,
            newCenter,
            this.pinchState.prevDistance,
            newDistance,
            this.zoomLimits,
          );

          this.section.setViewport(nextVp);

          this.pinchState.prevCenter = newCenter;
          this.pinchState.prevDistance = newDistance;
        }
        return;
      }
    }

    if (
      this.stateMachine.getState() !== 'idle' &&
      this.stateMachine.getState() !== 'editing-text' &&
      event.buttons === 0 &&
      event.pointerType === 'mouse'
    ) {
      this.stateMachine.cancel();
      return;
    }

    this.stateMachine.process({
      type: 'POINTER_MOVE',
      pointerId: event.pointerId,
      point,
      coalescedPoints: this.coalescedPointsOf(event, rect),
      buttons: event.buttons,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  };

  /**
   * As amostras intermediárias que o navegador agrupou neste evento, em pontos do elemento, da mais
   * antiga à mais nova. Sem `getCoalescedEvents` (WebKit antigo) ou sem amostras extras, nada: a
   * máquina usa só o evento principal.
   */
  private coalescedPointsOf(event: PointerEvent, rect: DOMRect): Point[] | undefined {
    if (typeof event.getCoalescedEvents !== 'function') return undefined;
    const samples = event.getCoalescedEvents();
    if (samples.length < 2) return undefined;
    return samples.map((sample) => ({
      x: sample.clientX - rect.left,
      y: sample.clientY - rect.top,
    }));
  }

  private readonly onPointerLeave = (event: PointerEvent): void => {
    this.onGridPointerChange?.(null);
    this.stateMachine.hideEraserCursor();
    if (
      this.stateMachine.getState() === 'idle' ||
      this.stateMachine.getState() === 'editing-text'
    ) {
      return;
    }

    try {
      if (this.element.hasPointerCapture(event.pointerId)) {
        return;
      }
    } catch {
      // Ignora se hasPointerCapture falhar
    }

    this.stateMachine.cancel();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    if (event.pointerType === 'touch') {
      this.activeTouches.delete(event.pointerId);

      if (this.pinchState) {
        this.pinchState = null;
        return;
      }
    }

    this.stateMachine.process({
      type: 'POINTER_UP',
      pointerId: event.pointerId,
      point,
      button: event.button,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.onGridPointerChange?.(null);
    if (event.pointerType === 'touch') {
      this.activeTouches.delete(event.pointerId);
      if (this.pinchState) {
        this.pinchState = null;
      }
    }

    this.stateMachine.process({
      type: 'POINTER_CANCEL',
      pointerId: event.pointerId,
    });
  };

  private readonly onLostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.activeTouches.delete(event.pointerId);
      if (this.pinchState) {
        this.pinchState = null;
      }
    }

    this.stateMachine.process({
      type: 'POINTER_CANCEL',
      pointerId: event.pointerId,
    });
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.stateMachine.getState() !== 'idle' || event.button === 1) {
      event.preventDefault();
    }
  };

  /** Qualquer clique ou toque na página, inclusive fora do canvas, passa o foco ao ponteiro. */
  private readonly onAnyPointerDown = (): void => {
    this.lastInputWasPointer = true;
  };

  /**
   * O Espaço ativa o controle focado pelo teclado, em vez de fazer pan. Depois de um clique do
   * mouse o botão continua focado, mas o Espaço segue como a tecla de pan. Qualquer outra tecla
   * (um Tab, por exemplo) devolve o foco ao teclado.
   */
  private isSpaceOwnedByControl(event: KeyboardEvent): boolean {
    const isSpace = event.code === 'Space' || event.key === ' ';
    if (!isSpace) {
      this.lastInputWasPointer = false;
      return false;
    }
    return controlOf(event) !== null && !this.lastInputWasPointer;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target) || this.isSpaceOwnedByControl(event)) return;

    if (event.code === 'Space' || event.key === ' ') {
      // Previne rolagem padrão da página com tecla espaço
      event.preventDefault();
    }

    this.stateMachine.process({
      type: 'KEY_DOWN',
      key: event.key,
      code: event.code,
    });
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    const isSpace = event.code === 'Space' || event.key === ' ';
    if (isSpace && controlOf(event) !== null && !this.lastInputWasPointer) return;

    this.stateMachine.process({
      type: 'KEY_UP',
      key: event.key,
      code: event.code,
    });
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  private readonly onAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  private readonly onWindowBlur = (): void => {
    if (this.stateMachine.getState() !== 'editing-text') {
      this.stateMachine.cancel();
    }
  };

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onGridPointerChange?.(null);

    this.activeTouches.clear();
    this.pinchState = null;

    this.stateMachine.process({ type: 'DESTROY' });

    if (this.unbindAction) {
      this.unbindAction();
      this.unbindAction = null;
    }

    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('mousedown', this.onMouseDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.element.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.element.removeEventListener('auxclick', this.onAuxClick);
    this.element.removeEventListener('dblclick', this.onDoubleClick);

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.onAnyPointerDown, true);
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onWindowBlur);
    }

    this.element.style.touchAction = this.initialTouchAction;
    this.element.style.cursor = this.initialCursor;
  }
}
