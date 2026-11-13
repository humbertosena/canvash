import {
  isFreeEndpoint,
  type BezierNode,
  type BoardNode,
  type Point,
  type PreviewShape,
  type ShapeLabel,
  type ShapeNode,
} from '@canvash/core';

/** O fragmento que leva o texto da forma à prévia, só quando ela tem um. */
function labelOf(shape: { readonly label?: ShapeLabel | undefined }): {
  readonly label?: ShapeLabel;
} {
  return shape.label === undefined ? {} : { label: shape.label };
}

function translatePoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

/** Os quatro pontos da curva transladados: a translação preserva a simetria. */
function translateBezierPoints(
  shape: BezierNode,
  delta: Point,
): Pick<BezierNode, 'start' | 'control1' | 'control2' | 'end'> {
  return {
    start: translatePoint(shape.start, delta),
    control1: translatePoint(shape.control1, delta),
    control2: translatePoint(shape.control2, delta),
    end: translatePoint(shape.end, delta),
  };
}

/** Preview da curva com os quatro pontos e a simetria. */
export function toBezierPreview(shape: BezierNode): PreviewShape {
  return {
    id: shape.id,
    type: 'bezier',
    start: shape.start,
    control1: shape.control1,
    control2: shape.control2,
    end: shape.end,
    symmetric: shape.symmetric,
    style: shape.style,
    visible: shape.visible,
    locked: shape.locked,
  };
}

/**
 * Translada a geometria de um nó existente por um deslocamento delta (dx, dy).
 * Retorna uma cópia do nó com as coordenadas transladadas.
 */
export function translateShape(shape: ShapeNode, delta: Point): ShapeNode;
export function translateShape(shape: BoardNode, delta: Point): BoardNode;
export function translateShape(shape: ShapeNode | BoardNode, delta: Point): ShapeNode | BoardNode;
export function translateShape(shape: ShapeNode | BoardNode, delta: Point): ShapeNode | BoardNode {
  if (shape.type === 'board') {
    return { ...shape, x: shape.x + delta.x, y: shape.y + delta.y };
  }

  if (shape.type === 'bezier') {
    return { ...shape, ...translateBezierPoints(shape, delta) };
  }

  if (shape.type === 'line') {
    return {
      ...shape,
      start: {
        x: shape.start.x + delta.x,
        y: shape.start.y + delta.y,
      },
      end: {
        x: shape.end.x + delta.x,
        y: shape.end.y + delta.y,
      },
    };
  }

  if (shape.type === 'arrow') {
    return {
      ...shape,
      start: isFreeEndpoint(shape.start)
        ? { x: shape.start.x + delta.x, y: shape.start.y + delta.y }
        : shape.start,
      end: isFreeEndpoint(shape.end)
        ? { x: shape.end.x + delta.x, y: shape.end.y + delta.y }
        : shape.end,
    };
  }

  return {
    ...shape,
    x: shape.x + delta.x,
    y: shape.y + delta.y,
  };
}

/**
 * Converte um nó em formato PreviewShape adequado para `section.setPreview({ updates })`.
 */
export function toPreviewShape(shape: ShapeNode | BoardNode): PreviewShape {
  if (shape.type === 'board') {
    // A prévia do board não leva a lista de filhos: quem pinta os filhos é o documento.
    return {
      id: shape.id,
      type: 'board',
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      title: shape.title,
      style: shape.style,
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'bezier') {
    return toBezierPreview(shape);
  }

  if (shape.type === 'text') {
    return {
      id: shape.id,
      type: 'text',
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      text: shape.text,
      fontSize: shape.fontSize,
      fontSizeMode: shape.fontSizeMode,
      fontFamily: shape.fontFamily,
      fontWeight: shape.fontWeight,
      textAlign: shape.textAlign,
      lineHeight: shape.lineHeight,
      style: shape.style,
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'arrow') {
    return {
      id: shape.id,
      type: 'arrow',
      start: shape.start,
      end: shape.end,
      startMarker: shape.startMarker,
      endMarker: shape.endMarker,
      style: shape.style,
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'line') {
    return {
      id: shape.id,
      type: 'line',
      start: shape.start,
      end: shape.end,
      style: shape.style,
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'triangle') {
    return {
      id: shape.id,
      type: 'triangle',
      variant: shape.variant,
      apex: shape.apex,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      style: shape.style,
      ...labelOf(shape),
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'cross') {
    return {
      id: shape.id,
      type: 'cross',
      armRatio: shape.armRatio,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      style: shape.style,
      ...labelOf(shape),
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'sticky') {
    return {
      id: shape.id,
      type: 'sticky',
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      text: shape.text,
      fontSize: shape.fontSize,
      fontSizeMode: shape.fontSizeMode,
      fontFamily: shape.fontFamily,
      fontWeight: shape.fontWeight,
      textAlign: shape.textAlign,
      lineHeight: shape.lineHeight,
      style: shape.style,
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'ink') {
    return {
      id: shape.id,
      type: 'ink',
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      strokes: shape.strokes,
      style: shape.style,
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'brace') {
    return {
      id: shape.id,
      type: 'brace',
      orientation: shape.orientation,
      tipPosition: shape.tipPosition,
      curvature: shape.curvature,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      style: shape.style,
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'chevron') {
    return {
      id: shape.id,
      type: 'chevron',
      direction: shape.direction,
      notchDepth: shape.notchDepth,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      style: shape.style,
      ...labelOf(shape),
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  if (shape.type === 'polygon') {
    return {
      id: shape.id,
      type: 'polygon',
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      sides: shape.sides,
      style: shape.style,
      ...labelOf(shape),
      visible: shape.visible,
      locked: shape.locked,
    };
  }

  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    rotation: shape.rotation,
    style: shape.style,
    ...labelOf(shape),
    visible: shape.visible,
    locked: shape.locked,
  };
}

/**
 * Constrói o patch parcial para o comando `shape.update` correspondente ao deslocamento delta (dx, dy).
 */
export function buildMovePatch(
  shape: ShapeNode | BoardNode,
  delta: Point,
): Record<string, unknown> {
  if (shape.type === 'board') return { x: shape.x + delta.x, y: shape.y + delta.y };

  if (shape.type === 'bezier') {
    return { ...translateBezierPoints(shape, delta) };
  }

  if (shape.type === 'line') {
    return {
      start: {
        x: shape.start.x + delta.x,
        y: shape.start.y + delta.y,
      },
      end: {
        x: shape.end.x + delta.x,
        y: shape.end.y + delta.y,
      },
    };
  }

  if (shape.type === 'arrow') {
    return {
      start: isFreeEndpoint(shape.start)
        ? { x: shape.start.x + delta.x, y: shape.start.y + delta.y }
        : shape.start,
      end: isFreeEndpoint(shape.end)
        ? { x: shape.end.x + delta.x, y: shape.end.y + delta.y }
        : shape.end,
    };
  }

  return {
    x: shape.x + delta.x,
    y: shape.y + delta.y,
  };
}
