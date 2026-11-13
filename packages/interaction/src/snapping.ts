import {
  shapeBounds,
  type CanvasDocument,
  type Bounds,
  type Point,
  type ShapeNode,
} from '@canvash/core';

/** Tolerância padrão do snapping magnético em CSS px (INPUT-09). */
export const DEFAULT_SNAP_TOLERANCE_CSS_PX = 6;

export type SnapAxis = 'x' | 'y';
export type SnapTargetType = 'object' | 'grid';

/** Alvo elegível para atração magnética. */
export interface SnapTarget {
  readonly type: SnapTargetType;
  readonly axis: SnapAxis;
  readonly coordinate: number;
  readonly nodeId?: string;
  readonly min?: number;
  readonly max?: number;
}

/** Guia visual efêmera produzida por um alinhamento ativo. */
export interface SnapGuide {
  readonly axis: SnapAxis;
  readonly coordinate: number;
  readonly min?: number;
  readonly max?: number;
  readonly targetType: SnapTargetType;
  readonly nodeId?: string;
}

/** Configuração da grade de referência. */
export interface GridSnapConfig {
  readonly enabled: boolean;
  readonly size: number;
}

/** Opções para resolução do snapping. */
export interface ComputeSnapOptions {
  /** Nível de zoom atual da viewport para normalizar a tolerância de 6 CSS px. */
  readonly zoom: number;
  /** Tolerância em CSS px. Padrão: 6 CSS px. */
  readonly toleranceCssPx?: number;
  /** Tecla Alt suspende todo o snapping durante o gesto quando ativa. */
  readonly altKey?: boolean;
  /** Configuração opcional de grade de snap. */
  readonly grid?: GridSnapConfig | undefined;
  /** Conjunto de IDs a ignorar como alvos (ex: nós selecionados ou em manipulação). */
  readonly excludedIds?: ReadonlySet<string> | readonly string[];
}

/** Resultado do cálculo de snapping. */
export interface SnapResult {
  /** Deslocamento vetorial a ser somado à posição (snapped - raw). */
  readonly delta: Point;
  /** Guias visuais efêmeras ativas para renderização no overlay. */
  readonly guides: readonly SnapGuide[];
}

/**
 * Coleta todos os alvos de snap a partir de objetos visíveis do documento que
 * pertencem a camadas também visíveis, excluindo nós informados (ex: seleção atual).
 */
export function collectObjectSnapTargets(
  document: CanvasDocument,
  excludedIds?: ReadonlySet<string> | readonly string[],
): readonly SnapTarget[] {
  const excludeSet = excludedIds instanceof Set ? excludedIds : new Set(excludedIds ?? []);

  const targets: SnapTarget[] = [];

  for (const layer of document.layers) {
    if (layer.visible === false) continue;

    for (const childId of layer.childIds) {
      if (excludeSet.has(childId)) continue;

      const node = document.nodes[childId];
      if (!node || node.visible === false) continue;

      const shapesToProcess: ShapeNode[] = [];
      if (node.type === 'group') {
        for (const grandChildId of node.childIds) {
          if (excludeSet.has(grandChildId)) continue;
          const childNode = document.nodes[grandChildId];
          if (
            childNode &&
            childNode.type !== 'group' &&
            childNode.type !== 'board' &&
            childNode.visible !== false
          ) {
            shapesToProcess.push(childNode);
          }
        }
      } else if (node.type !== 'board') {
        shapesToProcess.push(node);
      }

      for (const shape of shapesToProcess) {
        const bounds = shapeBounds(shape, {
          stroke: false,
          getNode: (id) => {
            const n = document.nodes[id];
            return n && n.type !== 'group' && n.type !== 'board' ? n : undefined;
          },
        });
        const { x, y, width, height } = bounds;

        const left = x;
        const centerX = x + width / 2;
        const right = x + width;

        const top = y;
        const centerY = y + height / 2;
        const bottom = y + height;

        // Alvos verticais (eixo X)
        targets.push(
          { type: 'object', axis: 'x', coordinate: left, nodeId: shape.id, min: top, max: bottom },
          {
            type: 'object',
            axis: 'x',
            coordinate: centerX,
            nodeId: shape.id,
            min: top,
            max: bottom,
          },
          { type: 'object', axis: 'x', coordinate: right, nodeId: shape.id, min: top, max: bottom },
        );

        // Alvos horizontais (eixo Y)
        targets.push(
          { type: 'object', axis: 'y', coordinate: top, nodeId: shape.id, min: left, max: right },
          {
            type: 'object',
            axis: 'y',
            coordinate: centerY,
            nodeId: shape.id,
            min: left,
            max: right,
          },
          {
            type: 'object',
            axis: 'y',
            coordinate: bottom,
            nodeId: shape.id,
            min: left,
            max: right,
          },
        );
      }
    }
  }

  return targets;
}

interface BestAxisMatch {
  absDist: number;
  delta: number;
  target: SnapTarget;
  source: number;
}

