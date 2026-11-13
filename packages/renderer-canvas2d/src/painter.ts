import {
  BOARD_TITLE_BAND,
  BOARD_TITLE_FONT_SIZE,
  STICKY_PADDING,
  STICKY_SHADOW,
  bracePath,
  inkPathSegments,
  inkStrokeAlpha,
  inkStrokeWidth,
  shapeOutline,
  stickyFoldColor,
  stickyFoldSize,
  stickyTextColor,
} from '@canvash/core';
import { paintArrow } from './arrow.js';
import type {
  RenderableBezier,
  RenderableBoard,
  RenderableBrace,
  ProjectedScene,
  RenderableChevron,
  RenderableCircle,
  RenderableCross,
  RenderableDiamond,
  RenderablePolygon,
  RenderableEllipse,
  RenderableInk,
  RenderableItem,
  RenderableLine,
  RenderableRectangle,
  RenderableSquare,
  RenderableSticky,
  RenderableText,
  RenderableTriangle,
} from './scene.js';
import { paintShapeLabel, type LabeledRenderable } from './shape-label.js';
import { computeTextLayout } from './text-layout.js';
import { formatFontString } from './text-metrics.js';

function paintRectangle(
  context: CanvasRenderingContext2D,
  item: RenderableRectangle | RenderableSquare,
  hasFill: boolean,
  hasStroke: boolean,
): void {
  if (item.rotation === 0) {
    if (hasFill && item.style.fill !== null) {
      context.fillStyle = item.style.fill;
      context.fillRect(item.x, item.y, item.width, item.height);
    }
    if (hasStroke && item.style.stroke !== null) {
      context.strokeStyle = item.style.stroke;
      context.lineWidth = item.style.strokeWidth;
      context.strokeRect(item.x, item.y, item.width, item.height);
    }
  } else {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    context.translate(cx, cy);
    context.rotate(item.rotation);
    const halfWidth = item.width / 2;
    const halfHeight = item.height / 2;
    if (hasFill && item.style.fill !== null) {
      context.fillStyle = item.style.fill;
      context.fillRect(-halfWidth, -halfHeight, item.width, item.height);
    }
    if (hasStroke && item.style.stroke !== null) {
      context.strokeStyle = item.style.stroke;
      context.lineWidth = item.style.strokeWidth;
      context.strokeRect(-halfWidth, -halfHeight, item.width, item.height);
    }
  }
}

function paintEllipse(
  context: CanvasRenderingContext2D,
  item: RenderableEllipse | RenderableCircle,
  hasFill: boolean,
  hasStroke: boolean,
): void {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const radiusX = item.width / 2;
  const radiusY = item.height / 2;

  context.beginPath();
  context.ellipse(cx, cy, radiusX, radiusY, item.rotation, 0, Math.PI * 2);

  if (hasFill && item.style.fill !== null) {
    context.fillStyle = item.style.fill;
    context.fill();
  }
  if (hasStroke && item.style.stroke !== null) {
    context.strokeStyle = item.style.stroke;
    context.lineWidth = item.style.strokeWidth;
    context.stroke();
  }
}

function paintPolygonOutline(
  context: CanvasRenderingContext2D,
  item:
    | RenderableDiamond
    | RenderableTriangle
    | RenderablePolygon
    | RenderableCross
    | RenderableChevron,
  hasFill: boolean,
  hasStroke: boolean,
): void {
  const vertices = shapeOutline(item);
  if (vertices.length < 3) return;

  if (item.rotation !== 0) {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    context.translate(cx, cy);
    context.rotate(item.rotation);
    context.translate(-cx, -cy);
  }

  context.beginPath();
  context.moveTo(vertices[0]!.x, vertices[0]!.y);
  for (let i = 1; i < vertices.length; i++) {
    context.lineTo(vertices[i]!.x, vertices[i]!.y);
  }
  context.closePath();

  if (hasFill && item.style.fill !== null) {
    context.fillStyle = item.style.fill;
    context.fill();
  }
  if (hasStroke && item.style.stroke !== null) {
    context.strokeStyle = item.style.stroke;
    context.lineWidth = item.style.strokeWidth;
    context.stroke();
  }
}

