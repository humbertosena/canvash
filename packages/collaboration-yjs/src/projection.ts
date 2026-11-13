import { compareOrderKeys } from '@canvash/collaboration';
import {
  DEFAULT_SHAPE_LABEL,
  INK_LIMITS,
  STICKY_COLORS,
  defaultBezierControls,
  fitStickyFontSize,
  mirrorControl,
  type ArrowNode,
  type BezierNode,
  type CanvasDocument,
  type BraceNode,
  type BoardNode,
  type BraceOrientation,
  type CanvasNode,
  type ChevronDirection,
  type ChevronNode,
  type CircleNode,
  type CrossNode,
  type DiamondNode,
  type EllipseNode,
  type FontWeight,
  type GroupNode,
  type InkKind,
  type InkNode,
  type InkStroke,
  type InkWidth,
  type LineNode,
  type PolygonNode,
  type ShapeLabel,
  type RectangleNode,
  type SquareNode,
  type StickyNode,
  type TextNode,
  type TriangleNode,
  type TriangleVariant,
} from '@canvash/core';
import type * as Y from 'yjs';
import { getDocumentCollections, type YjsEndpoints, type YjsGeometry } from './crdt-schema.js';

export const RECOVERY_LAYER_ID = '__recovery__';

const DEFAULT_STICKY_SIZE = 200;
const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/;
const HTML_TAGS = /<(?:\/[a-zA-Z]|[a-zA-Z])[a-zA-Z0-9:-]*(?:\s+[^>]*)?\/?>/g;

const DEFAULT_BOARD_TITLE = 'Board';
const MAX_BOARD_TITLE_LENGTH = 200;
const DEFAULT_BOARD_STYLE = { fill: '#ffffff', fillOpacity: 1, stroke: '#d4d4d8' } as const;

/** Uma linha de 1 a 200 caracteres, sem tags HTML; o resto vira o título padrão. */
function projectBoardTitle(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    raw === '' ||
    raw.length > MAX_BOARD_TITLE_LENGTH ||
    /[\r\n\u2028\u2029]/.test(raw) ||
    raw.replace(HTML_TAGS, '') !== raw
  ) {
    return DEFAULT_BOARD_TITLE;
  }
  return raw;
}

/** `null` é "sem cor"; uma cor hexadecimal vale em minúsculas; o resto volta ao padrão. */
function projectBoardColor(raw: unknown, fallback: string): string | null {
  if (raw === null) return null;
  if (typeof raw === 'string' && HEX_COLOR.test(raw.toLowerCase())) return raw.toLowerCase();
  return fallback;
}

const INK_KINDS: readonly string[] = ['pen', 'marker', 'highlighter'];
const INK_WIDTHS: readonly string[] = ['thin', 'medium', 'thick'];

const LABEL_ALIGNS: readonly string[] = ['left', 'center', 'right'];
const LABEL_VERTICAL_ALIGNS: readonly string[] = ['top', 'middle', 'bottom'];

/**
 * Remonta o texto da forma a partir dos campos planos `label*`. Sem `labelText` a forma não
 * tem texto; o que falta ou não vale cai no padrão e o HTML sai, como na nota adesiva.
 */
function projectLabel(sMap: Y.Map<unknown>): { label: ShapeLabel } | Record<string, never> {
  const rawText = sMap.get('labelText');
  if (typeof rawText !== 'string') return {};
  const fontSize = Number(sMap.get('labelFontSize'));
  const family = sMap.get('labelFontFamily');
  const weight = sMap.get('labelFontWeight');
  const color = sMap.get('labelColor');
  const align = sMap.get('labelAlign');
  const vertical = sMap.get('labelVerticalAlign');
  const validWeight =
    weight === 'normal' ||
    weight === 'bold' ||
    (typeof weight === 'number' &&
      Number.isInteger(weight) &&
      weight >= 100 &&
      weight <= 900 &&
      weight % 100 === 0);
  return {
    label: {
      text: rawText.replace(HTML_TAGS, ''),
      fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_SHAPE_LABEL.fontSize,
      fontFamily:
        typeof family === 'string' && family.trim() !== ''
          ? family
          : DEFAULT_SHAPE_LABEL.fontFamily,
      fontWeight: validWeight ? (weight as FontWeight) : DEFAULT_SHAPE_LABEL.fontWeight,
      color: typeof color === 'string' && HEX_COLOR.test(color.toLowerCase()) ? color : null,
      textAlign:
        typeof align === 'string' && LABEL_ALIGNS.includes(align)
          ? (align as ShapeLabel['textAlign'])
          : DEFAULT_SHAPE_LABEL.textAlign,
      verticalAlign:
        typeof vertical === 'string' && LABEL_VERTICAL_ALIGNS.includes(vertical)
          ? (vertical as ShapeLabel['verticalAlign'])
          : DEFAULT_SHAPE_LABEL.verticalAlign,
    },
  };
}

