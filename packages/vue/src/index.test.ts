import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as VueAdapter from './index.js';
import * as VueSsr from './ssr.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

interface LegacyEntry {
  old: string;
  kind: string;
  slice: string;
}

/** Os identificadores antigos de F5, lidos do JSON para este arquivo não citar nome antigo. */
function legacyExports(): string[] {
  const list = JSON.parse(
    readFileSync(new URL('../../../scripts/legacy-names.json', import.meta.url), 'utf8'),
  ) as { entries: LegacyEntry[] };
  return list.entries
    .filter((entry) => entry.slice === 'F5' && entry.kind === 'identifier')
    .map((entry) => entry.old);
}

const COMPONENTS = [
  'CanvasSection',
  'CanvasSurface',
  'CanvasToolbar',
  'CanvasProperties',
  'CanvasLayers',
  'CanvasSelectionMenu',
  'CanvasControls',
  'useCanvasSnapshot',
];

describe('@canvash/vue exports', () => {
  it('exporta versão e componentes principais', () => {
    expect(VueAdapter.VUE_ADAPTER_VERSION).toBe(manifest.version);
    expect(VueAdapter.CanvasSurface).toBeDefined();
    expect(VueAdapter.CanvasToolbar).toBeDefined();
    expect(VueAdapter.CanvasLayers).toBeDefined();
    expect(VueAdapter.CanvasProperties).toBeDefined();
    expect(VueAdapter.useCanvasSnapshot).toBeDefined();
  });

  it('exporta os sete componentes e o composable com os nomes de canvas', () => {
    for (const name of COMPONENTS) expect(VueAdapter).toHaveProperty(name);
  });

  it('não exporta nenhum nome antigo', () => {
    const old = legacyExports();
    expect(old.length).toBeGreaterThan(0);
    for (const name of old) expect(VueAdapter).not.toHaveProperty(name);
  });

  it('a entrada ./ssr exporta os mesmos nomes de canvas e nenhum antigo', () => {
    for (const name of COMPONENTS) expect(VueSsr).toHaveProperty(name);
    for (const name of legacyExports()) expect(VueSsr).not.toHaveProperty(name);
  });
});