function paintBrace(context: CanvasRenderingContext2D, item: RenderableBrace): void {
  const { start, segments } = bracePath(item);

  if (item.rotation !== 0) {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    context.translate(cx, cy);
    context.rotate(item.rotation);
    context.translate(-cx, -cy);
  }

  context.beginPath();
  context.moveTo(start.x, start.y);
  for (const segment of segments) {
    if (segment.kind === 'line') {
      context.lineTo(segment.to.x, segment.to.y);
    } else {
      context.bezierCurveTo(
        segment.control1.x,
        segment.control1.y,
        segment.control2.x,
        segment.control2.y,
        segment.to.x,
        segment.to.y,
      );
    }
  }
  // paintItem só chega aqui com traço visível: a chave não tem preenchimento.
  context.strokeStyle = item.style.stroke!;
  context.lineWidth = item.style.strokeWidth;
  context.stroke();
}

/**
 * Nota adesiva: sombra e corpo com o canto inferior direito dobrado, a dobra mais escura e o
 * texto na cor de maior contraste, recortado pela nota. O resultado não depende do tamanho da
 * fonte medido pelo core: se o texto passar do espaço, o recorte cobre o excesso.
 */
/**
 * Traços à mão livre: cada traço é uma curva suave pelos pontos médios dos segmentos, com pontas
 * e juntas redondas; o ponto único é um círculo. O marca-texto pinta com 0,4 de opacidade sobre
 * a do elemento. Os pontos locais viram coordenadas da caixa, e a rotação gira em torno do centro.
 */
function paintInk(context: CanvasRenderingContext2D, item: RenderableInk): void {
  const { x, y, width, height } = item;
  if (item.rotation !== 0) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    context.translate(cx, cy);
    context.rotate(item.rotation);
    context.translate(-cx, -cy);
  }
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of item.strokes) {
    const thickness = inkStrokeWidth(stroke.kind, stroke.width);
    const points = stroke.points.map((p) => ({ x: x + p.x * width, y: y + p.y * height }));
    context.save();
    context.globalAlpha = item.style.opacity * inkStrokeAlpha(stroke.kind);
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = thickness;
    context.beginPath();
    if (points.length === 1) {
      context.arc(points[0]!.x, points[0]!.y, thickness / 2, 0, 2 * Math.PI);
      context.fill();
    } else {
      for (const segment of inkPathSegments(points)) {
        if (segment.kind === 'M') context.moveTo(segment.x, segment.y);
        else if (segment.kind === 'L') context.lineTo(segment.x, segment.y);
        else context.quadraticCurveTo(segment.cx, segment.cy, segment.x, segment.y);
      }
      context.stroke();
    }
    context.restore();
  }
}

function paintSticky(context: CanvasRenderingContext2D, item: RenderableSticky): void {
  const fill = item.style.fill ?? '#fff59d';
  const { x, y, width, height } = item;
  const fold = stickyFoldSize(item);
  const right = x + width;
  const bottom = y + height;

  if (item.rotation !== 0) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    context.translate(cx, cy);
    context.rotate(item.rotation);
    context.translate(-cx, -cy);
  }

  const traceBody = (): void => {
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(right, y);
    context.lineTo(right, bottom - fold);
    context.lineTo(right - fold, bottom);
    context.lineTo(x, bottom);
    context.closePath();
  };

  context.save();
  context.shadowColor = STICKY_SHADOW.color;
  context.shadowBlur = STICKY_SHADOW.blur;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = STICKY_SHADOW.offsetY;
  traceBody();
  context.fillStyle = fill;
  context.fill();
  context.restore();

  if (item.style.stroke !== null && item.style.strokeWidth > 0) {
    traceBody();
    context.strokeStyle = item.style.stroke;
    context.lineWidth = item.style.strokeWidth;
    context.stroke();
  }

  context.beginPath();
  context.moveTo(right - fold, bottom - fold);
  context.lineTo(right, bottom - fold);
  context.lineTo(right - fold, bottom);
  context.closePath();
  context.fillStyle = stickyFoldColor(fill);
  context.fill();

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  const layout = computeTextLayout(
    item.text,
    {
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight,
      textAlign: item.textAlign,
      lineHeight: item.lineHeight,
      maxWidth: width - 2 * STICKY_PADDING,
    },
    context,
  );
  context.font = formatFontString(item.fontSize, item.fontFamily, item.fontWeight);
  context.textBaseline = 'top';
  context.fillStyle = stickyTextColor(fill);
  for (const line of layout.lines) {
    context.fillText(
      line.text,
      x + STICKY_PADDING + line.offsetX,
      y + STICKY_PADDING + line.offsetY,
    );
  }
  context.restore();
}

