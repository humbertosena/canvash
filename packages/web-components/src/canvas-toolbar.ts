import {
  clampZoom,
  DEFAULT_PEN_SETTINGS,
  DEFAULT_ZOOM_LIMITS,
  PEN_PALETTE,
  STICKY_COLORS,
} from '@canvash/core';
import type { CanvasSectionApi } from '@canvash/core';
import { css, html, LitElement, svg, type PropertyValues, type SVGTemplateResult } from 'lit';
import { getGlobalI18n, type ToolbarI18nMessages } from './i18n.js';
import type {
  EraserSizeChangeEventDetail,
  PenSettingsChangeEventDetail,
  PropertiesPanelToggleEventDetail,
  StickyColorChangeEventDetail,
} from './events.js';
import { ToolMenu, type ToolMenuBlock } from './tool-menu.js';

/**
 * Figuras do botão "Figuras", na ordem da ilha. Seta e chaves entram por serem listadas entre as
 * figuras, embora a primeira seja uma linha com ponta e a segunda, aberta.
 */
export const SHAPE_GROUP_TOOLS = [
  'rectangle',
  'square',
  'ellipse',
  'circle',
  'diamond',
  'triangle',
  'polygon',
  'pentagon',
  'hexagon',
  'octagon',
  'cross',
  'chevron',
  'arrow',
  'brace',
] as const;

export type ShapeGroupTool = (typeof SHAPE_GROUP_TOOLS)[number];

/** Chave da mensagem que nomeia cada figura. */
const SHAPE_LABEL_KEYS = {
  rectangle: 'rect',
  square: 'square',
  ellipse: 'ellipse',
  circle: 'circle',
  diamond: 'diamond',
  triangle: 'triangle',
  polygon: 'polygon',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  octagon: 'octagon',
  cross: 'cross',
  chevron: 'chevron',
  arrow: 'arrow',
  brace: 'brace',
} as const satisfies Record<ShapeGroupTool, keyof ToolbarI18nMessages>;

/** Colunas da grade da ilha de figuras. */
const SHAPES_MENU_COLUMNS = 4;

/** Cores da paleta da nota, na ordem do menu, com a chave da mensagem que as nomeia. */
const STICKY_PALETTE = [
  ['yellow', 'stickyColorYellow'],
  ['pink', 'stickyColorPink'],
  ['green', 'stickyColorGreen'],
  ['blue', 'stickyColorBlue'],
  ['orange', 'stickyColorOrange'],
  ['purple', 'stickyColorPurple'],
] as const satisfies ReadonlyArray<
  readonly [keyof typeof STICKY_COLORS, keyof ToolbarI18nMessages]
>;

/** Entradas do menu de cor: as 6 amostras e o seletor de cor personalizada. */
const STICKY_MENU_ENTRIES = STICKY_PALETTE.length + 1;
const STICKY_MENU_COLUMNS = 3;

type PenSettings = PenSettingsChangeEventDetail['settings'];
type PenKind = PenSettings['kind'];
type PenWidth = PenSettings['width'];

const PEN_KINDS = [
  ['pen', 'penKindPen'],
  ['marker', 'penKindMarker'],
  ['highlighter', 'penKindHighlighter'],
] as const satisfies ReadonlyArray<readonly [PenKind, keyof ToolbarI18nMessages]>;

const PEN_WIDTHS = [
  ['thin', 'penWidthThin'],
  ['medium', 'penWidthMedium'],
  ['thick', 'penWidthThick'],
] as const satisfies ReadonlyArray<readonly [PenWidth, keyof ToolbarI18nMessages]>;

/** Nome de cada cor de `PEN_PALETTE`, na mesma ordem. */
const PEN_COLOR_LABELS = [
  'penColorGraphite',
  'penColorRed',
  'penColorOrange',
  'penColorYellow',
  'penColorGreen',
  'penColorBlue',
  'penColorPurple',
  'penColorPink',
] as const satisfies ReadonlyArray<keyof ToolbarI18nMessages>;

/**
 * Entradas do menu da caneta, em 3 colunas e 5 linhas: tipo (3), espessura (3), as 8 cores da
 * paleta e a entrada do seletor de cor personalizada.
 */
const PEN_KIND_START = 0;
const PEN_WIDTH_START = PEN_KINDS.length;
const PEN_COLOR_START = PEN_WIDTH_START + PEN_WIDTHS.length;
const PEN_CUSTOM_INDEX = PEN_COLOR_START + PEN_PALETTE.length;
const PEN_MENU_ENTRIES = PEN_CUSTOM_INDEX + 1;
const PEN_MENU_COLUMNS = 3;

type EraserSize = EraserSizeChangeEventDetail['size'];

const ERASER_SIZES = [
  ['thin', 'eraserThin'],
  ['medium', 'eraserMedium'],
  ['thick', 'eraserThick'],
] as const satisfies ReadonlyArray<readonly [EraserSize, keyof ToolbarI18nMessages]>;

/** Diâmetro, em CSS px, da bolinha que representa cada tamanho no chip e no menu. */
const ERASER_DOT_PX: Readonly<Record<EraserSize, number>> = { thin: 6, medium: 10, thick: 14 };

function isShapeGroupTool(tool: string): tool is ShapeGroupTool {
  return (SHAPE_GROUP_TOOLS as readonly string[]).includes(tool);
}

/**
 * Opções do botão "Desenho", na ordem da ilha. A caneta aparece como "Tinta"; o nó que ela cria
 * continua `ink`.
 */
export const DRAW_GROUP_TOOLS = ['line', 'bezier', 'pen', 'eraser'] as const;

export type DrawGroupTool = (typeof DRAW_GROUP_TOOLS)[number];

function isDrawGroupTool(tool: string): tool is DrawGroupTool {
  return (DRAW_GROUP_TOOLS as readonly string[]).includes(tool);
}

/** Nome de cada opção do grupo Desenho: chave da mensagem. */
const DRAW_LABEL_KEYS = {
  line: 'line',
  bezier: 'bezier',
  pen: 'drawPen',
  eraser: 'eraser',
} as const satisfies Record<DrawGroupTool, keyof ToolbarI18nMessages>;

/** Colunas das opções da ilha de Desenho. */
const DRAW_OPTION_COLUMNS = 4;
/** As configurações da opção marcada começam depois das 4 opções. */
const DRAW_SETTINGS_START = DRAW_GROUP_TOOLS.length;

/** O nome sem o atalho entre parênteses: "Retângulo (R)" vira "Retângulo". */
function plainName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '');
}

export interface ToolbarToolDef {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly icon: string;
}

export const DEFAULT_TOOLBAR_TOOLS: readonly ToolbarToolDef[] = [
  { id: 'select', label: 'Selecionar (V)', shortcut: 'V', icon: '↖' },
  { id: 'rectangle', label: 'Retângulo (R)', shortcut: 'R', icon: '▭' },
  { id: 'ellipse', label: 'Elipse (O)', shortcut: 'O', icon: '○' },
  { id: 'line', label: 'Linha (L)', shortcut: 'L', icon: '╱' },
  { id: 'arrow', label: 'Seta (A)', shortcut: 'A', icon: '➔' },
  { id: 'text', label: 'Texto (T)', shortcut: 'T', icon: 'T' },
];

