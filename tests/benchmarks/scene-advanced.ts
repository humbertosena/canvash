/**
 * Gerador determinístico de cena avançada de benchmark com 10.000 nós (Marco 4).
 * Incorpora os novos tipos introduzidos no Marco 4:
 * - Texto multilinha com alinhamento e estilos (INPUT-06)
 * - Setas com marcadores e âncoras dinâmicas (INPUT-07)
 * - Grupos com hierarquia de 1 nível (INPUT-08)
 * - Retângulos e elipses com rotação e estilos (RENDER-01 / RENDER-06)
 *
 * Utiliza PRNG Mulberry32 com semente fixa para garantir reprodutibilidade exata.
 */

import { createPrng } from './scene.js';

export { createPrng } from './scene.js';

export type ArrowMarkerType = 'none' | 'arrow' | 'dot';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface FreeEndpoint {
  readonly x: number;
  readonly y: number;
}

export interface BindingEndpoint {
  readonly targetId: string;
  readonly anchor: Point;
}

export type ArrowEndpoint = FreeEndpoint | BindingEndpoint;

export interface BenchmarkStyle {
  readonly fill?: string | null | undefined;
  readonly stroke?: string | null | undefined;
  readonly strokeWidth?: number | undefined;
  readonly opacity?: number | undefined;
}

export interface BenchmarkRectangleNode {
  readonly id: string;
  readonly type: 'rectangle';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly style: BenchmarkStyle;
}

export interface BenchmarkEllipseNode {
  readonly id: string;
  readonly type: 'ellipse';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly style: BenchmarkStyle;
}

export interface BenchmarkTextNode {
  readonly id: string;
  readonly type: 'text';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight: 'normal' | 'bold';
  readonly textAlign: 'left' | 'center' | 'right';
  readonly lineHeight: number;
  readonly style: BenchmarkStyle;
}

export interface BenchmarkArrowNode {
  readonly id: string;
  readonly type: 'arrow';
  readonly visible: boolean;
  readonly locked: boolean;
  readonly start: ArrowEndpoint;
  readonly end: ArrowEndpoint;
  readonly startMarker: ArrowMarkerType;
  readonly endMarker: ArrowMarkerType;
  readonly style: BenchmarkStyle;
}

export interface BenchmarkGroupNode {
  readonly id: string;
  readonly type: 'group';
  readonly visible: boolean;
  readonly locked: boolean;
  readonly childIds: readonly string[];
}

export type AdvancedBenchmarkNode =
  | BenchmarkRectangleNode
  | BenchmarkEllipseNode
  | BenchmarkTextNode
  | BenchmarkArrowNode
  | BenchmarkGroupNode;

export interface AdvancedBenchmarkDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly nodes: Record<string, AdvancedBenchmarkNode>;
  readonly layers: readonly [
    {
      readonly id: string;
      readonly name: string;
      readonly visible: true;
      readonly locked: false;
      readonly childIds: readonly string[];
    },
  ];
}

const PALETTE = [
  '#2563eb',
  '#1d4ed8',
  '#16a34a',
  '#15803d',
  '#ea580c',
  '#c2410c',
  '#dc2626',
  '#b91c1c',
  '#9333ea',
  '#7e22ce',
  '#0891b2',
  '#0e7490',
  '#ca8a04',
  '#a16207',
  '#475569',
  '#334155',
] as const;

const SAMPLE_TEXTS = [
  'Canvash Design Engine',
  'Arquitetura Reativa\nCanvas 2D de Alta Performance',
  'Sistemas de Design\nComponentes Lit & React\nExportação SVG e JSON',
  'Camadas e Grupos\nEdição Avançada Marco 4',
  'Benchmark de Produção\nLatência p95 < 16.7ms\nHit-Test p95 < 4ms',
  'Snapping Magnético\nGuias Efêmeras e Tolerância 6px',
  'Editor Gráfico Vetorial\nUndo e Redo Transacional',
  'Diagramas e Fluxogramas\nSetas com Marcadores e Âncoras',
] as const;

/**
 * Gera documento com 10.000 nós representativos da suíte avançada do Marco 4.
 *
 * Distribuição em 10.000 nós:
 * - 3.000 retângulos
 * - 2.500 elipses
 * - 2.500 nós de texto multilinha
 * - 1.500 setas (livres e vinculadas com marcadores)
 * - 500 grupos (agrupando 1.000 nós em pares com hierarquia de 1 nível)
 * Total de entradas em document.nodes = 10.000.
 */
