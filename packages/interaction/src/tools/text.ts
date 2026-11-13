import type { FontWeight, Point, TextAlign, TextInput, TextNode } from '@canvash/core';

export const DEFAULT_TEXT_FONT_SIZE = 16;
export const DEFAULT_TEXT_FONT_FAMILY = 'sans-serif';
export const DEFAULT_TEXT_FONT_WEIGHT: FontWeight = 'normal';
export const DEFAULT_TEXT_LINE_HEIGHT = 1.25;
export const DEFAULT_TEXT_ALIGN: TextAlign = 'left';
export const DEFAULT_TEXT_WIDTH = 200;
export const DEFAULT_TEXT_COLOR = '#111827';
export const MIN_TEXT_WIDTH = 40;

export interface TextCreationGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

/**
 * Calcula a geometria da caixa de criação de texto com base no ponto inicial e atual.
 * Se a distância horizontal arrastada for menor que 20px, adota a largura padrão de 200px.
 */
export function computeTextCreationGeometry(
  startWorld: Point,
  currentWorld: Point,
): TextCreationGeometry {
  const dx = currentWorld.x - startWorld.x;
  const absDx = Math.abs(dx);

  const width = absDx >= 20 ? Math.max(MIN_TEXT_WIDTH, absDx) : DEFAULT_TEXT_WIDTH;
  const x = absDx >= 20 ? Math.min(startWorld.x, currentWorld.x) : startWorld.x;
  const y = Math.min(startWorld.y, currentWorld.y);

  return {
    x,
    y,
    width,
    height: 24,
    rotation: 0,
  };
}

/**
 * Verifica se um nó do documento é do tipo texto.
 */
export function isTextNode(shape: unknown): shape is TextNode {
  return (
    shape !== null &&
    typeof shape === 'object' &&
    'type' in shape &&
    (shape as { type: unknown }).type === 'text'
  );
}

export interface BuildCreateTextInputOptions {
  readonly id?: string | undefined;
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly text?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly fontFamily?: string | undefined;
  readonly fontWeight?: FontWeight | undefined;
  readonly textAlign?: TextAlign | undefined;
  readonly lineHeight?: number | undefined;
  readonly color?: string | undefined;
}

/**
 * Monta o `TextInput` inicial com valores padrão materializados.
 */
export function buildCreateTextInput(options: BuildCreateTextInputOptions): TextInput {
  return {
    type: 'text',
    x: options.x,
    y: options.y,
    width: options.width && options.width >= MIN_TEXT_WIDTH ? options.width : DEFAULT_TEXT_WIDTH,
    text: options.text ?? '',
    fontSize: options.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
    fontFamily: options.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
    fontWeight: options.fontWeight ?? DEFAULT_TEXT_FONT_WEIGHT,
    textAlign: options.textAlign ?? DEFAULT_TEXT_ALIGN,
    lineHeight: options.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
    style: {
      fill: options.color ?? DEFAULT_TEXT_COLOR,
      stroke: null,
      strokeWidth: 0,
      opacity: 1,
    },
  };
}
