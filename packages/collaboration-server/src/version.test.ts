import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLLABORATION_SERVER_VERSION } from './index.js';

describe('@canvash/collaboration-server', () => {
  it('exporta a versão do pacote, igual à do manifesto', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(COLLABORATION_SERVER_VERSION).toBe(manifest.version);
  });
});
