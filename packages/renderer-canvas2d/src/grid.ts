import type { Viewport } from '@canvash/core';

/** Aparência do grid: pontos nas interseções ou linhas contínuas. */
export type GridStyle = 'dots' | 'lines';

/** Posição do ponteiro em CSS px relativos ao canvas (tela, não mundo). */
export interface GridPointer {
  readonly x: number;
  readonly y: number;
}

/** Realce dos pontos do grid em volta do ponteiro. */
export interface GridHighlightOptions {
  /** Raio de influência em CSS px, constante em qualquer zoom. Padrão: 120. */
  readonly radius?: number | undefined;
  /** Cor do ponto sob o cursor. Padrão: '#8b8f99'. */
  readonly color?: string | undefined;
}

/** Configuração da camada visual de grid. */
export interface GridOptions {
  /** Habilita ou desabilita a exibição do grid. Padrão: true. */
  readonly enabled?: boolean | undefined;
  /** Aparência do grid. Padrão: 'dots'. */
  readonly style?: GridStyle | undefined;
  /** Tamanho base da célula do grid em unidades de mundo. Padrão: 20. */
  readonly size?: number | undefined;
  /** Cor do grid. Padrão: '#c9cbd1' nos pontos e '#e2e8f0' nas linhas. */
  readonly color?: string | undefined;
  /** Espessura da linha em CSS px; só vale em 'lines'. Padrão: 1. */
  readonly lineWidth?: number | undefined;
  /** Raio do ponto em CSS px, constante em qualquer zoom; só vale em 'dots'. Padrão: 1. */
  readonly dotRadius?: number | undefined;
  /** Distância mínima em pixels de tela entre linhas consecutivas. Padrão: 16. */
  readonly minScreenStep?: number | undefined;
  /** Distância máxima em pixels de tela entre linhas consecutivas. Padrão: 100. */
  readonly maxScreenStep?: number | undefined;
  /** Só em dots: realce sob o ponteiro. Padrão: ligado; `false` desliga. */
  readonly highlight?: boolean | GridHighlightOptions | undefined;
}

export interface AdaptiveStepParams {
  readonly baseSize: number;
  readonly zoom: number;
  readonly minScreenStep?: number | undefined;
  readonly maxScreenStep?: number | undefined;
}

/**
 * Calcula o espaçamento adaptativo do grid em unidades de mundo.
 * Evita o acúmulo de linhas subpixel em zoom reduzido (ex: zoom 0.05)
 * e lacunas vazias em zoom elevado (ex: zoom 16), mantendo a distância
 * visual entre linhas dentro de limites ergonômicos na tela.
 */
export function calculateAdaptiveGridStep(params: AdaptiveStepParams): number {
  const baseSize = params.baseSize > 0 && Number.isFinite(params.baseSize) ? params.baseSize : 20;
  const zoom = params.zoom > 0 && Number.isFinite(params.zoom) ? params.zoom : 1;
  const minStep = params.minScreenStep ?? 16;
  const maxStep = params.maxScreenStep ?? 100;

  let step = baseSize;
  let screenStep = step * zoom;

  if (screenStep < minStep) {
    while (screenStep < minStep) {
      step *= 2;
      screenStep = step * zoom;
    }
  } else if (screenStep > maxStep) {
    while (screenStep > maxStep && step / 2 >= 1) {
      step /= 2;
      screenStep = step * zoom;
    }
  }

  return step;
}

export interface PaintGridParams {
  readonly viewport: Viewport;
  readonly width: number;
  readonly height: number;
  readonly options?: GridOptions | undefined;
  /** Posição do ponteiro em CSS px relativos ao canvas; ausente ou null não realça. */
  readonly pointer?: GridPointer | null | undefined;
}

/** Área visível e passo do grid, em coordenadas de tela e de mundo. */
interface GridArea {
  readonly zoom: number;
  readonly step: number;
  readonly panX: number;
  readonly panY: number;
  readonly width: number;
  readonly height: number;
  readonly worldRight: number;
  readonly worldBottom: number;
  readonly firstX: number;
  readonly firstY: number;
}

const DEFAULT_DOT_COLOR = '#c9cbd1';
const DEFAULT_LINE_COLOR = '#e2e8f0';
const DEFAULT_DOT_RADIUS = 1;
const DEFAULT_HIGHLIGHT_RADIUS = 120;
const DEFAULT_HIGHLIGHT_COLOR = '#8b8f99';
/** Níveis de cor entre a base e o centro: cada nível é um path e um `fill`. */
const HIGHLIGHT_LEVELS = 8;

