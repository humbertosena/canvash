import { CanvasSurfaceElement } from './canvas-surface.js';
import { CanvasControlsElement } from './canvas-controls.js';
import { CanvasToolbarElement } from './canvas-toolbar.js';
import { CanvasPropertiesElement } from './canvas-properties.js';
import { CanvasLayersElement } from './canvas-layers.js';
import { CanvasSelectionMenuElement } from './canvas-selection-menu.js';
import { CanvasSectionElement } from './canvas-section.js';

export interface DefineCanvasElementsOptions {
  /**
   * Prefixo customizado para as tags (ex: 'canvash' resulta em 'canvash-canvas-surface').
   * Se omitido, os nomes padrão são utilizados ('canvas-surface', 'canvas-toolbar', etc.).
   */
  prefix?: string;

  /**
   * Instância de CustomElementRegistry a ser utilizada para registrar os elementos.
   * Se omitido, utiliza `globalThis.customElements`.
   */
  registry?: CustomElementRegistry;
}

export const DEFAULT_CANVAS_ELEMENTS = {
  'canvas-surface': CanvasSurfaceElement,
  'canvas-toolbar': CanvasToolbarElement,
  'canvas-properties': CanvasPropertiesElement,
  'canvas-layers': CanvasLayersElement,
  'canvas-controls': CanvasControlsElement,
  'canvas-section': CanvasSectionElement,
  'canvas-selection-menu': CanvasSelectionMenuElement,
} as const;

export function defineCanvasElements(options: DefineCanvasElementsOptions = {}): void {
  const registry =
    options.registry ?? (typeof globalThis !== 'undefined' ? globalThis.customElements : undefined);

  if (!registry) {
    throw new Error(
      'defineCanvasElements requires a CustomElementRegistry (customElements is not available in this environment).',
    );
  }

  const prefix = options.prefix?.trim();

  for (const [defaultTag, constructor] of Object.entries(DEFAULT_CANVAS_ELEMENTS)) {
    const tagName = prefix ? `${prefix}-${defaultTag}` : defaultTag;
    const existing = registry.get(tagName);

    if (existing) {
      if (existing === constructor) {
        // Idempotente: mesma tag registrada com a mesma classe construtora.
        continue;
      }
      throw new Error(
        `Cannot register custom element <${tagName}>: the name is already defined with a different constructor.`,
      );
    }

    registry.define(tagName, constructor);
  }
}
