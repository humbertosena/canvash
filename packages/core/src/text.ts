/**
 * Suporte a nós e métricas de texto simples em @canvash/core (Tarefa 41 - INPUT-06).
 */

export type TextAlign = 'left' | 'center' | 'right';

/**
 * Como o tamanho da fonte reage ao redimensionamento. `auto`: a fonte acompanha a escala da
 * caixa. `fixed`: redimensionar só muda a largura de quebra e a fonte fica.
 */
export type FontSizeMode = 'auto' | 'fixed';

/** Tamanhos oferecidos pelo painel; a API aceita qualquer valor positivo. */
export const FONT_SIZE_PRESETS = Object.freeze([
  12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 120,
] as const);
export type FontWeight = 'normal' | 'bold' | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface TextMetrics {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
}

export interface TextMetricsOptions {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight?: FontWeight | undefined;
  readonly lineHeight?: number | undefined;
  readonly maxWidth?: number | undefined;
}

/**
 * Adaptador injetável para medição e quebra de texto.
 * Permite usar CanvasRenderingContext2D no navegador e fallback determinístico no Node.
 */
export interface TextMetricsAdapter {
  measureText(text: string, options: TextMetricsOptions): TextMetrics;
}

/** Expressão regular para detecção estrita de tags HTML (texto simples, sem HTML). */
const HTML_TAG_REGEX = /<(?:\/[a-zA-Z]|[a-zA-Z])[a-zA-Z0-9:-]*(?:\s+[^>]*)?\/?>/;

export function containsHtmlTags(text: string): boolean {
  return HTML_TAG_REGEX.test(text);
}

/**
 * Adaptador padrão determinístico para Node.js / headless.
 * Não depende de Canvas nem de DOM; usa aproximação monospaçada estável.
 */
export const defaultTextMetricsAdapter: TextMetricsAdapter = {
  measureText(text: string, options: TextMetricsOptions): TextMetrics {
    const fontSize = options.fontSize > 0 ? options.fontSize : 16;
    const lineHeight =
      options.lineHeight && options.lineHeight > 0
        ? options.lineHeight > 3
          ? options.lineHeight
          : fontSize * options.lineHeight
        : fontSize * 1.25;

    const approxCharWidth = fontSize * 0.6;
    const maxWidth = options.maxWidth;

    const rawLines = text.split('\n');
    const lines: string[] = [];

    for (const rawLine of rawLines) {
      if (!maxWidth || maxWidth <= 0 || rawLine.length * approxCharWidth <= maxWidth) {
        lines.push(rawLine);
        continue;
      }

      // Quebra de linha por palavras (word-wrap)
      const words = rawLine.split(' ');
      let currentLine = '';

      for (const word of words) {
        const candidate = currentLine === '' ? word : `${currentLine} ${word}`;
        if (candidate.length * approxCharWidth > maxWidth && currentLine !== '') {
          lines.push(currentLine);
          currentLine = word;
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
      const lineWidth = line.length * approxCharWidth;
      if (lineWidth > maxLineWidth) {
        maxLineWidth = lineWidth;
      }
    }

    const finalWidth = maxWidth !== undefined && maxWidth > 0 ? maxWidth : maxLineWidth;
    const finalHeight = effectiveLines.length * lineHeight;

    return {
      width: Math.max(1, finalWidth),
      height: Math.max(1, finalHeight),
      lines: effectiveLines,
    };
  },
};

/**
 * Formata e divide um texto em linhas com base no adaptador de métricas fornecido ou padrão.
 */
export function layoutText(
  text: string,
  options: TextMetricsOptions,
  adapter: TextMetricsAdapter = defaultTextMetricsAdapter,
): TextMetrics {
  return adapter.measureText(text, options);
}
