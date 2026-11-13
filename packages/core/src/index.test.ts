import { describe, expect, it } from 'vitest';
import * as core from './index.js';
import type {
  CanvasSectionApi,
  CanvasDocument,
  CanvasSnapshot,
  Clock,
  CreateCanvasSectionOptions,
  IdGenerator,
  Layer,
} from './index.js';

// Tudo o que o pacote exporta em execução. Um export novo entra aqui junto com o teste dele.
const RUNTIME_EXPORTS = [
  'BOARD_TITLE_BAND',
  'BOARD_TITLE_FONT_SIZE',
  'DEFAULT_LIMITS',
  'DEFAULT_PEN_SETTINGS',
  'DEFAULT_SHAPE_LABEL',
  'DEFAULT_STICKY_SIZE',
  'DEFAULT_ZOOM_LIMITS',
  'ERASER_MIN_PIECE_CSS_PX',
  'ERASER_RADII',
  'ERASER_SIZE_NAMES',
  'FONT_SIZE_PRESETS',
  'INK_HIGHLIGHTER_ALPHA',
  'INK_KINDS',
  'INK_LIMITS',
  'INK_WIDTHS',
  'INK_WIDTH_NAMES',
  'MAX_PEERS',
  'MAX_PEER_IDS',
  'MAX_PEER_NAME_LENGTH',
  'PEN_PALETTE',
  'POLYGON_PRESETS',
  'SCHEMA_VERSION',
  'SHAPE_LABEL_LINE_HEIGHT',
  'SHAPE_LABEL_PADDING',
  'STICKY_COLORS',
  'STICKY_PADDING',
  'STICKY_SHADOW',
  'appendInkStroke',
  'bezierBounds',
  'bezierPoint',
  'boardTitleBounds',
  'boundsContain',
  'boundsFromPoints',
  'boundsIntersect',
  'boundsUnion',
  'braceBounds',
  'bracePath',
  'braceRadius',
  'canAppendInkStroke',
  'clampZoom',
  'computeSiblingReorderIndex',
  'containsHtmlTags',
  'createCanvasSection',
  'defaultBezierControls',
  'defaultTextMetricsAdapter',
  'distanceToSegment',
  'eraseFromInk',
  'eraseFromStrokes',
  'eraserRadiusWorld',
  'findGroupOfNode',
  'fitAspect',
  'fitStickyFontSize',
  'fitViewportToBounds',
  'flattenBezier',
  'flattenBrace',
  'inkBounds',
  'inkInputFromStroke',
  'inkPatchFromWorldStrokes',
  'inkPathSegments',
  'inkStrokeAlpha',
  'inkStrokeWidth',
  'inkStrokesToLocal',
  'inkStrokesToWorld',
  'isBindingEndpoint',
  'isBoardNode',
  'isBoxShape',
  'isFreeEndpoint',
  'isGroupNode',
  'isJsonArray',
  'isJsonObject',
  'isLabelable',
  'isZeroLengthArrow',
  'layoutText',
  'mirrorControl',
  'normalizeInkStrokes',
  'pointInShape',
  'resolveAnchorPosition',
  'resolveArrowEndpoints',
  'resolveEndpoint',
  'rotatePoint',
  'screenToWorld',
  'segmentOutsideCapsule',
  'shapeBounds',
  'shapeInsideRect',
  'shapeIntersectsRect',
  'shapeLabelArea',
  'shapeLabelColor',
  'shapeOutline',
  'simplifyPolyline',
  'stickyFoldColor',
  'stickyFoldSize',
  'stickyTextColor',
  'validateDocument',
  'worldToScreen',
  'zoomAt',
];

describe('entrada pública do pacote', () => {
  it('exporta em execução só a API pública', () => {
    expect(Object.keys(core).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it('cria um canvas usando só os nomes exportados', () => {
    const ids = ['doc-1', 'layer-1'];
    const generateId: IdGenerator = () => ids.shift() ?? '';
    const now: Clock = () => 0;
    const options: CreateCanvasSectionOptions = { generateId, now };

    const section: CanvasSectionApi = core.createCanvasSection(options);
    const snapshot: CanvasSnapshot = section.getSnapshot();
    const canvasDocument: CanvasDocument = snapshot.document;
    const layers: readonly Layer[] = canvasDocument.layers;

    expect(canvasDocument.id).toBe('doc-1');
    expect(layers.map((layer) => layer.id)).toEqual(['layer-1']);
  });

  it('expõe a geometria pura, utilizável sem um canvas', () => {
    const viewport = { x: 10, y: 20, zoom: 2 };
    const world = { x: 5, y: 5 };

    const screen = core.worldToScreen(viewport, world);

    expect(screen).toEqual({ x: 20, y: 30 });
    expect(core.screenToWorld(viewport, screen)).toEqual(world);
    expect(core.zoomAt(viewport, screen, 64).zoom).toBe(core.DEFAULT_ZOOM_LIMITS.max);
    expect(core.boundsFromPoints({ x: 4, y: 0 }, { x: 0, y: 3 })).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 3,
    });
    expect(core.fitAspect({ x: 0, y: 0, width: 100, height: 50, rotation: 0 }, 1)).toEqual({
      x: 25,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
    });
    expect(
      core.shapeOutline({ type: 'diamond', x: 10, y: 20, width: 100, height: 60, rotation: 0 }),
    ).toEqual([
      { x: 60, y: 20 },
      { x: 110, y: 50 },
      { x: 60, y: 80 },
      { x: 10, y: 50 },
    ]);
  });

  it('expõe as predefinições do polígono regular com 5, 6 e 8 lados', () => {
    expect(core.POLYGON_PRESETS).toEqual({ pentagon: 5, hexagon: 6, octagon: 8 });
    expect(Object.isFrozen(core.POLYGON_PRESETS)).toBe(true);
  });

  it('estreita um valor JSON de metadata sem cair em any', () => {
    const section = core.createCanvasSection();
    section.dispatch({
      type: 'shape.create',
      shape: {
        type: 'line',
        id: 'l',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        metadata: { tags: ['a', 1], info: { n: 1 }, none: null },
      },
    });
    const metadata = section.getSnapshot().document.nodes['l']?.metadata ?? {};
    const { tags, info, none } = metadata;

    expect(tags !== undefined && core.isJsonArray(tags) && tags.length).toBe(2);
    expect(info !== undefined && core.isJsonObject(info) && info['n']).toBe(1);
    expect(tags !== undefined && core.isJsonObject(tags)).toBe(false);
    expect(info !== undefined && core.isJsonArray(info)).toBe(false);
    expect(none !== undefined && (core.isJsonArray(none) || core.isJsonObject(none))).toBe(false);
  });
});
