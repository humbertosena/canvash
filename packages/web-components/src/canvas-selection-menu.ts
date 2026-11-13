import type { CanvasSectionApi } from '@canvash/core';
import {
  executeDelete,
  executeGroup,
  executeReorder,
  executeUngroup,
  getGroupActions,
  isSelectionVisible,
  placeSelectionMenu,
  type GroupActionsAvailability,
  type InteractionStateName,
  type ScreenRect,
  type ScreenSize,
  type SelectionMenuPlacement,
  type SelectionMenuPlacementOptions,
} from '@canvash/interaction';
import { css, html, LitElement, nothing, svg } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { isMacPlatform } from './canvas-controls.js';
import type { ExportBoardRequestEventDetail, ExportFormat } from './events.js';
import { getGlobalI18n, type SelectionMenuI18nMessages } from './i18n.js';

/** O que o mini-menu precisa do `<canvas-surface>`: estado da interação, caixa, foco e eventos. */
export interface SelectionMenuCanvas {
  readonly interactionState: InteractionStateName;
  focus(): void;
  getBoundingClientRect(): ClientBox;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/** Ações do mini-menu: agem sobre o documento. Propriedades vive na ilha da toolbar. */
export type SelectionMenuAction =
  'bring-to-front' | 'send-to-back' | 'group' | 'ungroup' | 'export-board' | 'delete';

/** Tamanho do menu antes da primeira medida: botões de 32 px, vãos de 2 px, respiro e borda. */
export function defaultMenuSize(buttons: number): ScreenSize {
  return { width: 10 + buttons * 32 + (buttons - 1) * 2, height: 42 };
}

/** Altura do submenu de exportação: dois itens de 32 px, o vão e o respiro. */
const EXPORT_MENU_HEIGHT = 2 * 32 + 2 + 10;

/** Os três botões que existem sempre; Agrupar e Desagrupar entram conforme a seleção. */
const BASE_BUTTONS = 3;

const NO_GROUP_ACTIONS: GroupActionsAvailability = { group: 'hidden', ungroup: 'hidden' };

/**
 * Atalho de cada ação de grupo: o texto da dica (`title`) e o `aria-keyshortcuts`, na ordem da
 * plataforma. Os dois modificadores valem nas duas plataformas, e o da plataforma vem primeiro.
 */
const GROUP_SHORTCUTS = {
  group: {
    mac: { text: '⌘G', keys: 'Meta+G Control+G' },
    other: { text: 'Ctrl+G', keys: 'Control+G Meta+G' },
  },
  ungroup: {
    mac: { text: '⌘⇧G', keys: 'Meta+Shift+G Control+Shift+G' },
    other: { text: 'Ctrl+Shift+G', keys: 'Control+Shift+G Meta+Shift+G' },
  },
} as const;

/** Alça de rotação a 24 px da caixa da seleção, mais o raio dela: o menu não a cobre. */
const ROTATION_HANDLE_CLEARANCE = 28;

const PLACEMENT: SelectionMenuPlacementOptions = {
  margin: 16,
  gap: 12,
  topInset: 72,
  rotationHandleOffset: ROTATION_HANDLE_CLEARANCE,
};

const ICONS = {
  'bring-to-front': svg`<rect x="3" y="3" width="11" height="11" rx="1.5" /><path d="M10 21h9a2 2 0 0 0 2-2v-9" />`,
  'send-to-back': svg`<rect x="10" y="10" width="11" height="11" rx="1.5" /><path d="M14 3H5a2 2 0 0 0-2 2v9" />`,
  group: svg`<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" />`,
  ungroup: svg`<rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /><path d="M15 3h4a2 2 0 0 1 2 2v4M3 15v4a2 2 0 0 0 2 2h4" stroke-dasharray="2 2" />`,
  'export-board': svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 7v8M8.5 11.5 12 15l3.5-3.5M8 18h8" />`,
  delete: svg`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />`,
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

/** Caixa em px da tela, como `getBoundingClientRect` a devolve. */
interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function samePlacement(
  a: SelectionMenuPlacement | null,
  b: SelectionMenuPlacement | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.side === b.side;
}

/** As ações do menu, na ordem em que aparecem, para o estado de grupo e de exportação dados. */
function visibleActions(
  { group, ungroup }: GroupActionsAvailability,
  exportBoard: boolean,
): SelectionMenuAction[] {
  return [
    'bring-to-front',
    'send-to-back',
    ...(group === 'hidden' ? [] : (['group'] as const)),
    ...(ungroup === 'hidden' ? [] : (['ungroup'] as const)),
    ...(exportBoard ? (['export-board'] as const) : []),
    'delete',
  ];
}

/**
 * O botão do tabindex móvel continua o mesmo quando segue existindo; se a ação sumiu, o índice
 * vai para o botão na mesma posição, limitado ao último.
 */
function remapToolbarIndex(
  index: number,
  from: { readonly groups: GroupActionsAvailability; readonly exportBoard: boolean },
  to: { readonly groups: GroupActionsAvailability; readonly exportBoard: boolean },
): number {
  const before = visibleActions(from.groups, from.exportBoard);
  const after = visibleActions(to.groups, to.exportBoard);
  const kept = after.indexOf(before[index] ?? 'delete');
  return kept >= 0 ? kept : Math.min(index, after.length - 1);
}

/**
 * Depois de Agrupar ou Desagrupar com o foco no botão, o tabindex móvel vai para a ação oposta;
 * se ela não aparece, para o botão na mesma posição, limitado ao último.
 */
function focusIndexAfter(
  pending: { readonly action: 'group' | 'ungroup'; readonly index: number },
  actions: ReadonlyArray<string | null>,
): number {
  const opposite = actions.indexOf(pending.action === 'group' ? 'ungroup' : 'group');
  return opposite >= 0 ? opposite : Math.min(pending.index, actions.length - 1);
}

function sameGroupActions(a: GroupActionsAvailability, b: GroupActionsAvailability): boolean {
  return a.group === b.group && a.ungroup === b.ungroup;
}

interface Measures {
  /** Origem do bloco que contém o menu: ponto de referência de `left` e `top`. */
  readonly origin: { readonly left: number; readonly top: number };
  readonly canvas: ClientBox;
  /** Tamanho real do menu, quando ele já está na tela. */
  readonly menu: ScreenSize | undefined;
  /** Faixa à direita do canvas ocupada pela toolbar: o menu não se posiciona sobre ela. */
  readonly rightInset?: number;
}

/**
 * Mini-menu flutuante da seleção: trazer para frente, enviar para trás e excluir.
 * Fica sobre o canvas, acima da seleção (ou abaixo, quando acima não cabe), e só aparece com
 * uma seleção, a ferramenta de seleção, nenhum gesto em andamento e fora do modo leitura.
 * Recebe o `canvas` e o `<canvas-surface>` (`canvas`); vai no slot `overlay` do `<canvas-section>`.
 */
export class CanvasSelectionMenuElement extends LitElement {
  static override properties = {
    _placement: { state: true },
    _toolbarIndex: { state: true },
    _groupActions: { state: true },
    _exportBoardId: { state: true },
    _exportMenu: { state: true },
    exportBoard: { type: Boolean, attribute: 'export-board', reflect: true },
  };

  static override styles = css`
    :host {
      display: contents;
    }

    /* Âncora sem tamanho no canto do bloco que contém o menu: dela sai a origem das medidas. */
    .origin {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      pointer-events: none;
    }

    .menu {
      position: absolute;
      z-index: 5;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 4px;
      background: var(--canvash-surface-float, #ebecef);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-card, 16px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      font-family: var(--canvash-font-float, Inter, 'Google Sans', system-ui, sans-serif);
      user-select: none;
      -webkit-user-select: none;
      pointer-events: auto;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--canvash-text-float, #1f1f1f);
      cursor: pointer;
      outline: none;
      transition:
        background-color 0.15s ease,
        color 0.15s ease;
    }

    button:hover {
      background: var(--canvash-btn-hover-bg, rgba(0, 0, 0, 0.06));
    }

    /* Continua focável no tabindex móvel, mas sem efeito: o hover não destaca o botão. */
    button[aria-disabled='true'] {
      opacity: 0.4;
      cursor: default;
    }

    button[aria-disabled='true']:hover {
      background: transparent;
    }

    button:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 1px;
    }

    /* O submenu de exportação do board: irmão de .menu, para o tabindex móvel não contá-lo. */
    .export-menu {
      position: absolute;
      z-index: 6;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      background: var(--canvash-surface-float, #ebecef);
      border: 1px solid var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06));
      border-radius: var(--canvash-radius-card, 16px);
      box-shadow: var(
        --canvash-shadow-float,
        0 4px 16px rgba(0, 0, 0, 0.08),
        0 1px 2px rgba(0, 0, 0, 0.04)
      );
      font-family: var(--canvash-font-float, Inter, 'Google Sans', system-ui, sans-serif);
      font-size: 13px;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: auto;
    }

    .export-menu button {
      width: auto;
      min-width: 64px;
      padding: 0 12px;
      justify-content: flex-start;
    }
  `;

  /** Onde o menu fica agora; `null` quando está escondido. */
  private _placement: SelectionMenuPlacement | null = null;

  /** Botão da barra que está na ordem de tabulação (tabindex móvel). */
  private _toolbarIndex = 0;

  /** Estado de Agrupar e Desagrupar para a seleção de agora (US-GA.1 a US-GA.4). */
  private _groupActions: GroupActionsAvailability = NO_GROUP_ACTIONS;

  /**
   * Mostra Exportar board quando a seleção é um só board (`export-board`). Quem exporta e baixa o
   * arquivo é o host, pelo evento `export-board-request`. Padrão: `false`.
   */
  exportBoard = false;

  /** O board selecionado, se Exportar board está ligado e a seleção é só ele. */
  private _exportBoardId: string | undefined;

  /** O submenu de formatos: aberto ou não, e onde fica (px a partir da origem do menu). */
  private _exportMenu: { readonly x: number; readonly y: number } | null = null;

  /** O foco estava num botão quando a ação deu certo: devolvido ao botão certo depois do desenho. */
  private _focusAfter: { readonly action: 'group' | 'ungroup'; readonly index: number } | undefined;
  private _section: CanvasSectionApi | undefined;
  private _unsubscribeSection: (() => void) | undefined;
  private _canvas: SelectionMenuCanvas | undefined;
  private _frame: number | undefined;
  private _framePending = false;
  private _resizeObserver: ResizeObserver | undefined;
  private readonly _observed = new Set<Element>();
  private readonly _onInteractionState = () => this._schedule();

  /** ContextMenu e ⇧F10, com o canvas focado, levam o foco ao mini-menu. */
  private readonly _onCanvasKeydown = (event: Event) => {
    const { key, shiftKey, ctrlKey, altKey, metaKey } = event as KeyboardEvent;
    const contextKey = key === 'ContextMenu' || (key === 'F10' && shiftKey);
    if (!contextKey || ctrlKey || altKey || metaKey || !this._placement) return;
    event.preventDefault();
    this._buttons()[this._toolbarIndex]?.focus();
  };

  get section(): CanvasSectionApi | undefined {
    return this._section;
  }

  set section(next: CanvasSectionApi | undefined) {
    if (this._section === next) return;
    this._detachSection();
    this._section = next;
    this._attachSection();
    this._schedule();
  }

  /** O `<canvas-surface>` do mesmo canvas: dá o estado da interação, a caixa e o foco. */
  get canvas(): SelectionMenuCanvas | undefined {
    return this._canvas;
  }

  set canvas(next: SelectionMenuCanvas | undefined) {
    if (this._canvas === next) return;
    this._detachCanvas();
    this._canvas = next;
    this._attachCanvas();
    this._schedule();
  }

  private _messages?: Partial<SelectionMenuI18nMessages>;

  get messages(): SelectionMenuI18nMessages {
    return { ...getGlobalI18n().selectionMenu, ...this._messages };
  }

  set messages(val: Partial<SelectionMenuI18nMessages> | undefined) {
    this._messages = val;
    this.requestUpdate();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._attachSection();
    this._attachCanvas();
    this._schedule();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeExportMenu();
    this._watchOutsidePointer();
    this._detachSection();
    this._detachCanvas();
    if (
      this._framePending &&
      this._frame !== undefined &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this._frame);
    }
    this._framePending = false;
    this._frame = undefined;
  }

  protected override performUpdate(): void | Promise<unknown> {
    if (typeof document === 'undefined' || typeof document.createComment !== 'function') {
      return;
    }
    return super.performUpdate();
  }

  protected override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    this._observeSizes();
    this._applyFocusAfter();
    if (changed.has('exportBoard')) this._schedule();
    this._repositionExportMenu();
    this._applyExportFocus();
    this._watchOutsidePointer();
  }

