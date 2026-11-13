import { LitElement, html, css } from 'lit';
import {
  FONT_SIZE_PRESETS,
  STICKY_COLORS,
  isBoardNode,
  isBoxShape,
  isLabelable,
  shapeLabelColor,
} from '@canvash/core';
import { buildMoveCommands, getMovableNodes } from '@canvash/interaction';
import type {
  BoardNode,
  CanvasCommand,
  CanvasSectionApi,
  BoxShapeNode,
  InkNode,
  LabelableNode,
  ShapeLabel,
  ShapeNode,
  StickyNode,
  TextNode,
  TriangleVariant,
} from '@canvash/core';
import { getGlobalI18n, type PropertiesI18nMessages } from './i18n.js';

/** Nós com texto próprio e tamanho de fonte: o texto livre e a nota adesiva. */
type TextualNode = TextNode | StickyNode;

const STICKY_PALETTE = [
  ['yellow', 'stickyColorYellow'],
  ['pink', 'stickyColorPink'],
  ['green', 'stickyColorGreen'],
  ['blue', 'stickyColorBlue'],
  ['orange', 'stickyColorOrange'],
  ['purple', 'stickyColorPurple'],
] as const satisfies ReadonlyArray<
  readonly [keyof typeof STICKY_COLORS, keyof PropertiesI18nMessages]
>;

/** Os valores de cada radiogroup do texto da forma, na ordem em que aparecem. */
const LABEL_VERTICAL_ALIGNS = [
  ['top', 'labelTop'],
  ['middle', 'labelMiddle'],
  ['bottom', 'labelBottom'],
] as const satisfies ReadonlyArray<readonly [string, keyof PropertiesI18nMessages]>;
const LABEL_ALIGNS = [
  ['left', 'labelAlignLeft'],
  ['center', 'labelAlignCenter'],
  ['right', 'labelAlignRight'],
] as const satisfies ReadonlyArray<readonly [string, keyof PropertiesI18nMessages]>;

/** O campo do `label` que cada radiogroup muda. */
type LabelRadioField = 'verticalAlign' | 'textAlign';
const LABEL_RADIO_VALUES: Record<LabelRadioField, readonly string[]> = {
  verticalAlign: LABEL_VERTICAL_ALIGNS.map(([value]) => value),
  textAlign: LABEL_ALIGNS.map(([value]) => value),
};

/** `bold` ou um peso numérico a partir de 600 conta como negrito. */
function isBoldWeight(weight: ShapeLabel['fontWeight'] | undefined): boolean {
  return weight === 'bold' || (typeof weight === 'number' && weight >= 600);
}

function isTextual(shape: ShapeNode): shape is TextualNode {
  return shape.type === 'text' || shape.type === 'sticky';
}

interface MixedValue<T> {
  mixed: boolean;
  value?: T;
}

export class CanvasPropertiesElement extends LitElement {
  static override properties = {
    section: { attribute: false },
  };

  static override styles = css`
    .sticky-swatches {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .sticky-swatch {
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid
        var(--canvash-properties-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: 6px;
      cursor: pointer;
    }

    .sticky-swatch[aria-checked='true'] {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 1px;
    }

    .sticky-swatch:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 2px;
    }

    .sticky-swatch:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .label-radios {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }

    .label-radio,
    .label-toggle {
      flex: 1;
      padding: 4px 6px;
      font: inherit;
      font-size: 12px;
      color: inherit;
      background: transparent;
      border: 1px solid
        var(--canvash-properties-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      border-radius: 6px;
      cursor: pointer;
    }

    .label-toggle[aria-pressed='true'],
    .label-toggle[aria-pressed='mixed'] {
      background: var(--canvash-btn-hover-bg, rgba(0, 0, 0, 0.1));
    }

    .label-radio[aria-checked='true'] {
      background: var(--canvash-btn-hover-bg, rgba(0, 0, 0, 0.1));
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: -1px;
    }

    .label-radio:focus-visible,
    .label-toggle:focus-visible {
      outline: 2px solid var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
      outline-offset: 1px;
    }

    .label-radio:disabled,
    .label-toggle:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--canvash-properties-bg, var(--canvash-surface-float, #ebecef));
      color: var(--canvash-properties-color, var(--canvash-text-float, #1f1f1f));
      border-left: 1px solid
        var(--canvash-properties-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      font-family: var(
        --canvash-font-family,
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        Roboto,
        sans-serif
      );
      font-size: 13px;
      box-sizing: border-box;
      user-select: none;
      overflow-y: auto;
    }

    *,
    *::before,
    *::after {
      box-sizing: inherit;
    }

    .properties-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      font-weight: 600;
      font-size: 13px;
      border-bottom: 1px solid
        var(--canvash-properties-border, var(--canvash-surface-float-border, rgba(0, 0, 0, 0.06)));
      background: var(--canvash-properties-header-bg, rgba(0, 0, 0, 0.04));
      color: var(--canvash-properties-header-color, var(--canvash-text-float, #1f1f1f));
    }

    .properties-body {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--canvash-properties-section-title, #4b5563);
      margin-bottom: 8px;
    }

    .property-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .property-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .property-field {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--canvash-input-bg, #ffffff);
      border: 1px solid var(--canvash-input-border, rgba(0, 0, 0, 0.25));
      border-radius: 4px;
      padding: 3px 6px;
      transition: border-color 0.15s ease;
    }

    .property-field:focus-within {
      border-color: var(--canvash-focus-ring, var(--canvash-text-float, #1f1f1f));
    }

    .property-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--canvash-properties-label-color, #3f434a);
      min-width: 14px;
    }

    .property-input {
      width: 100%;
      border: none;
      background: transparent;
      color: inherit;
      font-size: 12px;
      font-family: inherit;
      outline: none;
      padding: 2px 0;
    }

    .property-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .color-field {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .color-preview-btn {
      width: 26px;
      height: 26px;
      border-radius: 4px;
      border: 1px solid var(--canvash-input-border, rgba(0, 0, 0, 0.25));
      padding: 0;
      cursor: pointer;
      outline: none;
      overflow: hidden;
      flex-shrink: 0;
    }

    .color-preview-btn input[type='color'] {
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }

    .convert-btn {
      margin-top: 8px;
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--canvash-input-border, rgba(0, 0, 0, 0.25));
      border-radius: 6px;
      background: var(--canvash-btn-hover-bg, rgba(0, 0, 0, 0.06));
      color: var(--canvash-properties-color, var(--canvash-text-float, #1f1f1f));
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .convert-btn:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.1);
    }

    .convert-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .peer-lock-notice {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--canvash-properties-label-color, #1f2937);
      background: var(--canvash-properties-header-bg, #f1f5f9);
    }

    .empty-message {
      padding: 32px 16px;
      text-align: center;
      color: var(--canvash-properties-empty-color, #4b5563);
      font-size: 12px;
      line-height: 1.5;
    }
  `;

  private _section: CanvasSectionApi | undefined;
  private _unsubscribeSection: (() => void) | undefined;

  get section(): CanvasSectionApi | undefined {
    return this._section;
  }

  set section(value: CanvasSectionApi | undefined) {
    if (this._section === value) return;
    this._detach();
    this._section = value;
    this._attach();
    this.requestUpdate();
  }

  private _messages?: Partial<PropertiesI18nMessages>;

  get messages(): PropertiesI18nMessages {
    return { ...getGlobalI18n().properties, ...this._messages };
  }

  set messages(val: Partial<PropertiesI18nMessages> | undefined) {
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
  }

  protected override performUpdate(): void | Promise<unknown> {
    if (typeof document === 'undefined' || typeof document.createComment !== 'function') {
      return;
    }
    return super.performUpdate();
  }

