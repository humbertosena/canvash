import type { BoxGeometry } from './geometry/fit.js';
import type { OutlineShapeNode } from './geometry/outline.js';
import { SHAPE_LABEL_PADDING, type ShapeLabel } from './shape-label.js';
import { stickyTextColor } from './sticky.js';

/** Retângulo da área do texto no referencial da caixa (antes da rotação), já sem a margem. */
export interface LabelArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * O mínimo que a área e a cor leem, no padrão de `OutlineShapeNode`. Os nós do core e os
 * `Renderable*` do renderer (sem `visible`, `locked` nem `metadata`) o satisfazem sem cast.
 */
export type LabelLayoutShape = (
  | OutlineShapeNode
  | (BoxGeometry & { readonly type: 'rectangle' | 'square' | 'ellipse' | 'circle' })
) & {
  readonly style: {
    readonly fill: string | null;
    readonly stroke: string | null;
    readonly strokeWidth: number;
    readonly opacity: number;
  };
  readonly label?: ShapeLabel | undefined;
};

/** A cor escura do texto sobre fundo claro ou sem fundo (a mesma da nota). */
const TEXT_DARK = '#1f2937';

/** Abaixo deste alfa efetivo o preenchimento não conta como fundo do texto. */
const MIN_FILL_ALPHA = 0.5;

/** O retângulo da área antes da margem, por forma. */
function rawArea(shape: LabelLayoutShape): LabelArea {
  const { x, y, width, height } = shape;
  const cx = x + width / 2;
  const cy = y + height / 2;
  switch (shape.type) {
    case 'rectangle':
    case 'square':
      return { x, y, width, height };
    case 'ellipse':
    case 'circle': {
      // O retângulo de maior área inscrito numa elipse tem os lados em w/√2 e h/√2.
      const w = width / Math.SQRT2;
      const h = height / Math.SQRT2;
      return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    }
    case 'diamond':
      return { x: cx - width / 4, y: cy - height / 4, width: width / 2, height: height / 2 };
    case 'triangle':
      // A faixa útil é a metade inferior, apoiada na base, para qualquer posição do ápice.
      return {
        x: x + (shape.apex * width) / 2,
        y: y + height / 2,
        width: width / 2,
        height: height / 2,
      };
    case 'polygon': {
      // O quadrado inscrito no círculo inscrito (apótema); a caixa já é 1:1.
      const apothem = (width / 2) * Math.cos(Math.PI / shape.sides);
      const side = Math.SQRT2 * apothem;
      return { x: cx - side / 2, y: cy - side / 2, width: side, height: side };
    }
    case 'cross': {
      const thickness = shape.armRatio * Math.min(width, height);
      return { x, y: cy - thickness / 2, width, height: thickness };
    }
    case 'chevron': {
      const horizontal = shape.direction === 'right' || shape.direction === 'left';
      if (horizontal) {
        const depth = shape.notchDepth * width;
        return { x: x + depth, y, width: width - 2 * depth, height };
      }
      const depth = shape.notchDepth * height;
      return { x, y: y + depth, width, height: height - 2 * depth };
    }
  }
}

/**
 * Área inscrita da forma onde o texto é quebrado e recortado, no referencial da caixa. Cada lado
 * perde `SHAPE_LABEL_PADDING` mais meia espessura do contorno, quando ele é visível. Devolve `null`
 * se a largura ou a altura não passa de 0.
 */
export function shapeLabelArea(shape: LabelLayoutShape): LabelArea | null {
  const { stroke, strokeWidth } = shape.style;
  const padding = SHAPE_LABEL_PADDING + (stroke !== null && strokeWidth > 0 ? strokeWidth / 2 : 0);
  const raw = rawArea(shape);
  const width = raw.width - 2 * padding;
  const height = raw.height - 2 * padding;
  if (!(width > 0) || !(height > 0)) return null;
  return { x: raw.x + padding, y: raw.y + padding, width, height };
}

/** O alfa de `#rrggbbaa`, de 0 a 1; `1` para `#rrggbb` e para o que não é hexadecimal. */
function fillAlpha(fill: string): number {
  const match = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(fill);
  return match === null ? 1 : parseInt(match[1]!, 16) / 255;
}

/**
 * Cor efetiva do texto: `label.color` quando dada; senão a de maior contraste sobre `style.fill`.
 * O alfa efetivo é o do preenchimento vezes `style.opacity`; abaixo de 0,5 a forma conta como sem
 * preenchimento, e o texto fica com a cor escura.
 */
export function shapeLabelColor(shape: LabelLayoutShape): string {
  const given = shape.label?.color;
  if (given !== undefined && given !== null) return given;
  const { fill, opacity } = shape.style;
  if (fill === null || fillAlpha(fill) * opacity < MIN_FILL_ALPHA) return TEXT_DARK;
  return stickyTextColor(fill);
}