  // Ligações ----------------------------------------------------------------------------------

  private _attachSection(): void {
    if (this._section && !this._unsubscribeSection) {
      this._unsubscribeSection = this._section.subscribe(() => this._schedule());
    }
  }

  private _detachSection(): void {
    this._unsubscribeSection?.();
    this._unsubscribeSection = undefined;
  }

  private _attachCanvas(): void {
    this._canvas?.addEventListener('interaction-state-change', this._onInteractionState);
    this._canvas?.addEventListener('keydown', this._onCanvasKeydown);
  }

  private _detachCanvas(): void {
    this._canvas?.removeEventListener('interaction-state-change', this._onInteractionState);
    this._canvas?.removeEventListener('keydown', this._onCanvasKeydown);
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._observed.clear();
  }

  /**
   * O menu muda de tamanho com os textos e a fonte, e o canvas com a janela: em ambos os casos
   * a posição precisa ser refeita. Só observa o que mudou, porque cada `observe` novo dispara
   * uma chamada inicial.
   */
  private _observeSizes(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = (this._resizeObserver ??= new ResizeObserver(() => this._schedule()));
    const wanted = new Set<Element>();
    const menu = this.renderRoot?.querySelector('.menu');
    if (menu) wanted.add(menu);
    // O canvas é um elemento; `SelectionMenuCanvas` só descreve o que o menu usa dele.
    if (this._canvas) wanted.add(this._canvas as unknown as Element);

    for (const element of this._observed) {
      if (wanted.has(element)) continue;
      observer.unobserve(element);
      this._observed.delete(element);
    }
    for (const element of wanted) {
      if (this._observed.has(element)) continue;
      observer.observe(element);
      this._observed.add(element);
    }
  }

