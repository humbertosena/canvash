import {
  BOARD_TITLE_BAND,
  BOARD_TITLE_FONT_SIZE,
  STICKY_PADDING,
  STICKY_SHADOW,
  INK_HIGHLIGHTER_ALPHA,
  bracePath,
  inkPathSegments,
  inkStrokeWidth,
  shapeOutline,
  stickyFoldColor,
  stickyFoldSize,
  stickyTextColor,
  type Result,
} from '@canvash/core';
import {
  computeTextLayout,
  layoutShapeLabel,
  projectScene,
  type LabeledRenderable,
  type RenderableArrow,
  type RenderableBezier,
  type RenderableBoard,
  type RenderableBrace,
  type RenderableChevron,
  type RenderableCircle,
  type RenderableCross,
  type RenderableDiamond,
  type RenderablePolygon,
  type RenderableEllipse,
  type RenderableInk,
  type RenderableItem,
  type RenderableLine,
  type RenderableRectangle,
  type RenderableSquare,
  type RenderableSticky,
  type RenderableText,
  type RenderableTriangle,
} from '@canvash/renderer-canvas2d';
import { resolveExportContext } from './bounds.js';
import { ok, type ExportError } from './errors.js';
import type { ExportSource, ExportSvgOptions } from './types.js';

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const ARROW_HEAD_ANGLE = Math.PI / 6;

/** A largura da borda do board, em unidades do documento (a mesma do pintor do Canvas). */
const BOARD_BORDER_WIDTH = 1;

function renderSvgRectangle(item: RenderableRectangle | RenderableSquare): string {
  const parts: string[] = ['<rect'];
  parts.push(`x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}"`);

  if (item.style.fill !== null) {
    parts.push(`fill="${escapeXml(item.style.fill)}"`);
  } else {
    parts.push('fill="none"');
  }

  if (item.style.stroke !== null && item.style.strokeWidth > 0) {
    parts.push(`stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}"`);
  }

  if (item.style.opacity < 1) {
    parts.push(`opacity="${item.style.opacity}"`);
  }

  if (item.rotation !== 0) {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const deg = (item.rotation * 180) / Math.PI;
    parts.push(`transform="rotate(${deg} ${cx} ${cy})"`);
  }

  parts.push('/>');
  return parts.join(' ');
}

function renderSvgEllipse(item: RenderableEllipse | RenderableCircle): string {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const rx = item.width / 2;
  const ry = item.height / 2;

  const parts: string[] = ['<ellipse'];
  parts.push(`cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"`);

  if (item.style.fill !== null) {
    parts.push(`fill="${escapeXml(item.style.fill)}"`);
  } else {
    parts.push('fill="none"');
  }

  if (item.style.stroke !== null && item.style.strokeWidth > 0) {
    parts.push(`stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}"`);
  }

  if (item.style.opacity < 1) {
    parts.push(`opacity="${item.style.opacity}"`);
  }

  if (item.rotation !== 0) {
    const deg = (item.rotation * 180) / Math.PI;
    parts.push(`transform="rotate(${deg} ${cx} ${cy})"`);
  }

  parts.push('/>');
  return parts.join(' ');
}

function renderSvgPolygonOutline(
  item:
    | RenderableDiamond
    | RenderableTriangle
    | RenderablePolygon
    | RenderableCross
    | RenderableChevron,
): string {
  const vertices = shapeOutline(item);
  const pointsAttr = vertices.map((v) => `${v.x},${v.y}`).join(' ');

  const parts: string[] = ['<polygon'];
  parts.push(`points="${pointsAttr}"`);

  if (item.style.fill !== null) {
    parts.push(`fill="${escapeXml(item.style.fill)}"`);
  } else {
    parts.push('fill="none"');
  }

  if (item.style.stroke !== null && item.style.strokeWidth > 0) {
    parts.push(`stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}"`);
  }

  if (item.style.opacity < 1) {
    parts.push(`opacity="${item.style.opacity}"`);
  }

  if (item.rotation !== 0) {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const deg = (item.rotation * 180) / Math.PI;
    parts.push(`transform="rotate(${deg} ${cx} ${cy})"`);
  }

  parts.push('/>');
  return parts.join(' ');
}

