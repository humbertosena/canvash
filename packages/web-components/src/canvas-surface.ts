import { createCanvasSection, fitViewportToBounds, zoomAt } from '@canvash/core';
import type { CanvasSectionApi, CanvasChange, ViewportSize } from '@canvash/core';
import {
  attachInteractions,
  type InteractionHandle,
  type InteractionStateName,
} from '@canvash/interaction';
import {
  mount,
  type GridOptions,
  type GridStyle,
  type RendererHandle,
} from '@canvash/renderer-canvas2d';
import { css, html, LitElement } from 'lit';
import { getGlobalI18n, type CanvasI18nMessages } from './i18n.js';
import type {
  InteractionStateChangeEventDetail,
  CanvasErrorEventDetail,
  TextEditSupersededEventDetail,
  CanvasReadyEventDetail,
  DocumentChangeEventDetail,
  SelectionChangeEventDetail,
  EraserSizeChangeEventDetail,
  PenSettingsChangeEventDetail,
  StickyColorChangeEventDetail,
  ToolChangeEventDetail,
  ViewportChangeEventDetail,
} from './events.js';

export interface FitToContentOptions {
  /** Espaçamento em CSS px entre a borda do viewport e os limites do conteúdo. Padrão: 40. */
  padding?: number | undefined;
}

export class CanvasSurfaceElement extends LitElement {
  static override properties = {
    readOnly: { type: Boolean, reflect: true },
    grid: { type: Boolean, reflect: true },
    gridSize: { type: Number, attribute: 'grid-size', reflect: true },
    gridStyle: { type: String, attribute: 'grid-style', reflect: true },
    gridHighlight: { type: String, attribute: 'grid-highlight', reflect: true },
    ariaLabel: { type: String, attribute: 'aria-label', reflect: true },
  };

  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      outline: none;
      background: var(--canvash-canvas-bg, #f2f3f5);
    }

