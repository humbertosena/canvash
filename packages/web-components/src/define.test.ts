import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CanvasSurfaceElement } from './canvas-surface.js';
import { DEFAULT_CANVAS_ELEMENTS, defineCanvasElements } from './define.js';
import * as WebComponentsPackage from './index.js';

interface LegacyEntry {
  old: string;
  kind: string;
}

/** As tags antigas, lidas do JSON da renomeação para este arquivo não citar nome antigo. */
function legacyTags(): string[] {
  const list = JSON.parse(
    readFileSync(new URL('../../../scripts/legacy-names.json', import.meta.url), 'utf8'),
  ) as { entries: LegacyEntry[] };
  return list.entries
    .filter(
      (entry) =>
        entry.kind === 'tag' && !entry.old.includes('canvash-') && !entry.old.startsWith('app-'),
    )
    .map((entry) => entry.old);
}

class MockRegistry implements CustomElementRegistry {
  private map = new Map<string, CustomElementConstructor>();

  define(name: string, constructor: CustomElementConstructor): void {
    if (this.map.has(name)) {
      throw new Error(`CustomElementRegistry: ${name} is already registered`);
    }
    this.map.set(name, constructor);
  }

  get(name: string): CustomElementConstructor | undefined {
    return this.map.get(name);
  }

  getName(constructor: CustomElementConstructor): string | null {
    for (const [name, ctor] of this.map.entries()) {
      if (ctor === constructor) return name;
    }
    return null;
  }

  whenDefined(name: string): Promise<CustomElementConstructor> {
    const ctor = this.map.get(name);
    return ctor ? Promise.resolve(ctor) : new Promise(() => {});
  }

  upgrade(): void {}

  initialize(): void {}
}

describe('defineCanvasElements()', () => {
  it('importar o pacote não registra tags no customElements global', () => {
    expect(WebComponentsPackage).toBeDefined();
    if (typeof globalThis.customElements !== 'undefined') {
      expect(globalThis.customElements.get('canvas-surface')).toBeUndefined();
    }
  });

  it('registra os elementos padrão no registry', () => {
    const registry = new MockRegistry();
    defineCanvasElements({ registry });

    for (const [tag, ctor] of Object.entries(DEFAULT_CANVAS_ELEMENTS)) {
      expect(registry.get(tag)).toBe(ctor);
    }
  });

  it('registra as sete tags novas e nenhuma tag antiga, com e sem prefixo', () => {
    const plain = new MockRegistry();
    const prefixed = new MockRegistry();
    defineCanvasElements({ registry: plain });
    defineCanvasElements({ prefix: 'canvash', registry: prefixed });
    const tags = [
      'canvas-section',
      'canvas-surface',
      'canvas-toolbar',
      'canvas-properties',
      'canvas-layers',
      'canvas-selection-menu',
      'canvas-controls',
    ];

    expect(tags.map((tag) => plain.get(tag) !== undefined)).toEqual(tags.map(() => true));
    expect(tags.map((tag) => prefixed.get('canvash-' + tag) !== undefined)).toEqual(
      tags.map(() => true),
    );
    const old = legacyTags();
    expect(old).toHaveLength(7);
    expect(old.map((tag) => plain.get(tag))).toEqual(old.map(() => undefined));
    expect(old.map((tag) => prefixed.get('canvash-' + tag))).toEqual(old.map(() => undefined));
  });

  it('é idempotente: chamadas repetidas com os mesmos construtores não lançam erro', () => {
    const registry = new MockRegistry();
    expect(() => {
      defineCanvasElements({ registry });
      defineCanvasElements({ registry });
      defineCanvasElements({ registry });
    }).not.toThrow();

    expect(registry.get('canvas-surface')).toBe(CanvasSurfaceElement);
  });

  it('suporta prefixo customizável para as tags', () => {
    const registry = new MockRegistry();
    defineCanvasElements({ prefix: 'canvash', registry });

    expect(registry.get('canvash-canvas-surface')).toBe(DEFAULT_CANVAS_ELEMENTS['canvas-surface']);
    expect(registry.get('canvash-canvas-toolbar')).toBe(DEFAULT_CANVAS_ELEMENTS['canvas-toolbar']);
    expect(registry.get('canvash-canvas-properties')).toBe(
      DEFAULT_CANVAS_ELEMENTS['canvas-properties'],
    );
    expect(registry.get('canvash-canvas-layers')).toBe(DEFAULT_CANVAS_ELEMENTS['canvas-layers']);
    // Nomes sem prefixo não devem ter sido registrados
    expect(registry.get('canvas-surface')).toBeUndefined();
  });

  it('ignora espaços em branco ao redor do prefixo e usa default se vazio', () => {
    const registry = new MockRegistry();
    defineCanvasElements({ prefix: '  ', registry });

    expect(registry.get('canvas-surface')).toBe(DEFAULT_CANVAS_ELEMENTS['canvas-surface']);
  });

  it('lança erro descritivo em caso de colisão de nome com construtor diferente', () => {
    const registry = new MockRegistry();
    class ForeignElement {}
    registry.define('canvas-surface', ForeignElement as unknown as CustomElementConstructor);

    expect(() => defineCanvasElements({ registry })).toThrowError(
      /Cannot register custom element <canvas-surface>: the name is already defined with a different constructor/,
    );
  });

  it('lança erro descritivo se customElements não estiver disponível e nenhum registry for passado', () => {
    const globalWithCustomElements = globalThis as { customElements?: CustomElementRegistry };
    const originalCustomElements = globalWithCustomElements.customElements;
    try {
      delete globalWithCustomElements.customElements;
      expect(() => defineCanvasElements({})).toThrowError(
        /defineCanvasElements requires a CustomElementRegistry/,
      );
    } finally {
      if (originalCustomElements) {
        globalWithCustomElements.customElements = originalCustomElements;
      }
    }
  });

  it('usa globalThis.customElements por padrão quando options.registry for omitido', () => {
    const globalWithCustomElements = globalThis as { customElements?: CustomElementRegistry };
    const originalCustomElements = globalWithCustomElements.customElements;
    const mockGlobal = new MockRegistry();
    try {
      globalWithCustomElements.customElements = mockGlobal;
      defineCanvasElements();
      expect(mockGlobal.get('canvas-surface')).toBe(DEFAULT_CANVAS_ELEMENTS['canvas-surface']);
    } finally {
      if (originalCustomElements) {
        globalWithCustomElements.customElements = originalCustomElements;
      } else {
        delete globalWithCustomElements.customElements;
      }
    }
  });
});