  // Posição -----------------------------------------------------------------------------------

  /** Agrupa várias mudanças seguidas numa única atualização por quadro. */
  private _schedule(): void {
    if (this._framePending || typeof requestAnimationFrame !== 'function') return;
    this._framePending = true;
    this._frame = requestAnimationFrame(() => {
      this._framePending = false;
      this._update();
    });
  }

  /**
   * Só troca o estado quando a posição ou as ações de grupo mudam: em repouso não há novo
   * desenho. Uma mudança remota que bloqueia ou libera um nó chega aqui pela assinatura.
   */
  private _update(): void {
    let changed = false;
    const actions = this._computeGroupActions();
    const exportBoardId = this._computeExportBoardId();
    const exportChanged = this._exportBoardId !== exportBoardId;
    if (!sameGroupActions(this._groupActions, actions) || exportChanged) {
      this._toolbarIndex = remapToolbarIndex(
        this._toolbarIndex,
        { groups: this._groupActions, exportBoard: this._exportBoardId !== undefined },
        { groups: actions, exportBoard: exportBoardId !== undefined },
      );
      this._groupActions = actions;
      this._exportBoardId = exportBoardId;
      changed = true;
    }
    // O índice do foco pendente sai antes do desenho: escrito em `updated()`, reagendaria outro.
    const pending = this._focusAfter;
    if (pending) {
      this._toolbarIndex = focusIndexAfter(
        pending,
        visibleActions(actions, exportBoardId !== undefined),
      );
    }
    const next = this._computePlacement();
    if (!samePlacement(this._placement, next)) {
      this._placement = next;
      changed = true;
    }
    // O submenu pertence a um board e a um menu na tela: sem eles, fecha.
    if (this._exportMenu !== null && (exportChanged || next === null)) this._closeExportMenu();
    this._observeSizes();
    // Sem novo desenho não haverá `updated`: o foco pendente se resolve aqui.
    if (!changed) this._applyFocusAfter();
  }

