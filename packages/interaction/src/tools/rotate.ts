import {
  isBoxShape,
  rotatePoint,
  type CanvasSectionApi,
  type BezierNode,
  type CanvasCommand,
  type Point,
  type ShapeNode,
} from '@canvash/core';
import { computeAggregateBounds } from './resize-multiple.js';

const TAU = Math.PI * 2;

/**
 * Normaliza um ângulo em radianos para o intervalo [-π, π) conforme o schema Canvash.
 */
export function normalizeRotation(rotation: number): number {
  if (rotation >= -Math.PI && rotation < Math.PI) return rotation;
  const angle = rotation - Math.floor((rotation + Math.PI) / TAU) * TAU;
  return angle >= Math.PI ? -Math.PI : angle;
}

/** Distância do handle de rotação em relação ao topo da seleção em CSS px. */
export const ROTATION_HANDLE_OFFSET_CSS = 24;

/**
 * Retorna o centro geométrico de rotação para um único nó ou para um conjunto de nós.
 */
export function getRotationCenter(nodes: readonly ShapeNode[]): Point | null {
  if (nodes.length === 0) return null;

  if (nodes.length === 1) {
    const node = nodes[0];
    if (!node) return null;

    if (isBoxShape(node) && node.type !== 'text') {
      return {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      };
    }
    if (node.type === 'line') {
      return {
        x: (node.start.x + node.end.x) / 2,
        y: (node.start.y + node.end.y) / 2,
      };
    }
  }

  const bounds = computeAggregateBounds(nodes);
  if (!bounds) return null;

  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * Retorna a posição do handle de rotação no espaço de mundo.
 */
export function getRotationHandlePoint(
  nodes: readonly ShapeNode[],
  viewportZoom: number,
): Point | null {
  if (nodes.length === 0) return null;

  const zoom = viewportZoom > 0 ? viewportZoom : 1;
  const offsetWorld = ROTATION_HANDLE_OFFSET_CSS / zoom;

  if (nodes.length === 1) {
    const node = nodes[0];
    if (!node) return null;

    if (isBoxShape(node)) {
      const center = {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      };
      // Ponto superior central antes da rotação
      const unrotatedTop = {
        x: center.x,
        y: node.y - offsetWorld,
      };
      return rotatePoint(unrotatedTop, center, node.rotation);
    }

    if (node.type === 'line') {
      const center = {
        x: (node.start.x + node.end.x) / 2,
        y: (node.start.y + node.end.y) / 2,
      };
      const dx = node.end.x - node.start.x;
      const dy = node.end.y - node.start.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) return null;
      // Vetor normal perpendicular à linha (apontando "para cima" para linha da esquerda para a direita)
      const nx = dy / len;
      const ny = -dx / len;
      return {
        x: center.x + nx * offsetWorld,
        y: center.y + ny * offsetWorld,
      };
    }
  }

  const bounds = computeAggregateBounds(nodes);
  if (!bounds) return null;

  const centerX = bounds.x + bounds.width / 2;
  return {
    x: centerX,
    y: bounds.y - offsetWorld,
  };
}

/**
 * Verifica se um clique ou ponteiro colidiu com o handle de rotação.
 */
export function isRotationHandleHit(
  handlePoint: Point,
  worldPoint: Point,
  toleranceWorld: number,
): boolean {
  const dx = handlePoint.x - worldPoint.x;
  const dy = handlePoint.y - worldPoint.y;
  return dx * dx + dy * dy <= toleranceWorld * toleranceWorld;
}

/**
 * Calcula o delta angular de rotação em radianos a partir da posição inicial e atual do ponteiro.
 * Quando shiftKey é verdadeiro, quantiza a rotação em múltiplos exatos de 15° (π/12 rad).
 */
export function calculateRotationAngle(
  center: Point,
  startWorld: Point,
  currentWorld: Point,
  shiftKey: boolean,
): number {
  const startAngle = Math.atan2(startWorld.y - center.y, startWorld.x - center.x);
  const currentAngle = Math.atan2(currentWorld.y - center.y, currentWorld.x - center.x);

  let delta = currentAngle - startAngle;

  if (shiftKey) {
    const STEP_15_DEG = Math.PI / 12; // 15 graus = 0.261799 rad
    delta = Math.round(delta / STEP_15_DEG) * STEP_15_DEG;
  }

  return delta;
}

/**
 * Aplica rotação ao conjunto de formas:
 * - Para forma única: rotaciona ao redor de seu próprio centro;
 * - Para múltiplas formas: rotaciona o centro de cada forma ao redor do centro coletivo
 *   e incrementa a rotação intrínseca de cada nó, preservando exatamente as posições relativas (INPUT-04).
 */
export function rotateShapes(
  nodes: readonly ShapeNode[],
  center: Point,
  deltaAngle: number,
): readonly ShapeNode[] {
  if (nodes.length === 1) {
    const node = nodes[0];
    if (!node) return [];

    if (isBoxShape(node)) {
      return [
        {
          ...node,
          rotation: normalizeRotation(node.rotation + deltaAngle),
        },
      ];
    }
    if (node.type === 'line') {
      return [
        {
          ...node,
          start: rotatePoint(node.start, center, deltaAngle),
          end: rotatePoint(node.end, center, deltaAngle),
        },
      ];
    }
    if (node.type === 'bezier') {
      return [rotateBezier(node, center, deltaAngle)];
    }
    return [node];
  }

  return nodes.map((node): ShapeNode => {
    if (isBoxShape(node)) {
      const nodeCenter = {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      };
      const newCenter = rotatePoint(nodeCenter, center, deltaAngle);
      return {
        ...node,
        x: newCenter.x - node.width / 2,
        y: newCenter.y - node.height / 2,
        rotation: normalizeRotation(node.rotation + deltaAngle),
      };
    }

    if (node.type === 'line') {
      return {
        ...node,
        start: rotatePoint(node.start, center, deltaAngle),
        end: rotatePoint(node.end, center, deltaAngle),
      };
    }

    if (node.type === 'bezier') {
      return rotateBezier(node, center, deltaAngle);
    }

    return node;
  });
}

/** A curva não tem rotação própria: girar é girar os quatro pontos, o que preserva a simetria. */
function rotateBezier(node: BezierNode, center: Point, deltaAngle: number): BezierNode {
  return {
    ...node,
    start: rotatePoint(node.start, center, deltaAngle),
    control1: rotatePoint(node.control1, center, deltaAngle),
    control2: rotatePoint(node.control2, center, deltaAngle),
    end: rotatePoint(node.end, center, deltaAngle),
  };
}

/**
 * Constrói o patch de propriedades atualizadas para comitar no canvas.
 */
export function buildRotatePatch(node: ShapeNode): Record<string, unknown> {
  if (isBoxShape(node)) {
    return {
      x: node.x,
      y: node.y,
      rotation: node.rotation,
    };
  }

  if (node.type === 'line') {
    return {
      start: node.start,
      end: node.end,
    };
  }

  if (node.type === 'bezier') {
    return {
      start: node.start,
      control1: node.control1,
      control2: node.control2,
      end: node.end,
    };
  }

  return {};
}

/**
 * Executa a transação atômica de rotação no canvas gerando uma única entrada de histórico (INPUT-04).
 */
export function executeRotation(
  section: CanvasSectionApi,
  rotatedNodes: readonly ShapeNode[],
): void {
  const commands: CanvasCommand[] = rotatedNodes.map((node) => ({
    type: 'shape.update',
    id: node.id,
    patch: buildRotatePatch(node),
  }));

  if (commands.length > 0) {
    section.transact(commands);
  }
}
