import type {
  FontWeight,
  TextMetrics,
  TextMetricsAdapter,
  TextMetricsOptions,
} from '@canvash/core';

/** Limite máximo de entradas no cache de medição para evitar vazamento de memória. */
const MEASURE_CACHE_LIMIT = 5000;
const measureCache = new Map<string, number>();

/**
 * Formata a string de fonte CSS padrão a partir dos parâmetros de estilo.
 */
export function formatFontString(
  fontSize: number,
  fontFamily: string,
  fontWeight: FontWeight = 'normal',
): string {
  const size = fontSize > 0 ? fontSize : 16;
  const family = fontFamily.trim() !== '' ? fontFamily : 'sans-serif';
  return `${fontWeight} ${size}px ${family}`;
}

/**
 * Mede a largura de uma string de texto usando cache LRU eficiente para manter
 * o orçamento de renderização de ≤ 16.7 ms por frame.
 */
export function getCachedTextWidth(
  text: string,
  font: string,
  context?: CanvasRenderingContext2D,
): number {
  const key = `${font}:${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let width: number;
  if (context && typeof context.measureText === 'function') {
    context.font = font;
    width = context.measureText(text).width;
  } else {
    // Fallback monospaçado determinístico para ambientes headless / Node sem Canvas
    const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
    const fontSize = fontSizeMatch ? parseFloat(fontSizeMatch[1]!) : 16;
    width = text.length * fontSize * 0.6;
  }

  if (measureCache.size >= MEASURE_CACHE_LIMIT) {
    const keys = Array.from(measureCache.keys());
    const half = Math.floor(keys.length / 2);
    for (let i = 0; i < half; i++) {
      const k = keys[i];
      if (k !== undefined) {
        measureCache.delete(k);
      }
    }
  }

  measureCache.set(key, width);
  return width;
}

/**
 * Limpa o cache de medição de texto.
 */
export function clearTextMeasureCache(): void {
  measureCache.clear();
}

/**
 * Adaptador de métricas de texto baseado em Canvas 2D com cache.
 */
export class CanvasTextMetricsAdapter implements TextMetricsAdapter {
  private readonly context?: CanvasRenderingContext2D | undefined;

  constructor(context?: CanvasRenderingContext2D) {
    this.context = context;
  }

  measureText(text: string, options: TextMetricsOptions): TextMetrics {
    const fontSize = options.fontSize > 0 ? options.fontSize : 16;
    const font = formatFontString(fontSize, options.fontFamily, options.fontWeight ?? 'normal');
    const lineHeightPx =
      options.lineHeight && options.lineHeight > 0
        ? options.lineHeight > 3
          ? options.lineHeight
          : fontSize * options.lineHeight
        : fontSize * 1.25;

    const maxWidth = options.maxWidth;
    const rawLines = text.split('\n');
    const lines: string[] = [];

    for (const rawLine of rawLines) {
      if (!maxWidth || maxWidth <= 0) {
        lines.push(rawLine);
        continue;
      }

      const fullWidth = getCachedTextWidth(rawLine, font, this.context);
      if (fullWidth <= maxWidth) {
        lines.push(rawLine);
        continue;
      }

      // Word wrapping
      const words = rawLine.split(' ');
      let currentLine = '';

      for (const word of words) {
        const candidate = currentLine === '' ? word : `${currentLine} ${word}`;
        const candidateWidth = getCachedTextWidth(candidate, font, this.context);

        if (candidateWidth > maxWidth && currentLine !== '') {
          lines.push(currentLine);
          // Se a própria palavra isolada for maior que maxWidth, quebra por caracteres
          if (getCachedTextWidth(word, font, this.context) > maxWidth) {
            let chunk = '';
            for (const char of word) {
              const testChunk = chunk + char;
              if (getCachedTextWidth(testChunk, font, this.context) > maxWidth && chunk !== '') {
                lines.push(chunk);
                chunk = char;
              } else {
                chunk = testChunk;
              }
            }
            currentLine = chunk;
          } else {
            currentLine = word;
          }
        } else if (candidateWidth > maxWidth && currentLine === '') {
          // Palavra única longa demais na linha
          let chunk = '';
          for (const char of word) {
            const testChunk = chunk + char;
            if (getCachedTextWidth(testChunk, font, this.context) > maxWidth && chunk !== '') {
              lines.push(chunk);
              chunk = char;
            } else {
              chunk = testChunk;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = candidate;
        }
      }

      if (currentLine !== '') {
        lines.push(currentLine);
      }
    }

    const effectiveLines = lines.length > 0 ? lines : [''];
    let maxLineWidth = 0;
    for (const line of effectiveLines) {
      const lineWidth = getCachedTextWidth(line, font, this.context);
      if (lineWidth > maxLineWidth) {
        maxLineWidth = lineWidth;
      }
    }

    const finalWidth = maxWidth !== undefined && maxWidth > 0 ? maxWidth : maxLineWidth;
    const finalHeight = effectiveLines.length * lineHeightPx;

    return {
      width: Math.max(1, finalWidth),
      height: Math.max(1, finalHeight),
      lines: effectiveLines,
    };
  }
}
