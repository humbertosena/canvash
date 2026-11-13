import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Versão que o `package.json` de `packages/<dir>` declara no repositório. É a que o `pnpm pack`
 * leva ao tarball e à qual converte as dependências `workspace:*` entre pacotes.
 */
export const manifestVersion = (dir: string): string => {
  const path = fileURLToPath(new URL(`../../packages/${dir}/package.json`, import.meta.url));
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string') throw new Error(`${path} não declara "version"`);
  return manifest.version;
};