  private _attach(): void {
    if (this._section && !this._unsubscribeSection) {
      this._unsubscribeSection = this._section.subscribe(() => {
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

  private _getSelectedShapes(): ShapeNode[] {
    if (!this._section) return [];
    const snap = this._section.getSnapshot();
    const selectedIds = snap.session.selectedIds;
    const result: ShapeNode[] = [];

    for (const id of selectedIds) {
      const node = snap.document.nodes[id];
      if (node && node.type !== 'group' && node.type !== 'board') {
        result.push(node as ShapeNode);
      }
    }
    return result;
  }

  /** Os boards da seleção: têm a seção própria e ficam fora dos patches genéricos. */
  private _getSelectedBoards(): BoardNode[] {
    if (!this._section) return [];
    const snap = this._section.getSnapshot();
    return snap.session.selectedIds
      .map((id) => snap.document.nodes[id])
      .filter((node): node is BoardNode => node !== undefined && isBoardNode(node));
  }

  private _getCommonValue<S, T>(shapes: S[], getter: (s: S) => T | undefined): MixedValue<T> {
    if (shapes.length === 0) return { mixed: false, value: undefined };
    const first = getter(shapes[0]!);
    if (first === undefined) return { mixed: false, value: undefined };

    for (let i = 1; i < shapes.length; i++) {
      const current = getter(shapes[i]!);
      if (current !== first) {
        return { mixed: true, value: undefined };
      }
    }
    return { mixed: false, value: first };
  }

  private _applyPatch(patch: Record<string, unknown>): void {
    if (!this._section) return;
    const shapes = this._getSelectedShapes();
    if (shapes.length === 0) return;

    if (shapes.length === 1) {
      this._section.dispatch({
        type: 'shape.update',
        id: shapes[0]!.id,
        patch,
      });
    } else {
      const commands = shapes.map((shape) => ({
        type: 'shape.update' as const,
        id: shape.id,
        patch,
      }));
      this._section.transact(commands);
    }
  }

  /**
   * Aplica campos de estilo às figuras selecionadas. Cada figura recebe só os campos que o estilo
   * dela tem (a chave e o traço à mão livre não têm preenchimento, o traço à mão livre não tem
   * contorno), e uma seleção múltipla vira uma transação.
   */
  private _applyStylePatch(stylePatch: Record<string, unknown>): void {
    if (!this._section) return;
    const commands = this._getSelectedShapes().flatMap((shape) => {
      const own = Object.fromEntries(
        Object.entries(stylePatch).filter(([key]) => key in shape.style),
      );
      return Object.keys(own).length === 0
        ? []
        : [{ type: 'shape.update' as const, id: shape.id, patch: { style: own } }];
    });
    if (commands.length === 0) return;
    if (commands.length === 1) this._section.dispatch(commands[0]!);
    else this._section.transact(commands);
  }

  private _onNumberChange(prop: 'x' | 'y' | 'width' | 'height' | 'rotation', e: Event): void {
    const input = e.target as HTMLInputElement;
    const rawVal = parseFloat(input.value);
    if (Number.isNaN(rawVal)) return;

    // Só boards selecionados: X, Y, largura e altura, sem rotação.
    if (this._getSelectedShapes().length === 0) {
      this._onBoardNumberChange(prop, rawVal);
      return;
    }

    if (prop === 'rotation') {
      // Graus para radianos normalizados [-PI, PI)
      let rad = (rawVal * Math.PI) / 180;
      rad = Math.atan2(Math.sin(rad), Math.cos(rad));
      this._applyPatch({ rotation: rad });
    } else if (prop === 'width' || prop === 'height') {
      if (rawVal <= 0) return;
      const shapes = this._getSelectedShapes();
      if (shapes.some((s) => s.type === 'square' || s.type === 'circle' || s.type === 'polygon')) {
        this._applyPatch({ width: rawVal, height: rawVal });
      } else if (shapes.some((s) => s.type === 'triangle' && s.variant === 'equilateral')) {
        if (prop === 'width') {
          this._applyPatch({ width: rawVal, height: (rawVal * Math.sqrt(3)) / 2 });
        } else {
          this._applyPatch({ width: (rawVal * 2) / Math.sqrt(3), height: rawVal });
        }
      } else {
        this._applyPatch({ [prop]: rawVal });
      }
    } else {
      this._applyPatch({ [prop]: rawVal });
    }
  }

  private _onConvertShapeType(targetType: 'rectangle' | 'square' | 'ellipse' | 'circle'): void {
    this._applyPatch({ type: targetType });
  }

  private _onTriangleVariantChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    const val = select.value as TriangleVariant;
    if (val === 'isosceles' || val === 'equilateral' || val === 'right' || val === 'scalene') {
      this._applyPatch({ variant: val });
    }
  }

  private _onTriangleApexChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const rawVal = parseFloat(input.value);
    if (Number.isNaN(rawVal)) return;
    const clamped = Math.max(0, Math.min(1, rawVal));
    this._applyPatch({ apex: clamped });
  }

  private _onPolygonSidesChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const rawVal = Math.round(parseFloat(input.value));
    if (Number.isNaN(rawVal)) return;
    this._applyPatch({ sides: Math.max(3, Math.min(12, rawVal)) });
  }

  private _onBraceOrientationChange(e: Event): void {
    const value = (e.target as HTMLSelectElement).value;
    if (value === 'right' || value === 'left' || value === 'up' || value === 'down') {
      this._applyPatch({ orientation: value });
    }
  }

  private _onBraceFractionChange(field: 'tipPosition' | 'curvature', e: Event): void {
    const rawVal = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(rawVal)) return;
    this._applyPatch({ [field]: Math.max(0, Math.min(1, rawVal)) });
  }

  private _onChevronDirectionChange(e: Event): void {
    const value = (e.target as HTMLSelectElement).value;
    if (value === 'right' || value === 'left' || value === 'up' || value === 'down') {
      this._applyPatch({ direction: value });
    }
  }

