import {
  DEFAULT_SHAPE_LABEL,
  SHAPE_LABEL_LINE_HEIGHT,
  STICKY_COLORS,
  STICKY_PADDING,
  fitStickyFontSize,
  isLabelable,
  shapeLabelArea,
  shapeLabelColor,
  stickyTextColor,
  type CanvasSectionApi,
  type LabelableNode,
  type StickyNode,
  type TextNode,
  type Viewport,
} from '@canvash/core';

export interface TextEditorAdapterOptions {
  readonly container: HTMLElement;
  readonly section: CanvasSectionApi;
  readonly onCommit?: ((nodeId: string, newText: string, isNew: boolean) => void) | undefined;
  readonly onCancel?: ((nodeId: string, isNew: boolean) => void) | undefined;
}

export interface ActiveTextEditSession {
  readonly node: TextNode | StickyNode | LabelableNode;
  readonly isNew: boolean;
  readonly textarea: HTMLTextAreaElement;
  readonly unsubscribeSection: () => void;
  isComposing: boolean;
  isEnding: boolean;
}

/** Expressão regular para detecção estrita de tags HTML (texto simples, sem HTML). */
const HTML_TAG_REGEX = /<(?:\/[a-zA-Z]|[a-zA-Z])[a-zA-Z0-9:-]*(?:\s+[^>]*)?\/?>/g;

export function stripHtmlTags(text: string): string {
  return text.replace(HTML_TAG_REGEX, '');
}

/**
 * Adaptador que orquestra a sessão de edição em `<textarea>` flutuante alinhado ao canvas.
 * Garante paridade geométrica (zoom, pan, rotação), suporte completo a IME e histórico atômico.
 */
export class TextEditorAdapter {
  private readonly container: HTMLElement;
  private readonly section: CanvasSectionApi;
  private readonly onCommitCallback?:
    ((nodeId: string, newText: string, isNew: boolean) => void) | undefined;
  private readonly onCancelCallback?: ((nodeId: string, isNew: boolean) => void) | undefined;
  private session: ActiveTextEditSession | null = null;
  private destroyed = false;

  constructor(options: TextEditorAdapterOptions) {
    this.container = options.container;
    this.section = options.section;
    this.onCommitCallback = options.onCommit;
    this.onCancelCallback = options.onCancel;
  }

  public isActive(): boolean {
    return this.session !== null;
  }

  public getTextArea(): HTMLTextAreaElement | null {
    return this.session ? this.session.textarea : null;
  }

