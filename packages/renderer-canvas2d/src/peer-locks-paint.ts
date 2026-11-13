import type { Bounds, Viewport } from '@canvash/core';

/** Contorno de um nó bloqueado por outro participante: caixa em mundo, cor e nome dele. */
export interface PeerLockOutline {
  readonly bounds: Bounds;
  readonly color: string;
  readonly name: string;
}

const LINE_WIDTH = 2;
const LABEL_HEIGHT = 18;
const LABEL_PADDING_X = 6;
const LABEL_FONT = '600 11px sans-serif';

/** Texto preto ou branco, o que contrasta mais com o fundo `#rrggbb`. */
export function readableTextColor(background: string): string {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(background);
  if (!hex) return '#ffffff';
  const channel = (value: string): number => {
    const c = parseInt(value, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(hex[1]!) + 0.7152 * channel(hex[2]!) + 0.0722 * channel(hex[3]!);
  // Branco se chega a 4,5:1 (AA); senão #1f1f1f (luminância 0,0137); nos tons médios, preto.
  if (1.05 / (luminance + 0.05) >= 4.5) return '#ffffff';
  return (luminance + 0.05) / 0.0637 >= 4.5 ? '#1f1f1f' : '#000000';
}

/**
 * Pinta, em CSS px, o contorno de 2 px de cada nó bloqueado, sem alças, com a etiqueta do nome
 * no canto superior esquerdo. Efêmero: nunca entra na exportação.
 */
export function paintPeerLocks(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  outlines: readonly PeerLockOutline[],
): void {
  if (outlines.length === 0) return;
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  context.save();
  for (const outline of outlines) {
    const x = outline.bounds.x * zoom + viewport.x;
    const y = outline.bounds.y * zoom + viewport.y;
    context.strokeStyle = outline.color;
    context.lineWidth = LINE_WIDTH;
    context.strokeRect(x, y, outline.bounds.width * zoom, outline.bounds.height * zoom);

    context.font = LABEL_FONT;
    const width = Math.ceil(context.measureText(outline.name).width) + LABEL_PADDING_X * 2;
    // Acima do canto; se não couber na tela, dentro dele.
    const labelY = y - LABEL_HEIGHT >= 0 ? y - LABEL_HEIGHT : y;
    context.fillStyle = outline.color;
    context.fillRect(x, labelY, width, LABEL_HEIGHT);
    context.fillStyle = readableTextColor(outline.color);
    context.textBaseline = 'middle';
    context.fillText(outline.name, x + LABEL_PADDING_X, labelY + LABEL_HEIGHT / 2);
  }
  context.restore();
}
