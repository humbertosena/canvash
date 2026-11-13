import type { FontWeight, TextAlign } from './text.js';

/** Cor em `#rrggbb` ou `#rrggbbaa`. */
type Color = string;

/** Onde o bloco de texto fica na altura da área inscrita da forma. */
export type LabelVerticalAlign = 'top' | 'middle' | 'bottom';

/** Texto dentro de uma forma fechada. Quebra e é recortado na área inscrita. */
export interface ShapeLabel {
  /** Texto simples, sem HTML. Pode ser vazio. */
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight: FontWeight;
  /** `null`: a cor de maior contraste sobre `style.fill` (`stickyTextColor`). */
  readonly color: Color | null;
  readonly textAlign: TextAlign;
  readonly verticalAlign: LabelVerticalAlign;
}

/** Margem entre a área do texto e o contorno inscrito da forma, em unidades do documento. */
export const SHAPE_LABEL_PADDING = 8;

/** Entrelinha do texto da forma: fixa, fora do modelo. */
export const SHAPE_LABEL_LINE_HEIGHT = 1.25;

/** Os campos que faltam num `label` dado completam daqui. */
export const DEFAULT_SHAPE_LABEL: ShapeLabel = Object.freeze({
  text: '',
  fontSize: 16,
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  color: null,
  textAlign: 'center',
  verticalAlign: 'middle',
});