  public start(node: TextNode | StickyNode | LabelableNode, isNew = false): void {
    if (this.destroyed) return;
    if (this.session) {
      this.commit();
    }

    const doc = this.container.ownerDocument ?? document;
    const textarea = doc.createElement('textarea');
    textarea.setAttribute('data-testid', 'canvash-text-editor');
    textarea.className = 'canvash-text-editor';
    // A forma edita o texto do `label`; o texto livre e a nota, o `text`.
    const shape = isLabelable(node) ? node : null;
    textarea.value = shape ? (shape.label?.text ?? '') : (node as TextNode | StickyNode).text;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.autocapitalize = 'off';

    // Estilo base do overlay
    textarea.style.position = 'absolute';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.boxSizing = 'border-box';
    // A nota edita sobre a própria cor, com a cor de texto derivada dela; o texto livre, sobre o
    // vazio; a forma, sobre ela mesma, com a cor efetiva do texto (`shapeLabelColor`).
    const note = node.type === 'sticky' ? node : null;
    const noteFill = note?.style.fill ?? STICKY_COLORS.yellow;
    textarea.style.background = note ? noteFill : 'transparent';
    textarea.style.color = note
      ? stickyTextColor(noteFill)
      : shape
        ? shapeLabelColor(shape)
        : ((node as TextNode).style?.fill ?? '#000000');
    textarea.style.border = '1px dashed #3b82f6';
    textarea.style.outline = 'none';
    textarea.style.padding = '0';
    textarea.style.margin = '0';
    textarea.style.resize = 'none';
    textarea.style.overflow = 'hidden';
    textarea.style.whiteSpace = 'pre-wrap';
    textarea.style.wordBreak = 'break-word';
    textarea.style.zIndex = '9999';

    // Tipografia: a da forma vem do `label` (com os padrões), a do texto livre e da nota, do nó.
    const typography = shape
      ? {
          fontSize: shape.label?.fontSize ?? DEFAULT_SHAPE_LABEL.fontSize,
          fontFamily: shape.label?.fontFamily ?? DEFAULT_SHAPE_LABEL.fontFamily,
          fontWeight: shape.label?.fontWeight ?? DEFAULT_SHAPE_LABEL.fontWeight,
          textAlign: shape.label?.textAlign ?? DEFAULT_SHAPE_LABEL.textAlign,
          lineHeight: SHAPE_LABEL_LINE_HEIGHT,
        }
      : (node as TextNode | StickyNode);
    const verticalAlign = shape?.label?.verticalAlign ?? DEFAULT_SHAPE_LABEL.verticalAlign;
    // A área inscrita da forma, ou a caixa inteira se ela se anular.
    const area = shape
      ? (shapeLabelArea(shape) ?? { x: node.x, y: node.y, width: node.width, height: node.height })
      : null;

    /** Tamanho da fonte do editor: o da nota no modo fixo, o do ajuste a cada tecla no automático. */
    const currentFontSize = (): number =>
      note && note.fontSizeMode === 'auto'
        ? fitStickyFontSize({
            text: textarea.value,
            width: note.width,
            height: note.height,
            fontFamily: note.fontFamily,
            fontWeight: note.fontWeight,
            lineHeight: note.lineHeight,
          })
        : typography.fontSize;

    /**
     * `verticalAlign` da forma, simulado com `padding-top`: mede a altura do texto sem folga e
     * leva o bloco ao topo, ao meio ou à base da área, sem nunca passar para cima do topo.
     */
    const alignVertically = (heightPx: number): void => {
      if (!area) return;
      textarea.style.paddingTop = '0px';
      textarea.style.height = 'auto';
      const content = textarea.scrollHeight;
      textarea.style.height = `${heightPx}px`;
      const free = heightPx - content;
      const offset = verticalAlign === 'top' ? 0 : verticalAlign === 'middle' ? free / 2 : free;
      textarea.style.paddingTop = `${Math.max(0, offset)}px`;
    };

    const updateGeometry = (): void => {
      if (!this.session || this.session.textarea !== textarea) return;
      const vp: Viewport = this.section.getSnapshot().session.viewport;
      const zoom = vp.zoom > 0 ? vp.zoom : 1;

      // Centro da caixa em tela: a origem da rotação, na forma e nos demais.
      const cx = (node.x + node.width / 2) * zoom + vp.x;
      const cy = (node.y + node.height / 2) * zoom + vp.y;
      textarea.style.fontSize = `${currentFontSize() * zoom}px`;
      textarea.style.fontFamily = typography.fontFamily;
      textarea.style.fontWeight = String(typography.fontWeight);
      textarea.style.lineHeight = String(typography.lineHeight);
      textarea.style.textAlign = typography.textAlign;
      textarea.style.transformOrigin = '0 0';

      if (area) {
        // A área inscrita, no referencial da caixa: o deslocamento do canto dela ao centro da
        // caixa gira junto com a forma.
        const w = area.width * zoom;
        const h = area.height * zoom;
        const dx = (area.x - (node.x + node.width / 2)) * zoom;
        const dy = (area.y - (node.y + node.height / 2)) * zoom;
        textarea.style.width = `${w}px`;
        textarea.style.height = `${h}px`;
        textarea.style.padding = '0';
        alignVertically(h);
        textarea.style.transform = `translate(${cx}px, ${cy}px) rotate(${node.rotation}rad) translate(${dx}px, ${dy}px)`;
        return;
      }

      const w = node.width * zoom;
      // A nota tem altura própria; o texto livre cresce com o conteúdo.
      const h = note ? node.height * zoom : Math.max(node.height * zoom, 24 * zoom);
      textarea.style.width = `${w}px`;
      textarea.style.height = `${h}px`;
      textarea.style.padding = note ? `${STICKY_PADDING * zoom}px` : '0';
      textarea.style.transform = `translate(${cx}px, ${cy}px) rotate(${node.rotation}rad) translate(${-w / 2}px, ${-h / 2}px)`;
    };

    const unsubscribeSection = this.section.subscribe((event) => {
      if (event.areas.includes('viewport')) {
        updateGeometry();
      }
    });

    const activeSession: ActiveTextEditSession = {
      node,
      isNew,
      textarea,
      unsubscribeSection,
      isComposing: false,
      isEnding: false,
    };
    this.session = activeSession;

    // Atualiza a geometria inicial
    updateGeometry();

    // Ao digitar: o texto livre cresce em altura; a nota refaz o tamanho da fonte (modo automático).
    textarea.addEventListener('input', () => {
      if (note || area) {
        updateGeometry();
        return;
      }
      textarea.style.height = 'auto';
      const vp = this.section.getSnapshot().session.viewport;
      const zoom = vp.zoom > 0 ? vp.zoom : 1;
      const minH = Math.max(node.height * zoom, 24 * zoom);
      textarea.style.height = `${Math.max(textarea.scrollHeight, minH)}px`;
    });

    // Manipulação de IME (Composition Events)
    textarea.addEventListener('compositionstart', () => {
      activeSession.isComposing = true;
    });

    textarea.addEventListener('compositionend', () => {
      activeSession.isComposing = false;
    });

    // Teclas de controle
    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        if (!activeSession.isComposing && !e.isComposing) {
          e.preventDefault();
          this.cancel();
        }
        return;
      }

      if (e.key === 'Enter') {
        if (activeSession.isComposing || e.isComposing) {
          return;
        }

        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.commit();
          return;
        }
        // Enter normal: insere quebra de linha multilinha nativa no textarea
      }
    });

    textarea.addEventListener('blur', () => {
      if (this.session === activeSession && !activeSession.isEnding) {
        this.commit();
      }
    });

    this.container.appendChild(textarea);
    textarea.focus();
    if (textarea.select && typeof textarea.select === 'function') {
      textarea.select();
    }
  }

  public commit(): void {
    if (!this.session || this.session.isEnding) return;
    const session = this.session;
    session.isEnding = true;

    const rawText = session.textarea.value;
    const cleanText = stripHtmlTags(rawText);
    const { node, isNew } = session;

    this.cleanupSession(session);

    if (this.onCommitCallback) {
      this.onCommitCallback(node.id, cleanText, isNew);
    }
  }

  public cancel(): void {
    if (!this.session || this.session.isEnding) return;
    const session = this.session;
    session.isEnding = true;
    const { node, isNew } = session;

    this.cleanupSession(session);

    if (this.onCancelCallback) {
      this.onCancelCallback(node.id, isNew);
    }
  }

  private cleanupSession(session: ActiveTextEditSession): void {
    session.unsubscribeSection();
    if (session.textarea.parentElement) {
      session.textarea.parentElement.removeChild(session.textarea);
    }
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