  /** Devolve o foco depois de Agrupar ou Desagrupar, quando ele estava no botão da ação. */
  private _applyFocusAfter(): void {
    const pending = this._focusAfter;
    if (!pending) return;
    this._focusAfter = undefined;
    // Se a pessoa já levou o foco para outro lugar, ele não é roubado.
    if (!this._focusIsFree()) return;
    const buttons = this._buttons();
    if (buttons.length === 0) {
      // O menu saiu da tela com o botão: o foco volta ao canvas, como no Excluir.
      this._canvas?.focus();
      return;
    }
    const actions = buttons.map((button) => button.getAttribute('data-action'));
    const index = focusIndexAfter(pending, actions);
    // Depois de `_update()` o valor é o mesmo: o Lit não reagenda.
    this._toolbarIndex = index;
    buttons[index]!.focus();
  }

  /** O foco está no menu ou em lugar nenhum (o botão focado saiu da tela)? */
  private _focusIsFree(): boolean {
    const doc = this.ownerDocument;
    const active = doc?.activeElement ?? null;
    return active === null || active === doc.body || active === this;
  }

  /** O elemento do menu que tem o foco, ou `null`. */
  private _activeElement(): Element | null {
    return (this.renderRoot as ShadowRoot | undefined)?.activeElement ?? null;
  }

