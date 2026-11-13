import {
  BOARD_TITLE_BAND,
  BOARD_TITLE_FONT_SIZE,
  type BoardNode,
  type CanvasSectionApi,
  type Viewport,
} from '@canvash/core';
import { BOARD_TITLE_MAX_LENGTH } from './tools/board.js';

export interface BoardTitleEditorOptions {
  readonly container: HTMLElement;
  readonly section: CanvasSectionApi;
  /** O `aria-label` do campo (a mensagem `boardTitleLabel` do host). */
  readonly label: string;
  readonly onCommit?: ((boardId: string, text: string) => void) | undefined;
  readonly onCancel?: ((boardId: string) => void) | undefined;
}

interface ActiveSession {
  readonly board: BoardNode;
  readonly input: HTMLInputElement;
  readonly unsubscribeSection: () => void;
  isComposing: boolean;
  isEnding: boolean;
}

/**
 * Editor do título do board: um `<input>` de uma linha, opaco, sobre a faixa inteira do título e
 * alinhado ao canvas (zoom e pan). Fica fora do documento, do preview e da exportação.
 */
export class BoardTitleEditor {
  private readonly container: HTMLElement;
  private readonly section: CanvasSectionApi;
  private readonly label: string;
  private readonly onCommitCallback?: ((boardId: string, text: string) => void) | undefined;
  private readonly onCancelCallback?: ((boardId: string) => void) | undefined;
  private session: ActiveSession | null = null;
  private destroyed = false;

  constructor(options: BoardTitleEditorOptions) {
    this.container = options.container;
    this.section = options.section;
    this.label = options.label;
    this.onCommitCallback = options.onCommit;
    this.onCancelCallback = options.onCancel;
  }

  public isActive(): boolean {
    return this.session !== null;
  }

  public getInput(): HTMLInputElement | null {
    return this.session ? this.session.input : null;
  }

  public start(board: BoardNode): void {
    if (this.destroyed) return;
    if (this.session) {
      this.commit();
    }

    const doc = this.container.ownerDocument ?? document;
    const input = doc.createElement('input');
    input.type = 'text';
    input.setAttribute('data-testid', 'canvash-board-title-editor');
    input.className = 'canvash-board-title-editor';
    input.setAttribute('aria-label', this.label);
    input.maxLength = BOARD_TITLE_MAX_LENGTH;
    input.value = board.title;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.autocapitalize = 'off';

    input.style.position = 'absolute';
    input.style.top = '0';
    input.style.left = '0';
    input.style.boxSizing = 'border-box';
    // Opaco: o título pintado no canvas não pode aparecer por baixo do texto digitado.
    input.style.background = 'var(--canvash-canvas-bg, #ffffff)';
    input.style.color = 'var(--canvash-board-title-color, #3f3f46)';
    input.style.border = '1px dashed #3b82f6';
    input.style.outline = 'none';
    input.style.padding = '0';
    input.style.margin = '0';
    input.style.fontFamily = 'sans-serif';
    input.style.transformOrigin = '0 0';
    input.style.zIndex = '9999';

    const updateGeometry = (): void => {
      if (!this.session || this.session.input !== input) return;
      const vp: Viewport = this.section.getSnapshot().session.viewport;
      const zoom = vp.zoom > 0 ? vp.zoom : 1;
      input.style.width = `${board.width * zoom}px`;
      input.style.height = `${BOARD_TITLE_BAND * zoom}px`;
      input.style.fontSize = `${BOARD_TITLE_FONT_SIZE * zoom}px`;
      input.style.transform = `translate(${board.x * zoom + vp.x}px, ${(board.y - BOARD_TITLE_BAND) * zoom + vp.y}px)`;
    };

    const unsubscribeSection = this.section.subscribe((event) => {
      if (event.areas.includes('viewport')) {
        updateGeometry();
      }
    });

    const session: ActiveSession = {
      board,
      input,
      unsubscribeSection,
      isComposing: false,
      isEnding: false,
    };
    this.session = session;
    updateGeometry();

    input.addEventListener('compositionstart', () => {
      session.isComposing = true;
    });
    input.addEventListener('compositionend', () => {
      session.isComposing = false;
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      // As teclas do campo não chegam aos atalhos do canvas (Delete, setas, Ctrl+Z...).
      e.stopPropagation();
      if (session.isComposing || e.isComposing) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      }
    });

    input.addEventListener('blur', () => {
      if (this.session === session && !session.isEnding) {
        this.commit();
      }
    });

    this.container.appendChild(input);
    input.focus();
    input.select();
  }

  public commit(): void {
    if (!this.session || this.session.isEnding) return;
    const session = this.session;
    session.isEnding = true;
    const text = session.input.value;

    this.cleanupSession(session);
    this.onCommitCallback?.(session.board.id, text);
  }

  public cancel(): void {
    if (!this.session || this.session.isEnding) return;
    const session = this.session;
    session.isEnding = true;

    this.cleanupSession(session);
    this.onCancelCallback?.(session.board.id);
  }

  private cleanupSession(session: ActiveSession): void {
    session.unsubscribeSection();
    session.input.parentElement?.removeChild(session.input);
    if (this.session === session) {
      this.session = null;
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.session) {
      this.cancel();
    }
  }
}
