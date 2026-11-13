import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ReactAdapter from './index.js';
import * as ReactSsr from './ssr.js';

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

describe('@canvash/react exports', () => {
  it('exporta os componentes e o hook com os nomes de canvas', () => {
    for (const name of COMPONENTS) expect(ReactAdapter).toHaveProperty(name);
  });

  it('não exporta nenhum nome antigo', () => {
    const old = legacyExports();
    expect(old.length).toBeGreaterThan(0);
    for (const name of old) expect(ReactAdapter).not.toHaveProperty(name);
  });

  it('a entrada ./ssr exporta os mesmos nomes de canvas e nenhum antigo', () => {
    for (const name of COMPONENTS) expect(ReactSsr).toHaveProperty(name);
    for (const name of legacyExports()) expect(ReactSsr).not.toHaveProperty(name);
  });
});