function paintLine(context: CanvasRenderingContext2D, item: RenderableLine): void {
  if (item.style.stroke === null || item.style.strokeWidth <= 0) {
    return;
  }
  context.beginPath();
  context.moveTo(item.start.x, item.start.y);
  context.lineTo(item.end.x, item.end.y);
  context.strokeStyle = item.style.stroke;
  context.lineWidth = item.style.strokeWidth;
  context.stroke();
}

function paintBezier(context: CanvasRenderingContext2D, item: RenderableBezier): void {
  context.beginPath();
  context.moveTo(item.start.x, item.start.y);
  context.bezierCurveTo(
    item.control1.x,
    item.control1.y,
    item.control2.x,
    item.control2.y,
    item.end.x,
    item.end.y,
  );
  // paintItem só chega aqui com traço visível: a curva não tem preenchimento.
  context.strokeStyle = item.style.stroke!;
  context.lineWidth = item.style.strokeWidth;
  context.stroke();
}

function paintText(
  context: CanvasRenderingContext2D,
  item: RenderableText,
  hasFill: boolean,
  hasStroke: boolean,
): void {
  const font = formatFontString(item.fontSize, item.fontFamily, item.fontWeight);
  const layout = computeTextLayout(
    item.text,
    {
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight,
      textAlign: item.textAlign,
      lineHeight: item.lineHeight,
      maxWidth: item.width,
    },
    context,
  );

  context.font = font;
  context.textBaseline = 'top';

  if (item.rotation === 0) {
    for (const line of layout.lines) {
      const lineX = item.x + line.offsetX;
      const lineY = item.y + line.offsetY;

      if (hasFill && item.style.fill !== null) {
        context.fillStyle = item.style.fill;
        context.fillText(line.text, lineX, lineY);
      }
      if (hasStroke && item.style.stroke !== null) {
        context.strokeStyle = item.style.stroke;
        context.lineWidth = item.style.strokeWidth;
        context.strokeText(line.text, lineX, lineY);
      }
    }
  } else {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    context.translate(cx, cy);
    context.rotate(item.rotation);
    const halfWidth = item.width / 2;
    const halfHeight = item.height / 2;

    for (const line of layout.lines) {
      const lineX = -halfWidth + line.offsetX;
      const lineY = -halfHeight + line.offsetY;

      if (hasFill && item.style.fill !== null) {
        context.fillStyle = item.style.fill;
        context.fillText(line.text, lineX, lineY);
      }
      if (hasStroke && item.style.stroke !== null) {
        context.strokeStyle = item.style.stroke;
        context.lineWidth = item.style.strokeWidth;
        context.strokeText(line.text, lineX, lineY);
      }
    }
  }
}

/** Largura da borda do board, em unidades do documento. */
const BOARD_BORDER_WIDTH = 1;
const BOARD_TITLE_FAMILY = 'sans-serif';

/**
 * O título que cabe em `width`: inteiro, ou cortado com reticências. `undefined` quando nem as
 * reticências cabem.
 */
function fitBoardTitle(
  context: CanvasRenderingContext2D,
  title: string,
  width: number,
): string | undefined {
  if (context.measureText(title).width <= width) return title;
  const ellipsis = '…';
  if (context.measureText(ellipsis).width > width) return undefined;
  // Maior prefixo que cabe com as reticências, por busca binária sobre o tamanho do prefixo.
  let low = 0;
  let high = title.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(title.slice(0, middle) + ellipsis).width <= width) low = middle;
    else high = middle - 1;
  }
  return title.slice(0, low) + ellipsis;
}