/** Intensidade do realce: 1 sob o cursor, 0 na borda do raio, com queda suave. */
export function highlightIntensity(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const u = distance / radius;
  return (1 - u * u) ** 2;
}

/**
 * Pinta o grid em coordenadas de mundo na camada visual de fundo.
 *
 * Características:
 * - Alinhado estritamente à origem do mundo (0, 0), garantindo estabilidade no pan e zoom;
 * - Espaçamento adaptativo para prevenir moiré ou excesso de pontos e linhas subpixel;
 * - Desenhado em um único path de Canvas 2D sem alocação de canvas extras;
 * - Fora dos pontos (ou das linhas) a camada continua transparente: o fundo é do host.
 */
export function paintGrid(context: CanvasRenderingContext2D, params: PaintGridParams): void {
  const opts = params.options;
  if (opts?.enabled === false) {
    return;
  }

  if (params.width <= 0 || params.height <= 0) {
    return;
  }

  const zoom = params.viewport.zoom;
  if (zoom <= 0 || !Number.isFinite(zoom)) {
    return;
  }

  const baseSize = opts?.size ?? 20;
  const minStep = opts?.minScreenStep ?? 16;
  const maxStep = opts?.maxScreenStep ?? 100;
  const step = calculateAdaptiveGridStep({
    baseSize,
    zoom,
    minScreenStep: minStep,
    maxScreenStep: maxStep,
  });

  const panX = params.viewport.x;
  const panY = params.viewport.y;

  // Limites visíveis em coordenadas de mundo
  const worldLeft = -panX / zoom;
  const worldTop = -panY / zoom;

  const area: GridArea = {
    zoom,
    step,
    panX,
    panY,
    width: params.width,
    height: params.height,
    worldRight: (params.width - panX) / zoom,
    worldBottom: (params.height - panY) / zoom,
    // Primeira linha ou ponto alinhado a múltiplos exatos de step
    firstX: Math.floor(worldLeft / step) * step,
    firstY: Math.floor(worldTop / step) * step,
  };

  if ((opts?.style ?? 'dots') === 'lines') {
    paintLines(context, area, opts);
  } else {
    paintDots(context, area, opts, params.pointer);
  }
}

function paintLines(
  context: CanvasRenderingContext2D,
  area: GridArea,
  opts: GridOptions | undefined,
): void {
  const { zoom, step, panX, panY } = area;
  const color = opts?.color ?? DEFAULT_LINE_COLOR;
  const lineWidth = opts?.lineWidth ?? 1;

  if (
    typeof context.beginPath !== 'function' ||
    typeof context.stroke !== 'function' ||
    typeof context.moveTo !== 'function' ||
    typeof context.lineTo !== 'function'
  ) {
    return;
  }

  if (typeof context.save === 'function') {
    context.save();
  }
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;

  // Linhas verticais
  for (let x = area.firstX; x <= area.worldRight + step * 0.5; x += step) {
    const screenX = x * zoom + panX;
    context.moveTo(screenX, 0);
    context.lineTo(screenX, area.height);
  }

  // Linhas horizontais
  for (let y = area.firstY; y <= area.worldBottom + step * 0.5; y += step) {
    const screenY = y * zoom + panY;
    context.moveTo(0, screenY);
    context.lineTo(area.width, screenY);
  }

  context.stroke();
  if (typeof context.restore === 'function') {
    context.restore();
  }
}

/**
 * Pontos quadrados de lado `2 * dotRadius` em CSS px, centrados na interseção e arredondados ao
 * pixel inteiro: nítidos em DPR 1 e do mesmo tamanho em qualquer zoom. Só o espaçamento escala.
 */