function unitCoordinate(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/**
 * Traços de um registro remoto, revalidados contra o contrato do core: um traço inválido (sem
 * pontos, com mais de 2.000, de tipo, espessura ou cor desconhecidos, ou com ponto que não é um
 * par de números) é descartado, e os pontos recortados a [0, 1]. Passando de 500 traços ou de
 * 20.000 pontos, o resto é deixado de fora. Registro sem nenhum traço válido não vira elemento.
 */
function sanitizeInkStrokes(raw: unknown): InkStroke[] {
  if (!Array.isArray(raw)) return [];
  const strokes: InkStroke[] = [];
  let total = 0;
  for (const item of raw) {
    if (strokes.length >= INK_LIMITS.maxStrokes) break;
    if (typeof item !== 'object' || item === null) continue;
    const { points, color, kind, width } = item as Record<string, unknown>;
    if (
      !Array.isArray(points) ||
      points.length < 1 ||
      points.length > INK_LIMITS.maxPointsPerStroke ||
      typeof color !== 'string' ||
      !HEX_COLOR.test(color.toLowerCase()) ||
      typeof kind !== 'string' ||
      !INK_KINDS.includes(kind) ||
      typeof width !== 'string' ||
      !INK_WIDTHS.includes(width)
    ) {
      continue;
    }
    if (total + points.length > INK_LIMITS.maxPoints) break;
    const clean: Array<{ x: number; y: number }> = [];
    for (const point of points) {
      const x = unitCoordinate((point as { x?: unknown } | null)?.x);
      const y = unitCoordinate((point as { y?: unknown } | null)?.y);
      if (x === undefined || y === undefined) break;
      clean.push({ x, y });
    }
    if (clean.length !== points.length) continue;
    total += clean.length;
    strokes.push({
      points: clean,
      color: color.toLowerCase(),
      kind: kind as InkKind,
      width: width as InkWidth,
    });
  }
  return strokes;
}

interface ProjectedNodeRecord {
  id: string;
  type: string;
  parentId: string;
  orderKey: string;
  node: CanvasNode;
}

interface MutableLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  childIds: string[];
}

