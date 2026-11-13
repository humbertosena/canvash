import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Persistence from './index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('@canvash/persistence exports', () => {
  it('exporta versão e módulos principais', () => {
    expect(Persistence.PERSISTENCE_VERSION).toBe(manifest.version);
    expect(Persistence.serializeDocument).toBeDefined();
    expect(Persistence.parseDocument).toBeDefined();
    expect(Persistence.MAX_DOCUMENT_BYTES).toBe(20 * 1024 * 1024);
    expect(Persistence.IndexedDbStorageAdapter).toBeDefined();
    expect(Persistence.MemoryStorageAdapter).toBeDefined();
    expect(Persistence.createAutosaveManager).toBeDefined();
  });
});