/**
 * Traços dos ícones em uma grade 24×24, desenhados com `currentColor`: o botão herda a cor dos
 * tokens de tema e dos estados (hover, ativo, desabilitado).
 */
const ICONS = {
  select: svg`<path d="M5 3l14 7.5-6.2 1.6L10 18.5z" />`,
  hand: svg`<path
    d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V12M17 12V8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.5a6 6 0 0 1-4.6-2.2L4 15.5a1.5 1.5 0 0 1 2.3-1.9L8 15.5"
  />`,
  rectangle: svg`<rect x="3" y="6" width="18" height="12" rx="1" />`,
  square: svg`<rect x="5" y="5" width="14" height="14" rx="1" />`,
  ellipse: svg`<ellipse cx="12" cy="12" rx="9" ry="6" />`,
  circle: svg`<circle cx="12" cy="12" r="8" />`,
  diamond: svg`<path d="M12 3l9 9-9 9-9-9z" />`,
  triangle: svg`<path d="M12 4l9 16H3z" />`,
  polygon: svg`<path d="M12 3.4L19.04 6.79L20.77 14.4L15.9 20.51L8.1 20.51L3.23 14.4L4.96 6.79z" />`,
  pentagon: svg`<path d="M12 3.8L20.56 10.02L17.29 20.08L6.71 20.08L3.44 10.02z" />`,
  hexagon: svg`<path d="M12 3L19.79 7.5L19.79 16.5L12 21L4.21 16.5L4.21 7.5z" />`,
  octagon: svg`<path d="M15.44 3.69L20.31 8.56L20.31 15.44L15.44 20.31L8.56 20.31L3.69 15.44L3.69 8.56L8.56 3.69z" />`,
  cross: svg`<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />`,
  chevron: svg`<path d="M4 5h11l5 7-5 7H4l5-7z" />`,
  brace: svg`<path d="M16 3c-3 0-4 1-4 3v4c0 1.5-1 2-4 2 3 0 4 .5 4 2v4c0 2 1 3 4 3" />`,
  properties: svg`<path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" />`,
  line: svg`<path d="M5 19L19 5" />`,
  bezier: svg`<path d="M4 18C8 4 16 20 20 6" />`,
  arrow: svg`<path d="M5 19L19 5M10 5h9v9" />`,
  figures: svg`<rect x="3.5" y="3.5" width="7" height="7" rx="1" /><circle cx="17" cy="7" r="3.5" /><path d="M7 20.5l3.5-7h-7z" /><path d="M14 20l6-6M15.5 14h4.5v4.5" />`,
  text: svg`<path d="M5 7V4h14v3M12 4v16M9 20h6" />`,
  board: svg`<rect x="3" y="8" width="18" height="12" rx="1" /><path d="M3 8V4.5h8V8" />`,
  sticky: svg`<path d="M5 4h14v10l-6 6H5zM13 20v-6h6" />`,
  pen: svg`<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />`,
  eraser: svg`<path d="M16 4l5 5-10 10H6l-3-3zM9 8l7 7M11 19h10" />`,
  marker: svg`<path d="M5 20l1-4 9-9 3 3-9 9zM13 9l3 3M4 21h6" />`,
  highlighter: svg`<path d="M6 17l9-9 3 3-9 9H6zM9 20h11" />`,
  widthThin: svg`<path d="M4 12h16" stroke-width="1" />`,
  widthMedium: svg`<path d="M4 12h16" stroke-width="2.5" />`,
  widthThick: svg`<path d="M4 12h16" stroke-width="5" />`,
  caret: svg`<path d="M7 10l5 5 5-5" />`,
  undo: svg`<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />`,
  redo: svg`<path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />`,
} satisfies Record<string, SVGTemplateResult>;

type IconId = keyof typeof ICONS;

