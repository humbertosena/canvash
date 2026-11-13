import {
  SHAPE_LABEL_LINE_HEIGHT,
  shapeLabelArea,
  shapeLabelColor,
  type LabelArea,
} from '@canvash/core';
import type {
  RenderableChevron,
  RenderableCircle,
  RenderableCross,
  RenderableDiamond,
  RenderableEllipse,
  RenderablePolygon,
  RenderableRectangle,
  RenderableSquare,
  RenderableTriangle,
} from './scene.js';
import { computeTextLayout, type TextLayoutResult } from './text-layout.js';
import { formatFontString } from './text-metrics.js';

/** As nove formas do renderer que podem levar texto. */
export type LabeledRenderable =
  | RenderableRectangle
  | RenderableSquare
  | RenderableEllipse
  | RenderableCircle
  | RenderableDiamond
  | RenderableTriangle
  | RenderablePolygon
  | RenderableCross
  | RenderableChevron;

/** Uma linha já posicionada, com a origem no centro da caixa da forma (antes da rotação). */
export interface ShapeLabelLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

/** O texto da forma pronto para pintar: linhas, área de recorte, fonte e cor. */
export interface ShapeLabelLayout {
  /** Centro da caixa da forma, em mundo: a origem das coordenadas abaixo. */
  readonly center: { readonly x: number; readonly y: number };
  /** Retângulo de recorte, relativo ao centro. */
  readonly area: LabelArea;
  readonly font: string;
  readonly color: string;
  readonly lines: readonly ShapeLabelLine[];
}

/** Layouts que cabem no cache; a cena de benchmark com texto tem 5.000 formas com texto. */
const LABEL_LAYOUT_CACHE_LIMIT = 10000;

/**
 * O cache é por valor, não por identidade: a prévia dos gestos materializa um `label` novo a
 * cada quadro, e cada update remoto refaz o documento inteiro. A chave é o que muda a quebra
 * das linhas; a posição vertical e a cor entram depois, sem refazer a quebra.
 */
const layoutCache = new Map<string, TextLayoutResult>();
let layoutCount = 0;

/** Quantas quebras de texto foram calculadas (uma por valor novo): o contador dos testes. */
export function shapeLabelLayoutCount(): number {
  return layoutCount;
}

/** Esvazia o cache de layout e zera o contador. */
export function clearShapeLabelCache(): void {
  layoutCache.clear();
  layoutCount = 0;
}

function wrappedLines(
  item: LabeledRenderable,
  width: number,
  context: CanvasRenderingContext2D | undefined,
): TextLayoutResult {
  const label = item.label!;
  const key = [
    label.text,
    label.fontSize,
    label.fontFamily,
    label.fontWeight,
    label.textAlign,
    width,
  ].join('\u0000');
  const known = layoutCache.get(key);
  if (known !== undefined) return known;

  const result = computeTextLayout(
    label.text,
    {
      fontSize: label.fontSize,
      fontFamily: label.fontFamily,
      fontWeight: label.fontWeight,
      textAlign: label.textAlign,
      lineHeight: SHAPE_LABEL_LINE_HEIGHT,
      maxWidth: width,
    },
    context,
  );
  layoutCount += 1;
  if (layoutCache.size >= LABEL_LAYOUT_CACHE_LIMIT) {
    // Despeja a metade mais antiga, como o cache de medidas.
    const half = Math.floor(layoutCache.size / 2);
    let removed = 0;
    for (const oldest of layoutCache.keys()) {
      if (removed >= half) break;
      layoutCache.delete(oldest);
      removed += 1;
    }
  }
  layoutCache.set(key, result);
  return result;
}

/**
 * Posiciona o texto da forma: quebra na largura da área inscrita e desloca o bloco na vertical
 * pelo `verticalAlign`. Com excesso vertical, o bloco começa no topo da área. Devolve `null`
 * quando não há texto ou a área se anula.
 */
export function layoutShapeLabel(
  item: LabeledRenderable,
  context?: CanvasRenderingContext2D,
): ShapeLabelLayout | null {
  const label = item.label;
  if (label === undefined || label.text === '') return null;
  const area = shapeLabelArea(item);
  if (area === null) return null;

  const wrapped = wrappedLines(item, area.width, context);
  const block = wrapped.lines.length * wrapped.lineHeightPx;
  const free = area.height - block;
  const shift =
    label.verticalAlign === 'top' ? 0 : label.verticalAlign === 'middle' ? free / 2 : free;
  const top = Math.max(0, shift);

  const center = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
  const relative: LabelArea = {
    x: area.x - center.x,
    y: area.y - center.y,
    width: area.width,
    height: area.height,
  };
  return {
    center,
    area: relative,
    font: formatFontString(label.fontSize, label.fontFamily, label.fontWeight),
    color: shapeLabelColor(item),
    lines: wrapped.lines.map((line) => ({
      text: line.text,
      x: relative.x + line.offsetX,
      y: relative.y + top + line.offsetY,
    })),
  };
}

/**
 * Pinta o texto da forma no referencial dela: translada até o centro da caixa, gira pelo ângulo da
 * forma (uma vez só), recorta no retângulo da área e escreve as linhas com a opacidade da forma.
 */
export function paintShapeLabel(context: CanvasRenderingContext2D, item: LabeledRenderable): void {
  const layout = layoutShapeLabel(item, context);
  if (layout === null) return;

  context.save();
  context.translate(layout.center.x, layout.center.y);
  if (item.rotation !== 0) context.rotate(item.rotation);
  context.beginPath();
  context.rect(layout.area.x, layout.area.y, layout.area.width, layout.area.height);
  context.clip();
  context.globalAlpha = item.style.opacity;
  context.font = layout.font;
  context.textBaseline = 'top';
  context.fillStyle = layout.color;
  for (const line of layout.lines) context.fillText(line.text, line.x, line.y);
  context.restore();
}