/**
 * Resolve a atração magnética de um eixo com tie-breaking determinístico:
 * 1. Menor deslocamento absoluto
 * 2. Objeto sobre grade
 * 3. ID de nó estável (ordem alfabética)
 */
function resolveAxisSnap(
  axis: SnapAxis,
  sources: readonly number[],
  objectTargets: readonly SnapTarget[],
  grid: GridSnapConfig | undefined,
  toleranceWorld: number,
): { delta: number; guide?: SnapGuide } {
  let best: BestAxisMatch | null = null;
  const EPSILON = 1e-6;

  for (const source of sources) {
    // 1. Testa alvos de objetos no mesmo eixo
    for (const target of objectTargets) {
      if (target.axis !== axis) continue;

      const dist = target.coordinate - source;
      const absDist = Math.abs(dist);
      if (absDist > toleranceWorld) continue;

      if (best === null) {
        best = { absDist, delta: dist, target, source };
        continue;
      }

      if (absDist < best.absDist - EPSILON) {
        best = { absDist, delta: dist, target, source };
      } else if (Math.abs(absDist - best.absDist) <= EPSILON) {
        // Empate de distância: objeto sobre grid
        if (best.target.type === 'grid') {
          best = { absDist, delta: dist, target, source };
        } else if (best.target.type === 'object') {
          // Desempate estável por ID na ordem binária (code units UTF-16), independente de locale
          const currentId = target.nodeId ?? '';
          const bestId = best.target.nodeId ?? '';
          if (currentId < bestId) {
            best = { absDist, delta: dist, target, source };
          }
        }
      }
    }

    // 2. Testa grid analítico mais próximo
    if (grid && grid.enabled && grid.size > 0) {
      const gridCoord = Math.round(source / grid.size) * grid.size;
      const dist = gridCoord - source;
      const absDist = Math.abs(dist);

      if (absDist <= toleranceWorld) {
        if (best === null) {
          best = {
            absDist,
            delta: dist,
            target: { type: 'grid', axis, coordinate: gridCoord },
            source,
          };
        } else if (absDist < best.absDist - EPSILON) {
          best = {
            absDist,
            delta: dist,
            target: { type: 'grid', axis, coordinate: gridCoord },
            source,
          };
        }
        // Se a distância for igual, objeto já tem prioridade sobre grid, então não sobrescreve
      }
    }
  }

  if (best === null) {
    return { delta: 0 };
  }

  const guide: SnapGuide = {
    axis,
    coordinate: best.target.coordinate,
    min: best.target.min,
    max: best.target.max,
    targetType: best.target.type,
    nodeId: best.target.nodeId,
  };

  return { delta: best.delta, guide };
}

/**
 * Calcula o snapping espacial considerando fontes e alvos, respeitando tolerância em CSS px
 * em qualquer zoom, precedência estrita e suspensão por tecla Alt.
 */
export function computeSnap(
  sources: { readonly x: readonly number[]; readonly y: readonly number[] },
  targets: readonly SnapTarget[],
  options: ComputeSnapOptions,
): SnapResult {
  if (options.altKey) {
    return {
      delta: { x: 0, y: 0 },
      guides: [],
    };
  }

  const zoom = options.zoom > 0 ? options.zoom : 1;
  const toleranceCssPx = options.toleranceCssPx ?? DEFAULT_SNAP_TOLERANCE_CSS_PX;
  const toleranceWorld = toleranceCssPx / zoom;

  const snapX = resolveAxisSnap('x', sources.x, targets, options.grid, toleranceWorld);
  const snapY = resolveAxisSnap('y', sources.y, targets, options.grid, toleranceWorld);

  const guides: SnapGuide[] = [];
  if (snapX.guide) guides.push(snapX.guide);
  if (snapY.guide) guides.push(snapY.guide);

  return {
    delta: {
      x: snapX.delta,
      y: snapY.delta,
    },
    guides,
  };
}

/**
 * Helper para calcular snapping para uma bounding box (bordas e centros em ambos os eixos).
 */
export function computeBoxSnap(
  box: Bounds,
  document: CanvasDocument,
  options: ComputeSnapOptions,
): SnapResult {
  const sources = {
    x: [box.x, box.x + box.width / 2, box.x + box.width],
    y: [box.y, box.y + box.height / 2, box.y + box.height],
  };

  const targets = collectObjectSnapTargets(document, options.excludedIds);
  return computeSnap(sources, targets, options);
}

/**
 * Helper para calcular snapping para um ponto único (criação de forma, endpoints de linha/seta).
 */
export function computePointSnap(
  point: Point,
  document: CanvasDocument,
  options: ComputeSnapOptions,
): SnapResult {
  const sources = {
    x: [point.x],
    y: [point.y],
  };

  const targets = collectObjectSnapTargets(document, options.excludedIds);
  return computeSnap(sources, targets, options);
}