export function projectYDocToCanvasDocument(ydoc: Y.Doc): CanvasDocument {
  const { shapes, layers, groups } = getDocumentCollections(ydoc);

  // 1. Processa camadas válidas
  const validLayersMap = new Map<string, MutableLayer>();
  const layerEntries: Array<{ id: string; orderKey: string; layer: MutableLayer }> = [];

  for (const [layerId, layerMap] of layers.entries()) {
    if (layerMap.get('isDeleted') === true) continue;
    const name = String(layerMap.get('name') ?? 'Camada');
    const visible = Boolean(layerMap.get('visible') ?? true);
    const locked = Boolean(layerMap.get('locked') ?? false);
    const orderKey = String(layerMap.get('orderKey') ?? 'm');

    const layerObj: MutableLayer = {
      id: layerId,
      name,
      visible,
      locked,
      childIds: [],
    };
    validLayersMap.set(layerId, layerObj);
    layerEntries.push({ id: layerId, orderKey, layer: layerObj });
  }

  // Se não houver nenhuma camada válida, garante ao menos a camada padrão
  if (layerEntries.length === 0) {
    const fallbackLayer: MutableLayer = {
      id: 'layer-default',
      name: 'Camada 1',
      visible: true,
      locked: false,
      childIds: [],
    };
    validLayersMap.set(fallbackLayer.id, fallbackLayer);
    layerEntries.push({ id: fallbackLayer.id, orderKey: 'm', layer: fallbackLayer });
  }

  // Ordena camadas
  layerEntries.sort((a, b) => compareOrderKeys(a, b));

  // 2. Mapeia grupos válidos
  const validGroups = new Map<string, { id: string; parentId: string; orderKey: string }>();
  for (const [groupId, gMap] of groups.entries()) {
    if (gMap.get('isDeleted') === true) continue;
    const placement = gMap.get('placement') as { parentId?: string; orderKey?: string } | undefined;
    const parentId = placement?.parentId ?? layerEntries[0]!.id;
    const orderKey = placement?.orderKey ?? 'm';
    validGroups.set(groupId, { id: groupId, parentId, orderKey });
  }

  // Boards: pais válidos de formas e de grupos. Um board apagado manda o que ficou nele para a
  // camada de recuperação.
  const liveBoardIds = new Set<string>();
  const deletedBoardIds = new Set<string>();
  for (const [shapeId, sMap] of shapes.entries()) {
    if (sMap.get('type') !== 'board') continue;
    (sMap.get('isDeleted') === true ? deletedBoardIds : liveBoardIds).add(shapeId);
  }

  // 3. Processa nós válidos (shapes)
  const projectedShapes = new Map<string, ProjectedNodeRecord>();
  let needsRecoveryLayer = false;

  for (const [shapeId, sMap] of shapes.entries()) {
    if (sMap.get('isDeleted') === true) continue;

    const type = String(sMap.get('type') ?? 'rectangle');
    const placement = sMap.get('placement') as { parentId?: string; orderKey?: string } | undefined;
    let parentId = placement?.parentId ?? layerEntries[0]!.id;
    const orderKey = placement?.orderKey ?? 'm';

    // Valida parentesco: se o pai for um grupo, board ou camada inexistente, rebaixa para recuperação
    if (type === 'board') {
      // O board só mora numa camada: qualquer outro pai o leva para a primeira.
      if (!validLayersMap.has(parentId)) parentId = layerEntries[0]!.id;
    } else if (
      !validLayersMap.has(parentId) &&
      !validGroups.has(parentId) &&
      !liveBoardIds.has(parentId)
    ) {
      parentId = RECOVERY_LAYER_ID;
      needsRecoveryLayer = true;
    }

    const visible = Boolean(sMap.get('visible') ?? true);
    const locked = Boolean(sMap.get('locked') ?? false);
    const fill = (sMap.get('fill') as string | null) ?? null;
    const stroke = (sMap.get('stroke') as string | null) ?? null;
    const strokeWidth = Number(sMap.get('strokeWidth') ?? 1);
    const opacity = Number(sMap.get('opacity') ?? 1);

    if (
      type === 'rectangle' ||
      type === 'square' ||
      type === 'ellipse' ||
      type === 'circle' ||
      type === 'diamond'
    ) {
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const x = geo?.x ?? 0;
      const y = geo?.y ?? 0;
      const rawW = Math.max(1, geo?.width ?? 100);
      const rawH = Math.max(1, geo?.height ?? 100);
      const isLocked = type === 'square' || type === 'circle';
      const width = isLocked ? Math.min(rawW, rawH) : rawW;
      const height = isLocked ? Math.min(rawW, rawH) : rawH;
      const rotation = geo?.rotation ?? 0;

      const node = {
        id: shapeId,
        type,
        x,
        y,
        width,
        height,
        rotation,
        ...projectLabel(sMap),
        visible,
        locked,
        style: { fill, stroke, strokeWidth, opacity },
      } as RectangleNode | SquareNode | EllipseNode | CircleNode | DiamondNode;

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'triangle') {
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      let x = geo?.x ?? 0;
      let y = geo?.y ?? 0;
      let width = Math.max(1, geo?.width ?? 100);
      let height = Math.max(1, geo?.height ?? 100);
      const rotation = geo?.rotation ?? 0;
      const rawVariant = String(sMap.get('variant') ?? 'isosceles');
      const variant: TriangleVariant =
        rawVariant === 'equilateral' ||
        rawVariant === 'isosceles' ||
        rawVariant === 'right' ||
        rawVariant === 'scalene'
          ? rawVariant
          : 'isosceles';

      if (variant === 'equilateral') {
        const aspect = 2 / Math.sqrt(3);
        if (width / height > aspect) {
          const fittedW = height * aspect;
          x = x + (width - fittedW) / 2;
          width = fittedW;
        } else {
          const fittedH = width / aspect;
          y = y + (height - fittedH) / 2;
          height = fittedH;
        }
      }

      const rawApex = Number(sMap.get('apex') ?? 0.5);
      const apex =
        variant === 'isosceles' || variant === 'equilateral'
          ? 0.5
          : variant === 'right'
            ? 0
            : Number.isFinite(rawApex)
              ? Math.max(0, Math.min(1, rawApex))
              : 0.3;

      const node: TriangleNode = {
        id: shapeId,
        type: 'triangle',
        x,
        y,
        width,
        height,
        rotation,
        variant,
        apex,
        ...projectLabel(sMap),
        visible,
        locked,
        style: { fill, stroke, strokeWidth, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'polygon') {
      // Merge concorrente pode trazer caixa fora de 1:1 ou sides fora da faixa: a projeção
      // reaplica as invariantes do core, como no quadrado e no círculo.
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const side = Math.min(Math.max(1, geo?.width ?? 100), Math.max(1, geo?.height ?? 100));
      const rawSides = Number(sMap.get('sides'));
      const sides = Number.isFinite(rawSides) ? Math.min(12, Math.max(3, Math.round(rawSides))) : 5;
      const node: PolygonNode = {
        id: shapeId,
        type: 'polygon',
        x: geo?.x ?? 0,
        y: geo?.y ?? 0,
        width: side,
        height: side,
        rotation: geo?.rotation ?? 0,
        sides,
        ...projectLabel(sMap),
        visible,
        locked,
        style: { fill, stroke, strokeWidth, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'cross') {
      // Merge concorrente pode trazer armRatio fora da faixa: a projeção o devolve a ela.
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const rawArm = Number(sMap.get('armRatio'));
      const armRatio = Number.isFinite(rawArm) ? Math.min(1, Math.max(0.05, rawArm)) : 1 / 3;
      const node: CrossNode = {
        id: shapeId,
        type: 'cross',
        x: geo?.x ?? 0,
        y: geo?.y ?? 0,
        width: Math.max(1, geo?.width ?? 100),
        height: Math.max(1, geo?.height ?? 100),
        rotation: geo?.rotation ?? 0,
        armRatio,
        ...projectLabel(sMap),
        visible,
        locked,
        style: { fill, stroke, strokeWidth, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'chevron') {
      // Merge concorrente pode trazer direção ou profundidade fora do contrato: a projeção as
      // devolve ao padrão ou à faixa.
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const rawDirection = sMap.get('direction');
      const direction: ChevronDirection =
        rawDirection === 'left' || rawDirection === 'up' || rawDirection === 'down'
          ? rawDirection
          : 'right';
      const rawDepth = Number(sMap.get('notchDepth'));
      const notchDepth = Number.isFinite(rawDepth) ? Math.min(0.5, Math.max(0, rawDepth)) : 0.25;
      const node: ChevronNode = {
        id: shapeId,
        type: 'chevron',
        x: geo?.x ?? 0,
        y: geo?.y ?? 0,
        width: Math.max(1, geo?.width ?? 100),
        height: Math.max(1, geo?.height ?? 100),
        rotation: geo?.rotation ?? 0,
        direction,
        notchDepth,
        ...projectLabel(sMap),
        visible,
        locked,
        style: { fill, stroke, strokeWidth, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'brace') {
      // Merge concorrente pode trazer parâmetros fora do contrato: a projeção os devolve ao padrão
      // ou à faixa. A chave só tem traço: o preenchimento de um registro remoto é ignorado.
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const rawOrientation = sMap.get('orientation');
      const orientation: BraceOrientation =
        rawOrientation === 'right' || rawOrientation === 'up' || rawOrientation === 'down'
          ? rawOrientation
          : 'left';
      const unit = (key: string): number => {
        const raw = Number(sMap.get(key));
        return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
      };
      const node: BraceNode = {
        id: shapeId,
        type: 'brace',
        x: geo?.x ?? 0,
        y: geo?.y ?? 0,
        width: Math.max(1, geo?.width ?? 100),
        height: Math.max(1, geo?.height ?? 100),
        rotation: geo?.rotation ?? 0,
        orientation,
        tipPosition: unit('tipPosition'),
        curvature: unit('curvature'),
        visible,
        locked,
        style: { stroke: stroke ?? '#000000', strokeWidth, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'board') {
      // Título, opacidade e cores inválidos voltam ao padrão; a caixa sempre é válida e sem
      // rotação, e a lista de filhos vem dos registros que apontam para o board (passo 7).
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const rawOpacity = sMap.get('fillOpacity');
      const node: BoardNode = {
        id: shapeId,
        type: 'board',
        x: Number.isFinite(geo?.x) ? geo!.x : 0,
        y: Number.isFinite(geo?.y) ? geo!.y : 0,
        width: Math.max(1, Number.isFinite(geo?.width) ? geo!.width : 100),
        height: Math.max(1, Number.isFinite(geo?.height) ? geo!.height : 100),
        title: projectBoardTitle(sMap.get('title')),
        style: {
          fill: projectBoardColor(sMap.get('fill'), DEFAULT_BOARD_STYLE.fill),
          fillOpacity:
            typeof rawOpacity === 'number' && rawOpacity >= 0 && rawOpacity <= 1
              ? rawOpacity
              : DEFAULT_BOARD_STYLE.fillOpacity,
          stroke: projectBoardColor(sMap.get('stroke'), DEFAULT_BOARD_STYLE.stroke),
        },
        childIds: [],
        visible,
        locked,
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'sticky') {
      // Toda propriedade volta ao contrato do core: um registro remoto estranho nunca vira nota
      // inválida, que derrubaria a projeção do documento inteiro.
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const width = Math.max(1, geo?.width ?? DEFAULT_STICKY_SIZE);
      const height = Math.max(1, geo?.height ?? DEFAULT_STICKY_SIZE);
      const text = String(sMap.get('text') ?? '').replace(HTML_TAGS, '');
      const rawFamily = sMap.get('fontFamily');
      const fontFamily =
        typeof rawFamily === 'string' && rawFamily.trim() !== '' ? rawFamily : 'sans-serif';
      const fontWeight = sMap.get('fontWeight') === 'bold' ? 'bold' : 'normal';
      const rawAlign = sMap.get('align');
      const textAlign = rawAlign === 'center' || rawAlign === 'right' ? rawAlign : 'left';
      const rawLineHeight = Number(sMap.get('lineHeight'));
      const lineHeight = Number.isFinite(rawLineHeight) && rawLineHeight > 0 ? rawLineHeight : 1.25;
      const fontSizeMode = sMap.get('fontSizeMode') === 'fixed' ? 'fixed' : 'auto';
      const rawFontSize = Number(sMap.get('fontSize'));
      const storedFontSize = Number.isFinite(rawFontSize) && rawFontSize > 0 ? rawFontSize : 16;
      const noteFill = HEX_COLOR.test(fill ?? '') ? (fill as string) : STICKY_COLORS.yellow;
      const node: StickyNode = {
        id: shapeId,
        type: 'sticky',
        x: geo?.x ?? 0,
        y: geo?.y ?? 0,
        width,
        height,
        rotation: geo?.rotation ?? 0,
        text,
        // No modo automático o tamanho é derivado do espaço e do texto, como no core.
        fontSize:
          fontSizeMode === 'auto'
            ? fitStickyFontSize({ text, width, height, fontFamily, fontWeight, lineHeight })
            : storedFontSize,
        fontSizeMode,
        fontFamily,
        fontWeight,
        textAlign,
        lineHeight,
        visible,
        locked,
        style: { fill: noteFill, stroke, strokeWidth, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'ink') {
      // Um registro remoto estranho nunca vira elemento inválido, que derrubaria a projeção do
      // documento inteiro: traços inválidos saem e, sem nenhum traço, o elemento não é projetado.
      const strokes = sanitizeInkStrokes(sMap.get('strokes'));
      if (strokes.length > 0) {
        const geo = sMap.get('geometry') as YjsGeometry | undefined;
        const node: InkNode = {
          id: shapeId,
          type: 'ink',
          x: geo?.x ?? 0,
          y: geo?.y ?? 0,
          width: Math.max(1, geo?.width ?? 100),
          height: Math.max(1, geo?.height ?? 100),
          rotation: geo?.rotation ?? 0,
          strokes,
          visible,
          locked,
          style: { opacity: Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1)) },
        };
        projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
      }
    } else if (type === 'line') {
      const ep = sMap.get('endpoints') as YjsEndpoints | undefined;
      const node: LineNode = {
        id: shapeId,
        type: 'line',
        start: { x: ep?.start?.x ?? 0, y: ep?.start?.y ?? 0 },
        end: { x: ep?.end?.x ?? 100, y: ep?.end?.y ?? 100 },
        visible,
        locked,
        style: { stroke: stroke ?? '#000000', strokeWidth: strokeWidth || 2, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'bezier') {
      // Merge concorrente pode juntar control1 de um cliente com control2 de outro: na curva
      // simétrica, control1 é a fonte de verdade e control2 volta a ser o espelho dele.
      const ep = sMap.get('endpoints') as YjsEndpoints | undefined;
      const start = { x: ep?.start?.x ?? 0, y: ep?.start?.y ?? 0 };
      const rawEnd = { x: ep?.end?.x ?? 100, y: ep?.end?.y ?? 100 };
      const end =
        rawEnd.x === start.x && rawEnd.y === start.y ? { x: start.x + 1, y: start.y } : rawEnd;
      const fallback = defaultBezierControls(start, end);
      const control1 =
        (sMap.get('control1') as { x: number; y: number } | undefined) ?? fallback.control1;
      const symmetric = sMap.get('symmetric') !== false;
      const control2 = symmetric
        ? mirrorControl(start, end, control1)
        : ((sMap.get('control2') as { x: number; y: number } | undefined) ?? fallback.control2);
      const node: BezierNode = {
        id: shapeId,
        type: 'bezier',
        start,
        control1: { x: control1.x, y: control1.y },
        control2: { x: control2.x, y: control2.y },
        end,
        symmetric,
        visible,
        locked,
        style: {
          // Sem cor gravada, o traço padrão do core; `null` gravado é curva sem traço visível.
          stroke: sMap.has('stroke') ? stroke : '#000000',
          strokeWidth: Number.isFinite(strokeWidth) && strokeWidth >= 0 ? strokeWidth : 1,
          opacity,
        },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'arrow') {
      const ep = sMap.get('endpoints') as YjsEndpoints | undefined;
      let startAnchor = ep?.start?.anchor;
      let endAnchor = ep?.end?.anchor;

      // Sanitiza âncoras para alvos excluídos (COLLAB-10)
      // A seta não se liga a board: o vínculo com um vira ponta livre.
      if (
        startAnchor &&
        (!shapes.has(startAnchor.targetId) ||
          shapes.get(startAnchor.targetId)?.get('isDeleted') === true ||
          liveBoardIds.has(startAnchor.targetId))
      ) {
        startAnchor = undefined;
      }
      if (
        endAnchor &&
        (!shapes.has(endAnchor.targetId) ||
          shapes.get(endAnchor.targetId)?.get('isDeleted') === true ||
          liveBoardIds.has(endAnchor.targetId))
      ) {
        endAnchor = undefined;
      }

      const startEp = startAnchor
        ? { targetId: startAnchor.targetId, anchor: { x: 0.5, y: 0.5 } }
        : { x: ep?.start?.x ?? 0, y: ep?.start?.y ?? 0 };

      const endEp = endAnchor
        ? { targetId: endAnchor.targetId, anchor: { x: 0.5, y: 0.5 } }
        : { x: ep?.end?.x ?? 100, y: ep?.end?.y ?? 100 };

      const node: ArrowNode = {
        id: shapeId,
        type: 'arrow',
        start: startEp,
        end: endEp,
        startMarker: ep?.startMarker ?? 'none',
        endMarker: ep?.endMarker ?? 'arrow',
        visible,
        locked,
        style: { stroke: stroke ?? '#000000', strokeWidth: strokeWidth || 2, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    } else if (type === 'text') {
      const geo = sMap.get('geometry') as YjsGeometry | undefined;
      const text = String(sMap.get('text') ?? '');
      const fontSize = Number(sMap.get('fontSize') ?? 16);
      // Registros anteriores ao campo não têm modo: projetam como automático, o comportamento deles.
      const fontSizeMode = sMap.get('fontSizeMode') === 'fixed' ? 'fixed' : 'auto';
      const fontFamily = String(sMap.get('fontFamily') ?? 'sans-serif');
      const fontWeight = String(sMap.get('fontWeight') ?? 'normal') as 'normal' | 'bold';
      const align = String(sMap.get('align') ?? 'left') as 'left' | 'center' | 'right';

      const node: TextNode = {
        id: shapeId,
        type: 'text',
        x: geo?.x ?? 0,
        y: geo?.y ?? 0,
        width: Math.max(1, geo?.width ?? 100),
        height: Math.max(1, geo?.height ?? 30),
        rotation: geo?.rotation ?? 0,
        text,
        fontSize,
        fontSizeMode,
        fontFamily,
        fontWeight,
        textAlign: align,
        lineHeight: 1.2,
        visible,
        locked,
        style: { fill: fill ?? '#000000', stroke: null, strokeWidth: 0, opacity },
      };

      projectedShapes.set(shapeId, { id: shapeId, type, parentId, orderKey, node });
    }
  }

  // O grupo de um board apagado, com membros, também vai para a recuperação.
  if (deletedBoardIds.size > 0) {
    const shapeParents = new Set([...projectedShapes.values()].map((shape) => shape.parentId));
    for (const group of validGroups.values()) {
      if (deletedBoardIds.has(group.parentId) && shapeParents.has(group.id)) {
        needsRecoveryLayer = true;
      }
    }
  }

  // 4. Cria camada de recuperação se necessário
  if (needsRecoveryLayer && !validLayersMap.has(RECOVERY_LAYER_ID)) {
    const recoveryLayer: MutableLayer = {
      id: RECOVERY_LAYER_ID,
      name: 'Camada de Recuperação',
      visible: true,
      locked: false,
      childIds: [],
    };
    validLayersMap.set(RECOVERY_LAYER_ID, recoveryLayer);
    layerEntries.push({ id: RECOVERY_LAYER_ID, orderKey: 'zz', layer: recoveryLayer });
  }

  // 5. Agrupa childIds por pai com ordenação estável (COLLAB-09)
  const childrenByParent = new Map<string, Array<{ id: string; orderKey: string }>>();

  for (const s of projectedShapes.values()) {
    let list = childrenByParent.get(s.parentId);
    if (!list) {
      list = [];
      childrenByParent.set(s.parentId, list);
    }
    list.push({ id: s.id, orderKey: s.orderKey });
  }

  // Processa grupos válidos: grupo só é projetado se contiver pelo menos um filho
  const projectedGroups = new Map<string, GroupNode>();

  for (const [groupId, g] of validGroups.entries()) {
    const groupChildren = childrenByParent.get(groupId);
    if (!groupChildren || groupChildren.length === 0) {
      continue; // Grupo vazio não é projetado
    }

    groupChildren.sort(compareOrderKeys);
    const childIds = groupChildren.map((c) => c.id);

    const groupNode: GroupNode = {
      id: groupId,
      type: 'group',
      childIds,
      visible: true,
      locked: false,
    };
    projectedGroups.set(groupId, groupNode);

    // O grupo em si é filho da camada ou do board do seu placement. O de um board apagado vai
    // para a recuperação; o de qualquer outro pai inválido, para a primeira camada.
    let targetLayerId = g.parentId;
    if (deletedBoardIds.has(targetLayerId)) {
      targetLayerId = RECOVERY_LAYER_ID;
    } else if (!validLayersMap.has(targetLayerId) && !liveBoardIds.has(targetLayerId)) {
      targetLayerId = layerEntries[0]!.id;
    }
    let parentList = childrenByParent.get(targetLayerId);
    if (!parentList) {
      parentList = [];
      childrenByParent.set(targetLayerId, parentList);
    }
    parentList.push({ id: groupId, orderKey: g.orderKey });
  }

  // 6. Atribui childIds finais às camadas
  for (const entry of layerEntries) {
    const list = childrenByParent.get(entry.id) ?? [];
    list.sort(compareOrderKeys);
    entry.layer.childIds = list.map((item) => item.id);
  }

  // 7. Monta nós finais do documento
  const allNodes: Record<string, CanvasNode> = {};

  for (const [id, s] of projectedShapes.entries()) {
    if (s.node.type === 'board') {
      const list = childrenByParent.get(id) ?? [];
      list.sort(compareOrderKeys);
      allNodes[id] = { ...s.node, childIds: list.map((item) => item.id) };
    } else {
      allNodes[id] = s.node;
    }
  }
  for (const [id, g] of projectedGroups.entries()) {
    allNodes[id] = g;
  }

  return {
    schemaVersion: 1,
    id: 'collab-doc',
    layers: layerEntries.map((e) => e.layer),
    nodes: allNodes,
  };
}