  /** Agrupar e Desagrupar para a seleção, ou os dois escondidos sem canvas ou sem seleção. */
  private _computeGroupActions(): GroupActionsAvailability {
    const section = this._section;
    if (!section) return NO_GROUP_ACTIONS;
    const { selectedIds } = section.getSnapshot().session;
    return selectedIds.length === 0 ? NO_GROUP_ACTIONS : getGroupActions(section, selectedIds);
  }

  /** O ID do board selecionado, se Exportar board está ligado e a seleção é só ele. */
  private _computeExportBoardId(): string | undefined {
    const section = this._section;
    if (!this.exportBoard || !section) return undefined;
    const { document, session } = section.getSnapshot();
    if (session.selectedIds.length !== 1) return undefined;
    const id = session.selectedIds[0]!;
    return document.nodes[id]?.type === 'board' ? id : undefined;
  }

  /** Quantos botões o menu tem agora: os três de sempre mais os de grupo e o de exportar. */
  private _buttonCount(): number {
    const { group, ungroup } = this._groupActions;
    return (
      BASE_BUTTONS +
      (group === 'hidden' ? 0 : 1) +
      (ungroup === 'hidden' ? 0 : 1) +
      (this._exportBoardId === undefined ? 0 : 1)
    );
  }

  /** Medidas do DOM, em px da tela: origem do menu, caixa do canvas e tamanho do menu. */
  private _measure(): Measures | undefined {
    const canvas = this._canvas?.getBoundingClientRect();
    if (!canvas) return undefined;
    const origin = this.renderRoot?.querySelector('.origin')?.getBoundingClientRect();
    const menu = this.renderRoot?.querySelector('.menu')?.getBoundingClientRect();
    return {
      origin: { left: origin?.left ?? canvas.left, top: origin?.top ?? canvas.top },
      canvas,
      menu: menu && menu.width > 0 ? { width: menu.width, height: menu.height } : undefined,
      rightInset: this._toolbarInset(),
    };
  }

  /**
   * A toolbar fica à direita, sobre o canvas: o shell publica a largura dela em
   * `--canvash-shell-toolbar-inline-size`. Reserva essa largura mais a margem das ilhas, ou 0 se
   * não houver toolbar (fora do shell).
   */
  private _toolbarInset(): number {
    if (typeof getComputedStyle !== 'function') return 0;
    const raw = getComputedStyle(this).getPropertyValue('--canvash-shell-toolbar-inline-size');
    const width = Number.parseFloat(raw);
    return Number.isFinite(width) && width > 0 ? PLACEMENT.margin + width : 0;
  }

  /** Onde o menu fica, ou `null` quando ele não deve aparecer. */
  private _computePlacement(): SelectionMenuPlacement | null {
    const section = this._section;
    const canvas = this._canvas;
    if (!section || !canvas) return null;

    const { session } = section.getSnapshot();
    const { selectedIds, activeTool, readOnly, viewport } = session;
    if (selectedIds.length === 0 || activeTool !== 'select' || readOnly) return null;
    if (canvas.interactionState !== 'idle') return null;

    const bounds = section.getBounds(selectedIds, { stroke: true, includePreview: false });
    const measures = this._measure();
    if (!bounds || !measures) return null;

    // A seleção está em px do canvas; o menu se posiciona a partir da origem do seu bloco.
    const dx = measures.canvas.left - measures.origin.left;
    const dy = measures.canvas.top - measures.origin.top;
    const selection: ScreenRect = {
      x: bounds.x * viewport.zoom + viewport.x + dx,
      y: bounds.y * viewport.zoom + viewport.y + dy,
      width: bounds.width * viewport.zoom,
      height: bounds.height * viewport.zoom,
    };
    const area: ScreenRect = {
      x: dx,
      y: dy,
      width: measures.canvas.width,
      height: measures.canvas.height,
    };
    if (!isSelectionVisible(selection, area)) return null;

    // O menu se posiciona na área livre, antes da toolbar; a visibilidade vale para o canvas todo.
    const inset = measures.rightInset ?? 0;
    const free: ScreenRect = { ...area, width: area.width - inset };
    return placeSelectionMenu(
      selection,
      measures.menu ?? defaultMenuSize(this._buttonCount()),
      free,
      PLACEMENT,
    );
  }

