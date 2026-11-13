import { zoomAt } from '@canvash/core';
import type { CanvasSectionApi } from '@canvash/core';
import { ZOOM_STEP_FACTOR } from '@canvash/interaction';
import { css, html, LitElement, svg } from 'lit';
import { getGlobalI18n, type CanvasControlsI18nMessages } from './i18n.js';
import { ToolMenu } from './tool-menu.js';

/** O que os controles pedem ao `<canvas-surface>`: zoom e enquadramento ancorados no centro. */
export interface ZoomTarget {
  zoomBy(factor: number): void;
  zoomTo(zoom: number): void;
  fitToContent(): void;
  fitToSelection(): void;
}

export type ZoomItemId = 'in' | 'out' | 'reset' | 'fit' | 'selection';

/** Itens do menu de zoom, na ordem exibida; o atalho de cada um vem de `DEFAULT_SHORTCUTS`. */
export const ZOOM_ITEMS: readonly {
  readonly id: ZoomItemId;
  readonly label: keyof CanvasControlsI18nMessages;
  /** Atalho em macOS e nos demais sistemas. */
  readonly shortcut: { readonly mac: string; readonly other: string };
}[] = [
  { id: 'in', label: 'zoomIn', shortcut: { mac: '⌘=', other: 'Ctrl+=' } },
  { id: 'out', label: 'zoomOut', shortcut: { mac: '⌘-', other: 'Ctrl+-' } },
  { id: 'reset', label: 'zoomTo100', shortcut: { mac: '⇧0', other: 'Shift+0' } },
  { id: 'fit', label: 'zoomToFit', shortcut: { mac: '⇧1', other: 'Shift+1' } },
  { id: 'selection', label: 'zoomToSelection', shortcut: { mac: '⇧2', other: 'Shift+2' } },
];

const ICONS = {
  undo: svg`<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />`,
  redo: svg`<path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />`,
};

/** Ícone decorativo: o nome do botão vem do `aria-label`. */
function icon(id: keyof typeof ICONS) {
  return html`<svg
    part="icon"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    ${ICONS[id]}
  </svg>`;
}

