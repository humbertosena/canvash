import {
  DEFAULT_STICKY_SIZE,
  STICKY_COLORS,
  fitStickyFontSize,
  type Point,
  type PreviewShape,
  type StickyNode,
} from '@canvash/core';

/** Cor da nota nascida de uma ferramenta que nunca recebeu outra. */
export const DEFAULT_STICKY_COLOR: string = STICKY_COLORS.yellow;

const STICKY_FONT_FAMILY = 'sans-serif';
const STICKY_LINE_HEIGHT = 1.25;

const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Aceita cores `#rrggbb` ou `#rrggbbaa`, em qualquer caixa. */
export function isStickyColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

export interface StickyBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Caixa da nota criada pelo gesto. Um clique, ou um arrasto menor que `minDrag` em algum eixo,
 * põe a nota de tamanho padrão com o canto superior esquerdo no ponto; um arrasto maior usa a
 * caixa do gesto, em qualquer direção.
 */
export function computeStickyCreation(start: Point, end: Point, minDrag: number): StickyBox {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < minDrag || height < minDrag) {
    return { x: start.x, y: start.y, width: DEFAULT_STICKY_SIZE, height: DEFAULT_STICKY_SIZE };
  }
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
}

/** Nota provisória, ainda fora do documento, para a sessão de edição que a cria. */
export function buildProvisionalSticky(box: StickyBox, color: string, id: string): StickyNode {
  const base = {
    text: '',
    width: box.width,
    height: box.height,
    fontFamily: STICKY_FONT_FAMILY,
    fontWeight: 'normal' as const,
    lineHeight: STICKY_LINE_HEIGHT,
  };
  return {
    id,
    type: 'sticky',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    text: '',
    fontSize: fitStickyFontSize(base),
    fontSizeMode: 'auto',
    fontFamily: base.fontFamily,
    fontWeight: base.fontWeight,
    textAlign: 'left',
    lineHeight: base.lineHeight,
    visible: true,
    locked: false,
    style: { fill: color, stroke: null, strokeWidth: 0, opacity: 1 },
  };
}

/** Preview da caixa da nota durante o arrasto de criação. */
export function buildStickyPreview(box: StickyBox, color: string, id: string): PreviewShape {
  return {
    id,
    type: 'sticky',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    style: { fill: color, opacity: 0.85 },
  };
}

/** Diz se o nó é uma nota adesiva. */
export function isStickyNode(shape: unknown): shape is StickyNode {
  return (
    shape !== null &&
    typeof shape === 'object' &&
    'type' in shape &&
    (shape as { type: unknown }).type === 'sticky'
  );
}
