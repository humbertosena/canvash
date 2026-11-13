import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checkFast = fileURLToPath(new URL('../../scripts/check-fast.mjs', import.meta.url));

describe('check-fast', () => {
  it('passa com código 0 e tempo de execução quando tudo está limpo', () => {
    const result = spawnSync(process.execPath, [checkFast], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^check:fast: limpo \(\d+\.\d+s\)\n$/);
  }, 15000);
});
