import { layoutText, rotatePoint, type Point, type TextNode } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import {
  buildResizePatch,
  buildResizePreview,
  resizeShape,
  type ResizeHandleId,
} from './resize.js';
import { scaleShapeUniform } from './resize-multiple.js';
import { toPreviewShape } from '../transform.js';

const TEXT = 'Uma frase comprida o bastante para quebrar em várias linhas dentro da caixa';

function textNode(extra: Partial<TextNode> = {}): TextNode {
  const base: TextNode = {
    id: 'tx',
    type: 'text',
    x: 100,
    y: 100,
    width: 200,
    height: 0,
    rotation: 0,
    text: TEXT,
    fontSize: 20,
    fontSizeMode: 'fixed',
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    textAlign: 'left',
    lineHeight: 1.25,
    visible: true,
    locked: false,
    style: { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 },
  };
  const node = { ...base, ...extra };
  return { ...node, height: extra.height ?? heightFor(node, node.width) };
}

function heightFor(node: TextNode, width: number): number {
  return layoutText(node.text, {
    fontSize: node.fontSize,
    fontFamily: node.fontFamily,
    fontWeight: node.fontWeight,
    lineHeight: node.lineHeight,
    maxWidth: width,
  }).height;
}

/** Canto superior esquerdo e superior direito da caixa, em mundo. */
function topCorners(node: TextNode): { left: Point; right: Point } {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  return {
    left: rotatePoint({ x: node.x, y: node.y }, center, node.rotation),
    right: rotatePoint({ x: node.x + node.width, y: node.y }, center, node.rotation),
  };
}

const HANDLES: ResizeHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

describe('redimensionar texto com tamanho fixo', () => {
  for (const rotation of [0, Math.PI / 4]) {
    describe(`com rotação ${rotation}`, () => {
      const node = textNode({ rotation });
      // O arrasto vai 60 unidades para a direita e 40 para baixo no referencial da caixa.
      const toWorld = (local: Point): Point =>
        rotatePoint(
          { x: node.x + node.width / 2 + local.x, y: node.y + node.height / 2 + local.y },
          {
            x: node.x + node.width / 2,
            y: node.y + node.height / 2,
          },
          rotation,
        );

      it('as alças norte e sul não têm efeito', () => {
        for (const handle of ['n', 's'] as const) {
          expect(resizeShape(node, handle, toWorld({ x: 80, y: 80 }))).toBe(node);
        }
      });

      it('as alças de canto e laterais mudam só a largura e a quebra; a fonte fica', () => {
        for (const handle of ['nw', 'ne', 'se', 'sw', 'e', 'w'] as const) {
          const grows = handle === 'ne' || handle === 'se' || handle === 'e';
          const point = toWorld({ x: grows ? node.width / 2 + 60 : -node.width / 2 - 60, y: 40 });
          const resized = resizeShape(node, handle, point) as TextNode;

          expect(resized.fontSize).toBe(20);
          expect(resized.fontSizeMode).toBe('fixed');
          expect(resized.width).toBeCloseTo(node.width + 60, 6);
          expect(resized.height).toBeCloseTo(heightFor(node, resized.width), 6);
          expect(resized.rotation).toBe(rotation);
        }
      });

      it('a borda oposta ao arrasto fica no lugar', () => {
        const before = topCorners(node);
        const east = resizeShape(
          node,
          'se',
          toWorld({ x: node.width / 2 + 60, y: 40 }),
        ) as TextNode;
        expect(topCorners(east).left.x).toBeCloseTo(before.left.x, 6);
        expect(topCorners(east).left.y).toBeCloseTo(before.left.y, 6);

        const west = resizeShape(
          node,
          'nw',
          toWorld({ x: -node.width / 2 - 60, y: -40 }),
        ) as TextNode;
        expect(topCorners(west).right.x).toBeCloseTo(before.right.x, 6);
        expect(topCorners(west).right.y).toBeCloseTo(before.right.y, 6);
      });
    });
  }

  it('encolher até quase zero mantém a largura mínima de 1 e a fonte', () => {
    const node = textNode();
    const resized = resizeShape(node, 'se', { x: node.x - 500, y: node.y + 50 }) as TextNode;
    expect(resized.width).toBe(1);
    expect(resized.fontSize).toBe(20);
  });
});

