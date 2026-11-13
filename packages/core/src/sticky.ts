import { FONT_SIZE_PRESETS, layoutText, type FontWeight } from './text.js';

/** Cores de nota adesiva, em pastel. `yellow` é a padrão. */
export const STICKY_COLORS = Object.freeze({
  yellow: '#fff59d',
  pink: '#f8bbd0',
  green: '#c8e6c9',
  blue: '#bbdefb',
  orange: '#ffcc80',
  purple: '#d1c4e9',
} as const);

export type StickyColorName = keyof typeof STICKY_COLORS;

/** Margem interna entre a borda da nota e o texto, em unidades do documento. */
export const STICKY_PADDING = 12;

/** Lado da nota nascida de um clique, em unidades do documento. */
export const DEFAULT_STICKY_SIZE = 200;

/**
 * Sombra da nota. O Canvas usa deslocamento e desfoque; o SVG, sem filtros, um retângulo
 * deslocado com `svgOpacity`. `reach` é o quanto ela passa da caixa, em qualquer lado.
 */
export const STICKY_SHADOW = Object.freeze({
  offsetY: 2,
  blur: 6,
  color: 'rgba(0, 0, 0, 0.18)',
  svgOpacity: 0.15,
  reach: 8,
} as const);

/** Maior lado da dobra do canto inferior direito. */
const MAX_FOLD_SIZE = 24;

/** Quanto a dobra é mais escura que o fundo: 12%. */
const FOLD_DARKENING = 0.12;

const TEXT_DARK = '#1f2937';
const TEXT_LIGHT = '#ffffff';

/** Menor tamanho que o ajuste automático devolve quando nenhum da lista cabe. */
const SMALLEST_FONT_SIZE = FONT_SIZE_PRESETS[0];

const HEX_COLOR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/;

function channels(color: string): readonly [number, number, number] | null {
  const match = HEX_COLOR.exec(color);
  if (match === null) return null;
  const rgb = match[1]!;
  return [
    parseInt(rgb.slice(0, 2), 16),
    parseInt(rgb.slice(2, 4), 16),
    parseInt(rgb.slice(4, 6), 16),
  ];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa sRGB (WCAG 2.1) de `#rrggbb` ou `#rrggbbaa`, ignorando o alfa. */
function relativeLuminance(color: string): number {
  const rgb = channels(color);
  if (rgb === null) return 0;
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/**
 * Cor do texto com maior contraste WCAG sobre `fill`: escura (`#1f2937`) ou branca. Em empate, a
 * escura. Sem cor de fundo ou com uma cor que não é hexadecimal, a escura.
 */
export function stickyTextColor(fill: string | null): string {
  if (fill === null || channels(fill) === null) return TEXT_DARK;
  const luminance = relativeLuminance(fill);
  const dark = (luminance + 0.05) / (relativeLuminance(TEXT_DARK) + 0.05);
  const light = (relativeLuminance(TEXT_LIGHT) + 0.05) / (luminance + 0.05);
  return light > dark ? TEXT_LIGHT : TEXT_DARK;
}

/** Cor da dobra: o fundo 12% mais escuro, em `#rrggbb`. Cor inválida fica como está. */
export function stickyFoldColor(fill: string): string {
  const rgb = channels(fill);
  if (rgb === null) return fill;
  return `#${rgb
    .map((channel) =>
      Math.round(channel * (1 - FOLD_DARKENING))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Lado da dobra do canto inferior direito: 24, ou um quarto do menor lado da nota. */
export function stickyFoldSize(box: { readonly width: number; readonly height: number }): number {
  return Math.min(MAX_FOLD_SIZE, box.width / 4, box.height / 4);
}

/** O que o ajuste automático lê da nota. */
export interface StickyFitInput {
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly fontFamily: string;
  readonly fontWeight: FontWeight;
  readonly lineHeight: number;
}

/**
 * Maior tamanho de `FONT_SIZE_PRESETS` em que o texto cabe na área útil da nota (largura e altura
 * menos a margem dos dois lados): a quebra das linhas cabe na altura e nenhuma linha passa da
 * largura, como acontece com uma palavra comprida demais. Se nenhum cabe, o menor da lista.
 */
export function fitStickyFontSize(note: StickyFitInput): number {
  const availableWidth = note.width - 2 * STICKY_PADDING;
  const availableHeight = note.height - 2 * STICKY_PADDING;
  if (availableWidth <= 0 || availableHeight <= 0) return SMALLEST_FONT_SIZE;

  for (let index = FONT_SIZE_PRESETS.length - 1; index >= 0; index -= 1) {
    const fontSize = FONT_SIZE_PRESETS[index]!;
    const options = {
      fontSize,
      fontFamily: note.fontFamily,
      fontWeight: note.fontWeight,
      lineHeight: note.lineHeight,
    };
    const layout = layoutText(note.text, { ...options, maxWidth: availableWidth });
    if (layout.height > availableHeight) continue;
    const widest = Math.max(...layout.lines.map((line) => layoutText(line, options).width));
    if (widest <= availableWidth) return fontSize;
  }
  return SMALLEST_FONT_SIZE;
}
