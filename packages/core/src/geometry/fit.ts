/** Caixa com rotação em torno do centro. */
export interface BoxGeometry {
  /** Canto superior esquerdo antes da rotação. */
  readonly x: number;
  readonly y: number;
  /** Sempre maior que zero. */
  readonly width: number;
  /** Sempre maior que zero. */
  readonly height: number;
  /** Radianos, ao redor do centro, em `[-π, π)`. */
  readonly rotation: number;
}

/** Maior caixa de razão `ratio` (W/H) contida em `box`, no mesmo centro. */
export function fitAspect<T extends BoxGeometry>(box: T, ratio: number): T {
  const width = Math.min(box.width, box.height * ratio);
  const height = width / ratio;
  return {
    ...box,
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}