function renderSvgLine(item: RenderableLine): string {
  const parts: string[] = ['<line'];
  parts.push(`x1="${item.start.x}" y1="${item.start.y}" x2="${item.end.x}" y2="${item.end.y}"`);

  if (item.style.stroke !== null && item.style.strokeWidth > 0) {
    parts.push(
      `stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}" stroke-linecap="round"`,
    );
  }

  if (item.style.opacity < 1) {
    parts.push(`opacity="${item.style.opacity}"`);
  }

  parts.push('/>');
  return parts.join(' ');
}

/** Número de coordenada para atributo SVG: só o texto do número, nunca uma string do documento. */
function svgNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function renderSvgBezier(item: RenderableBezier): string {
  const [start, c1, c2, end] = [item.start, item.control1, item.control2, item.end].map(
    (point) => `${svgNumber(point.x)} ${svgNumber(point.y)}`,
  );
  const parts: string[] = ['<path', `d="M ${start} C ${c1}, ${c2}, ${end}"`, 'fill="none"'];

  if (item.style.stroke !== null && item.style.strokeWidth > 0) {
    parts.push(`stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}"`);
  }

  if (item.style.opacity < 1) {
    parts.push(`opacity="${item.style.opacity}"`);
  }

  parts.push('/>');
  return parts.join(' ');
}

function renderSvgBrace(item: RenderableBrace): string {
  const { start, segments } = bracePath(item);
  const point = (p: { x: number; y: number }): string => `${svgNumber(p.x)} ${svgNumber(p.y)}`;
  const commands = [
    `M ${point(start)}`,
    ...segments.map((segment) =>
      segment.kind === 'line'
        ? `L ${point(segment.to)}`
        : `C ${point(segment.control1)}, ${point(segment.control2)}, ${point(segment.to)}`,
    ),
  ];
  const parts: string[] = ['<path', `d="${commands.join(' ')}"`, 'fill="none"'];

  if (item.style.stroke !== null && item.style.strokeWidth > 0) {
    parts.push(`stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}"`);
  }

  if (item.style.opacity < 1) {
    parts.push(`opacity="${item.style.opacity}"`);
  }

  if (item.rotation !== 0) {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const deg = (item.rotation * 180) / Math.PI;
    parts.push(`transform="rotate(${deg} ${cx} ${cy})"`);
  }

  parts.push('/>');
  return parts.join(' ');
}

function renderSvgArrow(item: RenderableArrow): string {
  const parts: string[] = [];
  const strokeColor = item.style.stroke ? escapeXml(item.style.stroke) : 'currentColor';
  const strokeWidth = item.style.strokeWidth;
  const opacityAttr = item.style.opacity < 1 ? ` opacity="${item.style.opacity}"` : '';

  // Eixo da seta
  parts.push(
    `<line x1="${item.start.x}" y1="${item.start.y}" x2="${item.end.x}" y2="${item.end.y}" stroke="${strokeColor}" stroke-width="${strokeWidth}"${opacityAttr} stroke-linecap="round" />`,
  );

  const dx = item.end.x - item.start.x;
  const dy = item.end.y - item.start.y;
  const angle = Math.atan2(dy, dx);

  // Marcador inicial
  if (item.startMarker === 'dot') {
    const radius = Math.max(4, strokeWidth * 1.8);
    parts.push(
      `<circle cx="${item.start.x}" cy="${item.start.y}" r="${radius}" fill="${strokeColor}"${opacityAttr} />`,
    );
  } else if (item.startMarker === 'arrow') {
    const headLength = Math.max(10, strokeWidth * 3.5);
    const oppAngle = angle + Math.PI;
    const leftX = item.start.x - headLength * Math.cos(oppAngle - ARROW_HEAD_ANGLE);
    const leftY = item.start.y - headLength * Math.sin(oppAngle - ARROW_HEAD_ANGLE);
    const rightX = item.start.x - headLength * Math.cos(oppAngle + ARROW_HEAD_ANGLE);
    const rightY = item.start.y - headLength * Math.sin(oppAngle + ARROW_HEAD_ANGLE);
    parts.push(
      `<polygon points="${item.start.x},${item.start.y} ${leftX},${leftY} ${rightX},${rightY}" fill="${strokeColor}"${opacityAttr} />`,
    );
  }

  // Marcador final
  if (item.endMarker === 'dot') {
    const radius = Math.max(4, strokeWidth * 1.8);
    parts.push(
      `<circle cx="${item.end.x}" cy="${item.end.y}" r="${radius}" fill="${strokeColor}"${opacityAttr} />`,
    );
  } else if (item.endMarker === 'arrow') {
    const headLength = Math.max(10, strokeWidth * 3.5);
    const leftX = item.end.x - headLength * Math.cos(angle - ARROW_HEAD_ANGLE);
    const leftY = item.end.y - headLength * Math.sin(angle - ARROW_HEAD_ANGLE);
    const rightX = item.end.x - headLength * Math.cos(angle + ARROW_HEAD_ANGLE);
    const rightY = item.end.y - headLength * Math.sin(angle + ARROW_HEAD_ANGLE);
    parts.push(
      `<polygon points="${item.end.x},${item.end.y} ${leftX},${leftY} ${rightX},${rightY}" fill="${strokeColor}"${opacityAttr} />`,
    );
  }

  return parts.join('\n');
}