/** Ícone decorativo: o nome do botão vem do `aria-label`. */
function icon(id: IconId) {
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

export class CanvasToolbarElement extends LitElement {
  static override properties = {
    orientation: { type: String, reflect: true },
    lastShape: { attribute: false },
    lastDrawTool: { attribute: false },
    propertiesOpen: { type: Boolean, attribute: 'properties-open', reflect: true },
    stickyColor: { attribute: false },
    penSettings: { attribute: false },
    eraserSize: { attribute: false },
    hideHistory: { type: Boolean, attribute: 'hide-history', reflect: true },
    hideZoom: { type: Boolean, attribute: 'hide-zoom', reflect: true },
    compactReadonly: { type: Boolean, attribute: 'compact-readonly', reflect: true },
    _hasEnd: { state: true },
  };

  static override styles = css`
    :host {
      display: inline-flex;
      user-select: none;
      -webkit-user-select: none;
    }

    .toolbar-wrapper {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 4px;
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

    :host([orientation='vertical']) .toolbar-wrapper {
      flex-direction: column;
    }

    .group {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    :host([orientation='vertical']) .group {
      flex-direction: column;
      align-self: stretch;
    }

    .separator {
      width: 1px;
      height: 20px;
      background: var(--canvash-toolbar-separator, rgba(0, 0, 0, 0.12));
      margin: 0 4px;
    }

    :host([orientation='vertical']) .separator {
      width: 20px;
      height: 1px;
      margin: 4px 0;
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

    button[aria-pressed='true'] {
      background: var(--canvash-btn-active-bg, var(--canvash-text-float, #1f1f1f));
      border-color: var(--canvash-btn-active-border, var(--canvash-text-float, #1f1f1f));
      color: var(--canvash-btn-active-color, #ffffff);
      font-weight: 600;
    }

    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .shapes-group,
    .sticky-group,
    .draw-group {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    /* Na vertical o grupo ocupa a largura da toolbar: a ilha abre a 12 px da borda, não do botão. */
    :host([orientation='vertical']) .shapes-group,
    :host([orientation='vertical']) .sticky-group,
    :host([orientation='vertical']) .draw-group {
      align-self: stretch;
      justify-content: center;
    }

    .properties-area {
      position: relative;
    }

    :host([orientation='vertical']) .properties-area {
      justify-content: center;
    }

    /* Ghost island de Propriedades: ao lado da ilha (à esquerda dela, que fica na borda direita da
       tela), alinhada ao topo do botão, com rolagem. */
    .properties-panel {
      position: absolute;
      top: 0;
      right: calc(100% + 12px);
      z-index: 10;
      box-sizing: border-box;
      width: min(280px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      overflow: auto;
      background: var(--canvash-properties-bg, var(--canvash-surface-float-hover, #d9dbe0));
      border: 1px solid
        var(--canvash-toolbar-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: var(--canvash-toolbar-radius, var(--canvash-radius-card, 16px));
      box-shadow: var(
        --canvash-menu-shadow,
        var(--canvash-shadow-float, 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04))
      );
    }

    :host([orientation='vertical']) .properties-panel.flipped {
      right: auto;
      left: calc(100% + 12px);
    }

    :host(:not([orientation='vertical'])) .properties-panel {
      top: calc(100% + 8px);
      right: auto;
      left: 0;
    }

    /* Indicador de grupo: triângulo de 4 px no canto, que avisa das opções e não é alvo de clique. */
    .group-button {
      position: relative;
    }

    .group-button::after {
      content: '';
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 0 0 4px 4px;
      border-color: transparent transparent currentColor transparent;
      opacity: 0.6;
      pointer-events: none;
    }

    .tool-menu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: repeat(var(--tool-menu-columns, 4), 32px);
      gap: 2px;
      padding: 4px;
      background: var(--canvash-menu-bg, var(--canvash-surface-float-hover, #d9dbe0));
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

    :host([orientation='vertical']) .tool-menu {
      top: 0;
      left: auto;
      right: calc(100% + 12px);
    }

    .tool-menu.flipped {
      top: auto;
      bottom: calc(100% + 8px);
    }

    :host([orientation='vertical']) .tool-menu.flipped {
      top: 0;
      bottom: auto;
      left: calc(100% + 12px);
      right: auto;
    }

    .tool-menu button {
      min-width: 32px;
      padding: 0;
    }

    /* Ghost island: o botão que a abriu usa o fundo forte da ilha; o item sob o ponteiro, o mais forte. */
    button[aria-expanded='true']:not([aria-pressed='true']) {
      background: var(--canvash-surface-float-hover, #d9dbe0);
    }

    .tool-menu button:hover:not(:disabled):not([aria-checked='true']) {
      background: var(--canvash-surface-float-item-hover, #ccced3);
    }

    .tool-menu button[aria-checked='true'] {
      background: var(
        --canvash-menu-item-active-bg,
        var(--canvash-btn-active-bg, var(--canvash-text-float, #1f1f1f))
      );
      border-color: var(--canvash-btn-active-border, var(--canvash-text-float, #1f1f1f));
      color: var(--canvash-btn-active-color, #ffffff);
    }

    .tool-menu button[aria-disabled='true'] {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      border: 0;
      opacity: 0;
    }

    .tool-swatch {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.35);
    }

    /* Cada bloco de configurações da ilha de Desenho é uma grade de 3 colunas sob as 4 opções. */
    .menu-group {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: repeat(3, 32px);
      gap: 2px;
    }

    .menu-divider {
      grid-column: 1 / -1;
      height: 1px;
      margin: 2px 4px;
      background: var(--canvash-toolbar-separator, rgba(0, 0, 0, 0.12));
    }

    .eraser-dot {
      display: inline-block;
      border-radius: 50%;
      border: 1.5px solid currentColor;
      box-sizing: border-box;
    }

    .pen-custom-swatch {
      background: conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444);
    }

    .tool-menu .menu-wide {
      grid-column: 1 / -1;
      width: 100%;
      height: 28px;
      padding: 0;
      border: 1px solid
        var(--canvash-toolbar-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
    }

    .zoom-text {
      min-width: 44px;
      text-align: center;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--canvash-toolbar-muted, #4b5563);
    }
  `;

  orientation: 'horizontal' | 'vertical' = 'horizontal';

  /** Esconde desfazer e refazer (por exemplo, quando `<canvas-controls>` já os mostra). */
  hideHistory = false;

  /** Esconde os controles de zoom (idem). */
  hideZoom = false;

  /** Em modo leitura, mostra só as ferramentas Seleção e Mão. Fora dele, não muda nada. */
  compactReadonly = false;

  /** O slot `end` tem conteúdo: só então a toolbar desenha o divisor antes dele. */
  private _hasEnd = false;

  /** Forma mostrada no botão "Formas" e ativada por um clique nele. Não persiste. */
  lastShape: ShapeGroupTool = 'rectangle';

  /** Menu "Formas": estado, teclado, foco e fechamento ficam no controlador. */
  private readonly _shapesMenu = new ToolMenu({
    host: this,
    columns: SHAPES_MENU_COLUMNS,
    count: SHAPE_GROUP_TOOLS.length,
    groupSelector: '.shapes-group',
    menuSelector: '.shapes-menu',
    toggleSelector: '[data-action="open-shapes"]',
    onOpen: () => this._closeOtherMenus(this._shapesMenu),
    entrySelector: (index) =>
      `[role="menuitemradio"][data-tool="${SHAPE_GROUP_TOOLS[index] ?? ''}"]`,
    initialIndex: () => {
      const active = this._section?.getSnapshot().session.activeTool;
      const tool = active !== undefined && isShapeGroupTool(active) ? active : this.lastShape;
      return SHAPE_GROUP_TOOLS.indexOf(tool);
    },
    canHover: () => this._section !== undefined,
  });

  /**
   * Painel de propriedades da seleção aberto. Emite `properties-panel-toggle` a cada mudança. Fecha
   * quando a seleção fica vazia ou o canvas entra em leitura; trocar a seleção o mantém aberto.
   */
  propertiesOpen = false;

  /** Uma ilha por vez: abrir uma fecha as outras, por hover, clique ou teclado. */
  private _closeOtherMenus(except: ToolMenu): void {
    this.propertiesOpen = false;
    for (const menu of [this._shapesMenu, this._stickyMenu, this._drawMenu]) {
      if (menu !== except) menu.close({ restoreFocus: false });
    }
  }

  /** Estado do menu "Formas"; não reflete em atributo. */
  get shapesMenuOpen(): boolean {
    return this._shapesMenu.open;
  }

  set shapesMenuOpen(open: boolean) {
    if (open) this._shapesMenu.openMenu();
    else this._shapesMenu.close({ restoreFocus: false });
  }

  /** Menu de cores da nota: 6 amostras e a entrada que abre o seletor personalizado. */
  private readonly _stickyMenu = new ToolMenu({
    host: this,
    columns: STICKY_MENU_COLUMNS,
    count: STICKY_MENU_ENTRIES,
    groupSelector: '.sticky-group',
    menuSelector: '.sticky-menu',
    toggleSelector: '[data-action="open-sticky-colors"]',
    onOpen: () => this._closeOtherMenus(this._stickyMenu),
    entrySelector: (index) =>
      index < STICKY_PALETTE.length
        ? `[role="menuitemradio"][data-color="${STICKY_PALETTE[index]![0]}"]`
        : '[data-action="custom-sticky-color"]',
    initialIndex: () => {
      const index = STICKY_PALETTE.findIndex(([name]) => STICKY_COLORS[name] === this._stickyColor);
      return index >= 0 ? index : STICKY_PALETTE.length;
    },
    canHover: () => this._section !== undefined,
  });

  private _stickyColor: string = STICKY_COLORS.yellow;

  /**
   * Cor das próximas notas adesivas, em `#rrggbb`. Mudá-la avisa o `<canvas-surface>` do mesmo
   * canvas pelo evento `sticky-color-change`. Não persiste; o host pode atribuí-la.
   */
  get stickyColor(): string {
    return this._stickyColor;
  }

  set stickyColor(color: string) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    const next = color.toLowerCase();
    if (next === this._stickyColor) return;
    this._stickyColor = next;
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent<StickyColorChangeEventDetail>('sticky-color-change', {
        detail: { color: next, section: this._section },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Última opção do grupo Desenho, mostrada no botão e ativada por um clique nele. Não persiste. */
  lastDrawTool: DrawGroupTool = 'bezier';

  /**
   * Ilha de Desenho: as 4 opções e, abaixo de um divisor, as configurações da opção marcada
   * (tipo, espessura e cores da Tinta; tamanhos da borracha; nada para linha e Bézier).
   */
  private readonly _drawMenu = new ToolMenu({
    host: this,
    columns: DRAW_OPTION_COLUMNS,
    count: () => DRAW_SETTINGS_START + this._drawSettingsCount(),
    blocks: () => this._drawBlocks(),
    groupSelector: '.draw-group',
    menuSelector: '.draw-menu',
    toggleSelector: '[data-action="open-draw"]',
    onOpen: () => this._closeOtherMenus(this._drawMenu),
    entrySelector: (index) => {
      if (index < DRAW_SETTINGS_START) {
        return `[role="menuitemradio"][data-tool="${DRAW_GROUP_TOOLS[index] ?? ''}"]`;
      }
      const offset = index - DRAW_SETTINGS_START;
      if (this.lastDrawTool === 'eraser') {
        return `[role="menuitemradio"][data-eraser-size="${ERASER_SIZES[offset]?.[0] ?? ''}"]`;
      }
      if (offset < PEN_WIDTH_START) {
        return `[role="menuitemradio"][data-pen-kind="${PEN_KINDS[offset - PEN_KIND_START]![0]}"]`;
      }
      if (offset < PEN_COLOR_START) {
        return `[role="menuitemradio"][data-pen-width="${PEN_WIDTHS[offset - PEN_WIDTH_START]![0]}"]`;
      }
      if (offset < PEN_CUSTOM_INDEX) {
        return `[role="menuitemradio"][data-pen-color="${PEN_PALETTE[offset - PEN_COLOR_START]}"]`;
      }
      return '[data-action="custom-pen-color"]';
    },
    initialIndex: () => DRAW_GROUP_TOOLS.indexOf(this.lastDrawTool),
    canHover: () => this._section !== undefined,
  });

  /** Estado da ilha de Desenho; não reflete em atributo. */
  get drawMenuOpen(): boolean {
    return this._drawMenu.open;
  }

  set drawMenuOpen(open: boolean) {
    if (open) this._drawMenu.openMenu();
    else this._drawMenu.close({ restoreFocus: false });
  }

  /** Quantas entradas de configuração a opção marcada tem. */
  private _drawSettingsCount(): number {
    if (this.lastDrawTool === 'pen') return PEN_MENU_ENTRIES;
    if (this.lastDrawTool === 'eraser') return ERASER_SIZES.length;
    return 0;
  }

  /** Grades empilhadas da ilha, para a seta para baixo e para cima passarem de uma à outra. */
  private _drawBlocks(): readonly ToolMenuBlock[] {
    const options = { start: 0, count: DRAW_SETTINGS_START, columns: DRAW_OPTION_COLUMNS };
    if (this.lastDrawTool === 'eraser') {
      return [options, { start: DRAW_SETTINGS_START, count: ERASER_SIZES.length, columns: 3 }];
    }
    if (this.lastDrawTool !== 'pen') return [options];
    const at = (offset: number, count: number) => ({
      start: DRAW_SETTINGS_START + offset,
      count,
      columns: PEN_MENU_COLUMNS,
    });
    return [
      options,
      at(PEN_KIND_START, PEN_KINDS.length),
      at(PEN_WIDTH_START, PEN_WIDTHS.length),
      at(PEN_COLOR_START, PEN_PALETTE.length + 1),
    ];
  }

  private _penSettings: PenSettings = { ...DEFAULT_PEN_SETTINGS };

  /**
   * Cor, tipo e espessura dos próximos traços da caneta. Atribuir aceita campos parciais; cada
   * campo inválido é ignorado. Mudá-la avisa o `<canvas-surface>` do mesmo canvas pelo evento
   * `pen-settings-change`. Não persiste; o host pode atribuí-la.
   */
  get penSettings(): PenSettings {
    return this._penSettings;
  }

  set penSettings(patch: Partial<PenSettings>) {
    const color =
      typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)
        ? patch.color.toLowerCase()
        : this._penSettings.color;
    const kind = PEN_KINDS.some(([name]) => name === patch.kind)
      ? (patch.kind as PenKind)
      : this._penSettings.kind;
    const width = PEN_WIDTHS.some(([name]) => name === patch.width)
      ? (patch.width as PenWidth)
      : this._penSettings.width;
    const current = this._penSettings;
    if (color === current.color && kind === current.kind && width === current.width) return;
    this._penSettings = { color, kind, width };
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent<PenSettingsChangeEventDetail>('pen-settings-change', {
        detail: { settings: this._penSettings, section: this._section },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _eraserSize: EraserSize = 'medium';

  /**
   * Tamanho da borracha: `thin`, `medium` (padrão) ou `thick`, raio de 4, 8 ou 16 CSS px. Mudá-lo
   * avisa o `<canvas-surface>` do mesmo canvas pelo evento `eraser-size-change`. Valor inválido é
   * ignorado. Não persiste; o host pode atribuí-lo.
   */
  get eraserSize(): EraserSize {
    return this._eraserSize;
  }

  set eraserSize(size: EraserSize) {
    if (!ERASER_SIZES.some(([name]) => name === size) || size === this._eraserSize) return;
    this._eraserSize = size;
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent<EraserSizeChangeEventDetail>('eraser-size-change', {
        detail: { size, section: this._section },
        bubbles: true,
        composed: true,
      }),
    );
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

  private _messages?: Partial<ToolbarI18nMessages>;

  get messages(): ToolbarI18nMessages {
    return { ...getGlobalI18n().toolbar, ...this._messages };
  }

  set messages(val: Partial<ToolbarI18nMessages> | undefined) {
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
    this._shapesMenu.dispose();
    this._stickyMenu.dispose();
    this._drawMenu.dispose();
  }

  /** Compacta em modo leitura: os menus somem do DOM, então fecham para soltar o clique fora. */
  protected override willUpdate(): void {
    if (this.propertiesOpen && !this._canOpenProperties()) this.propertiesOpen = false;
    if (!this.compactReadonly || !this._section?.getSnapshot().session.readOnly) return;
    this._shapesMenu.close({ restoreFocus: false });
    this._stickyMenu.close({ restoreFocus: false });
    this._drawMenu.close({ restoreFocus: false });
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('propertiesOpen')) {
      const previous = changed.get('propertiesOpen');
      // A primeira atualização só registra o valor inicial: não é uma mudança.
      if (previous !== undefined && previous !== this.propertiesOpen) {
        this.dispatchEvent(
          new CustomEvent<PropertiesPanelToggleEventDetail>('properties-panel-toggle', {
            detail: { open: this.propertiesOpen },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
    if (this.propertiesOpen) this._layoutPropertiesPanel();
  }

  /** Há seleção, o canvas não está em leitura e existe canvas? Só então Propriedades abre. */
  private _canOpenProperties(): boolean {
    const session = this._section?.getSnapshot().session;
    return session !== undefined && !session.readOnly && session.selectedIds.length > 0;
  }

  /** Clique no botão Propriedades: alterna o painel e fecha as ilhas de grupo. */
  private _onPropertiesButton(): void {
    if (!this.propertiesOpen && !this._canOpenProperties()) return;
    const open = !this.propertiesOpen;
    if (open) {
      for (const menu of [this._shapesMenu, this._stickyMenu, this._drawMenu]) {
        menu.close({ restoreFocus: false });
      }
    }
    this.propertiesOpen = open;
  }

  /** Esc no painel fecha e devolve o foco ao botão. */
  private _onPropertiesKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.propertiesOpen = false;
    this.renderRoot?.querySelector<HTMLElement>('[data-action="properties"]')?.focus();
  }

  /**
   * Mantém o painel dentro da tela: abre à esquerda da toolbar vertical e inverte de lado quando
   * falta espaço e o outro lado comporta; sobe o quanto precisar para caber embaixo. Mede depois de cada
   * render, porque o conteúdo muda com a seleção.
   */
  private _layoutPropertiesPanel(): void {
    const panel = this.renderRoot?.querySelector<HTMLElement>('.properties-panel');
    if (!panel || typeof window === 'undefined') return;
    const margin = 16;
    panel.style.translate = '';
    panel.classList.remove('flipped');
    let box = panel.getBoundingClientRect();
    const vertical = this.orientation === 'vertical';
    const barBox = this.getBoundingClientRect();
    if (vertical && box.left < margin && barBox.right + box.width <= window.innerWidth) {
      panel.classList.add('flipped');
      box = panel.getBoundingClientRect();
    }
    const shift = vertical ? Math.max(0, box.bottom - (window.innerHeight - margin)) : 0;
    const top = vertical ? Math.max(margin - (box.top - shift), 0) : 0;
    if (shift > 0 || top > 0) panel.style.translate = `0 ${top - shift}px`;
  }

  protected override performUpdate(): void | Promise<unknown> {
    if (typeof document === 'undefined' || typeof document.createComment !== 'function') {
      return;
    }
    return super.performUpdate();
  }

  private _attach(): void {
    if (this._section && !this._unsubscribeSection) {
      this._rememberActiveShape();
      this._unsubscribeSection = this._section.subscribe((change) => {
        if (change.areas.includes('tool')) this._rememberActiveShape();
        this.requestUpdate();
      });
    }
  }

  private _detach(): void {
    if (this._unsubscribeSection) {
      this._unsubscribeSection();
      this._unsubscribeSection = undefined;
    }
  }

  /** As lembranças dos grupos acompanham a ferramenta ativa sempre que ela pertence a um deles. */
  private _rememberActiveShape(): void {
    const tool = this._section?.getSnapshot().session.activeTool;
    if (tool === undefined) return;
    if (isShapeGroupTool(tool)) this.lastShape = tool;
    if (isDrawGroupTool(tool)) this.lastDrawTool = tool;
  }

  private _selectTool(toolId: string): void {
    if (!this._section) return;
    this._section.setTool(toolId);
  }

  /** Clique no botão do grupo: ativa a última figura e fixa a ilha, ou fecha a que já estava fixada. */
  private _onShapesButton(): void {
    this._selectTool(this.lastShape);
    this._shapesMenu.toggle();
  }

  /** Ativa uma figura do menu, lembra dela no botão e fecha o menu. */
  private _selectShape(tool: ShapeGroupTool): void {
    if (!this._section || this._section.getSnapshot().session.readOnly) return;
    this.lastShape = tool;
    this._section.setTool(tool);
    this._shapesMenu.close({ restoreFocus: true });
  }

  /** Clique no botão da nota: ativa com a cor lembrada e fixa a ilha, ou fecha a que estava fixada. */
  private _onStickyButton(): void {
    this._selectTool('sticky');
    this._stickyMenu.toggle();
  }

  /** Escolhe a cor das próximas notas, ativa a ferramenta e fecha o menu. */
  private _selectStickyColor(color: string): void {
    this.stickyColor = color;
    this._section?.setTool('sticky');
    this._stickyMenu.close({ restoreFocus: true });
  }

  private _onCustomStickyColor(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value;
    if (value !== undefined) this._selectStickyColor(value);
  }

  /** O seletor nativo fica fora do menu (que só aceita itens de menu): este item o abre. */
  private _openStickyColorPicker(): void {
    const input = this.renderRoot?.querySelector<HTMLInputElement>(
      'input[data-field="sticky-color-custom"]',
    );
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  }

  /** Clique no botão de Desenho: ativa a opção lembrada e fixa a ilha, ou fecha a que estava fixada. */
  private _onDrawButton(): void {
    this._selectTool(this.lastDrawTool);
    this._drawMenu.toggle();
  }

  /** Ativa uma opção da ilha, lembra dela no botão e fecha a ilha. */
  private _selectDrawTool(tool: DrawGroupTool): void {
    if (!this._section || this._section.getSnapshot().session.readOnly) return;
    this.lastDrawTool = tool;
    this._section.setTool(tool);
    this._drawMenu.close({ restoreFocus: true });
  }

  /** Tipo e espessura mudam a caneta e a ativam; o menu fica aberto para a próxima escolha. */
  private _selectPenOption(patch: Partial<PenSettings>): void {
    this.penSettings = patch;
    this._section?.setTool('pen');
  }

  /** A cor encerra a escolha: ativa a caneta e fecha o menu. */
  private _selectPenColor(color: string): void {
    this.penSettings = { color };
    this._section?.setTool('pen');
    this._drawMenu.close({ restoreFocus: true });
  }

  private _onCustomPenColor(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value;
    if (value !== undefined) this._selectPenColor(value);
  }

  private _openPenColorPicker(): void {
    const input = this.renderRoot?.querySelector<HTMLInputElement>(
      'input[data-field="pen-color-custom"]',
    );
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  }

  /** Escolhe o tamanho da borracha, ativa a ferramenta e fecha o menu. */
  private _selectEraserSize(size: EraserSize): void {
    this.eraserSize = size;
    this._section?.setTool('eraser');
    this._drawMenu.close({ restoreFocus: true });
  }

  private _undo(): void {
    if (!this._section) return;
    this._section.undo();
  }

  private _redo(): void {
    if (!this._section) return;
    this._section.redo();
  }

  private _zoom(factor: number): void {
    if (!this._section) return;
    const snap = this._section.getSnapshot();
    const current = snap.session.viewport;
    const targetZoom = clampZoom(current.zoom * factor, DEFAULT_ZOOM_LIMITS);
    this._section.setViewport({ ...current, zoom: targetZoom });
  }

  private _resetZoom(): void {
    if (!this._section) return;
    const current = this._section.getSnapshot().session.viewport;
    this._section.setViewport({ ...current, zoom: 1 });
  }

  private _renderToolButton(
    tool: { readonly id: IconId; readonly label: string },
    activeTool: string,
  ) {
    return html`
      <button
        type="button"
        part="tool-button tool-${tool.id}"
        data-tool=${tool.id}
        aria-label=${tool.label}
        aria-pressed=${activeTool === tool.id ? 'true' : 'false'}
        ?disabled=${!this._section}
        @click=${() => this._selectTool(tool.id)}
      >
        ${icon(tool.id)}
      </button>
    `;
  }

  /** Botão de grupo: o clique ativa a última figura e fixa a ilha; o hover só abre a ilha. */
  private _renderShapesGroup(msg: ToolbarI18nMessages, activeTool: string, readOnly: boolean) {
    const current = this.lastShape;
    const currentLabel = msg[SHAPE_LABEL_KEYS[current]];
    return html`
      <div
        class="shapes-group"
        part="shapes-group"
        @pointerdown=${() => this._shapesMenu.onGroupPointerDown()}
      >
        <button
          type="button"
          class="group-button"
          part="shapes-button tool-button tool-${current}"
          data-tool=${current}
          data-action="open-shapes"
          aria-label=${msg.figuresCurrent(plainName(currentLabel))}
          title=${msg.figures}
          aria-haspopup="menu"
          aria-expanded=${this.shapesMenuOpen ? 'true' : 'false'}
          aria-controls="shapes-menu"
          aria-pressed=${activeTool === current ? 'true' : 'false'}
          ?disabled=${!this._section}
          @click=${this._onShapesButton}
          @keydown=${(event: KeyboardEvent) => this._shapesMenu.onToggleKeydown(event)}
          @pointerenter=${(event: PointerEvent) => this._shapesMenu.onPointerEnter(event)}
          @pointerleave=${(event: PointerEvent) => this._shapesMenu.onPointerLeave(event)}
        >
          ${icon('figures')}
        </button>
        ${this.shapesMenuOpen ? this._renderShapesMenu(msg, readOnly) : ''}
      </div>
    `;
  }

  private _renderShapesMenu(msg: ToolbarI18nMessages, readOnly: boolean) {
    return html`
      <div
        id="shapes-menu"
        class="tool-menu shapes-menu ${this._shapesMenu.flipped ? 'flipped' : ''}"
        style="--tool-menu-columns: ${SHAPES_MENU_COLUMNS}"
        part="shapes-menu"
        role="menu"
        aria-label=${msg.figures}
        @keydown=${(event: KeyboardEvent) => this._shapesMenu.onMenuKeydown(event)}
        @focusout=${(event: FocusEvent) => this._shapesMenu.onFocusOut(event)}
        @pointerenter=${(event: PointerEvent) => this._shapesMenu.onPointerEnter(event)}
        @pointerleave=${(event: PointerEvent) => this._shapesMenu.onPointerLeave(event)}
      >
        ${SHAPE_GROUP_TOOLS.map((tool, index) => {
          const label = msg[SHAPE_LABEL_KEYS[tool]];
          return html`
            <button
              type="button"
              role="menuitemradio"
              part="shapes-item shapes-item-${tool}"
              data-tool=${tool}
              aria-label=${plainName(label)}
              title=${label}
              aria-checked=${this.lastShape === tool ? 'true' : 'false'}
              aria-disabled=${readOnly ? 'true' : 'false'}
              tabindex=${index === this._shapesMenu.focusedIndex ? '0' : '-1'}
              @focus=${() => this._shapesMenu.noteFocus(index)}
              @click=${() => this._selectShape(tool)}
            >
              ${icon(tool)}
            </button>
          `;
        })}
      </div>
    `;
  }

  /** Botão de grupo: o clique ativa a nota com a cor lembrada e fixa a ilha; o hover só abre. */
  private _renderStickyGroup(msg: ToolbarI18nMessages, activeTool: string) {
    return html`
      <div
        class="sticky-group"
        part="sticky-group"
        @pointerdown=${() => this._stickyMenu.onGroupPointerDown()}
      >
        <button
          type="button"
          class="group-button"
          part="sticky-button tool-button tool-sticky"
          data-tool="sticky"
          data-action="open-sticky-colors"
          aria-label=${msg.sticky}
          title=${msg.sticky}
          aria-haspopup="menu"
          aria-expanded=${this._stickyMenu.open ? 'true' : 'false'}
          aria-controls="sticky-menu"
          aria-pressed=${activeTool === 'sticky' ? 'true' : 'false'}
          ?disabled=${!this._section}
          @click=${this._onStickyButton}
          @keydown=${(event: KeyboardEvent) => this._stickyMenu.onToggleKeydown(event)}
          @pointerenter=${(event: PointerEvent) => this._stickyMenu.onPointerEnter(event)}
          @pointerleave=${(event: PointerEvent) => this._stickyMenu.onPointerLeave(event)}
        >
          ${icon('sticky')}
        </button>
        <input
          type="color"
          class="visually-hidden"
          data-field="sticky-color-custom"
          aria-hidden="true"
          tabindex="-1"
          .value=${this._stickyColor}
          @change=${(event: Event) => this._onCustomStickyColor(event)}
        />
        ${this._stickyMenu.open ? this._renderStickyMenu(msg) : ''}
      </div>
    `;
  }

  private _renderStickyMenu(msg: ToolbarI18nMessages) {
    return html`
      <div
        id="sticky-menu"
        class="tool-menu sticky-menu ${this._stickyMenu.flipped ? 'flipped' : ''}"
        style="--tool-menu-columns: ${STICKY_MENU_COLUMNS}"
        part="sticky-menu"
        role="menu"
        aria-label=${msg.stickyColor}
        @keydown=${(event: KeyboardEvent) => this._stickyMenu.onMenuKeydown(event)}
        @focusout=${(event: FocusEvent) => this._stickyMenu.onFocusOut(event)}
        @pointerenter=${(event: PointerEvent) => this._stickyMenu.onPointerEnter(event)}
        @pointerleave=${(event: PointerEvent) => this._stickyMenu.onPointerLeave(event)}
      >
        ${STICKY_PALETTE.map(([name, key], index) => {
          const hex = STICKY_COLORS[name];
          return html`
            <button
              type="button"
              role="menuitemradio"
              part="sticky-swatch sticky-swatch-${name}"
              data-color=${name}
              aria-label=${msg[key] as string}
              title=${msg[key] as string}
              aria-checked=${this._stickyColor === hex ? 'true' : 'false'}
              tabindex=${index === this._stickyMenu.focusedIndex ? '0' : '-1'}
              @focus=${() => this._stickyMenu.noteFocus(index)}
              @click=${() => this._selectStickyColor(hex)}
            >
              <span class="tool-swatch" style="background: ${hex}"></span>
            </button>
          `;
        })}
        <button
          type="button"
          role="menuitem"
          class="menu-wide"
          part="sticky-custom"
          data-action="custom-sticky-color"
          tabindex=${STICKY_PALETTE.length === this._stickyMenu.focusedIndex ? '0' : '-1'}
          @focus=${() => this._stickyMenu.noteFocus(STICKY_PALETTE.length)}
          @click=${() => this._openStickyColorPicker()}
        >
          ${msg.stickyColorCustom}
        </button>
      </div>
    `;
  }

  /** Botão Propriedades e a ilha (role dialog) com o slot onde o host põe o `<canvas-properties>`. */
  private _renderPropertiesButton(msg: ToolbarI18nMessages) {
    const enabled = this._canOpenProperties();
    return html`
      <button
        type="button"
        part="properties-button tool-button"
        data-action="properties"
        aria-label=${msg.properties}
        title=${enabled ? msg.properties : msg.propertiesUnavailable}
        aria-haspopup="dialog"
        aria-expanded=${this.propertiesOpen ? 'true' : 'false'}
        aria-controls="properties-panel"
        ?disabled=${!enabled}
        @click=${this._onPropertiesButton}
      >
        ${icon('properties')}
      </button>
      ${
        this.propertiesOpen
          ? html`
              <div
                id="properties-panel"
                class="properties-panel"
                part="properties-panel"
                role="dialog"
                aria-label=${msg.properties}
                @keydown=${this._onPropertiesKeydown}
              >
                <slot name="properties"></slot>
              </div>
            `
          : ''
      }
    `;
  }

  /** Botão de grupo: o clique ativa a opção lembrada e fixa a ilha; o hover só abre. */
  private _renderDrawGroup(msg: ToolbarI18nMessages, activeTool: string, readOnly: boolean) {
    const current = this.lastDrawTool;
    const currentLabel = msg[DRAW_LABEL_KEYS[current]];
    return html`
      <div
        class="draw-group"
        part="draw-group"
        @pointerdown=${() => this._drawMenu.onGroupPointerDown()}
      >
        <button
          type="button"
          class="group-button"
          part="draw-button tool-button tool-${current}"
          data-tool=${current}
          data-action="open-draw"
          aria-label=${msg.drawCurrent(plainName(currentLabel))}
          title=${msg.draw}
          aria-haspopup="menu"
          aria-expanded=${this.drawMenuOpen ? 'true' : 'false'}
          aria-controls="draw-menu"
          aria-pressed=${activeTool === current ? 'true' : 'false'}
          ?disabled=${!this._section}
          @click=${this._onDrawButton}
          @keydown=${(event: KeyboardEvent) => this._drawMenu.onToggleKeydown(event)}
          @pointerenter=${(event: PointerEvent) => this._drawMenu.onPointerEnter(event)}
          @pointerleave=${(event: PointerEvent) => this._drawMenu.onPointerLeave(event)}
        >
          ${icon('pen')}
        </button>
        <input
          type="color"
          class="visually-hidden"
          data-field="pen-color-custom"
          aria-hidden="true"
          tabindex="-1"
          .value=${this._penSettings.color}
          @change=${(event: Event) => this._onCustomPenColor(event)}
        />
        ${this.drawMenuOpen ? this._renderDrawMenu(msg, readOnly) : ''}
      </div>
    `;
  }

  private _renderDrawMenu(msg: ToolbarI18nMessages, readOnly: boolean) {
    const menu = this._drawMenu;
    const current = this.lastDrawTool;
    return html`
      <div
        id="draw-menu"
        class="tool-menu draw-menu ${menu.flipped ? 'flipped' : ''}"
        style="--tool-menu-columns: ${DRAW_OPTION_COLUMNS}"
        part="draw-menu"
        role="menu"
        aria-label=${msg.draw}
        @keydown=${(event: KeyboardEvent) => menu.onMenuKeydown(event)}
        @focusout=${(event: FocusEvent) => menu.onFocusOut(event)}
        @pointerenter=${(event: PointerEvent) => menu.onPointerEnter(event)}
        @pointerleave=${(event: PointerEvent) => menu.onPointerLeave(event)}
      >
        ${DRAW_GROUP_TOOLS.map((tool, index) => {
          const label = msg[DRAW_LABEL_KEYS[tool]];
          return html`
            <button
              type="button"
              role="menuitemradio"
              part="draw-item draw-item-${tool}"
              data-tool=${tool}
              aria-label=${plainName(label)}
              title=${label}
              aria-checked=${current === tool ? 'true' : 'false'}
              aria-disabled=${readOnly ? 'true' : 'false'}
              tabindex=${index === menu.focusedIndex ? '0' : '-1'}
              @focus=${() => menu.noteFocus(index)}
              @click=${() => this._selectDrawTool(tool)}
            >
              ${icon(tool)}
            </button>
          `;
        })}
        ${current === 'pen' ? this._renderPenSettings(msg) : ''}
        ${current === 'eraser' ? this._renderEraserSettings(msg) : ''}
      </div>
    `;
  }

  /** Tipo, espessura e cores da Tinta, abaixo do divisor da ilha de Desenho. */
  private _renderPenSettings(msg: ToolbarI18nMessages) {
    const menu = this._drawMenu;
    const item = (index: number) => ({
      tabindex: DRAW_SETTINGS_START + index === menu.focusedIndex ? '0' : '-1',
      focus: () => menu.noteFocus(DRAW_SETTINGS_START + index),
    });
    return html`
      <div role="separator" class="menu-divider"></div>
      <div role="group" aria-label=${msg.penKind} class="menu-group">
        ${PEN_KINDS.map(([kind, key], offset) => {
          const entry = item(PEN_KIND_START + offset);
          return html`
            <button
              type="button"
              role="menuitemradio"
              part="pen-item pen-kind pen-kind-${kind}"
              data-pen-kind=${kind}
              aria-label=${msg[key] as string}
              title=${msg[key] as string}
              aria-checked=${this._penSettings.kind === kind ? 'true' : 'false'}
              tabindex=${entry.tabindex}
              @focus=${entry.focus}
              @click=${() => this._selectPenOption({ kind })}
            >
              ${icon(kind)}
            </button>
          `;
        })}
      </div>
      <div role="group" aria-label=${msg.penWidth} class="menu-group">
        ${PEN_WIDTHS.map(([width, key], offset) => {
          const entry = item(PEN_WIDTH_START + offset);
          const widthIcon =
            width === 'thin' ? 'widthThin' : width === 'medium' ? 'widthMedium' : 'widthThick';
          return html`
            <button
              type="button"
              role="menuitemradio"
              part="pen-item pen-width pen-width-${width}"
              data-pen-width=${width}
              aria-label=${msg[key] as string}
              title=${msg[key] as string}
              aria-checked=${this._penSettings.width === width ? 'true' : 'false'}
              tabindex=${entry.tabindex}
              @focus=${entry.focus}
              @click=${() => this._selectPenOption({ width })}
            >
              ${icon(widthIcon)}
            </button>
          `;
        })}
      </div>
      <div role="group" aria-label=${msg.penColor} class="menu-group">
        ${PEN_PALETTE.map((hex, offset) => {
          const entry = item(PEN_COLOR_START + offset);
          const label = msg[PEN_COLOR_LABELS[offset]!] as string;
          return html`
            <button
              type="button"
              role="menuitemradio"
              part="pen-item pen-swatch"
              data-pen-color=${hex}
              aria-label=${label}
              title=${label}
              aria-checked=${this._penSettings.color === hex ? 'true' : 'false'}
              tabindex=${entry.tabindex}
              @focus=${entry.focus}
              @click=${() => this._selectPenColor(hex)}
            >
              <span class="tool-swatch" style="background: ${hex}"></span>
            </button>
          `;
        })}
        <button
          type="button"
          role="menuitem"
          part="pen-item pen-custom"
          data-action="custom-pen-color"
          aria-label=${msg.penColorCustom}
          title=${msg.penColorCustom}
          tabindex=${item(PEN_CUSTOM_INDEX).tabindex}
          @focus=${item(PEN_CUSTOM_INDEX).focus}
          @click=${() => this._openPenColorPicker()}
        >
          <span class="tool-swatch pen-custom-swatch"></span>
        </button>
      </div>
    `;
  }

  /** Os três tamanhos da borracha, abaixo do divisor da ilha de Desenho. */
  private _renderEraserSettings(msg: ToolbarI18nMessages) {
    const menu = this._drawMenu;
    return html`
      <div role="separator" class="menu-divider"></div>
      <div role="group" aria-label=${msg.eraserSize} class="menu-group">
        ${ERASER_SIZES.map(([size, key], index) => {
          const label = msg[key] as string;
          return html`
            <button
              type="button"
              role="menuitemradio"
              part="eraser-item eraser-item-${size}"
              data-eraser-size=${size}
              aria-label=${label}
              title=${label}
              aria-checked=${this._eraserSize === size ? 'true' : 'false'}
              tabindex=${DRAW_SETTINGS_START + index === menu.focusedIndex ? '0' : '-1'}
              @focus=${() => menu.noteFocus(DRAW_SETTINGS_START + index)}
              @click=${() => this._selectEraserSize(size)}
            >
              <span
                class="eraser-dot"
                style="width: ${ERASER_DOT_PX[size]}px; height: ${ERASER_DOT_PX[size]}px"
              ></span>
            </button>
          `;
        })}
      </div>
    `;
  }

  /**
   * Ligado uma vez em `firstUpdated`, e não no template: o `<slot name="end">` nunca sai do DOM e
   * o listener morre com o elemento.
   */
  private readonly _onEndSlotChange = (event: Event): void => {
    this._hasEnd = (event.target as HTMLSlotElement).assignedElements().length > 0;
  };

  protected override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this.renderRoot
      ?.querySelector('slot[name="end"]')
      ?.addEventListener('slotchange', this._onEndSlotChange);
  }

  override render() {
    const snap = this._section?.getSnapshot();
    const activeTool = snap?.session.activeTool ?? 'select';
    const canUndo = (snap?.history.canUndo ?? false) && !(snap?.session.readOnly ?? false);
    const canRedo = (snap?.history.canRedo ?? false) && !(snap?.session.readOnly ?? false);
    const zoom = snap?.session.viewport.zoom ?? 1;
    const zoomPercent = `${Math.round(zoom * 100)}%`;
    const msg = this.messages;
    const compact = this.compactReadonly && (snap?.session.readOnly ?? false);

    const controlTools: readonly { readonly id: IconId; readonly label: string }[] = [
      { id: 'select', label: msg.select },
      { id: 'hand', label: msg.hand },
    ];
    const readOnly = snap?.session.readOnly ?? false;

    return html`
      <div
        class="toolbar-wrapper"
        part="toolbar"
        role="toolbar"
        aria-label=${msg.toolbarLabel}
        tabindex="0"
      >
        <slot name="start"></slot>

        <div
          class="group"
          part="tools-group control-area"
          role="group"
          aria-label=${msg.islandAreas.control}
        >
          ${controlTools.map((tool) => this._renderToolButton(tool, activeTool))}
        </div>
        ${
          compact
            ? ''
            : html`
                <div class="separator" role="separator" aria-orientation=${this.orientation}></div>

                <div
                  class="group"
                  part="tools-group shapes-area"
                  role="group"
                  aria-label=${msg.islandAreas.shapes}
                >
                  ${this._renderShapesGroup(msg, activeTool, readOnly)}
                  ${this._renderToolButton({ id: 'text', label: msg.text }, activeTool)}
                  ${this._renderStickyGroup(msg, activeTool)}
                  ${this._renderDrawGroup(msg, activeTool, readOnly)}
                  ${this._renderToolButton({ id: 'board', label: msg.board }, activeTool)}
                </div>

                <div class="separator" role="separator" aria-orientation=${this.orientation}></div>

                <div
                  class="group properties-area"
                  part="tools-group properties-area"
                  role="group"
                  aria-label=${msg.islandAreas.properties}
                >
                  ${this._renderPropertiesButton(msg)}
                </div>
              `
        }
        ${
          this.hideHistory
            ? ''
            : html`
                <div class="separator" role="separator" aria-orientation=${this.orientation}></div>

                <div class="group" part="history-group">
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
              `
        }
        ${
          this.hideZoom
            ? ''
            : html`
                <div class="separator" role="separator" aria-orientation=${this.orientation}></div>

                <div class="group" part="zoom-controls">
                  <button
                    type="button"
                    part="action-button zoom-out"
                    data-action="zoom-out"
                    aria-label=${msg.zoomOut}
                    ?disabled=${!this._section}
                    @click=${() => this._zoom(1 / 1.2)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    class="zoom-text"
                    part="zoom-indicator"
                    data-action="zoom-reset"
                    aria-label=${msg.zoomReset}
                    title="${msg.zoomLabel}: ${zoomPercent}"
                    ?disabled=${!this._section}
                    @click=${this._resetZoom}
                  >
                    ${zoomPercent}
                  </button>
                  <button
                    type="button"
                    part="action-button zoom-in"
                    data-action="zoom-in"
                    aria-label=${msg.zoomIn}
                    ?disabled=${!this._section}
                    @click=${() => this._zoom(1.2)}
                  >
                    +
                  </button>
                </div>
              `
        }

        <slot></slot>
        ${
          this._hasEnd
            ? html`<div
                class="separator"
                part="end-separator"
                role="separator"
                aria-orientation=${this.orientation}
              ></div>`
            : ''
        }
        <slot name="end"></slot>
      </div>
    `;
  }
}
