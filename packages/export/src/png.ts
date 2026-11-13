import type { Result } from '@canvash/core';
import { paintItem, paintScene, projectScene } from '@canvash/renderer-canvas2d';
import { resolveExportContext } from './bounds.js';
import { err, ok, type ExportError } from './errors.js';
import type { ExportPngOptions, ExportSource } from './types.js';

export const DEFAULT_MAX_PIXELS = 16_000_000; // 16 milhões de pixels (IO-07)

/**
 * Exporta um documento ou canvas para uma imagem PNG (Blob) de alta fidelidade (IO-05, IO-07).
 */
export async function exportPng(
  source: ExportSource,
  options: ExportPngOptions = {},
): Promise<Result<Blob, ExportError>> {
  const scale = options.scale !== undefined && options.scale > 0 ? options.scale : 1;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  const fontTimeoutMs = options.fontTimeoutMs ?? 2000;

  const resolved = resolveExportContext(source, options);
  if (!resolved.ok) return resolved;
  const { document: doc, bounds, candidateIds, boardId, clip } = resolved.value;

  const pixelWidth = Math.ceil(bounds.width * scale);
  const pixelHeight = Math.ceil(bounds.height * scale);
  const totalPixels = pixelWidth * pixelHeight;

  // Verificação preventiva antes de qualquer alocação (IO-07)
  if (totalPixels > maxPixels) {
    return err(
      'LIMIT_EXCEEDED',
      `Export dimensions (${pixelWidth}x${pixelHeight} = ${totalPixels} pixels) exceed maximum limit of ${maxPixels} pixels.`,
      { pixelWidth, pixelHeight, totalPixels, maxPixels },
    );
  }

  // Aguarda fontes declaradas caso document.fonts esteja disponível no ambiente
  if (typeof document !== 'undefined' && 'fonts' in document && document.fonts?.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, fontTimeoutMs)),
      ]);
    } catch {
      // Falha suave de fonte - prossegue com fontes de fallback sem travar
    }
  }

  // Criação de Canvas compatível com OffscreenCanvas ou DOM Canvas
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
    context = canvas.getContext('2d');
  } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    context = canvas.getContext('2d');
  } else {
    return err(
      'UNSUPPORTED_ENVIRONMENT',
      'Canvas is not supported in this runtime environment (neither OffscreenCanvas nor HTMLCanvasElement available).',
    );
  }

  if (!context) {
    return err('EXPORT_FAILED', 'Failed to acquire 2D rendering context from Canvas.');
  }

  // Fundo
  if (options.background && options.background !== 'transparent') {
    context.fillStyle = options.background;
    context.fillRect(0, 0, pixelWidth, pixelHeight);
  }

  // Aplica projeção de escala e alinhamento do viewport
  context.save();
  context.scale(scale, scale);
  context.translate(-bounds.x, -bounds.y);

  // O escopo de board pinta o retângulo dele sem o título e recorta os filhos nesse retângulo.
  const scene = projectScene(doc, {
    candidateIds,
    ...(boardId === undefined ? {} : { boardTitles: false }),
  });
  const canvas2d = context as unknown as CanvasRenderingContext2D;
  if (boardId === undefined || clip === undefined) {
    paintScene(canvas2d, scene);
  } else {
    for (const item of scene.items) {
      if (item.id === boardId) paintItem(canvas2d, item);
    }
    canvas2d.save();
    canvas2d.beginPath();
    canvas2d.rect(clip.x, clip.y, clip.width, clip.height);
    canvas2d.clip();
    for (const item of scene.items) {
      if (item.id !== boardId) paintItem(canvas2d, item);
    }
    canvas2d.restore();
  }
  context.restore();

  // Conversão para Blob
  try {
    if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return ok(blob);
    }

    if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
      return new Promise((resolve) => {
        (canvas as HTMLCanvasElement).toBlob((blob) => {
          if (blob) {
            resolve(ok(blob));
          } else {
            resolve(err('EXPORT_FAILED', 'Failed to generate PNG blob from HTMLCanvasElement.'));
          }
        }, 'image/png');
      });
    }

    return err('EXPORT_FAILED', 'Canvas does not support Blob serialization.');
  } catch (error) {
    return err('EXPORT_FAILED', 'Unexpected error during PNG serialization.', { details: error });
  }
}