  private _onChevronNotchDepthChange(e: Event): void {
    const rawVal = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(rawVal)) return;
    this._applyPatch({ notchDepth: Math.max(0, Math.min(0.5, rawVal)) });
  }

  private _onCrossArmRatioChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const rawVal = parseFloat(input.value);
    if (Number.isNaN(rawVal)) return;
    this._applyPatch({ armRatio: Math.max(0.05, Math.min(1, rawVal)) });
  }

  /** Ligar a simetria faz o core re-espelhar control2 a partir de control1 (US-06.4). */
  private _onBezierSymmetricChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._applyPatch({ symmetric: input.checked });
  }

  /**
   * X, Y, largura e altura dos boards selecionados. X e Y levam os descendentes pelo mesmo vetor
   * (o board sozinho deixaria os filhos para trás); um board com descendente bloqueado não anda.
   * Largura e altura mudam só o board. Tudo vira uma transação.
   */
  private _onBoardNumberChange(prop: string, value: number): void {
    const section = this._section;
    if (!section || prop === 'rotation') return;
    const commands = this._getSelectedBoards().flatMap((board) => {
      if (prop === 'width' || prop === 'height') {
        return value > 0 && value !== board[prop]
          ? [{ type: 'shape.update' as const, id: board.id, patch: { [prop]: value } }]
          : [];
      }
      const delta = { x: 0, y: 0, [prop]: value - (prop === 'x' ? board.x : board.y) };
      return delta.x === 0 && delta.y === 0
        ? []
        : buildMoveCommands(getMovableNodes(section, [board.id]), delta);
    });
    this._sendCommands(commands);
  }

  private _sendCommands(commands: ReadonlyArray<CanvasCommand>): void {
    if (!this._section || commands.length === 0) return;
    if (commands.length === 1) this._section.dispatch(commands[0]!);
    else this._section.transact([...commands]);
  }

  /** Aplica o patch a todos os boards selecionados: uma transação, uma entrada de histórico. */
  private _patchBoards(patch: Record<string, unknown>): void {
    this._sendCommands(
      this._getSelectedBoards().map((board) => ({
        type: 'shape.update' as const,
        id: board.id,
        patch,
      })),
    );
  }

  private _onBoardTitle(e: Event): void {
    const input = e.target as HTMLInputElement;
    const boards = this._getSelectedBoards();
    if (boards.length !== 1) return;
    const title = input.value.trim();
    if (title === '' || title === boards[0]!.title) {
      input.value = boards[0]!.title;
      return;
    }
    this._patchBoards({ title });
  }

  private _onBoardColor(field: 'fill' | 'stroke', e: Event): void {
    const color = (e.target as HTMLInputElement).value;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      this._patchBoards({ style: { [field]: color.toLowerCase() } });
    }
  }

  private _onBoardColorNone(field: 'fill' | 'stroke'): void {
    this._patchBoards({ style: { [field]: null } });
  }

  private _onBoardFillOpacity(e: Event): void {
    const rawVal = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(rawVal)) return;
    this._patchBoards({ style: { fillOpacity: Math.min(1, Math.max(0, rawVal / 100)) } });
  }

  private _onColorChange(prop: 'fill' | 'stroke', e: Event): void {
    const input = e.target as HTMLInputElement;
    const color = input.value;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      this._applyStylePatch({ [prop]: color.toLowerCase() });
    }
  }

  private _onStrokeWidthChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const rawVal = parseFloat(input.value);
    if (Number.isNaN(rawVal) || rawVal < 0) return;
    this._applyStylePatch({ strokeWidth: rawVal });
  }

  private _onOpacityChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const rawVal = parseFloat(input.value);
    if (Number.isNaN(rawVal)) return;
    const opacity = Math.min(1, Math.max(0, rawVal / 100));
    this._applyStylePatch({ opacity });
  }

  /**
   * Tamanho da fonte dos textos selecionados: um número fixa o modo e o tamanho, "auto" volta
   * ao modo automático sem mudar o tamanho. Só os textos mudam, e uma seleção múltipla vira uma
   * transação (uma entrada de histórico).
   */
  private _onFontSizeChange(e: Event): void {
    if (!this._section) return;
    const value = (e.target as HTMLSelectElement).value;
    let patch: Record<string, unknown>;
    if (value === 'auto') {
      patch = { fontSizeMode: 'auto' };
    } else {
      const size = parseFloat(value);
      if (!Number.isFinite(size) || size <= 0) return;
      patch = { fontSizeMode: 'fixed', fontSize: size };
    }

    const texts = this._getSelectedShapes().filter(isTextual);
    if (texts.length === 0) return;
    if (texts.length === 1) {
      this._section.dispatch({ type: 'shape.update', id: texts[0]!.id, patch });
    } else {
      this._section.transact(
        texts.map((text) => ({ type: 'shape.update' as const, id: text.id, patch })),
      );
    }
  }

  /** Valor e rótulos do seletor de tamanho para os textos selecionados. */
  private _fontSizeChoice(texts: readonly TextualNode[]): {
    selected: 'auto' | 'mixed' | string;
    autoSize: number | undefined;
    extra: number | undefined;
  } {
    const first = texts[0]!;
    const same = texts.every(
      (text) => text.fontSizeMode === first.fontSizeMode && text.fontSize === first.fontSize,
    );
    if (!same) return { selected: 'mixed', autoSize: undefined, extra: undefined };
    if (first.fontSizeMode === 'auto') {
      return { selected: 'auto', autoSize: first.fontSize, extra: undefined };
    }
    const inList = (FONT_SIZE_PRESETS as readonly number[]).includes(first.fontSize);
    return {
      selected: String(first.fontSize),
      autoSize: undefined,
      extra: inList ? undefined : first.fontSize,
    };
  }

  private _onTextChange(e: Event): void {
    if (!this._section) return;
    const text = (e.target as HTMLInputElement).value;
    const targets = this._getSelectedShapes().filter(isTextual);
    if (targets.length === 0) return;
    if (targets.length === 1) {
      this._section.dispatch({ type: 'shape.update', id: targets[0]!.id, patch: { text } });
    } else {
      this._section.transact(
        targets.map((target) => ({
          type: 'shape.update' as const,
          id: target.id,
          patch: { text },
        })),
      );
    }
  }

  /** Cor das notas selecionadas: só as notas mudam, numa única entrada de histórico. */
  private _onStickyColor(color: string): void {
    if (!this._section || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    const notes = this._getSelectedShapes().filter((shape) => shape.type === 'sticky');
    if (notes.length === 0) return;
    const patch = { style: { fill: color.toLowerCase() } };
    if (notes.length === 1) {
      this._section.dispatch({ type: 'shape.update', id: notes[0]!.id, patch });
    } else {
      this._section.transact(
        notes.map((note) => ({ type: 'shape.update' as const, id: note.id, patch })),
      );
    }
  }

  /**
   * Aplica campos do `label` às formas elegíveis selecionadas, numa só entrada de histórico. Uma
   * forma sem `label` ganha o objeto com os padrões e `text: ''`.
   */
  private _applyLabelPatch(label: Partial<ShapeLabel>): void {
    if (!this._section) return;
    const shapes = this._getSelectedShapes().filter(isLabelable);
    if (shapes.length === 0) return;
    const commands = shapes.map((shape) => ({
      type: 'shape.update' as const,
      id: shape.id,
      patch: { label },
    }));
    if (commands.length === 1) this._section.dispatch(commands[0]!);
    else this._section.transact(commands);
  }

  private _onLabelRadio(field: LabelRadioField, value: string): void {
    if (!LABEL_RADIO_VALUES[field].includes(value)) return;
    this._applyLabelPatch({ [field]: value });
  }

  /**
   * Teclado do radiogroup, no padrão WAI-ARIA: as setas movem e marcam (dando a volta), Home e End
   * vão às pontas, e o foco acompanha o item marcado. Outras teclas seguem o caminho normal.
   */
  private _onLabelRadioKeydown(field: LabelRadioField, event: KeyboardEvent): void {
    const values = LABEL_RADIO_VALUES[field];
    const current = values.indexOf((event.target as HTMLElement).dataset['value'] ?? '');
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = current >= values.length - 1 ? 0 : current + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = current <= 0 ? values.length - 1 : current - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = values.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this._onLabelRadio(field, values[next]!);
    const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      '[role="radio"]',
    );
    buttons[next]?.focus();
  }

  /** Tamanho do texto das formas selecionadas, pelo seletor. */
  private _onLabelFontSize(e: Event): void {
    const size = parseFloat((e.target as HTMLSelectElement).value);
    if (!Number.isFinite(size) || size <= 0) return;
    this._applyLabelPatch({ fontSize: size });
  }

  /**
   * Negrito das formas selecionadas: pressionado (`bold` ou peso ≥ 600) desliga para `normal`; não
   * pressionado ou misto liga para `bold` em todas.
   */
  private _onLabelBold(): void {
    const shapes = this._getSelectedShapes().filter(isLabelable);
    if (shapes.length === 0) return;
    const allBold = shapes.every((shape) => isBoldWeight(shape.label?.fontWeight));
    this._applyLabelPatch({ fontWeight: allBold ? 'normal' : 'bold' });
  }

  /** Cor do texto das formas selecionadas: `#rrggbb` do seletor de cor. */
  private _onLabelColor(color: string): void {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    this._applyLabelPatch({ color: color.toLowerCase() });
  }

  /** Volta o texto das formas selecionadas à cor automática (maior contraste sobre o fundo). */
  private _onLabelColorAuto(): void {
    this._applyLabelPatch({ color: null });
  }

  /** Recolore todos os traços dos elementos de traços selecionados, numa só entrada de histórico. */
  private _onInkColor(color: string): void {
    if (!this._section || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    const inks = this._getSelectedShapes().filter(
      (shape): shape is InkNode => shape.type === 'ink',
    );
    if (inks.length === 0) return;
    const next = color.toLowerCase();
    const commands = inks.map((ink) => ({
      type: 'shape.update' as const,
      id: ink.id,
      patch: { strokes: ink.strokes.map((stroke) => ({ ...stroke, color: next })) },
    }));
    if (commands.length === 1) this._section.dispatch(commands[0]!);
    else this._section.transact(commands);
  }

  private _renderInkSection(
    inks: readonly InkNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const strokes = inks.reduce((sum, ink) => sum + ink.strokes.length, 0);
    const colors = new Set(inks.flatMap((ink) => ink.strokes.map((stroke) => stroke.color)));
    const mixed = colors.size > 1;
    const shown = mixed ? undefined : [...colors][0];
    return html`
      <div class="property-section" part="section-ink">
        <div class="section-title">${msg.sectionInk}</div>
        <div class="property-row" part="ink-strokes" data-field="ink-strokes">
          <span class="property-label">${msg.inkStrokes(strokes)}</span>
        </div>
        <div class="property-row">
          <span class="property-label" style="width: 70px;">${msg.inkColor}</span>
          <div class="color-field">
            <label
              class="color-preview-btn"
              part="btn-ink-color-preview"
              aria-label=${msg.inkColor}
              style="background-color: ${mixed ? '#cbd5e1' : (shown ?? 'transparent')}; cursor: ${
                disabled ? 'not-allowed' : 'pointer'
              };"
            >
              <input
                type="color"
                part="input-ink-color"
                data-field="ink-color"
                aria-label=${msg.inkColor}
                ?disabled=${disabled}
                .value=${shown === undefined ? '#000000' : shown.slice(0, 7)}
                @input=${(e: Event) => this._onInkColor((e.target as HTMLInputElement).value)}
              />
            </label>
            <span style="font-size: 11px; color: #334155; font-family: monospace;">
              ${mixed ? msg.mixed : (shown ?? '')}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  private _renderStickySection(
    notes: readonly StickyNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const first = notes[0]!.style.fill;
    const same = notes.every((note) => note.style.fill === first);
    return html`
      <div class="property-section" part="section-sticky">
        <div class="section-title">${msg.sectionSticky}</div>
        <div
          class="sticky-swatches"
          part="sticky-swatches"
          role="radiogroup"
          aria-label=${msg.stickyColor}
        >
          ${STICKY_PALETTE.map(([name, key]) => {
            const hex = STICKY_COLORS[name];
            const label = msg[key] as string;
            return html`
              <button
                type="button"
                class="sticky-swatch"
                part="sticky-swatch sticky-swatch-${name}"
                role="radio"
                data-field="sticky-color"
                data-color=${name}
                aria-label=${label}
                title=${label}
                aria-checked=${same && first === hex ? 'true' : 'false'}
                ?disabled=${disabled}
                style="background: ${hex}"
                @click=${() => this._onStickyColor(hex)}
              ></button>
            `;
          })}
        </div>
        <div class="property-row">
          <span class="property-label" style="width: 70px;">${msg.stickyColorCustom}</span>
          <div class="color-field">
            <label
              class="color-preview-btn"
              part="btn-sticky-color-preview"
              aria-label=${msg.stickyColorCustom}
              style="background-color: ${same ? first : '#cbd5e1'}; cursor: ${
                disabled ? 'not-allowed' : 'pointer'
              };"
            >
              <input
                type="color"
                part="input-sticky-color"
                data-field="sticky-color-custom"
                aria-label=${msg.stickyColorCustom}
                ?disabled=${disabled}
                .value=${same ? first : '#000000'}
                @input=${(e: Event) => this._onStickyColor((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
        </div>
      </div>
    `;
  }

  /** Um radiogroup (Posição ou Alinhamento): um item marcado com tabindex 0, ou o primeiro se misto. */
  private _renderLabelRadios(
    field: LabelRadioField,
    dataField: string,
    groupLabel: string,
    options: ReadonlyArray<readonly [string, keyof PropertiesI18nMessages]>,
    current: MixedValue<string>,
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const checked = current.mixed ? undefined : current.value;
    return html`
      <div class="property-field" part="field-${dataField}" style="margin-top: 4px;">
        <span class="property-label" id="label-${dataField}-name">${groupLabel}</span>
        <div
          class="label-radios"
          part="label-radios"
          role="radiogroup"
          data-field=${dataField}
          aria-labelledby="label-${dataField}-name"
          @keydown=${(event: KeyboardEvent) => this._onLabelRadioKeydown(field, event)}
        >
          ${options.map(([value, key], index) => {
            const isChecked = checked === value;
            const tabbable = checked === undefined ? index === 0 : isChecked;
            return html`
              <button
                type="button"
                class="label-radio"
                part="label-radio label-radio-${value}"
                role="radio"
                data-value=${value}
                aria-checked=${isChecked ? 'true' : 'false'}
                tabindex=${tabbable ? '0' : '-1'}
                ?disabled=${disabled}
                @click=${() => this._onLabelRadio(field, value)}
              >
                ${msg[key] as string}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  /** Seção "Texto na forma": posição vertical e alinhamento horizontal do texto das formas. */
  private _renderLabelSection(
    shapes: readonly LabelableNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const vertical = this._getCommonValue([...shapes], (s) => s.label?.verticalAlign ?? 'middle');
    const align = this._getCommonValue([...shapes], (s) => s.label?.textAlign ?? 'center');
    return html`
      <div class="property-section" part="section-label">
        <div class="section-title">${msg.sectionLabel}</div>
        ${this._renderLabelRadios(
          'verticalAlign',
          'label-vertical-align',
          msg.labelVerticalAlign,
          LABEL_VERTICAL_ALIGNS,
          vertical,
          msg,
          disabled,
        )}
        ${this._renderLabelRadios(
          'textAlign',
          'label-align',
          msg.labelAlign,
          LABEL_ALIGNS,
          align,
          msg,
          disabled,
        )}
        ${this._renderLabelFontSize(shapes, msg, disabled)}
        ${this._renderLabelBold(shapes, msg, disabled)}
        ${this._renderLabelColor(shapes, msg, disabled)}
      </div>
    `;
  }

  /** Tamanho do texto da forma: presets, a opção extra do tamanho fora da lista e a de "misto". */
  private _renderLabelFontSize(
    shapes: readonly LabelableNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const size = this._getCommonValue([...shapes], (s) => s.label?.fontSize ?? 16);
    const selected = size.mixed ? 'mixed' : String(size.value);
    const extra =
      size.mixed ||
      size.value === undefined ||
      (FONT_SIZE_PRESETS as readonly number[]).includes(size.value)
        ? undefined
        : size.value;
    return html`
      <div class="property-field" part="field-label-font-size" style="margin-top: 4px;">
        <label class="property-label" for="prop-label-font-size">${msg.fontSize}</label>
        <select
          id="prop-label-font-size"
          class="property-input"
          part="input-label-font-size"
          data-field="labelFontSize"
          data-property="labelFontSize"
          aria-label=${msg.fontSize}
          ?disabled=${disabled}
          .value=${selected}
          @change=${(e: Event) => this._onLabelFontSize(e)}
        >
          ${size.mixed ? html`<option value="mixed" selected disabled>${msg.mixed}</option>` : ''}
          ${extra === undefined ? '' : html`<option value=${String(extra)} selected>${extra}</option>`}
          ${FONT_SIZE_PRESETS.map(
            (preset) =>
              html`<option value=${String(preset)} ?selected=${selected === String(preset)}>
                ${preset}
              </option>`,
          )}
        </select>
      </div>
    `;
  }

  /** Botão Negrito: `aria-pressed` true, false ou "mixed" quando as formas divergem. */
  private _renderLabelBold(
    shapes: readonly LabelableNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const bold = shapes.map((shape) => isBoldWeight(shape.label?.fontWeight));
    const state = bold.every(Boolean) ? 'true' : bold.some(Boolean) ? 'mixed' : 'false';
    return html`
      <div class="property-field" part="field-label-bold" style="margin-top: 4px;">
        <button
          type="button"
          class="label-toggle"
          part="button-label-bold"
          data-field="label-bold"
          aria-pressed=${state}
          ?disabled=${disabled}
          @click=${() => this._onLabelBold()}
          style="font-weight: bold;"
        >
          ${msg.labelBold}
        </button>
      </div>
    `;
  }

  /** Cor do texto: seletor com a cor efetiva e o botão Automática. */
  private _renderLabelColor(
    shapes: readonly LabelableNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const effective = this._getCommonValue([...shapes], (s) => shapeLabelColor(s));
    const automatic = shapes.every((shape) => (shape.label?.color ?? null) === null);
    const shown = effective.mixed ? undefined : effective.value;
    return html`
      <div class="property-row" part="field-label-color" style="margin-top: 4px;">
        <span class="property-label" style="width: 70px;">${msg.labelColor}</span>
        <div class="color-field">
          <label
            class="color-preview-btn"
            part="btn-label-color-preview"
            aria-label=${msg.labelColor}
            style="background-color: ${effective.mixed ? '#cbd5e1' : (shown ?? 'transparent')}; cursor: ${
              disabled ? 'not-allowed' : 'pointer'
            };"
          >
            <input
              type="color"
              part="input-label-color"
              data-field="label-color"
              aria-label=${msg.labelColor}
              ?disabled=${disabled}
              .value=${shown === undefined ? '#000000' : shown.slice(0, 7)}
              @input=${(e: Event) => this._onLabelColor((e.target as HTMLInputElement).value)}
            />
          </label>
          <span style="font-size: 11px; color: #334155; font-family: monospace;">
            ${effective.mixed ? msg.mixed : (shown ?? '')}
          </span>
          <button
            type="button"
            class="label-toggle"
            part="button-label-color-auto"
            data-field="label-color-auto"
            aria-pressed=${automatic ? 'true' : 'false'}
            ?disabled=${disabled}
            @click=${() => this._onLabelColorAuto()}
          >
            ${msg.labelColorAuto}
          </button>
        </div>
      </div>
    `;
  }

  private _renderFontSizeField(
    texts: readonly TextualNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const { selected, autoSize, extra } = this._fontSizeChoice(texts);
    const autoLabel =
      autoSize === undefined ? msg.fontSizeAuto : `${msg.fontSizeAuto} (${Math.round(autoSize)})`;
    return html`
      <div class="property-field" part="field-font-size" style="margin-top: 8px;">
        <label class="property-label" for="prop-font-size">${msg.fontSize}</label>
        <select
          id="prop-font-size"
          class="property-input"
          part="input-font-size"
          data-field="fontSize"
          data-property="fontSize"
          aria-label=${msg.fontSize}
          ?disabled=${disabled}
          .value=${selected}
          @change=${(e: Event) => this._onFontSizeChange(e)}
        >
          ${
            selected === 'mixed'
              ? html`<option value="mixed" selected disabled>${msg.mixed}</option>`
              : ''
          }
          ${
            extra === undefined
              ? ''
              : html`<option value=${String(extra)} selected>${extra}</option>`
          }
          <option value="auto" ?selected=${selected === 'auto'}>${autoLabel}</option>
          ${FONT_SIZE_PRESETS.map(
            (size) =>
              html`<option value=${String(size)} ?selected=${selected === String(size)}>
                ${size}
              </option>`,
          )}
        </select>
      </div>
    `;
  }

  /** Uma linha de cor do board (fundo ou borda): a cor, o valor e o botão "Nenhum". */
  private _renderBoardColor(
    field: 'fill' | 'stroke',
    label: string,
    value: MixedValue<string | null>,
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const shown = value.mixed ? undefined : (value.value ?? undefined);
    const partName = field === 'fill' ? 'board-fill' : 'board-stroke';
    return html`
      <div class="property-row" part="field-${partName}">
        <span class="property-label" style="width: 70px;">${label}</span>
        <div class="color-field">
          <label
            class="color-preview-btn"
            part="btn-${partName}-preview"
            aria-label=${label}
            style="background-color: ${value.mixed ? '#cbd5e1' : (shown ?? 'transparent')}; cursor: ${
              disabled ? 'not-allowed' : 'pointer'
            };"
          >
            <input
              type="color"
              part="input-${partName}"
              data-field=${partName}
              aria-label=${label}
              ?disabled=${disabled}
              .value=${shown ?? '#000000'}
              @input=${(e: Event) => this._onBoardColor(field, e)}
            />
          </label>
          <span style="font-size: 11px; color: #334155; font-family: monospace;">
            ${value.mixed ? msg.mixed : (shown ?? msg.boardNone)}
          </span>
          <button
            type="button"
            class="label-toggle"
            part="button-${partName}-none"
            data-field="${partName}-none"
            aria-label=${`${label}: ${msg.boardNone}`}
            aria-pressed=${!value.mixed && value.value === null ? 'true' : 'false'}
            ?disabled=${disabled}
            @click=${() => this._onBoardColorNone(field)}
          >
            ${msg.boardNone}
          </button>
        </div>
      </div>
    `;
  }

  /** A seção do board: título (só com um), fundo, opacidade do fundo e borda. */
  private _renderBoardSection(
    boards: readonly BoardNode[],
    msg: PropertiesI18nMessages,
    disabled: boolean,
  ) {
    const single = boards.length === 1 ? boards[0] : undefined;
    const list = [...boards];
    const fill = this._getCommonValue(list, (b) => b.style.fill);
    const stroke = this._getCommonValue(list, (b) => b.style.stroke);
    const opacity = this._getCommonValue(list, (b) => Math.round(b.style.fillOpacity * 100));
    return html`
      <div class="property-section" part="section-board">
        <div class="section-title">${msg.sectionBoard}</div>
        ${
          single
            ? html`
                <div class="property-row" part="field-board-title">
                  <label class="property-label" for="prop-board-title" style="width: 70px;"
                    >${msg.boardTitle}</label
                  >
                  <div class="property-field" style="flex: 1;">
                    <input
                      id="prop-board-title"
                      type="text"
                      maxlength="200"
                      class="property-input"
                      part="input-board-title"
                      data-property="board-title"
                      ?disabled=${disabled}
                      .value=${single.title}
                      @change=${(e: Event) => this._onBoardTitle(e)}
                    />
                  </div>
                </div>
              `
            : ''
        }
        ${this._renderBoardColor('fill', msg.boardBackground, fill, msg, disabled)}
        <div class="property-row" part="field-board-fill-opacity">
          <label class="property-label" for="prop-board-fill-opacity" style="width: 70px;"
            >${msg.boardBackgroundOpacity}</label
          >
          <div class="property-field" style="flex: 1;">
            <input
              id="prop-board-fill-opacity"
              type="number"
              min="0"
              max="100"
              step="5"
              class="property-input"
              part="input-board-fill-opacity"
              data-property="board-fill-opacity"
              ?disabled=${disabled}
              .placeholder=${opacity.mixed ? msg.mixed : ''}
              .value=${opacity.mixed || opacity.value === undefined ? '' : String(opacity.value)}
              @change=${(e: Event) => this._onBoardFillOpacity(e)}
            />
            <span style="font-size: 11px; color: #475569;">%</span>
          </div>
        </div>
        ${this._renderBoardColor('stroke', msg.boardBorder, stroke, msg, disabled)}
      </div>
    `;
  }

  override render() {
    const snap = this._section?.getSnapshot();
    const isReadOnly = snap?.session.readOnly ?? false;
    const shapes = this._getSelectedShapes();
    const boards = this._getSelectedBoards();
    // Só boards: a seção do board, X, Y, largura e altura; sem rotação, conversões nem estilo.
    const boardOnly = shapes.length === 0 && boards.length > 0;
    const msg = this.messages;

    if (shapes.length === 0 && boards.length === 0) {
      return html`
        <div class="properties-header" part="properties-header">
          <slot name="header">
            <span>${msg.title}</span>
          </slot>
        </div>
        <div class="empty-message" part="empty-message">${msg.noSelection}</div>
        <slot></slot>
        <slot name="footer"></slot>
      `;
    }

    const anyLocked = shapes.some((s) => s.locked) || boards.some((b) => b.locked);
    // Outro participante detém algum dos nós: os campos ficam desabilitados e a linha avisa quem.
    const peerLock = this._section
      ? snap?.session.selectedIds
          .map((id) => this._section?.getPeerLock(id))
          .find((lock) => lock !== undefined)
      : undefined;
    const disabled = isReadOnly || anyLocked || peerLock !== undefined;

    // Dimensões / Geometria
    const boxShapes = shapes.filter((s): s is BoxShapeNode => isBoxShape(s));
    const frames: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = boardOnly
      ? boards
      : boxShapes;

    const xVal = this._getCommonValue([...frames], (s) => Math.round(s.x * 100) / 100);
    const yVal = this._getCommonValue([...frames], (s) => Math.round(s.y * 100) / 100);
    const wVal = this._getCommonValue([...frames], (s) => Math.round(s.width * 100) / 100);
    const hVal = this._getCommonValue([...frames], (s) => Math.round(s.height * 100) / 100);
    const rVal = this._getCommonValue(boxShapes, (s) => Math.round((s.rotation * 180) / Math.PI));

    // Estilos
    // Cada campo é lido só das figuras cujo estilo o tem (a chave não tem preenchimento e o traço à
    // mão livre não tem contorno), para uma seleção mista não esconder nem enganar os controles.
    const fillVal = this._getCommonValue(
      shapes.filter((s) => 'fill' in s.style),
      (s) => ('fill' in s.style ? (s.style.fill as string | null) : undefined),
    );
    const strokeShapes = shapes.filter((s) => 'stroke' in s.style);
    const strokeVal = this._getCommonValue(strokeShapes, (s) =>
      'stroke' in s.style ? (s.style.stroke as string | null) : undefined,
    );
    const strokeWidthVal = this._getCommonValue(strokeShapes, (s) =>
      'strokeWidth' in s.style ? s.style.strokeWidth : undefined,
    );
    const opacityVal = this._getCommonValue(shapes, (s) =>
      Math.round((s.style.opacity ?? 1) * 100),
    );

    // Texto (se todos forem text)
    const textShapes = shapes.filter(isTextual);
    const stickyShapes = shapes.filter((s): s is StickyNode => s.type === 'sticky');
    const onlyNotes = stickyShapes.length === shapes.length;
    const labelShapes = shapes.filter(isLabelable);
    const inkShapes = shapes.filter((s): s is InkNode => s.type === 'ink');
    const onlyInk = inkShapes.length === shapes.length;
    const textVal = this._getCommonValue(textShapes, (s) => s.text);

    const singleShape = shapes.length === 1 ? shapes[0] : undefined;

    return html`
      <div class="properties-header" part="properties-header">
        <slot name="header">
          <span>${msg.title}</span>
          <span style="font-weight: normal; font-size: 11px; opacity: 0.7;">
            ${
              shapes.length + boards.length === 1
                ? (shapes[0] ?? boards[0]!).type
                : `${shapes.length + boards.length} selecionados`
            }
          </span>
        </slot>
      </div>
      ${
        peerLock
          ? html`<div
              class="peer-lock-notice"
              part="peer-lock-notice"
              role="status"
              aria-disabled="true"
              style="border-left: 4px solid ${peerLock.color};"
            >
              ${msg.lockedBy(peerLock.name)}
            </div>`
          : ''
      }

      <div class="properties-body" part="properties-body">
        ${boardOnly ? this._renderBoardSection(boards, msg, disabled) : ''}
        ${
          frames.length > 0
            ? html`
                <div class="property-section" part="section-transform">
                  <div class="section-title">${msg.sectionTransform}</div>
                  <div class="property-grid">
                    <div class="property-field" part="field-x">
                      <label class="property-label" for="prop-x">X</label>
                      <input
                        id="prop-x"
                        type="number"
                        class="property-input"
                        part="input-x"
                        data-property="x"
                        aria-label=${msg.posX}
                        ?disabled=${disabled}
                        .placeholder=${xVal.mixed ? msg.mixed : ''}
                        .value=${xVal.mixed || xVal.value === undefined ? '' : String(xVal.value)}
                        @change=${(e: Event) => this._onNumberChange('x', e)}
                      />
                    </div>

                    <div class="property-field" part="field-y">
                      <label class="property-label" for="prop-y">Y</label>
                      <input
                        id="prop-y"
                        type="number"
                        class="property-input"
                        part="input-y"
                        data-property="y"
                        aria-label=${msg.posY}
                        ?disabled=${disabled}
                        .placeholder=${yVal.mixed ? msg.mixed : ''}
                        .value=${yVal.mixed || yVal.value === undefined ? '' : String(yVal.value)}
                        @change=${(e: Event) => this._onNumberChange('y', e)}
                      />
                    </div>

                    <div class="property-field" part="field-width">
                      <label class="property-label" for="prop-w">L</label>
                      <input
                        id="prop-w"
                        type="number"
                        min="1"
                        class="property-input"
                        part="input-width"
                        data-property="width"
                        aria-label=${msg.width}
                        ?disabled=${disabled}
                        .placeholder=${wVal.mixed ? msg.mixed : ''}
                        .value=${wVal.mixed || wVal.value === undefined ? '' : String(wVal.value)}
                        @change=${(e: Event) => this._onNumberChange('width', e)}
                      />
                    </div>

                    <div class="property-field" part="field-height">
                      <label class="property-label" for="prop-h">A</label>
                      <input
                        id="prop-h"
                        type="number"
                        min="1"
                        class="property-input"
                        part="input-height"
                        data-property="height"
                        aria-label=${msg.height}
                        ?disabled=${disabled}
                        .placeholder=${hVal.mixed ? msg.mixed : ''}
                        .value=${hVal.mixed || hVal.value === undefined ? '' : String(hVal.value)}
                        @change=${(e: Event) => this._onNumberChange('height', e)}
                      />
                    </div>
                  </div>

                  ${
                    boardOnly
                      ? ''
                      : html`
                          <div
                            class="property-field"
                            part="field-rotation"
                            style="margin-top: 8px;"
                          >
                            <label class="property-label" for="prop-rotation">∠</label>
                            <input
                              id="prop-rotation"
                              type="number"
                              class="property-input"
                              part="input-rotation"
                              data-property="rotation"
                              aria-label=${msg.rotation}
                              ?disabled=${disabled}
                              .placeholder=${rVal.mixed ? msg.mixed : ''}
                              .value=${rVal.mixed || rVal.value === undefined ? '' : String(rVal.value)}
                              @change=${(e: Event) => this._onNumberChange('rotation', e)}
                            />
                            <span style="font-size: 11px; color: #475569; padding-right: 4px;"
                              >°</span
                            >
                          </div>
                        `
                  }
                  ${
                    singleShape?.type === 'square'
                      ? html`
                          <button
                            type="button"
                            class="convert-btn"
                            part="btn-convert-type"
                            data-action="convert-to-rectangle"
                            aria-label=${msg.convertToRectangle}
                            ?disabled=${disabled}
                            @click=${() => this._onConvertShapeType('rectangle')}
                          >
                            ${msg.convertToRectangle}
                          </button>
                        `
                      : singleShape?.type === 'rectangle'
                        ? html`
                            <button
                              type="button"
                              class="convert-btn"
                              part="btn-convert-type"
                              data-action="convert-to-square"
                              aria-label=${msg.convertToSquare}
                              ?disabled=${disabled}
                              @click=${() => this._onConvertShapeType('square')}
                            >
                              ${msg.convertToSquare}
                            </button>
                          `
                        : singleShape?.type === 'circle'
                          ? html`
                              <button
                                type="button"
                                class="convert-btn"
                                part="btn-convert-type"
                                data-action="convert-to-ellipse"
                                aria-label=${msg.convertToEllipse}
                                ?disabled=${disabled}
                                @click=${() => this._onConvertShapeType('ellipse')}
                              >
                                ${msg.convertToEllipse}
                              </button>
                            `
                          : singleShape?.type === 'ellipse'
                            ? html`
                                <button
                                  type="button"
                                  class="convert-btn"
                                  part="btn-convert-type"
                                  data-action="convert-to-circle"
                                  aria-label=${msg.convertToCircle}
                                  ?disabled=${disabled}
                                  @click=${() => this._onConvertShapeType('circle')}
                                >
                                  ${msg.convertToCircle}
                                </button>
                              `
                            : singleShape?.type === 'triangle'
                              ? html`
                                  <div
                                    class="property-field"
                                    part="field-triangle-variant"
                                    style="margin-top: 8px;"
                                  >
                                    <label class="property-label" for="prop-triangle-variant"
                                      >${msg.triangleVariant}</label
                                    >
                                    <select
                                      id="prop-triangle-variant"
                                      class="property-input"
                                      part="select-triangle-variant"
                                      data-field="variant"
                                      data-property="variant"
                                      aria-label=${msg.triangleVariant}
                                      ?disabled=${disabled}
                                      .value=${singleShape.variant}
                                      @change=${(e: Event) => this._onTriangleVariantChange(e)}
                                    >
                                      <option
                                        value="isosceles"
                                        ?selected=${singleShape.variant === 'isosceles'}
                                      >
                                        ${msg.triangleIsosceles}
                                      </option>
                                      <option
                                        value="equilateral"
                                        ?selected=${singleShape.variant === 'equilateral'}
                                      >
                                        ${msg.triangleEquilateral}
                                      </option>
                                      <option
                                        value="right"
                                        ?selected=${singleShape.variant === 'right'}
                                      >
                                        ${msg.triangleRight}
                                      </option>
                                      <option
                                        value="scalene"
                                        ?selected=${singleShape.variant === 'scalene'}
                                      >
                                        ${msg.triangleScalene}
                                      </option>
                                    </select>
                                  </div>
                                  ${
                                    singleShape.variant === 'scalene'
                                      ? html`
                                          <div
                                            class="property-field"
                                            part="field-triangle-apex"
                                            style="margin-top: 8px;"
                                          >
                                            <label class="property-label" for="prop-triangle-apex"
                                              >${msg.triangleApex}</label
                                            >
                                            <input
                                              id="prop-triangle-apex"
                                              type="number"
                                              min="0"
                                              max="1"
                                              step="0.05"
                                              class="property-input"
                                              part="input-triangle-apex"
                                              data-field="apex"
                                              data-property="apex"
                                              aria-label=${msg.triangleApex}
                                              ?disabled=${disabled}
                                              .value=${String(
                                                Math.round(singleShape.apex * 100) / 100,
                                              )}
                                              @change=${(e: Event) => this._onTriangleApexChange(e)}
                                            />
                                          </div>
                                        `
                                      : ''
                                  }
                                `
                              : singleShape?.type === 'polygon'
                                ? html`
                                    <div
                                      class="property-field"
                                      part="field-polygon-sides"
                                      style="margin-top: 8px;"
                                    >
                                      <label class="property-label" for="prop-polygon-sides"
                                        >${msg.polygonSides}</label
                                      >
                                      <input
                                        id="prop-polygon-sides"
                                        type="number"
                                        min="3"
                                        max="12"
                                        step="1"
                                        class="property-input"
                                        part="input-polygon-sides"
                                        data-field="sides"
                                        data-property="sides"
                                        aria-label=${msg.polygonSides}
                                        ?disabled=${disabled}
                                        .value=${String(singleShape.sides)}
                                        @change=${(e: Event) => this._onPolygonSidesChange(e)}
                                      />
                                    </div>
                                  `
                                : ''
                  }
                </div>
              `
            : ''
        }
        ${
          singleShape?.type === 'cross'
            ? html`
                <div class="property-section" part="section-cross">
                  <div class="property-field" part="field-cross-arm-ratio">
                    <label class="property-label" for="prop-cross-arm-ratio"
                      >${msg.crossArmRatio}</label
                    >
                    <input
                      id="prop-cross-arm-ratio"
                      type="number"
                      min="0.05"
                      max="1"
                      step="0.05"
                      class="property-input"
                      part="input-cross-arm-ratio"
                      data-field="armRatio"
                      data-property="armRatio"
                      aria-label=${msg.crossArmRatio}
                      ?disabled=${disabled}
                      .value=${String(Math.round(singleShape.armRatio * 100) / 100)}
                      @change=${(e: Event) => this._onCrossArmRatioChange(e)}
                    />
                  </div>
                </div>
              `
            : ''
        }
        ${
          singleShape?.type === 'chevron'
            ? html`
                <div class="property-section" part="section-chevron">
                  <div class="property-field" part="field-chevron-direction">
                    <label class="property-label" for="prop-chevron-direction"
                      >${msg.chevronDirection}</label
                    >
                    <select
                      id="prop-chevron-direction"
                      class="property-input"
                      part="select-chevron-direction"
                      data-field="direction"
                      data-property="direction"
                      aria-label=${msg.chevronDirection}
                      ?disabled=${disabled}
                      .value=${singleShape.direction}
                      @change=${(e: Event) => this._onChevronDirectionChange(e)}
                    >
                      <option value="right" ?selected=${singleShape.direction === 'right'}>
                        ${msg.directionRight}
                      </option>
                      <option value="left" ?selected=${singleShape.direction === 'left'}>
                        ${msg.directionLeft}
                      </option>
                      <option value="up" ?selected=${singleShape.direction === 'up'}>
                        ${msg.directionUp}
                      </option>
                      <option value="down" ?selected=${singleShape.direction === 'down'}>
                        ${msg.directionDown}
                      </option>
                    </select>
                  </div>
                  <div class="property-field" part="field-chevron-notch-depth">
                    <label class="property-label" for="prop-chevron-notch-depth"
                      >${msg.chevronNotchDepth}</label
                    >
                    <input
                      id="prop-chevron-notch-depth"
                      type="number"
                      min="0"
                      max="0.5"
                      step="0.05"
                      class="property-input"
                      part="input-chevron-notch-depth"
                      data-field="notchDepth"
                      data-property="notchDepth"
                      aria-label=${msg.chevronNotchDepth}
                      ?disabled=${disabled}
                      .value=${String(Math.round(singleShape.notchDepth * 100) / 100)}
                      @change=${(e: Event) => this._onChevronNotchDepthChange(e)}
                    />
                  </div>
                </div>
              `
            : ''
        }
        ${
          singleShape?.type === 'brace'
            ? html`
                <div class="property-section" part="section-brace">
                  <div class="property-field" part="field-brace-orientation">
                    <label class="property-label" for="prop-brace-orientation"
                      >${msg.braceOrientation}</label
                    >
                    <select
                      id="prop-brace-orientation"
                      class="property-input"
                      part="select-brace-orientation"
                      data-field="orientation"
                      data-property="orientation"
                      aria-label=${msg.braceOrientation}
                      ?disabled=${disabled}
                      .value=${singleShape.orientation}
                      @change=${(e: Event) => this._onBraceOrientationChange(e)}
                    >
                      <option value="left" ?selected=${singleShape.orientation === 'left'}>
                        ${msg.directionLeft}
                      </option>
                      <option value="right" ?selected=${singleShape.orientation === 'right'}>
                        ${msg.directionRight}
                      </option>
                      <option value="up" ?selected=${singleShape.orientation === 'up'}>
                        ${msg.directionUp}
                      </option>
                      <option value="down" ?selected=${singleShape.orientation === 'down'}>
                        ${msg.directionDown}
                      </option>
                    </select>
                  </div>
                  <div class="property-field" part="field-brace-tip-position">
                    <label class="property-label" for="prop-brace-tip-position"
                      >${msg.braceTipPosition}</label
                    >
                    <input
                      id="prop-brace-tip-position"
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      class="property-input"
                      part="input-brace-tip-position"
                      data-field="tipPosition"
                      data-property="tipPosition"
                      aria-label=${msg.braceTipPosition}
                      ?disabled=${disabled}
                      .value=${String(Math.round(singleShape.tipPosition * 100) / 100)}
                      @change=${(e: Event) => this._onBraceFractionChange('tipPosition', e)}
                    />
                  </div>
                  <div class="property-field" part="field-brace-curvature">
                    <label class="property-label" for="prop-brace-curvature"
                      >${msg.braceCurvature}</label
                    >
                    <input
                      id="prop-brace-curvature"
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      class="property-input"
                      part="input-brace-curvature"
                      data-field="curvature"
                      data-property="curvature"
                      aria-label=${msg.braceCurvature}
                      ?disabled=${disabled}
                      .value=${String(Math.round(singleShape.curvature * 100) / 100)}
                      @change=${(e: Event) => this._onBraceFractionChange('curvature', e)}
                    />
                  </div>
                </div>
              `
            : ''
        }
        ${
          singleShape?.type === 'bezier'
            ? html`
                <div class="property-section" part="section-bezier">
                  <label class="property-field" part="field-bezier-symmetric">
                    <input
                      id="prop-bezier-symmetric"
                      type="checkbox"
                      part="input-bezier-symmetric"
                      data-field="symmetric"
                      data-property="symmetric"
                      aria-label=${msg.bezierSymmetric}
                      ?disabled=${disabled}
                      .checked=${singleShape.symmetric}
                      @change=${(e: Event) => this._onBezierSymmetricChange(e)}
                    />
                    <span class="property-label">${msg.bezierSymmetric}</span>
                  </label>
                </div>
              `
            : ''
        }
        ${stickyShapes.length > 0 ? this._renderStickySection(stickyShapes, msg, disabled) : ''}
        ${inkShapes.length > 0 ? this._renderInkSection(inkShapes, msg, disabled) : ''}
        ${labelShapes.length > 0 ? this._renderLabelSection(labelShapes, msg, disabled) : ''}
        ${
          textShapes.length > 0
            ? html`
                <div class="property-section" part="section-text">
                  <div class="section-title">${msg.sectionText}</div>
                  <div class="property-field" part="field-text">
                    <input
                      id="prop-text"
                      type="text"
                      class="property-input"
                      part="input-text"
                      data-property="text"
                      aria-label=${msg.textContent}
                      ?disabled=${disabled}
                      .placeholder=${textVal.mixed ? msg.mixed : ''}
                      .value=${textVal.mixed || textVal.value === undefined ? '' : textVal.value}
                      @change=${(e: Event) => this._onTextChange(e)}
                    />
                  </div>
                  ${this._renderFontSizeField(textShapes, msg, disabled)}
                </div>
              `
            : ''
        }
        ${
          boardOnly
            ? ''
            : html`
                <div class="property-section" part="section-style">
                  <div class="section-title">${msg.sectionStyle}</div>

                  ${
                    !onlyNotes && !onlyInk && (fillVal.value !== undefined || fillVal.mixed)
                      ? html`
                          <div class="property-row">
                            <span class="property-label" style="width: 70px;">${msg.fill}</span>
                            <div class="color-field">
                              <label
                                class="color-preview-btn"
                                part="btn-fill-preview"
                                aria-label=${msg.fill}
                                style="background-color: ${
                                  fillVal.mixed ? '#cbd5e1' : fillVal.value || 'transparent'
                                }; cursor: ${disabled ? 'not-allowed' : 'pointer'};"
                              >
                                <input
                                  type="color"
                                  part="input-fill"
                                  data-property="fill"
                                  aria-label=${msg.fill}
                                  ?disabled=${disabled}
                                  .value=${fillVal.value || '#000000'}
                                  @input=${(e: Event) => this._onColorChange('fill', e)}
                                />
                              </label>
                              <span
                                style="font-size: 11px; color: #334155; font-family: monospace;"
                              >
                                ${fillVal.mixed ? msg.mixed : (fillVal.value ?? 'Nenhum')}
                              </span>
                            </div>
                          </div>
                        `
                      : ''
                  }
                  ${
                    onlyInk
                      ? ''
                      : html`
                          <div class="property-row">
                            <span class="property-label" style="width: 70px;">${msg.stroke}</span>
                            <div class="color-field">
                              <label
                                class="color-preview-btn"
                                part="btn-stroke-preview"
                                aria-label=${msg.stroke}
                                style="background-color: ${
                                  strokeVal.mixed ? '#cbd5e1' : strokeVal.value || 'transparent'
                                }; cursor: ${disabled ? 'not-allowed' : 'pointer'};"
                              >
                                <input
                                  type="color"
                                  part="input-stroke"
                                  data-property="stroke"
                                  aria-label=${msg.stroke}
                                  ?disabled=${disabled}
                                  .value=${strokeVal.value || '#000000'}
                                  @input=${(e: Event) => this._onColorChange('stroke', e)}
                                />
                              </label>
                              <span
                                style="font-size: 11px; color: #334155; font-family: monospace;"
                              >
                                ${strokeVal.mixed ? msg.mixed : (strokeVal.value ?? 'Nenhum')}
                              </span>
                            </div>
                          </div>

                          <div class="property-row">
                            <label
                              class="property-label"
                              for="prop-stroke-width"
                              style="width: 70px;"
                              >${msg.strokeWidth}</label
                            >
                            <div class="property-field" style="flex: 1;">
                              <input
                                id="prop-stroke-width"
                                type="number"
                                min="0"
                                step="1"
                                class="property-input"
                                part="input-stroke-width"
                                data-property="strokeWidth"
                                aria-label=${msg.strokeWidth}
                                ?disabled=${disabled}
                                .placeholder=${strokeWidthVal.mixed ? msg.mixed : ''}
                                .value=${
                                  strokeWidthVal.mixed || strokeWidthVal.value === undefined
                                    ? ''
                                    : String(strokeWidthVal.value)
                                }
                                @change=${(e: Event) => this._onStrokeWidthChange(e)}
                              />
                              <span style="font-size: 11px; color: #475569;">px</span>
                            </div>
                          </div>
                        `
                  }

                  <div class="property-row">
                    <label class="property-label" for="prop-opacity" style="width: 70px;"
                      >${msg.opacity}</label
                    >
                    <div class="property-field" style="flex: 1;">
                      <input
                        id="prop-opacity"
                        type="number"
                        min="0"
                        max="100"
                        step="5"
                        class="property-input"
                        part="input-opacity"
                        data-property="opacity"
                        aria-label=${msg.opacity}
                        ?disabled=${disabled}
                        .placeholder=${opacityVal.mixed ? msg.mixed : ''}
                        .value=${
                          opacityVal.mixed || opacityVal.value === undefined
                            ? ''
                            : String(opacityVal.value)
                        }
                        @change=${(e: Event) => this._onOpacityChange(e)}
                      />
                      <span style="font-size: 11px; color: #475569;">%</span>
                    </div>
                  </div>
                </div>
              `
        }
      </div>

      <slot></slot>
      <slot name="footer"></slot>
    `;
  }
}