export function generateAdvancedBenchmarkScene(
  seed = 42,
  totalNodes = 10000,
): AdvancedBenchmarkDocument {
  const random = createPrng(seed);

  const nodes: Record<string, AdvancedBenchmarkNode> = {};
  const initialLayerChildren: string[] = [];

  // Alocação proporcional de nós base
  const groupCount = Math.floor(totalNodes * 0.05); // 500 grupos
  const leafCount = totalNodes - groupCount; // 9.500 leaf shapes

  const rectCount = Math.floor(leafCount * 0.32); // ~3040 retângulos
  const ellipseCount = Math.floor(leafCount * 0.26); // ~2470 elipses
  const textCount = Math.floor(leafCount * 0.26); // ~2470 textos
  const arrowCount = leafCount - rectCount - ellipseCount - textCount; // ~1520 setas

  let nodeIndex = 0;
  const targetCandidateIds: string[] = [];

  // 1. Cria Retângulos
  for (let i = 0; i < rectCount; i += 1) {
    const id = `node-rect-${nodeIndex++}`;
    const x = Math.round((random() * 5000 - 2500) * 10) / 10;
    const y = Math.round((random() * 4000 - 2000) * 10) / 10;
    const width = Math.round((40 + random() * 120) * 10) / 10;
    const height = Math.round((40 + random() * 120) * 10) / 10;
    const rotation = Math.round((random() * 2 * Math.PI - Math.PI) * 100) / 100;
    const fillIndex = Math.floor(random() * PALETTE.length);
    const fill = PALETTE[fillIndex] ?? '#2563eb';
    const strokeWidth = Math.floor(random() * 3) + 1;

    const rectNode: BenchmarkRectangleNode = {
      id,
      type: 'rectangle',
      x,
      y,
      width,
      height,
      rotation,
      visible: true,
      locked: false,
      style: {
        fill,
        stroke: '#0f172a',
        strokeWidth,
        opacity: Math.round((0.8 + random() * 0.2) * 100) / 100,
      },
    };

    nodes[id] = rectNode;
    targetCandidateIds.push(id);
    initialLayerChildren.push(id);
  }

  // 2. Cria Elipses
  for (let i = 0; i < ellipseCount; i += 1) {
    const id = `node-ellipse-${nodeIndex++}`;
    const x = Math.round((random() * 5000 - 2500) * 10) / 10;
    const y = Math.round((random() * 4000 - 2000) * 10) / 10;
    const width = Math.round((40 + random() * 120) * 10) / 10;
    const height = Math.round((40 + random() * 120) * 10) / 10;
    const rotation = Math.round((random() * 2 * Math.PI - Math.PI) * 100) / 100;
    const fillIndex = Math.floor(random() * PALETTE.length);
    const fill = PALETTE[fillIndex] ?? '#16a34a';
    const strokeWidth = Math.floor(random() * 3) + 1;

    const ellipseNode: BenchmarkEllipseNode = {
      id,
      type: 'ellipse',
      x,
      y,
      width,
      height,
      rotation,
      visible: true,
      locked: false,
      style: {
        fill,
        stroke: '#0f172a',
        strokeWidth,
        opacity: Math.round((0.8 + random() * 0.2) * 100) / 100,
      },
    };

    nodes[id] = ellipseNode;
    targetCandidateIds.push(id);
    initialLayerChildren.push(id);
  }

  // 3. Cria Nós de Texto Multilinha
  const textAlignOptions = ['left', 'center', 'right'] as const;
  const fontWeightOptions = ['normal', 'bold'] as const;

  for (let i = 0; i < textCount; i += 1) {
    const id = `node-text-${nodeIndex++}`;
    const x = Math.round((random() * 5000 - 2500) * 10) / 10;
    const y = Math.round((random() * 4000 - 2000) * 10) / 10;
    const width = Math.round((80 + random() * 140) * 10) / 10;
    const height = Math.round((40 + random() * 60) * 10) / 10;
    const rotation = Math.round((random() * 0.5 - 0.25) * 100) / 100;
    const text = SAMPLE_TEXTS[i % SAMPLE_TEXTS.length] ?? 'Canvash Text';
    const fontSize = 14 + (i % 5) * 2;
    const textAlign = textAlignOptions[i % textAlignOptions.length] ?? 'left';
    const fontWeight = fontWeightOptions[i % fontWeightOptions.length] ?? 'normal';
    const fillIndex = Math.floor(random() * PALETTE.length);
    const fill = PALETTE[fillIndex] ?? '#0f172a';

    const textNode: BenchmarkTextNode = {
      id,
      type: 'text',
      x,
      y,
      width,
      height,
      rotation,
      visible: true,
      locked: false,
      text,
      fontSize,
      fontFamily: 'sans-serif',
      fontWeight,
      textAlign,
      lineHeight: 1.25,
      style: {
        fill,
        stroke: null,
        strokeWidth: 0,
        opacity: 1,
      },
    };

    nodes[id] = textNode;
    targetCandidateIds.push(id);
    initialLayerChildren.push(id);
  }

  // 4. Cria Setas (Livres e Vinculadas)
  const markerOptions: readonly ArrowMarkerType[] = ['none', 'arrow', 'dot'];

  for (let i = 0; i < arrowCount; i += 1) {
    const id = `node-arrow-${nodeIndex++}`;
    const startX = Math.round((random() * 5000 - 2500) * 10) / 10;
    const startY = Math.round((random() * 4000 - 2000) * 10) / 10;
    const deltaX = (random() > 0.5 ? 1 : -1) * (30 + random() * 150);
    const deltaY = (random() > 0.5 ? 1 : -1) * (30 + random() * 150);
    const endX = Math.round((startX + deltaX) * 10) / 10;
    const endY = Math.round((startY + deltaY) * 10) / 10;

    const startMarker = markerOptions[i % markerOptions.length] ?? 'none';
    const endMarker = markerOptions[(i + 1) % markerOptions.length] ?? 'arrow';
    const strokeIndex = Math.floor(random() * PALETTE.length);
    const stroke = PALETTE[strokeIndex] ?? '#0f172a';
    const strokeWidth = Math.floor(random() * 3) + 1;

    const isBound = i % 4 === 0 && targetCandidateIds.length > 2;
    let startEndpoint: ArrowEndpoint = { x: startX, y: startY };
    let endEndpoint: ArrowEndpoint = { x: endX, y: endY };

    if (isBound) {
      const targetIdA = targetCandidateIds[i % targetCandidateIds.length]!;
      const targetIdB = targetCandidateIds[(i + 7) % targetCandidateIds.length]!;
      if (targetIdA !== targetIdB) {
        startEndpoint = { targetId: targetIdA, anchor: { x: 0.5, y: 0.5 } };
        endEndpoint = { targetId: targetIdB, anchor: { x: 1.0, y: 0.5 } };
      }
    }

    const arrowNode: BenchmarkArrowNode = {
      id,
      type: 'arrow',
      visible: true,
      locked: false,
      start: startEndpoint,
      end: endEndpoint,
      startMarker,
      endMarker,
      style: {
        stroke,
        strokeWidth,
        opacity: 0.95,
      },
    };

    nodes[id] = arrowNode;
    initialLayerChildren.push(id);
  }

  // 5. Agrupa nós em 500 grupos (1 nível)
  const finalLayerChildren: string[] = [];
  const groupedSet = new Set<string>();

  let groupIndex = 0;
  for (let i = 0; i < initialLayerChildren.length; i += 1) {
    const currentId = initialLayerChildren[i]!;

    if (
      groupIndex < groupCount &&
      i + 1 < initialLayerChildren.length &&
      !groupedSet.has(currentId)
    ) {
      const nextId = initialLayerChildren[i + 1]!;
      const nodeA = nodes[currentId];
      const nodeB = nodes[nextId];

      if (
        nodeA &&
        nodeB &&
        nodeA.type !== 'group' &&
        nodeB.type !== 'group' &&
        nodeA.type !== 'arrow' &&
        nodeB.type !== 'arrow' &&
        !groupedSet.has(nextId)
      ) {
        const groupId = `node-group-${groupIndex++}`;
        const groupNode: BenchmarkGroupNode = {
          id: groupId,
          type: 'group',
          visible: true,
          locked: false,
          childIds: [currentId, nextId],
        };

        nodes[groupId] = groupNode;
        groupedSet.add(currentId);
        groupedSet.add(nextId);

        finalLayerChildren.push(groupId);
        i += 1;
        continue;
      }
    }

    if (!groupedSet.has(currentId)) {
      finalLayerChildren.push(currentId);
    }
  }

  const layer = {
    id: 'layer-bench-advanced',
    name: 'Advanced Benchmark Layer',
    visible: true as const,
    locked: false as const,
    childIds: finalLayerChildren,
  };

  return {
    schemaVersion: 1,
    id: `doc-benchmark-advanced-${seed}`,
    nodes,
    layers: [layer],
  };
}
