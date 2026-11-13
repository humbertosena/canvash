import { beforeEach, describe, expect, it } from 'vitest';
import { computeTextLayout } from './text-layout.js';
import { clearTextMeasureCache, formatFontString, getCachedTextWidth } from './text-metrics.js';

describe('Text Layout e Text Metrics (Tarefa 42 - RENDER-03)', () => {
  beforeEach(() => {
    clearTextMeasureCache();
  });

  describe('formatFontString', () => {
    it('formata com peso, tamanho e família padrão', () => {
      expect(formatFontString(16, 'sans-serif')).toBe('normal 16px sans-serif');
      expect(formatFontString(24, 'Inter', 'bold')).toBe('bold 24px Inter');
      expect(formatFontString(18, 'Roboto', 600)).toBe('600 18px Roboto');
    });

    it('aplica fallbacks para valores inválidos', () => {
      expect(formatFontString(-5, '')).toBe('normal 16px sans-serif');
    });
  });

  describe('getCachedTextWidth e cache LRU', () => {
    it('retorna a largura e reutiliza cache na chamada seguinte', () => {
      const font = '16px sans-serif';
      const w1 = getCachedTextWidth('Teste de Cache', font);
      expect(w1).toBeGreaterThan(0);

      // Segunda chamada com a mesma chave deve ser idêntica
      const w2 = getCachedTextWidth('Teste de Cache', font);
      expect(w2).toBe(w1);
    });

    it('limpa o cache com clearTextMeasureCache', () => {
      const font = '16px sans-serif';
      getCachedTextWidth('Palavra', font);
      clearTextMeasureCache();
      const w = getCachedTextWidth('Palavra', font);
      expect(w).toBeGreaterThan(0);
    });
  });

  describe('computeTextLayout', () => {
    it('calcula linha única com alinhamento à esquerda (left)', () => {
      const result = computeTextLayout('Texto de Teste', {
        fontSize: 16,
        fontFamily: 'sans-serif',
        textAlign: 'left',
        maxWidth: 300,
      });

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]!.text).toBe('Texto de Teste');
      expect(result.lines[0]!.offsetX).toBe(0);
      expect(result.lines[0]!.offsetY).toBe(0);
      expect(result.totalWidth).toBe(300);
      expect(result.totalHeight).toBe(result.lineHeightPx);
    });

    it('calcula offset horizontal para alinhamento centralizado (center)', () => {
      const maxWidth = 400;
      const result = computeTextLayout('Centro', {
        fontSize: 16,
        fontFamily: 'sans-serif',
        textAlign: 'center',
        maxWidth,
      });

      expect(result.lines).toHaveLength(1);
      const line = result.lines[0]!;
      expect(line.offsetX).toBeCloseTo((maxWidth - line.width) / 2);
    });

    it('calcula offset horizontal para alinhamento à direita (right)', () => {
      const maxWidth = 400;
      const result = computeTextLayout('Direita', {
        fontSize: 16,
        fontFamily: 'sans-serif',
        textAlign: 'right',
        maxWidth,
      });

      expect(result.lines).toHaveLength(1);
      const line = result.lines[0]!;
      expect(line.offsetX).toBeCloseTo(maxWidth - line.width);
    });

    it('divide parágrafos multilinha por quebra explícita de linha', () => {
      const result = computeTextLayout('Linha 1\nLinha 2\nLinha 3', {
        fontSize: 20,
        fontFamily: 'sans-serif',
        lineHeight: 1.5,
      });

      expect(result.lines).toHaveLength(3);
      expect(result.lines[0]!.text).toBe('Linha 1');
      expect(result.lines[1]!.text).toBe('Linha 2');
      expect(result.lines[2]!.text).toBe('Linha 3');
      expect(result.lines[0]!.offsetY).toBe(0);
      expect(result.lines[1]!.offsetY).toBe(20 * 1.5);
      expect(result.lines[2]!.offsetY).toBe(2 * (20 * 1.5));
    });

    it('quebra palavras automaticamente ao exceder maxWidth (word wrapping)', () => {
      const longSentence =
        'O rápido coelho marrom salta sobre o cão preguiçoso no jardim ensolarado';
      const result = computeTextLayout(longSentence, {
        fontSize: 16,
        fontFamily: 'sans-serif',
        maxWidth: 150,
      });

      expect(result.lines.length).toBeGreaterThan(1);
      // Cada linha individual deve respeitar o limite ou quebrar
      for (const line of result.lines) {
        expect(line.text.length).toBeGreaterThan(0);
      }
    });

    it('quebra palavras muito longas caractere a caractere para não vazar a caixa', () => {
      const veryLongWord = 'pneumoultramicroscopicossilicovulcanoconiotico';
      const result = computeTextLayout(veryLongWord, {
        fontSize: 16,
        fontFamily: 'sans-serif',
        maxWidth: 100,
      });

      expect(result.lines.length).toBeGreaterThan(1);
      const reconstructed = result.lines.map((l) => l.text).join('');
      expect(reconstructed).toBe(veryLongWord);
    });
  });
});
