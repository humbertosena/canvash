import {
  defaultBezierControls,
  POLYGON_PRESETS,
  type Point,
  type PolygonPresetTool,
  type PreviewShape,
  type ShapeInput,
} from '@canvash/core';

export type CreationToolId =
  | 'rectangle'
  | 'square'
  | 'ellipse'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'polygon'
  | PolygonPresetTool
  | 'cross'
  | 'chevron'
  | 'brace'
  | 'line'
  | 'bezier';

export const DEFAULT_MIN_DIMENSION = 2;

const CREATION_TOOLS: ReadonlySet<string> = new Set<CreationToolId>([
  'rectangle',
  'square',
  'ellipse',
  'circle',
  'diamond',
  'triangle',
  'polygon',
  'cross',
  'chevron',
  'brace',
  'line',
  'bezier',
  ...(Object.keys(POLYGON_PRESETS) as PolygonPresetTool[]),
]);

/** Ferramentas de criação por arrasto (todas menos texto e seta, que têm fluxo próprio). */
export function isCreationToolId(tool: string): tool is CreationToolId {
  return CREATION_TOOLS.has(tool);
}

/** Ferramentas que criam um polígono regular com número fixo de lados. */
export function isPolygonPresetTool(tool: string): tool is PolygonPresetTool {
  return Object.hasOwn(POLYGON_PRESETS, tool);
}

/** Lados do polígono criado pela ferramenta; o painel troca depois (US-05.1). */
const DEFAULT_POLYGON_SIDES = 5;

export interface RectangularGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface LineGeometry {
  readonly start: Point;
  readonly end: Point;
  readonly length: number;
}

export type CreatedGeometry =
  | ({
      readonly type:
        | 'rectangle'
        | 'square'
        | 'ellipse'
        | 'circle'
        | 'diamond'
        | 'triangle'
        | 'cross'
        | 'chevron'
        | 'brace';
    } & RectangularGeometry)
  /** `sides` só existe nas predefinições (pentágono, hexágono, octógono); o polígono genérico usa o padrão. */
  | ({ readonly type: 'polygon'; readonly sides?: number } & RectangularGeometry)
  /** A curva Bézier nasce pela regra da linha; os controles vêm do arco padrão (US-06.1). */
  | ({ readonly type: 'line' } & LineGeometry)
  | ({ readonly type: 'bezier' } & LineGeometry);

export interface ComputeCreationOptions {
  readonly tool: CreationToolId;
  readonly startWorld: Point;
  readonly currentWorld: Point;
  readonly shiftKey: boolean;
}

export function computeCreationGeometry(options: ComputeCreationOptions): CreatedGeometry {
  const { tool, startWorld, currentWorld, shiftKey } = options;

  if (tool === 'line' || tool === 'bezier') {
    const dx = currentWorld.x - startWorld.x;
    const dy = currentWorld.y - startWorld.y;

    if (!shiftKey) {
      return {
        type: tool,
        start: { x: startWorld.x, y: startWorld.y },
        end: { x: currentWorld.x, y: currentWorld.y },
        length: Math.hypot(dx, dy),
      };
    }

    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4; // 45 graus
    const snappedAngle = Math.round(angle / step) * step;
    const distance = Math.hypot(dx, dy);

    return {
      type: tool,
      start: { x: startWorld.x, y: startWorld.y },
      end: {
        x: startWorld.x + distance * Math.cos(snappedAngle),
        y: startWorld.y + distance * Math.sin(snappedAngle),
      },
      length: distance,
    };
  }

  const rawWidth = Math.abs(currentWorld.x - startWorld.x);
  const rawHeight = Math.abs(currentWorld.y - startWorld.y);
  const signX = currentWorld.x >= startWorld.x ? 1 : -1;
  const signY = currentWorld.y >= startWorld.y ? 1 : -1;

  const isPreset = isPolygonPresetTool(tool);
  if (shiftKey || isPreset || tool === 'square' || tool === 'circle' || tool === 'polygon') {
    const side = Math.max(rawWidth, rawHeight);
    const x = signX >= 0 ? startWorld.x : startWorld.x - side;
    const y = signY >= 0 ? startWorld.y : startWorld.y - side;

    return {
      ...(isPreset ? { type: 'polygon' as const, sides: POLYGON_PRESETS[tool] } : { type: tool }),
      x,
      y,
      width: side,
      height: side,
      rotation: 0,
    };
  }

  return {
    type: tool as Exclude<CreationToolId, PolygonPresetTool | 'line' | 'bezier'>,
    x: Math.min(startWorld.x, currentWorld.x),
    y: Math.min(startWorld.y, currentWorld.y),
    width: rawWidth,
    height: rawHeight,
    rotation: 0,
  };
}

export function isCreationValid(
  geometry: CreatedGeometry,
  minDimension = DEFAULT_MIN_DIMENSION,
): boolean {
  if (geometry.type === 'line' || geometry.type === 'bezier') {
    return geometry.length >= minDimension;
  }
  return geometry.width >= minDimension && geometry.height >= minDimension;
}

export function buildPreviewShape(
  geometry: CreatedGeometry,
  previewId = '__preview_shape__',
): PreviewShape {
  if (geometry.type === 'bezier') {
    return {
      id: previewId,
      type: 'bezier',
      start: geometry.start,
      ...defaultBezierControls(geometry.start, geometry.end),
      end: geometry.end,
      symmetric: true,
      style: {
        stroke: '#2563eb',
        strokeWidth: 2,
        opacity: 0.8,
      },
    };
  }

  if (geometry.type === 'line') {
    return {
      id: previewId,
      type: 'line',
      start: geometry.start,
      end: geometry.end,
      style: {
        stroke: '#2563eb',
        strokeWidth: 2,
        opacity: 0.8,
      },
    };
  }

  if (geometry.type === 'triangle') {
    return {
      id: previewId,
      type: 'triangle',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
      variant: 'isosceles',
      apex: 0.5,
      style: {
        fill: '#2563eb26',
        stroke: '#2563eb',
        strokeWidth: 2,
        opacity: 0.8,
      },
    };
  }

  if (geometry.type === 'polygon') {
    return {
      id: previewId,
      type: 'polygon',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
      sides: geometry.sides ?? DEFAULT_POLYGON_SIDES,
      style: {
        fill: '#2563eb26',
        stroke: '#2563eb',
        strokeWidth: 2,
        opacity: 0.8,
      },
    };
  }

  if (geometry.type === 'brace') {
    // A chave só tem traço: o preview não leva preenchimento.
    return {
      id: previewId,
      type: 'brace',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
      style: {
        stroke: '#2563eb',
        strokeWidth: 2,
        opacity: 0.8,
      },
    };
  }

  return {
    id: previewId,
    type: geometry.type,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: geometry.rotation,
    style: {
      fill: '#2563eb26',
      stroke: '#2563eb',
      strokeWidth: 2,
      opacity: 0.8,
    },
  };
}

export function buildCreateShapeInput(geometry: CreatedGeometry): ShapeInput {
  if (geometry.type === 'line' || geometry.type === 'bezier') {
    // Na curva, o core deriva os mesmos controles do preview a partir das pontas.
    return {
      type: geometry.type,
      start: geometry.start,
      end: geometry.end,
    };
  }

  if (geometry.type === 'triangle') {
    return {
      type: 'triangle',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
      variant: 'isosceles',
      apex: 0.5,
    };
  }

  if (geometry.type === 'polygon') {
    return {
      type: 'polygon',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
      sides: geometry.sides ?? DEFAULT_POLYGON_SIDES,
    };
  }

  return {
    type: geometry.type,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: geometry.rotation,
  };
}
