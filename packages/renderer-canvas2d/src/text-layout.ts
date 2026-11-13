import type { FontWeight, TextAlign } from '@canvash/core';
import { CanvasTextMetricsAdapter, formatFontString, getCachedTextWidth } from './text-metrics.js';

export interface FormattedLine {
  readonly text: string;
  readonly width: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface TextLayoutOptions {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight?: FontWeight | undefined;
  readonly textAlign?: TextAlign | undefined;
  readonly lineHeight?: number | undefined;
  readonly maxWidth?: number | undefined;
}

export interface TextLayoutResult {
  readonly lines: readonly FormattedLine[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly lineHeightPx: number;
}

/**
 * Calcula o layout visual completo de um bloco de texto: quebra de linhas, dimensões
 * e offsets horizontais e verticais de acordo com o alinhamento.
 */
export function computeTextLayout(
  text: string,
  options: TextLayoutOptions,
  context?: CanvasRenderingContext2D,
): TextLayoutResult {
  const fontSize = options.fontSize > 0 ? options.fontSize : 16;
  const fontFamily = options.fontFamily.trim() !== '' ? options.fontFamily : 'sans-serif';
  const fontWeight = options.fontWeight ?? 'normal';
  const textAlign = options.textAlign ?? 'left';
  const font = formatFontString(fontSize, fontFamily, fontWeight);

  const lineHeightPx =
    options.lineHeight && options.lineHeight > 0
      ? options.lineHeight > 3
        ? options.lineHeight
        : fontSize * options.lineHeight
      : fontSize * 1.25;

  const adapter = new CanvasTextMetricsAdapter(context);
  const metrics = adapter.measureText(text, {
    fontSize,
    fontFamily,
    fontWeight,
    lineHeight: options.lineHeight,
    maxWidth: options.maxWidth,
  });

  const maxWidth = options.maxWidth && options.maxWidth > 0 ? options.maxWidth : metrics.width;
  const formattedLines: FormattedLine[] = [];

  for (let i = 0; i < metrics.lines.length; i++) {
    const lineText = metrics.lines[i]!;
    const lineWidth = getCachedTextWidth(lineText, font, context);
    const offsetY = i * lineHeightPx;

    let offsetX = 0;
    if (textAlign === 'center') {
      offsetX = Math.max(0, (maxWidth - lineWidth) / 2);
    } else if (textAlign === 'right') {
      offsetX = Math.max(0, maxWidth - lineWidth);
    }

    formattedLines.push({
      text: lineText,
      width: lineWidth,
      offsetX,
      offsetY,
    });
  }

  return {
    lines: formattedLines,
    totalWidth: metrics.width,
    totalHeight: metrics.height,
    lineHeightPx,
  };
}