describe('redimensionar texto automático (comportamento existente)', () => {
  const node = textNode({ fontSizeMode: 'auto' });

  it('o canto escala caixa e fonte', () => {
    const resized = resizeShape(node, 'se', {
      x: node.x + node.width * 2,
      y: node.y + node.height * 2,
    }) as TextNode;
    expect(resized.fontSize).toBeCloseTo(40, 6);
    expect(resized.width).toBeCloseTo(node.width * 2, 6);
  });

  it('a alça lateral só refaz a quebra e as verticais não fazem nada', () => {
    const resized = resizeShape(node, 'e', { x: node.x + 300, y: node.y }) as TextNode;
    expect(resized.fontSize).toBe(20);
    expect(resized.width).toBeCloseTo(300, 6);
    expect(resizeShape(node, 's', { x: node.x, y: node.y + 90 })).toBe(node);
  });
});

describe('seleção múltipla com texto', () => {
  const anchor = { x: 0, y: 0 };

  it('texto fixo escala só a largura, recalcula a altura e preserva a fonte', () => {
    const node = textNode({ x: 100, y: 50 });
    const scaled = scaleShapeUniform(node, anchor, 2) as TextNode;
    expect(scaled.fontSize).toBe(20);
    expect(scaled.width).toBeCloseTo(400, 6);
    expect(scaled.height).toBeCloseTo(heightFor(node, 400), 6);
    // O centro escala em torno da âncora.
    expect(scaled.x + scaled.width / 2).toBeCloseTo((node.x + node.width / 2) * 2, 6);
    expect(scaled.fontSizeMode).toBe('fixed');
  });

  it('texto automático escala caixa e fonte, como antes', () => {
    const node = textNode({ fontSizeMode: 'auto' });
    const scaled = scaleShapeUniform(node, anchor, 2) as TextNode;
    expect(scaled.fontSize).toBe(40);
    expect(scaled.width).toBeCloseTo(400, 6);
    expect(scaled.height).toBeCloseTo(node.height * 2, 6);
  });

  it('em grupo, cada texto segue o próprio modo', () => {
    const fixed = textNode({ id: 'f', fontSize: 24 });
    const auto = textNode({ id: 'a', fontSize: 24, fontSizeMode: 'auto' });
    const [first, second] = [fixed, auto].map((node) =>
      scaleShapeUniform(node, anchor, 1.5),
    ) as TextNode[];
    expect(first!.fontSize).toBe(24);
    expect(second!.fontSize).toBe(36);
  });
});

describe('patch e preview do texto redimensionado', () => {
  it('o patch leva a caixa e o tamanho, e o preview leva o modo', () => {
    const node = textNode({ fontSize: 28 });
    const resized = resizeShape(node, 'e', { x: node.x + 320, y: node.y }) as TextNode;
    expect(buildResizePatch(resized)).toEqual({
      x: resized.x,
      y: resized.y,
      width: resized.width,
      height: resized.height,
      fontSize: 28,
    });
    expect(buildResizePreview(resized)).toMatchObject({
      type: 'text',
      fontSize: 28,
      fontSizeMode: 'fixed',
    });
    expect(toPreviewShape(node)).toMatchObject({ type: 'text', fontSizeMode: 'fixed' });
  });
});

describe('todas as alças em texto fixo mantêm a fonte', () => {
  it('nenhuma das 8 alças altera fontSize', () => {
    const node = textNode({ fontSize: 33 });
    for (const handle of HANDLES) {
      const resized = resizeShape(node, handle, { x: node.x + 350, y: node.y + 90 }) as TextNode;
      expect(resized.fontSize).toBe(33);
    }
  });
});
