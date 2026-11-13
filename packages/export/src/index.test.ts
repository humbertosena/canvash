import { readFileSync } from 'node:fs';
import type { CanvasDocument, CanvasSectionApi } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import * as Export from './index.js';
import type { ExportSource } from './index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('@canvash/export exports', () => {
  it('exporta versão e funções principais de SVG e PNG', () => {
    expect(Export.EXPORT_VERSION).toBe(manifest.version);
    expect(Export.exportSvg).toBeDefined();
    expect(Export.exportPng).toBeDefined();
    expect(Export.escapeXml).toBeDefined();
    expect(Export.DEFAULT_MAX_PIXELS).toBe(16_000_000);
    expect(Export.prepareExportContext).toBeDefined();
    expect(Export.boardExportFileName).toBeDefined();
    expect(Export.prepareBoardExportContext).toBeDefined();
  });

  it('ExportSource é a instância do canvas ou o documento', () => {
    expectTypeOf<ExportSource>().toEqualTypeOf<CanvasSectionApi | CanvasDocument>();
  });
});