    :host(:focus-visible),
    .surface-container:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: -2px;
    }

    .surface-container {
      position: relative;
      width: 100%;
      height: 100%;
      outline: none;
      user-select: none;
      -webkit-user-select: none;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `;

  readOnly: boolean = false;
  grid: boolean = false;
  gridSize: number = 20;
  /** Aparência do grid: pontos (padrão) ou linhas. */
  gridStyle: GridStyle = 'dots';
  /** Realce dos pontos sob o ponteiro: ligado (padrão) ou desligado com `"off"`. */
  gridHighlight: 'on' | 'off' = 'on';
  override ariaLabel: string | null = 'Canvash Canvas';

  private _announcement: string = '';
  private _section: CanvasSectionApi | undefined;
  private _internalSection: CanvasSectionApi | undefined;
  private _isInternal: boolean = false;
  private _container: HTMLElement | null = null;
  private _rendererHandle: RendererHandle | undefined;
  private _interactionHandle: InteractionHandle | undefined;
  private _unsubscribeSection: (() => void) | undefined;
  private _mounted: boolean = false;
  private _stickyColor: string | undefined;
  private _stickyListening = false;
  private _penSettings: PenSettingsChangeEventDetail['settings'] | undefined;
  private _eraserSize: EraserSizeChangeEventDetail['size'] | undefined;

  /** Cor das próximas notas adesivas (`#rrggbb`). Aplica-se ao motor de interação deste canvas. */
  setStickyColor(color: string): void {
    this._stickyColor = color;
    this._interactionHandle?.setStickyColor(color);
  }

  /** Cor, tipo e espessura dos próximos traços da caneta. Aplica-se ao motor de interação. */
  setPenSettings(settings: PenSettingsChangeEventDetail['settings']): void {
    this._penSettings = settings;
    this._interactionHandle?.setPenSettings(settings);
  }

  /** Tamanho da borracha (`thin`, `medium` ou `thick`). Aplica-se ao motor de interação. */
  setEraserSize(size: EraserSizeChangeEventDetail['size']): void {
    this._eraserSize = size;
    this._interactionHandle?.setEraserSize(size);
  }

  getEraserSize(): EraserSizeChangeEventDetail['size'] | undefined {
    return this._interactionHandle?.getEraserSize() ?? this._eraserSize;
  }

  /** A toolbar anuncia o tamanho da borracha; só vale para o canvas do mesmo canvas. */
  private readonly _onEraserSizeChange = (event: Event): void => {
    const detail = (event as CustomEvent<EraserSizeChangeEventDetail>).detail;
    if (!detail || !this._section || detail.section !== this._section) return;
    this.setEraserSize(detail.size);
  };

  getPenSettings(): PenSettingsChangeEventDetail['settings'] | undefined {
    return this._interactionHandle?.getPenSettings() ?? this._penSettings;
  }

  /** A toolbar anuncia a caneta; só vale para o canvas do mesmo canvas. */
  private readonly _onPenSettingsChange = (event: Event): void => {
    const detail = (event as CustomEvent<PenSettingsChangeEventDetail>).detail;
    if (!detail || !this._section || detail.section !== this._section) return;
    this.setPenSettings(detail.settings);
  };

  getStickyColor(): string | undefined {
    return this._interactionHandle?.getStickyColor() ?? this._stickyColor;
  }

  /** A toolbar anuncia a cor; só vale para o canvas do mesmo canvas. */
  private readonly _onStickyColorChange = (event: Event): void => {
    const detail = (event as CustomEvent<StickyColorChangeEventDetail>).detail;
    if (!detail || !this._section || detail.section !== this._section) return;
    this.setStickyColor(detail.color);
  };

  /**
   * Instância do canvas conectada a este canvas.
   * Se nenhuma instância for informada antes da montagem, uma instância interna é criada automaticamente.
   */
  get section(): CanvasSectionApi | undefined {
    return this._section;
  }

  set section(nextSection: CanvasSectionApi | undefined) {
    if (this._section === nextSection) return;
    const wasMounted = this._mounted;
    this._unmount();
    this._isInternal = false;
    this._internalSection = undefined;
    this._section = nextSection;
    if (wasMounted && this.isConnected) {
      this._mount();
    }
  }

  private _messages?: Partial<CanvasI18nMessages>;

  get messages(): CanvasI18nMessages {
    return { ...getGlobalI18n().canvas, ...this._messages };
  }

  set messages(val: Partial<CanvasI18nMessages> | undefined) {
    this._messages = val;
    this.requestUpdate();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this._container && !this._mounted) {
      this._mount();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unmount();
  }

  protected override firstUpdated(): void {
    this._container = this.renderRoot.querySelector('.surface-container');
    if (this.isConnected && !this._mounted) {
      this._mount();
    }
  }

  protected override performUpdate(): void | Promise<unknown> {
    if (typeof document === 'undefined' || typeof document.createComment !== 'function') {
      return;
    }
    return super.performUpdate();
  }

  protected override updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    if (changedProperties.has('readOnly') && this._section) {
      this._section.setReadOnly(this.readOnly);
    }

    const gridChanged =
      changedProperties.has('grid') ||
      changedProperties.has('gridSize') ||
      changedProperties.has('gridStyle') ||
      changedProperties.has('gridHighlight');
    if (gridChanged && this._mounted) {
      // Remonta com as novas configurações de grid
      this._remountRenderer();
    }
  }

  /**
   * Foca o elemento interno do canvas para permitir navegação imediata por teclado.
   */
  override focus(options?: FocusOptions): void {
    if (this._container && typeof this._container.focus === 'function') {
      this._container.focus(options);
    } else if (typeof super.focus === 'function') {
      super.focus(options);
    }
  }

  /**
   * Enquadra a visão aos limites dos elementos do documento com padding opcional.
   */
  fitToContent(options: FitToContentOptions = {}): void {
    if (!this._section) return;
    this._fitToIds(Object.keys(this._section.getSnapshot().document.nodes), options);
  }

  /**
   * Enquadra a visão aos limites dos elementos selecionados com padding opcional. Sem seleção,
   * não faz nada.
   */
  fitToSelection(options: FitToContentOptions = {}): void {
    if (!this._section) return;
    this._fitToIds(this._section.getSnapshot().session.selectedIds, options);
  }

  /** Multiplica o zoom por `factor`, mantendo no lugar o ponto central do contêiner. */
  zoomBy(factor: number): void {
    if (!this._section || !Number.isFinite(factor) || factor <= 0) return;
    this.zoomTo(this._section.getSnapshot().session.viewport.zoom * factor);
  }

  /** Leva o zoom a `zoom` (dentro dos limites), mantendo no lugar o ponto central do contêiner. */
  zoomTo(zoom: number): void {
    if (!this._section || !Number.isFinite(zoom) || zoom <= 0) return;
    const size = this._viewportSize();
    const viewport = this._section.getSnapshot().session.viewport;
    const next = zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, zoom);
    // Sem mudança de zoom (já no limite), `zoomAt` devolve o mesmo objeto: nada a publicar.
    if (next !== viewport) this._section.setViewport(next);
  }

  /** Tamanho do contêiner em CSS px; sem contêiner montado, o padrão de 800 × 600. */
  private _viewportSize(): ViewportSize {
    return {
      width: this._container?.clientWidth ?? 800,
      height: this._container?.clientHeight ?? 600,
    };
  }

  private _fitToIds(ids: readonly string[], options: FitToContentOptions): void {
    if (!this._section || ids.length === 0) return;
    const bounds = this._section.getBounds(ids, { includePreview: false, stroke: true });
    if (!bounds) return;
    const viewport = fitViewportToBounds(bounds, this._viewportSize(), {
      padding: options.padding,
    });
    if (viewport) this._section.setViewport(viewport);
  }

  /**
   * Destrói explicitamente a instância interna do canvas, se criada por este elemento.
   * Não afeta canvas atribuídos externamente pelo host (WC-05).
   */
  dispose(): void {
    this._unmount();
    if (this._isInternal && this._internalSection) {
      this._internalSection.destroy();
      this._internalSection = undefined;
      this._section = undefined;
      this._isInternal = false;
    }
  }

  private _mount(): void {
    if (this._mounted || !this._container) return;

    if (!this._section) {
      this._internalSection = createCanvasSection();
      this._section = this._internalSection;
      this._isInternal = true;
    }

    if (this.readOnly) {
      this._section.setReadOnly(true);
    }

    const gridOptions = this._gridOptions();

    const mountResult = mount({
      container: this._container,
      section: this._section,
      grid: gridOptions,
      onError: (error) => {
        this._dispatchTypedEvent<CanvasErrorEventDetail>('canvas-error', { error });
      },
    });

    if (!mountResult.ok) {
      this._dispatchTypedEvent<CanvasErrorEventDetail>('canvas-error', {
        error: mountResult.error,
      });
      return;
    }

    this._rendererHandle = mountResult.value;

    // O renderer pode ser remontado (grid mudou): a interação fala sempre com o atual, não com o
    // que foi montado primeiro, que passa a estar destruído.
    this._interactionHandle = attachInteractions({
      element: this._container,
      section: this._section,
      renderer: {
        setGuides: (guides) => this._rendererHandle?.setGuides(guides),
        setEraserCursor: (cursor) => this._rendererHandle?.setEraserCursor(cursor),
        setGridPointer: (point) => this._rendererHandle?.setGridPointer(point),
        setDropTarget: (boardId) => this._rendererHandle?.setDropTarget(boardId),
      },
      onStateChange: (state) => this._onInteractionStateChange(state),
      boardTitle: (n) => this.messages.boardDefaultTitle(n),
      boardTitleLabel: this.messages.boardTitleLabel,
      onTextEditSuperseded: (nodeId, text) => {
        this._dispatchTypedEvent<TextEditSupersededEventDetail>('text-edit-superseded', {
          nodeId,
          text,
        });
      },
    });

    this._unsubscribeSection = this._section.subscribe((event) => {
      this._handleSectionChange(event);
    });

    if (this._stickyColor !== undefined) this._interactionHandle.setStickyColor(this._stickyColor);
    if (this._penSettings !== undefined) this._interactionHandle.setPenSettings(this._penSettings);
    if (this._eraserSize !== undefined) this._interactionHandle.setEraserSize(this._eraserSize);
    if (!this._stickyListening && typeof document !== 'undefined') {
      document.addEventListener('sticky-color-change', this._onStickyColorChange);
      document.addEventListener('pen-settings-change', this._onPenSettingsChange);
      document.addEventListener('eraser-size-change', this._onEraserSizeChange);
      this._stickyListening = true;
    }

    this._mounted = true;

    this._dispatchTypedEvent<CanvasReadyEventDetail>('canvas-ready', { section: this._section });
  }

  private _unmount(): void {
    if (this._stickyListening && typeof document !== 'undefined') {
      document.removeEventListener('sticky-color-change', this._onStickyColorChange);
      document.removeEventListener('pen-settings-change', this._onPenSettingsChange);
      document.removeEventListener('eraser-size-change', this._onEraserSizeChange);
      this._stickyListening = false;
    }
    if (this._interactionHandle) {
      this._interactionHandle.cancel();
      this._interactionHandle.destroy();
      this._interactionHandle = undefined;
    }
    // Um gesto em andamento termina junto com a interação: avisa o fim dele.
    this._onInteractionStateChange('idle');

    if (this._rendererHandle) {
      this._rendererHandle.destroy();
      this._rendererHandle = undefined;
    }

    if (this._unsubscribeSection) {
      this._unsubscribeSection();
      this._unsubscribeSection = undefined;
    }

    this._mounted = false;
  }

  private _interactionState: InteractionStateName = 'idle';

  /** Estado atual da interação (`idle`, `moving`, `resizing`, `drawing`...). */
  get interactionState(): InteractionStateName {
    return this._interactionState;
  }

  private _onInteractionStateChange(state: InteractionStateName): void {
    if (state === this._interactionState) return;
    this._interactionState = state;
    this._dispatchTypedEvent<InteractionStateChangeEventDetail>('interaction-state-change', {
      state,
    });
  }

  /** Opções de grid do renderer: o tamanho só vale com `grid`, o estilo e o realce valem sempre. */
  private _gridOptions(): GridOptions {
    const highlight = this.gridHighlight !== 'off';
    return this.grid
      ? { size: this.gridSize, style: this.gridStyle, highlight }
      : { style: this.gridStyle, highlight };
  }

  private _remountRenderer(): void {
    if (!this._mounted || !this._container || !this._section) return;
    if (this._rendererHandle) {
      this._rendererHandle.destroy();
      this._rendererHandle = undefined;
    }
    const gridOptions = this._gridOptions();
    const mountResult = mount({
      container: this._container,
      section: this._section,
      grid: gridOptions,
      onError: (error) => {
        this._dispatchTypedEvent<CanvasErrorEventDetail>('canvas-error', { error });
      },
    });
    if (mountResult.ok) {
      this._rendererHandle = mountResult.value;
    }
  }

  private _handleSectionChange(event: CanvasChange): void {
    const { snapshot, areas, origin, affectedIds } = event;

    if (areas.includes('document')) {
      this._dispatchTypedEvent<DocumentChangeEventDetail>('document-change', {
        snapshot,
        revision: snapshot.revision,
        origin,
        affectedIds,
        document: snapshot.document,
      });
    }

    if (areas.includes('selection')) {
      this._dispatchTypedEvent<SelectionChangeEventDetail>('selection-change', {
        selectedIds: snapshot.session.selectedIds,
        snapshot,
      });
    }

    if (areas.includes('viewport')) {
      this._dispatchTypedEvent<ViewportChangeEventDetail>('viewport-change', {
        viewport: snapshot.session.viewport,
        snapshot,
      });
    }

    if (areas.includes('tool')) {
      this._dispatchTypedEvent<ToolChangeEventDetail>('tool-change', {
        activeTool: snapshot.session.activeTool,
        snapshot,
      });
    }

    // Acessibilidade: emite anúncios apenas quando NÃO estiver em interação de alta frequência / preview
    const hasPreview = areas.includes('preview') || this._section?.getPreview() !== null;
    if (!hasPreview) {
      const msg = this.messages;
      if (areas.includes('selection')) {
        const count = snapshot.session.selectedIds.length;
        if (count === 0) {
          this.announce(msg.announceNoSelection);
        } else if (count === 1) {
          const id = snapshot.session.selectedIds[0]!;
          const node = snapshot.document.nodes[id];
          this.announce(
            node?.type === 'board'
              ? msg.announceBoardSelection(node.title)
              : msg.announceSingleSelection(node?.type ?? 'selecionado', id),
          );
        } else {
          this.announce(msg.announceMultiSelection(count));
        }
      } else if (areas.includes('tool')) {
        this.announce(msg.announceTool(snapshot.session.activeTool));
      } else if (areas.includes('viewport')) {
        this.announce(msg.announceZoom(Math.round(snapshot.session.viewport.zoom * 100)));
      }
    }
  }

  /**
   * Emite um anúncio acessível para leitores de tela via aria-live.
   * Suprime automaticamente durante interações de alta frequência e previews.
   */
  announce(text: string): void {
    if (this._section?.getPreview() !== null) return;
    this._announcement = text;
    this.requestUpdate();
  }

  private _dispatchTypedEvent<T>(type: string, detail: T): boolean {
    return this.dispatchEvent(
      new CustomEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: false,
        detail,
      }),
    );
  }

  override render() {
    return html`
      <div
        class="surface-container"
        part="container"
        tabindex="0"
        aria-label=${this.ariaLabel ?? 'Canvash Canvas'}
        role="region"
      >
        <slot></slot>
      </div>
      <slot name="overlay"></slot>
      <div
        class="sr-only"
        part="live-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        ${this._announcement}
      </div>
    `;
  }
}
