import { describe, expect, it } from 'vitest';
import {
  buildCreateTextInput,
  computeTextCreationGeometry,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_WIDTH,
  isTextNode,
  MIN_TEXT_WIDTH,
} from './text.js';

describe('tools/text', () => {
  describe('computeTextCreationGeometry', () => {
    it('usa DEFAULT_TEXT_WIDTH em clique simples ou arrasto curto (< 20px)', () => {
      const geoClick = computeTextCreationGeometry({ x: 100, y: 150 }, { x: 105, y: 152 });
      expect(geoClick.width).toBe(DEFAULT_TEXT_WIDTH);
      expect(geoClick.x).toBe(100);
      expect(geoClick.y).toBe(150);

      const geoZero = computeTextCreationGeometry({ x: 50, y: 50 }, { x: 50, y: 50 });
      expect(geoZero.width).toBe(DEFAULT_TEXT_WIDTH);
      expect(geoZero.x).toBe(50);
      expect(geoZero.y).toBe(50);
    });

    it('calcula largura correta em arrasto para a direita (>= 20px)', () => {
      const geo = computeTextCreationGeometry({ x: 100, y: 150 }, { x: 250, y: 220 });
      expect(geo.width).toBe(150);
      expect(geo.x).toBe(100);
      expect(geo.y).toBe(150);
    });

    it('inverte coordenadas corretamente em arrasto para a esquerda', () => {
      const geo = computeTextCreationGeometry({ x: 300, y: 200 }, { x: 120, y: 100 });
      expect(geo.width).toBe(180);
      expect(geo.x).toBe(120);
      expect(geo.y).toBe(100);
    });

    it('respeita MIN_TEXT_WIDTH em arrasto de borda', () => {
      const geo = computeTextCreationGeometry({ x: 100, y: 100 }, { x: 125, y: 100 });
      expect(geo.width).toBe(MIN_TEXT_WIDTH);
    });
  });

  describe('isTextNode', () => {
    it('identifica nós de texto corretamente', () => {
      expect(isTextNode({ type: 'text', id: '1' })).toBe(true);
      expect(isTextNode({ type: 'rectangle', id: '1' })).toBe(false);
      expect(isTextNode(null)).toBe(false);
      expect(isTextNode(undefined)).toBe(false);
      expect(isTextNode('text')).toBe(false);
    });
  });

  describe('buildCreateTextInput', () => {
    it('materializa defaults válidos', () => {
      const input = buildCreateTextInput({ x: 50, y: 80 });
      expect(input.type).toBe('text');
      expect(input.x).toBe(50);
      expect(input.y).toBe(80);
      expect(input.width).toBe(DEFAULT_TEXT_WIDTH);
      expect(input.fontSize).toBe(DEFAULT_TEXT_FONT_SIZE);
      expect(input.fontFamily).toBe('sans-serif');
      expect(input.textAlign).toBe('left');
      expect(input.style?.fill).toBe('#111827');
    });

    it('aceita customizações parciais', () => {
      const input = buildCreateTextInput({
        x: 10,
        y: 20,
        width: 320,
        fontSize: 24,
        fontFamily: 'monospace',
        textAlign: 'center',
        color: '#ff0000',
        text: 'Olá mundo',
      });
      expect(input.width).toBe(320);
      expect(input.fontSize).toBe(24);
      expect(input.fontFamily).toBe('monospace');
      expect(input.textAlign).toBe('center');
      expect(input.style?.fill).toBe('#ff0000');
      expect(input.text).toBe('Olá mundo');
    });
  });
});