  // Ações -------------------------------------------------------------------------------------

  private _act(action: SelectionMenuAction): void {
    const section = this._section;
    if (!section) return;
    const { selectedIds } = section.getSnapshot().session;
    if (action === 'delete') {
      // O foco estava no botão que acabou de sair da tela: devolve-o ao canvas.
      if (executeDelete(section, selectedIds)) this._canvas?.focus();
      return;
    }
    if (action === 'group' || action === 'ungroup') {
      // O foco só é devolvido se estava no botão: no WebKit, clicar não o foca.
      const focused = this._activeElement();
      const index = focused ? this._buttons().indexOf(focused as HTMLElement) : -1;
      const done =
        action === 'group'
          ? executeGroup(section, selectedIds)
          : executeUngroup(section, selectedIds);
      if (done && index >= 0) this._focusAfter = { action, index };
      return;
    }
    executeReorder(
      section,
      selectedIds,
      action === 'bring-to-front' ? 'bringToFront' : 'sendToBack',
    );
  }

  // Exportar board -----------------------------------------------------------------------------

  private _exportButton(): HTMLElement | null {
    return (
      this.renderRoot?.querySelector<HTMLElement>('.menu [data-action="export-board"]') ?? null
    );
  }

  /** Abre o submenu abaixo do botão, ou acima se não couber, e fecha se já estava aberto. */
  private _toggleExportMenu(fromKeyboard = false): void {
    if (this._exportMenu !== null) {
      this._closeExportMenu();
      return;
    }
    this._exportMenu = this._computeExportMenuPosition();
    // Enter e Espaço chegam como clique sem ponteiro (`detail` 0): o foco vai para o primeiro item.
    if (fromKeyboard) this._exportFocus = 'first';
  }

  private _closeExportMenu(): void {
    this._exportMenu = null;
    this._exportFocus = undefined;
  }

  private _watchingOutside = false;

  /** Escuta o ponteiro fora do menu só enquanto o submenu está aberto. */
  private _watchOutsidePointer(): void {
    const open = this._exportMenu !== null;
    if (open === this._watchingOutside) return;
    this._watchingOutside = open;
    const doc = this.ownerDocument;
    if (open) doc.addEventListener('pointerdown', this._onOutsidePointer, true);
    else doc.removeEventListener('pointerdown', this._onOutsidePointer, true);
  }

  /** Foco pedido para um item do submenu, resolvido depois do desenho (`updated`). */
  private _exportFocus: 'first' | 'last' | undefined;

  /** Clique, toque ou ponteiro fora do menu e do submenu fecham o submenu. */
  private readonly _onOutsidePointer = (event: Event): void => {
    if (this._exportMenu === null) return;
    if (event.composedPath().includes(this)) return;
    this._closeExportMenu();
  };

  private _exportItems(): HTMLElement[] {
    return [
      ...(this.renderRoot?.querySelectorAll<HTMLElement>('.export-menu [role="menuitem"]') ?? []),
    ];
  }

