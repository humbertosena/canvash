import { describe, expect, it } from 'vitest';
import { stripHtmlTags } from './text-editor.js';

describe('text-editor (unit)', () => {
  describe('stripHtmlTags', () => {
    it('remove tags html preservando conteúdo textual', () => {
      expect(stripHtmlTags('<b>Texto em negrito</b>')).toBe('Texto em negrito');
      expect(stripHtmlTags('<p>Parágrafo <i>itálico</i></p>')).toBe('Parágrafo itálico');
      expect(stripHtmlTags('<div class="x">linha 1</div><br/>linha 2')).toBe('linha 1linha 2');
    });

    it('preserva operadores matemáticos < e > sem formato de tag', () => {
      expect(stripHtmlTags('x < 5 e y > 10')).toBe('x < 5 e y > 10');
      expect(stripHtmlTags('1 < 2 && 3 > 2')).toBe('1 < 2 && 3 > 2');
    });

    it('lida com strings vazias e textos planos normais', () => {
      expect(stripHtmlTags('')).toBe('');
      expect(stripHtmlTags('Texto plano')).toBe('Texto plano');
      expect(stripHtmlTags('Multi\nLinha\nComum')).toBe('Multi\nLinha\nComum');
    });
  });
});