function renderSvgText(item: RenderableText): string {
  const layout = computeTextLayout(item.text, {
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    textAlign: item.textAlign,
    lineHeight: item.lineHeight,
    maxWidth: item.width,
  });

  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const halfWidth = item.width / 2;
  const halfHeight = item.height / 2;

  const fontAttr = `font-family="${escapeXml(item.fontFamily)}" font-size="${item.fontSize}" font-weight="${item.fontWeight}"`;
  const fillAttr =
    item.style.fill !== null ? `fill="${escapeXml(item.style.fill)}"` : 'fill="currentColor"';
  const strokeAttr =
    item.style.stroke !== null && item.style.strokeWidth > 0
      ? ` stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}"`
      : '';
  const opacityAttr = item.style.opacity < 1 ? ` opacity="${item.style.opacity}"` : '';

  const transformAttr =
    item.rotation !== 0
      ? ` transform="rotate(${(item.rotation * 180) / Math.PI} ${cx} ${cy})"`
      : '';

  const linesSvg: string[] = [];
  for (const line of layout.lines) {
    const lineX = cx - halfWidth + line.offsetX;
    const lineY = cy - halfHeight + line.offsetY;
    // O texto escapado NUNCA contém tags HTML ou scripts (IO-06)
    linesSvg.push(
      `  <text x="${lineX}" y="${lineY}" ${fontAttr} ${fillAttr}${strokeAttr}${opacityAttr}${transformAttr}>${escapeXml(line.text)}</text>`,
    );
  }

  return linesSvg.join('\n');
}

/** Número com até 3 casas, sem zeros à direita: os caminhos dos traços ficam compactos. */
function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Separa `#rrggbbaa` em cor opaca e alfa: o SVG de qualquer leitor entende `stroke-opacity`. */
function splitColor(color: string): { readonly rgb: string; readonly alpha: number } {
  if (color.length === 9) {
    return { rgb: color.slice(0, 7), alpha: parseInt(color.slice(7), 16) / 255 };
  }
  return { rgb: color, alpha: 1 };
}

/**
 * Traços à mão livre: um `<path>` por traço, com as mesmas curvas quadráticas do Canvas, pontas e
 * juntas redondas e o marca-texto em `stroke-opacity`. O ponto único é um `<circle>`. A rotação
 * do elemento vai em um `<g>`; a opacidade do elemento, no `opacity` desse grupo.
 */