/** A plataforma é Apple? Define o modificador principal mostrado e anunciado nos atalhos. */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Atalho com o modificador principal: ⌘ no macOS, Ctrl nos demais. */
function command(mac: boolean, key: string, shift = false): string {
  if (mac) return `⌘${shift ? '⇧' : ''}${key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

interface HelpRow {
  readonly label: keyof CanvasControlsI18nMessages;
  readonly keys: string;
}

interface HelpSection {
  readonly title: keyof CanvasControlsI18nMessages;
  readonly rows: readonly HelpRow[];
}

/** Atalhos reais do editor, agrupados como o diálogo de ajuda os mostra. */
function helpSections(mac: boolean, msg: CanvasControlsI18nMessages): readonly HelpSection[] {
  return [
    {
      title: 'helpSectionEdit',
      rows: [
        { label: 'helpDelete', keys: 'Delete / Backspace' },
        { label: 'helpEditText', keys: 'Enter' },
        { label: 'helpMove', keys: '← ↑ → ↓' },
        { label: 'helpUndo', keys: command(mac, 'Z') },
        { label: 'helpRedo', keys: mac ? '⌘⇧Z' : `${command(mac, 'Z', true)} / Ctrl+Y` },
        { label: 'helpCancel', keys: 'Esc' },
      ],
    },
    {
      title: 'helpSectionArrange',
      rows: [
        { label: 'helpGroup', keys: command(mac, 'G') },
        { label: 'helpUngroup', keys: command(mac, 'G', true) },
        { label: 'helpBringToFront', keys: command(mac, ']', true) },
        { label: 'helpBringForward', keys: command(mac, ']') },
        { label: 'helpSendBackward', keys: command(mac, '[') },
        { label: 'helpSendToBack', keys: command(mac, '[', true) },
      ],
    },
    {
      title: 'helpSectionView',
      rows: [
        { label: 'helpPan', keys: msg.keySpace },
        ...ZOOM_ITEMS.map((item) => ({
          label: item.label,
          keys: mac ? item.shortcut.mac : item.shortcut.other,
        })),
      ],
    },
  ];
}

/**
 * Controles da base do canvas: desfazer e refazer, zoom com menu (aproximar, afastar, 100%,
 * ajustar ao conteúdo e ajustar à seleção). Recebe o `canvas` e, para ancorar o zoom no centro e
 * enquadrar, o `<canvas-surface>` em `canvas`.
 */
export class CanvasControlsElement extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
      user-select: none;
      -webkit-user-select: none;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pill,
    .zoom-group > .zoom-button {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px;
      background: var(--canvash-toolbar-bg, var(--canvash-surface-float, #ebecef));
      border: 1px solid
        var(--canvash-toolbar-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: var(--canvash-toolbar-radius, var(--canvash-radius-card, 16px));
      box-shadow: var(
        --canvash-toolbar-shadow,
        var(--canvash-shadow-float, 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04))
      );
    }

    .zoom-group {
      position: relative;
      display: inline-flex;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      height: 32px;
      padding: 0 6px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--canvash-toolbar-color, var(--canvash-text-float, #1f1f1f));
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      outline: none;
      transition:
        background-color 0.15s ease,
        border-color 0.15s ease,
        color 0.15s ease;
    }

    button:hover:not(:disabled) {
      background: var(--canvash-btn-hover-bg, rgba(0, 0, 0, 0.06));
      color: var(--canvash-btn-hover-color, var(--canvash-text-float, #1f1f1f));
    }

    button:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 1px;
    }

    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .zoom-button {
      min-width: 56px;
      font-variant-numeric: tabular-nums;
    }

    .zoom-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 10;
      display: flex;
      flex-direction: column;
      min-width: 220px;
      padding: 4px;
      background: var(
        --canvash-menu-bg,
        var(--canvash-toolbar-bg, var(--canvash-surface-float, #ebecef))
      );
      border: 1px solid
        var(
          --canvash-menu-border,
          var(--canvash-toolbar-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)))
        );
      border-radius: var(--canvash-toolbar-radius, var(--canvash-radius-card, 16px));
      box-shadow: var(
        --canvash-menu-shadow,
        var(--canvash-shadow-float, 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04))
      );
    }

    .zoom-menu button {
      justify-content: space-between;
      gap: 24px;
      width: 100%;
      height: 32px;
      text-align: left;
    }

    .zoom-menu button[aria-disabled='true'] {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .shortcut {
      font-size: 12px;
      color: var(--canvash-toolbar-muted, #4b5563);
    }

    .help-button {
      width: 40px;
      min-width: 40px;
      height: 40px;
      padding: 0;
      font-weight: 600;
      background: var(--canvash-toolbar-bg, var(--canvash-surface-float, #ebecef));
      border: 1px solid
        var(--canvash-toolbar-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: 50%;
      box-shadow: var(
        --canvash-toolbar-shadow,
        var(--canvash-shadow-float, 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04))
      );
    }

    dialog.help {
      width: min(480px, calc(100vw - 32px));
      max-height: calc(100vh - 64px);
      padding: 0;
      color: var(--canvash-toolbar-color, var(--canvash-text-float, #1f1f1f));
      background: var(
        --canvash-menu-bg,
        var(--canvash-toolbar-bg, var(--canvash-surface-float, #ebecef))
      );
      border: 1px solid
        var(
          --canvash-menu-border,
          var(--canvash-toolbar-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)))
        );
      border-radius: 16px;
      box-shadow: var(
        --canvash-menu-shadow,
        var(--canvash-shadow-float, 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04))
      );
    }

    dialog.help::backdrop {
      background: rgba(15, 23, 42, 0.4);
    }

    .help-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 20px 24px;
      font-size: 14px;
    }

    .help-body h2 {
      margin: 0;
      font-size: 16px;
    }

    .help-body h3 {
      margin: 0 0 4px;
      font-size: 13px;
      color: var(--canvash-toolbar-muted, #4b5563);
    }

    .help-body dl {
      margin: 0;
    }

    .help-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 3px 0;
    }

    .help-row dt,
    .help-row dd {
      margin: 0;
    }

    .help-row kbd {
      font-family: inherit;
      font-size: 12px;
      color: var(--canvash-toolbar-muted, #4b5563);
      white-space: nowrap;
    }

    .help-close {
      align-self: flex-end;
      padding: 0 16px;
      border-color: var(
        --canvash-toolbar-border,
        var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06))
      );
    }
  `;

  /** Os controles ficam na horizontal; o `ToolMenu` lê a orientação do dono. */
  readonly orientation = 'horizontal' as const;

  /** Menu de zoom: estado, teclado, foco e fechamento ficam no controlador. */
  private readonly _zoomMenu = new ToolMenu({
    host: this,
    columns: 1,
    count: ZOOM_ITEMS.length,
    groupSelector: '.zoom-group',
    menuSelector: '.zoom-menu',
    toggleSelector: '[data-action="open-zoom"]',
    entrySelector: (index) => `[role="menuitem"][data-zoom="${ZOOM_ITEMS[index]?.id ?? ''}"]`,
    initialIndex: () => 0,
  });

  /** Estado do menu de zoom; não reflete em atributo. */
  get zoomMenuOpen(): boolean {
    return this._zoomMenu.open;
  }

  set zoomMenuOpen(open: boolean) {
    if (open) this._zoomMenu.openMenu();
    else this._zoomMenu.close({ restoreFocus: false });
  }

  private _section: CanvasSectionApi | undefined;
  private _unsubscribeSection: (() => void) | undefined;

  get section(): CanvasSectionApi | undefined {
    return this._section;
  }

  set section(nextSection: CanvasSectionApi | undefined) {
    if (this._section === nextSection) return;
    this._detach();
    this._section = nextSection;
    this._attach();
    this.requestUpdate();
  }

  private _canvas: ZoomTarget | undefined;

  /** O `<canvas-surface>` do mesmo canvas; sem ele, os itens de enquadramento ficam desabilitados. */
  get canvas(): ZoomTarget | undefined {
    return this._canvas;
  }

  set canvas(next: ZoomTarget | undefined) {
    if (this._canvas === next) return;
    this._canvas = next;
    this.requestUpdate();
  }

  private _messages?: Partial<CanvasControlsI18nMessages>;

  get messages(): CanvasControlsI18nMessages {
    return { ...getGlobalI18n().controls, ...this._messages };
  }

  set messages(val: Partial<CanvasControlsI18nMessages> | undefined) {
    this._messages = val;
    this.requestUpdate();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._attach();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._detach();
    this._zoomMenu.dispose();
  }

  protected override performUpdate(): void | Promise<unknown> {
    if (typeof document === 'undefined' || typeof document.createComment !== 'function') {
      return;
    }
    return super.performUpdate();
  }

  private _attach(): void {
    if (this._section && !this._unsubscribeSection) {
      this._unsubscribeSection = this._section.subscribe(() => this.requestUpdate());
    }
  }

  private _detach(): void {
    if (this._unsubscribeSection) {
      this._unsubscribeSection();
      this._unsubscribeSection = undefined;
    }
  }

  private _undo(): void {
    this._section?.undo();
  }

  private _redo(): void {
    this._section?.redo();
  }

  /** Leva o zoom a `zoom`; sem `canvas`, ancora na origem da tela. */
  private _zoomTo(zoom: number): void {
    if (!this._section) return;
    if (this._canvas) {
      this._canvas.zoomTo(zoom);
      return;
    }
    const viewport = this._section.getSnapshot().session.viewport;
    const next = zoomAt(viewport, { x: 0, y: 0 }, zoom);
    if (next !== viewport) this._section.setViewport(next);
  }

  private _zoomBy(factor: number): void {
    if (!this._section) return;
    if (this._canvas) {
      this._canvas.zoomBy(factor);
      return;
    }
    this._zoomTo(this._section.getSnapshot().session.viewport.zoom * factor);
  }

  /** O item não tem como agir agora: sem canvas, sem `canvas`, sem conteúdo ou sem seleção. */
  private _isDisabled(id: ZoomItemId): boolean {
    const snap = this._section?.getSnapshot();
    if (!snap) return true;
    if (id === 'fit') return !this._canvas || Object.keys(snap.document.nodes).length === 0;
    if (id === 'selection') return !this._canvas || snap.session.selectedIds.length === 0;
    return false;
  }

  /** Executa o item do menu de zoom e fecha o menu devolvendo o foco ao botão. */
  private _activate(id: ZoomItemId): void {
    if (this._isDisabled(id)) return;
    switch (id) {
      case 'in':
        this._zoomBy(ZOOM_STEP_FACTOR);
        break;
      case 'out':
        this._zoomBy(1 / ZOOM_STEP_FACTOR);
        break;
      case 'reset':
        this._zoomTo(1);
        break;
      case 'fit':
        this._canvas?.fitToContent();
        break;
      case 'selection':
        this._canvas?.fitToSelection();
        break;
    }
    this._zoomMenu.close({ restoreFocus: true });
  }

  /** O menu abre para cima: seta para cima ou para baixo no botão abrem. */
  private _onZoomKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    this._zoomMenu.openMenu();
  }

  private _helpDialog(): HTMLDialogElement | null {
    return this.renderRoot?.querySelector<HTMLDialogElement>('dialog') ?? null;
  }

  /** Abre o diálogo de atalhos como modal; o menu de zoom, se aberto, fecha antes. */
  private _openHelp(): void {
    const dialog = this._helpDialog();
    if (!dialog || dialog.open || typeof dialog.showModal !== 'function') return;
    this._zoomMenu.close({ restoreFocus: false });
    dialog.showModal();
  }

  private _closeHelp(): void {
    const dialog = this._helpDialog();
    if (dialog?.open) dialog.close();
  }

  /** Esc, Fechar ou `close()`: o foco volta ao botão "?" que abriu o diálogo. */
  private _onHelpClose(): void {
    this.renderRoot?.querySelector<HTMLElement>('[data-action="open-help"]')?.focus();
  }

  private _renderHelp(msg: CanvasControlsI18nMessages) {
    const mac = isMacPlatform();
    return html`
      <dialog
        class="help"
        part="help-dialog"
        aria-labelledby="help-title"
        @close=${() => this._onHelpClose()}
      >
        <div class="help-body" part="help-body">
          <h2 id="help-title" part="help-title">${msg.helpTitle}</h2>
          <slot name="help">
            ${helpSections(mac, msg).map(
              (helpSection) => html`
                <section part="help-section">
                  <h3>${msg[helpSection.title] as string}</h3>
                  <dl>
                    ${helpSection.rows.map(
                      (row) => html`
                        <div class="help-row" part="help-row">
                          <dt>${msg[row.label] as string}</dt>
                          <dd><kbd part="help-keys">${row.keys}</kbd></dd>
                        </div>
                      `,
                    )}
                  </dl>
                </section>
              `,
            )}
          </slot>
          <button
            type="button"
            class="help-close"
            part="help-close"
            data-action="close-help"
            @click=${() => this._closeHelp()}
          >
            ${msg.close}
          </button>
        </div>
      </dialog>
    `;
  }

  private _renderZoomMenu(msg: CanvasControlsI18nMessages) {
    const mac = isMacPlatform();
    return html`
      <div
        id="zoom-menu"
        class="zoom-menu"
        part="zoom-menu"
        role="menu"
        aria-label=${msg.zoomMenu}
        @keydown=${(event: KeyboardEvent) => this._zoomMenu.onMenuKeydown(event)}
        @focusout=${(event: FocusEvent) => this._zoomMenu.onFocusOut(event)}
      >
        ${ZOOM_ITEMS.map(
          (item, index) => html`
            <button
              type="button"
              role="menuitem"
              part="zoom-item zoom-item-${item.id}"
              data-zoom=${item.id}
              aria-disabled=${this._isDisabled(item.id) ? 'true' : 'false'}
              tabindex=${index === this._zoomMenu.focusedIndex ? '0' : '-1'}
              @focus=${() => this._zoomMenu.noteFocus(index)}
              @click=${() => this._activate(item.id)}
            >
              <span>${msg[item.label] as string}</span>
              <span class="shortcut" part="zoom-shortcut"
                >${mac ? item.shortcut.mac : item.shortcut.other}</span
              >
            </button>
          `,
        )}
      </div>
    `;
  }

  override render() {
    const snap = this._section?.getSnapshot();
    const readOnly = snap?.session.readOnly ?? false;
    const canUndo = (snap?.history.canUndo ?? false) && !readOnly;
    const canRedo = (snap?.history.canRedo ?? false) && !readOnly;
    const percent = Math.round((snap?.session.viewport.zoom ?? 1) * 100);
    const msg = this.messages;

    return html`
      <div class="controls" part="controls">
        <div class="pill" part="history-group" role="group" aria-label=${msg.historyLabel}>
          <button
            type="button"
            part="action-button action-undo"
            data-action="undo"
            aria-label=${msg.undo}
            ?disabled=${!canUndo}
            @click=${this._undo}
          >
            ${icon('undo')}
          </button>
          <button
            type="button"
            part="action-button action-redo"
            data-action="redo"
            aria-label=${msg.redo}
            ?disabled=${!canRedo}
            @click=${this._redo}
          >
            ${icon('redo')}
          </button>
        </div>

        <div class="zoom-group" part="zoom-group">
          <button
            type="button"
            class="zoom-button"
            part="zoom-button"
            data-action="open-zoom"
            aria-label=${msg.zoomButton(percent)}
            aria-haspopup="menu"
            aria-expanded=${this.zoomMenuOpen ? 'true' : 'false'}
            aria-controls="zoom-menu"
            ?disabled=${!this._section}
            @click=${() => this._zoomMenu.toggle()}
            @keydown=${(event: KeyboardEvent) => this._onZoomKeydown(event)}
          >
            ${percent}%
          </button>
          ${this.zoomMenuOpen ? this._renderZoomMenu(msg) : ''}
        </div>

        <button
          type="button"
          class="help-button"
          part="help-button"
          data-action="open-help"
          aria-label=${msg.help}
          aria-haspopup="dialog"
          @click=${() => this._openHelp()}
        >
          ?
        </button>
      </div>
      ${this._renderHelp(msg)}
    `;
  }
}