function paintDots(
  context: CanvasRenderingContext2D,
  area: GridArea,
  opts: GridOptions | undefined,
  pointer: GridPointer | null | undefined,
): void {
  const { zoom, step, panX, panY } = area;
  const color = opts?.color ?? DEFAULT_DOT_COLOR;
  const radius =
    opts?.dotRadius !== undefined && opts.dotRadius > 0 && Number.isFinite(opts.dotRadius)
      ? opts.dotRadius
      : DEFAULT_DOT_RADIUS;
  const side = radius * 2;

  if (
    typeof context.beginPath !== 'function' ||
    typeof context.rect !== 'function' ||
    typeof context.fill !== 'function'
  ) {
    return;
  }

  if (typeof context.save === 'function') {
    context.save();
  }
  context.beginPath();
  context.fillStyle = color;

  for (let y = area.firstY; y <= area.worldBottom + step * 0.5; y += step) {
    const centerY = Math.round(y * zoom + panY);
    for (let x = area.firstX; x <= area.worldRight + step * 0.5; x += step) {
      const centerX = Math.round(x * zoom + panX);
      context.rect(centerX - radius, centerY - radius, side, side);
    }
  }

  context.fill();

  const highlight = resolveHighlight(opts?.highlight, color);
  if (highlight && pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
    paintDotHighlight(context, area, { radius, side }, highlight, pointer);
  }

  if (typeof context.restore === 'function') {
    context.restore();
  }
}

interface ResolvedHighlight {
  readonly radius: number;
  /** Cor de cada nível de 1 a `HIGHLIGHT_LEVELS`; `null` quando o nível não é pintado. */
  readonly levelColors: readonly (string | null)[];
}

type Rgb = readonly [number, number, number];

function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const digits = match[1]!;
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Cores dos níveis do realce. Com as duas cores em hexadecimal, interpola em RGB da base ao
 * centro; senão não há degradê e o centro só aparece da metade da intensidade em diante.
 */
function resolveHighlight(
  option: boolean | GridHighlightOptions | undefined,
  baseColor: string,
): ResolvedHighlight | null {
  if (option === false) return null;
  const custom = typeof option === 'object' ? option : undefined;
  const radius =
    custom?.radius !== undefined && custom.radius > 0 && Number.isFinite(custom.radius)
      ? custom.radius
      : DEFAULT_HIGHLIGHT_RADIUS;
  const centerColor = custom?.color ?? DEFAULT_HIGHLIGHT_COLOR;
  const base = parseHex(baseColor);
  const center = parseHex(centerColor);

  const levelColors: (string | null)[] = [null];
  for (let level = 1; level <= HIGHLIGHT_LEVELS; level += 1) {
    const t = level / HIGHLIGHT_LEVELS;
    if (base && center) {
      levelColors.push(
        toHex([
          base[0] + (center[0] - base[0]) * t,
          base[1] + (center[1] - base[1]) * t,
          base[2] + (center[2] - base[2]) * t,
        ]),
      );
    } else {
      levelColors.push(t >= 0.5 ? centerColor : null);
    }
  }
  return { radius, levelColors };
}

/**
 * Segunda passada: redesenha, com o mesmo retângulo arredondado ao pixel da passada base, os
 * pontos a menos de `radius` do ponteiro, um path e um `fill` por nível de intensidade.
 */
function paintDotHighlight(
  context: CanvasRenderingContext2D,
  area: GridArea,
  dot: { readonly radius: number; readonly side: number },
  highlight: ResolvedHighlight,
  pointer: GridPointer,
): void {
  const { zoom, step, panX, panY } = area;
  const buckets: [number, number][][] = Array.from({ length: HIGHLIGHT_LEVELS + 1 }, () => []);

  for (let y = area.firstY; y <= area.worldBottom + step * 0.5; y += step) {
    const centerY = Math.round(y * zoom + panY);
    if (Math.abs(centerY - pointer.y) >= highlight.radius) continue;
    for (let x = area.firstX; x <= area.worldRight + step * 0.5; x += step) {
      const centerX = Math.round(x * zoom + panX);
      const level = Math.round(
        highlightIntensity(Math.hypot(centerX - pointer.x, centerY - pointer.y), highlight.radius) *
          HIGHLIGHT_LEVELS,
      );
      if (level > 0) buckets[level]!.push([centerX, centerY]);
    }
  }

  // Níveis de mesma cor (sem degradê) entram no mesmo path e no mesmo `fill`.
  const byColor = new Map<string, [number, number][]>();
  for (let level = 1; level <= HIGHLIGHT_LEVELS; level += 1) {
    const color = highlight.levelColors[level];
    if (!color || buckets[level]!.length === 0) continue;
    const dots = byColor.get(color);
    if (dots) dots.push(...buckets[level]!);
    else byColor.set(color, [...buckets[level]!]);
  }

  for (const [color, dots] of byColor) {
    context.beginPath();
    context.fillStyle = color;
    for (const [x, y] of dots) {
      context.rect(x - dot.radius, y - dot.radius, dot.side, dot.side);
    }
    context.fill();
  }
}