function renderSvgInk(item: RenderableInk): string {
  const lines: string[] = [];
  for (const stroke of item.strokes) {
    const thickness = inkStrokeWidth(stroke.kind, stroke.width);
    const { rgb, alpha } = splitColor(stroke.color);
    const opacity = alpha * (stroke.kind === 'highlighter' ? INK_HIGHLIGHTER_ALPHA : 1);
    const alphaText = opacity < 1 ? formatNumber(opacity) : undefined;
    const points = stroke.points.map((p) => ({
      x: item.x + p.x * item.width,
      y: item.y + p.y * item.height,
    }));
    if (points.length === 1) {
      lines.push(
        `    <circle cx="${formatNumber(points[0]!.x)}" cy="${formatNumber(points[0]!.y)}" r="${formatNumber(thickness / 2)}" fill="${escapeXml(rgb)}"${alphaText === undefined ? '' : ` fill-opacity="${alphaText}"`} />`,
      );
      continue;
    }
    const d = inkPathSegments(points)
      .map((segment) =>
        segment.kind === 'Q'
          ? `Q${formatNumber(segment.cx)} ${formatNumber(segment.cy)} ${formatNumber(segment.x)} ${formatNumber(segment.y)}`
          : `${segment.kind}${formatNumber(segment.x)} ${formatNumber(segment.y)}`,
      )
      .join(' ');
    lines.push(
      `    <path d="${d}" fill="none" stroke="${escapeXml(rgb)}" stroke-width="${formatNumber(thickness)}" stroke-linecap="round" stroke-linejoin="round"${alphaText === undefined ? '' : ` stroke-opacity="${alphaText}"`} />`,
    );
  }
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const transformAttr =
    item.rotation !== 0
      ? ` transform="rotate(${formatNumber((item.rotation * 180) / Math.PI)} ${formatNumber(cx)} ${formatNumber(cy)})"`
      : '';
  const opacityAttr =
    item.style.opacity < 1 ? ` opacity="${formatNumber(item.style.opacity)}"` : '';
  return [`<g${opacityAttr}${transformAttr}>`, ...lines, '  </g>'].join('\n');
}

/** Altura do topo da caixa de um glifo até a linha de base, como fração do corpo da fonte. */
const ASCENT_RATIO = 0.8;

/**
 * Nota adesiva: sombra como retângulo deslocado (sem filtros), corpo com o canto dobrado, dobra
 * mais escura e o texto recortado pela nota por um `<clipPath>` próprio.
 */