  /** O teclado do botão: seta para baixo abre com foco no primeiro item; Esc fecha. */
  private _onExportButtonKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const wasOpen = this._exportMenu !== null;
      if (!wasOpen) this._exportMenu = this._computeExportMenuPosition();
      this._exportFocus = 'first';
      // Já aberto, nada será redesenhado: o foco vai agora.
      if (wasOpen) this._applyExportFocus();
    } else if (event.key === 'Escape' && this._exportMenu !== null) {
      event.preventDefault();
      event.stopPropagation();
      this._closeExportMenu();
    }
  }

  /**
   * O teclado do submenu, o da ilha Exportar do shell: setas e Home e End andam entre os itens, Esc
   * fecha e devolve o foco ao botão, Tab fecha. As teclas que o submenu usa não sobem para a barra.
   */
  private _onExportMenuKeydown(event: KeyboardEvent): void {
    const { key } = event;
    if (key === 'Tab') {
      this._closeExportMenu();
      return;
    }
    const handled = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'];
    if (!handled.includes(key)) return;
    event.stopPropagation();
    if (key === 'Enter' || key === ' ') return;

    event.preventDefault();
    if (key === 'Escape') {
      this._closeExportMenu();
      this._exportButton()?.focus();
      return;
    }
    const items = this._exportItems();
    if (items.length === 0) return;
    const from = items.indexOf(event.target as HTMLElement);
    const last = items.length - 1;
    let next: number;
    if (key === 'Home') next = 0;
    else if (key === 'End') next = last;
    else if (key === 'ArrowDown') next = from >= last ? 0 : from + 1;
    else next = from <= 0 ? last : from - 1;
    items[next]?.focus();
  }

  /** Foca o item pedido por `_exportFocus`, depois que o submenu foi desenhado. */
  private _applyExportFocus(): void {
    const wanted = this._exportFocus;
    if (wanted === undefined || this._exportMenu === null) return;
    const items = this._exportItems();
    if (items.length === 0) return;
    this._exportFocus = undefined;
    (wanted === 'first' ? items[0] : items[items.length - 1])?.focus();
  }

  /** Onde o submenu fica, em px a partir da origem do menu. */
  private _computeExportMenuPosition(): { readonly x: number; readonly y: number } {
    const placement = this._placement;
    const fallback = { x: placement?.x ?? 0, y: (placement?.y ?? 0) + 46 };
    const button = this._exportButton()?.getBoundingClientRect();
    const origin = this.renderRoot?.querySelector('.origin')?.getBoundingClientRect();
    if (!button || !origin) return fallback;
    const canvas = this._canvas?.getBoundingClientRect();
    const x = button.left - origin.left;
    const below = button.bottom - origin.top + 4;
    const fits =
      canvas === undefined || button.bottom + 4 + EXPORT_MENU_HEIGHT <= canvas.top + canvas.height;
    return { x, y: fits ? below : button.top - origin.top - 4 - EXPORT_MENU_HEIGHT };
  }

  /** Com o submenu aberto, o menu pode ter se movido: acompanha o botão. */
  private _repositionExportMenu(): void {
    if (this._exportMenu === null) return;
    const next = this._computeExportMenuPosition();
    if (next.x !== this._exportMenu.x || next.y !== this._exportMenu.y) this._exportMenu = next;
  }

  /** Escolher um formato fecha o submenu, devolve o foco ao botão e pede a exportação, uma vez. */
  private _chooseExport(format: ExportFormat): void {
    const boardId = this._exportBoardId;
    if (boardId === undefined) return;
    this._closeExportMenu();
    this._exportButton()?.focus();
    this.dispatchEvent(
      new CustomEvent<ExportBoardRequestEventDetail>('export-board-request', {
        detail: { boardId, format },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _buttons(): HTMLElement[] {
    return [...(this.renderRoot?.querySelectorAll<HTMLElement>('.menu button') ?? [])];
  }

  // Teclado -----------------------------------------------------------------------------------

  /** Setas, Home e End andam entre os botões (tabindex móvel); Tab sai da barra. */
  private _onToolbarKeydown(event: KeyboardEvent): void {
    const { key } = event;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    const buttons = this._buttons();
    if (buttons.length === 0) return;

    const from = buttons.indexOf(event.target as HTMLElement);
    const current = from >= 0 ? from : this._toolbarIndex;
    const last = buttons.length - 1;
    let next: number;
    if (key === 'Home') next = 0;
    else if (key === 'End') next = last;
    else if (key === 'ArrowRight') next = current >= last ? 0 : current + 1;
    else next = current <= 0 ? last : current - 1;

    event.preventDefault();
    this._toolbarIndex = next;
    buttons[next]?.focus();
  }

  // Desenho -----------------------------------------------------------------------------------

  private _renderAction(
    action: SelectionMenuAction,
    label: string,
    index: number,
    disabled = false,
  ) {
    const shortcut =
      action === 'group' || action === 'ungroup'
        ? GROUP_SHORTCUTS[action][isMacPlatform() ? 'mac' : 'other']
        : undefined;
    if (action === 'export-board') return this._renderExportButton(label, index);
    return html`<button
      type="button"
      part="selection-action selection-action-${action}"
      data-action="${action}"
      aria-label=${label}
      title=${ifDefined(shortcut ? `${label} (${shortcut.text})` : undefined)}
      aria-keyshortcuts=${ifDefined(shortcut?.keys)}
      aria-disabled=${ifDefined(disabled ? 'true' : undefined)}
      tabindex=${index === this._toolbarIndex ? '0' : '-1'}
      @focus=${() => (this._toolbarIndex = index)}
      @click=${() => this._act(action)}
    >
      ${icon(action)}
    </button>`;
  }

  /** Exportar board: abre o submenu de formatos, por isso `aria-haspopup` e `aria-expanded`. */
  private _renderExportButton(label: string, index: number) {
    return html`<button
      type="button"
      part="selection-action selection-action-export-board"
      data-action="export-board"
      aria-label=${label}
      title=${label}
      aria-haspopup="menu"
      aria-expanded=${String(this._exportMenu !== null)}
      tabindex=${index === this._toolbarIndex ? '0' : '-1'}
      @focus=${() => (this._toolbarIndex = index)}
      @keydown=${(event: KeyboardEvent) => this._onExportButtonKeydown(event)}
      @click=${(event: MouseEvent) => this._toggleExportMenu(event.detail === 0)}
    >
      ${icon('export-board')}
    </button>`;
  }

  /** Os botões visíveis, na ordem: frente, trás, Agrupar, Desagrupar, Exportar board e Excluir. */
  private _renderActions(msg: SelectionMenuI18nMessages) {
    const { group, ungroup } = this._groupActions;
    const buttons: [SelectionMenuAction, string, boolean][] = [
      ['bring-to-front', msg.bringToFront, false],
      ['send-to-back', msg.sendToBack, false],
    ];
    if (group !== 'hidden') buttons.push(['group', msg.group, group === 'disabled']);
    if (ungroup !== 'hidden') buttons.push(['ungroup', msg.ungroup, ungroup === 'disabled']);
    if (this._exportBoardId !== undefined) buttons.push(['export-board', msg.exportBoard, false]);
    buttons.push(['delete', msg.delete, false]);
    // Com chave por ação, o botão de uma ação é sempre o mesmo nó: ao entrar ou sair Agrupar e
    // Desagrupar, nenhum nó passa a significar outra ação (foco, leitor de tela e testes).
    return repeat(
      buttons,
      ([action]) => action,
      ([action, label, disabled], index) => this._renderAction(action, label, index, disabled),
    );
  }

  /** O submenu de formatos, irmão de `.menu`; só existe aberto. */
  private _renderExportMenu(msg: SelectionMenuI18nMessages) {
    const position = this._exportMenu;
    if (position === null) return nothing;
    const items: ReadonlyArray<readonly [ExportFormat, string]> = [
      ['svg', msg.exportBoardSvg],
      ['png', msg.exportBoardPng],
    ];
    return html`<div
      class="export-menu"
      part="export-board-menu"
      role="menu"
      aria-label=${msg.exportBoardMenu}
      style=${`left: ${position.x}px; top: ${position.y}px`}
      @keydown=${(event: KeyboardEvent) => this._onExportMenuKeydown(event)}
    >
      ${items.map(
        ([format, label]) =>
          html`<button
            type="button"
            part="export-board-item"
            role="menuitem"
            data-format=${format}
            aria-label=${label}
            tabindex="-1"
            @click=${() => this._chooseExport(format)}
          >
            ${format.toUpperCase()}
          </button>`,
      )}
    </div>`;
  }

  override render() {
    const origin = html`<span class="origin" aria-hidden="true"></span>`;
    const placement = this._placement;
    if (!placement) return origin;

    const msg = this.messages;
    return html`${origin}
      <div
        class="menu"
        part="selection-menu"
        role="toolbar"
        aria-label=${msg.toolbarLabel}
        style=${`left: ${placement.x}px; top: ${placement.y}px`}
        @keydown=${(event: KeyboardEvent) => this._onToolbarKeydown(event)}
      >
        ${this._renderActions(msg)}
      </div>
      ${this._renderExportMenu(msg)}`;
  }
}