/**
 * Pinta o board: o fundo com a opacidade própria, a borda de 1 unidade e o título na faixa logo
 * acima do canto superior esquerdo. O board não recorta o que vem depois dele.
 */
function paintBoard(context: CanvasRenderingContext2D, item: RenderableBoard): void {
  if (item.fill !== null && item.fillOpacity > 0) {
    context.save();
    if (item.fillOpacity < 1) context.globalAlpha = item.fillOpacity;
    context.fillStyle = item.fill;
    context.fillRect(item.x, item.y, item.width, item.height);
    context.restore();
  }
  if (item.stroke !== null) {
    context.save();
    context.strokeStyle = item.stroke;
    context.lineWidth = BOARD_BORDER_WIDTH;
    context.strokeRect(item.x, item.y, item.width, item.height);
    context.restore();
  }
  if (item.title === undefined || item.title === '') return;
  context.save();
  context.font = formatFontString(BOARD_TITLE_FONT_SIZE, BOARD_TITLE_FAMILY);
  const title = fitBoardTitle(context, item.title, item.width);
  if (title !== undefined) {
    context.fillStyle = item.titleColor;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(title, item.x, item.y - BOARD_TITLE_BAND / 2);
  }
  context.restore();
}

/**
 * Pinta um único item projetado no contexto Canvas 2D.
 * Isola transformações e opacidade via save/restore.
 */
export function paintItem(context: CanvasRenderingContext2D, item: RenderableItem): void {
  if (item.type === 'board') {
    paintBoard(context, item);
    return;
  }
  if (item.style.opacity <= 0) {
    return;
  }

  if (item.type === 'ink') {
    // Sem preenchimento nem contorno do elemento: cor e espessura são de cada traço.
    context.save();
    paintInk(context, item);
    context.restore();
    return;
  }

  const hasFill = item.style.fill !== null;
  const hasStroke = item.style.stroke !== null && item.style.strokeWidth > 0;

  if (!hasFill && !hasStroke) {
    // Sem forma a pintar, o texto da forma ainda aparece.
    if (carriesLabel(item)) paintShapeLabel(context, item);
    return;
  }

  context.save();
  if (item.style.opacity < 1) {
    context.globalAlpha = item.style.opacity;
  }

  if (item.type === 'rectangle' || item.type === 'square') {
    paintRectangle(context, item, hasFill, hasStroke);
  } else if (item.type === 'ellipse' || item.type === 'circle') {
    paintEllipse(context, item, hasFill, hasStroke);
  } else if (
    item.type === 'diamond' ||
    item.type === 'triangle' ||
    item.type === 'polygon' ||
    item.type === 'cross' ||
    item.type === 'chevron'
  ) {
    paintPolygonOutline(context, item, hasFill, hasStroke);
  } else if (item.type === 'brace') {
    paintBrace(context, item);
  } else if (item.type === 'line') {
    paintLine(context, item);
  } else if (item.type === 'bezier') {
    paintBezier(context, item);
  } else if (item.type === 'arrow') {
    paintArrow(context, item);
  } else if (item.type === 'sticky') {
    paintSticky(context, item);
  } else if (item.type === 'text') {
    paintText(context, item, hasFill, hasStroke);
  }

  context.restore();
  // O texto vem depois, no próprio save/restore: a pintura da forma deixa o contexto
  // transladado e girado, e o texto aplica a transformação dele do zero.
  if (carriesLabel(item)) paintShapeLabel(context, item);
}

/** A forma tem texto a pintar? Estreita o item para as nove formas com `label`. */
function carriesLabel(item: RenderableItem): item is LabeledRenderable {
  return 'label' in item && item.label !== undefined && item.label.text !== '';
}

/**
 * Pinta a cena projetada sequencialmente no contexto Canvas 2D.
 * A ordem de pintura preserva estritamente a ordem de items da cena.
 */
export function paintScene(context: CanvasRenderingContext2D, scene: ProjectedScene): void {
  for (const item of scene.items) {
    paintItem(context, item);
  }
}