function renderSvgSticky(item: RenderableSticky, clipId: string): string {
  const fill = item.style.fill ?? '#fff59d';
  const { x, y, width, height } = item;
  const fold = stickyFoldSize(item);
  const right = x + width;
  const bottom = y + height;
  const layout = computeTextLayout(item.text, {
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    textAlign: item.textAlign,
    lineHeight: item.lineHeight,
    maxWidth: width - 2 * STICKY_PADDING,
  });

  const groupAttrs: string[] = [];
  if (item.style.opacity < 1) groupAttrs.push(`opacity="${item.style.opacity}"`);
  if (item.rotation !== 0) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    groupAttrs.push(`transform="rotate(${(item.rotation * 180) / Math.PI} ${cx} ${cy})"`);
  }

  const bodyPoints = [
    [x, y],
    [right, y],
    [right, bottom - fold],
    [right - fold, bottom],
    [x, bottom],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
  const foldPoints = [
    [right - fold, bottom - fold],
    [right, bottom - fold],
    [right - fold, bottom],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
  const strokeAttr =
    item.style.stroke !== null && item.style.strokeWidth > 0
      ? ` stroke="${escapeXml(item.style.stroke)}" stroke-width="${item.style.strokeWidth}"`
      : '';
  const fontAttr = `font-family="${escapeXml(item.fontFamily)}" font-size="${item.fontSize}" font-weight="${item.fontWeight}"`;
  const textFill = escapeXml(stickyTextColor(fill));

  const lines = layout.lines.map((line) => {
    const lineX = x + STICKY_PADDING + line.offsetX;
    const lineY = y + STICKY_PADDING + line.offsetY + item.fontSize * ASCENT_RATIO;
    // O texto escapado NUNCA contém tags HTML ou scripts (IO-06)
    return `    <text x="${lineX}" y="${lineY}" ${fontAttr} fill="${textFill}" clip-path="url(#${clipId})">${escapeXml(line.text)}</text>`;
  });

  return [
    `<g${groupAttrs.length > 0 ? ` ${groupAttrs.join(' ')}` : ''}>`,
    `    <rect x="${x}" y="${y + STICKY_SHADOW.offsetY}" width="${width}" height="${height}" fill="#000000" opacity="${STICKY_SHADOW.svgOpacity}" />`,
    `    <polygon points="${bodyPoints}" fill="${escapeXml(fill)}"${strokeAttr} />`,
    `    <polygon points="${foldPoints}" fill="${stickyFoldColor(fill)}" />`,
    `    <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" /></clipPath>`,
    ...lines,
    '  </g>',
  ].join('\n');
}

/** Os tipos de `<clipPath>` da exportação: a nota, o texto da forma e o título do board. */
type ClipKind = 'sticky' | 'label' | 'board' | 'board-clip';

/**
 * Texto da forma: um `<g>` depois do elemento dela, com o `<clipPath>` da área inscrita e um
 * `<text>` por linha (o mesmo layout do Canvas, sem contexto). No SVG a opacidade da forma fica
 * no próprio elemento e não alcança o texto, então o `<g>` a leva, e a rotação também. Sem texto,
 * não há nada a acrescentar.
 */
function renderSvgLabel(item: LabeledRenderable, clipId: string): string {
  const layout = layoutShapeLabel(item);
  if (layout === null) return '';
  const { center, area } = layout;
  const label = item.label!;

  const groupAttrs: string[] = [];
  if (item.style.opacity < 1) groupAttrs.push(`opacity="${item.style.opacity}"`);
  if (item.rotation !== 0) {
    groupAttrs.push(
      `transform="rotate(${(item.rotation * 180) / Math.PI} ${center.x} ${center.y})"`,
    );
  }
  const fontAttr = `font-family="${escapeXml(label.fontFamily)}" font-size="${label.fontSize}" font-weight="${label.fontWeight}"`;
  const lines = layout.lines.map((line) => {
    const lineX = formatNumber(center.x + line.x);
    const lineY = formatNumber(center.y + line.y + label.fontSize * ASCENT_RATIO);
    // O texto escapado NUNCA contém tags HTML ou scripts (IO-06)
    return `    <text x="${lineX}" y="${lineY}" ${fontAttr} fill="${escapeXml(layout.color)}" clip-path="url(#${clipId})">${escapeXml(line.text)}</text>`;
  });
  return [
    `<g${groupAttrs.length > 0 ? ` ${groupAttrs.join(' ')}` : ''}>`,
    `    <clipPath id="${clipId}"><rect x="${formatNumber(center.x + area.x)}" y="${formatNumber(center.y + area.y)}" width="${formatNumber(area.width)}" height="${formatNumber(area.height)}" /></clipPath>`,
    ...lines,
    '  </g>',
  ].join('\n');
}

/** A forma tem texto a exportar? */
function carriesLabel(item: RenderableItem): item is LabeledRenderable {
  return 'label' in item && item.label !== undefined && item.label.text !== '';
}

/**
 * Board: o fundo com `fill-opacity`, a borda de 1 unidade num `<rect>` sem preenchimento e o
 * título numa faixa logo acima do canto superior esquerdo, recortado pela largura do board. O
 * título é texto escapado, sem tags (IO-06). Sem título (a exportação só do board), não há `<text>`.
 */
function renderSvgBoard(item: RenderableBoard, nextClipId: () => string): string {
  const box = `x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}"`;
  const parts: string[] = [];
  if (item.fill !== null && item.fillOpacity > 0) {
    const { rgb, alpha } = splitColor(item.fill);
    const opacity = formatNumber(item.fillOpacity * alpha);
    parts.push(
      `<rect ${box} fill="${escapeXml(rgb)}"${opacity === '1' ? '' : ` fill-opacity="${opacity}"`} />`,
    );
  }
  if (item.stroke !== null) {
    parts.push(
      `<rect ${box} fill="none" stroke="${escapeXml(item.stroke)}" stroke-width="${BOARD_BORDER_WIDTH}" />`,
    );
  }
  if (item.title !== undefined && item.title !== '') {
    const clipId = nextClipId();
    const band = item.y - BOARD_TITLE_BAND;
    // O meio da faixa, com a linha de base da fonte abaixo dele (o `middle` do Canvas).
    const baseline = formatNumber(
      band + BOARD_TITLE_BAND / 2 + BOARD_TITLE_FONT_SIZE * (ASCENT_RATIO - 0.5),
    );
    parts.push(
      `<clipPath id="${clipId}"><rect x="${item.x}" y="${band}" width="${item.width}" height="${BOARD_TITLE_BAND}" /></clipPath>`,
      `<text x="${item.x}" y="${baseline}" font-family="sans-serif" font-size="${BOARD_TITLE_FONT_SIZE}" fill="${escapeXml(item.titleColor)}" clip-path="url(#${clipId})">${escapeXml(item.title)}</text>`,
    );
  }
  return parts.join('\n  ');
}

function renderSvgItem(item: RenderableItem, nextClipId: (kind: ClipKind) => string): string {
  if (item.type === 'board') return renderSvgBoard(item, () => nextClipId('board'));
  if (item.style.opacity <= 0) return '';

  if (
    item.type === 'rectangle' ||
    item.type === 'square' ||
    item.type === 'ellipse' ||
    item.type === 'circle' ||
    item.type === 'diamond' ||
    item.type === 'triangle' ||
    item.type === 'polygon' ||
    item.type === 'cross' ||
    item.type === 'chevron'
  ) {
    const shape =
      item.type === 'rectangle' || item.type === 'square'
        ? renderSvgRectangle(item)
        : item.type === 'ellipse' || item.type === 'circle'
          ? renderSvgEllipse(item)
          : renderSvgPolygonOutline(item);
    if (!carriesLabel(item)) return shape;
    const label = renderSvgLabel(item, nextClipId('label'));
    return label === '' ? shape : `${shape}\n  ${label}`;
  }
  if (item.type === 'line') {
    return renderSvgLine(item);
  }
  if (item.type === 'bezier') {
    return renderSvgBezier(item);
  }
  if (item.type === 'brace') {
    return renderSvgBrace(item);
  }
  if (item.type === 'arrow') {
    return renderSvgArrow(item);
  }
  if (item.type === 'text') {
    return renderSvgText(item);
  }
  if (item.type === 'sticky') {
    return renderSvgSticky(item, nextClipId('sticky'));
  }
  if (item.type === 'ink') {
    return renderSvgInk(item);
  }
  return '';
}

/**
 * Exporta um documento ou canvas para uma string SVG standalone e segura (IO-05, IO-06).
 */
export async function exportSvg(
  source: ExportSource,
  options: ExportSvgOptions = {},
): Promise<Result<string, ExportError>> {
  const resolved = resolveExportContext(source, options);
  if (!resolved.ok) return resolved;
  const { document, bounds, candidateIds, boardId, clip } = resolved.value;
  // O escopo de board desenha só o retângulo dele: o título fica de fora da cena.
  const scene = projectScene(document, {
    candidateIds,
    ...(boardId === undefined ? {} : { boardTitles: false }),
  });

  const svgLines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">`,
  ];

  // Fundo opcional
  if (options.background && options.background !== 'transparent') {
    svgLines.push(
      `  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(options.background)}" />`,
    );
  }

  let clipCount = 0;
  // Um contador só: a nota e o texto da forma dividem a numeração, então os ids não se repetem.
  const nextClipId = (kind: ClipKind): string => `canvash-${kind}-${(clipCount += 1)}`;
  if (boardId === undefined || clip === undefined) {
    for (const item of scene.items) {
      const rendered = renderSvgItem(item, nextClipId);
      if (rendered) {
        svgLines.push(`  ${rendered}`);
      }
    }
  } else {
    // O item do board sai sem recorte; os filhos, dentro de um <g> recortado no retângulo dele.
    const children: string[] = [];
    let boardMarkup = '';
    const boardClipId = (): string => nextClipId('board-clip');
    for (const item of scene.items) {
      if (item.id === boardId) boardMarkup = renderSvgItem(item, nextClipId);
    }
    if (boardMarkup) svgLines.push(`  ${boardMarkup}`);
    const ownClip = scene.items.some((item) => item.id !== boardId) ? boardClipId() : undefined;
    for (const item of scene.items) {
      if (item.id === boardId) continue;
      const rendered = renderSvgItem(item, nextClipId);
      if (rendered) children.push(`    ${rendered}`);
    }
    if (ownClip !== undefined && children.length > 0) {
      svgLines.push(
        `  <clipPath id="${ownClip}"><rect x="${clip.x}" y="${clip.y}" width="${clip.width}" height="${clip.height}" /></clipPath>`,
        `  <g clip-path="url(#${ownClip})">`,
        ...children,
        '  </g>',
      );
    }
  }

  svgLines.push('</svg>');
  return ok(svgLines.join('\n'));
}
