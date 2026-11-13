// release-packages.mjs — fonte única de quais pacotes têm constante de versão e do que
// "versão coerente" quer dizer. Reaproveitado por scripts/set-version.mjs e pelos testes.
// Só as sete constantes de versão do PACOTE entram: SCHEMA_VERSION (core), COLLABORATION_VERSION e
// COLLABORATION_YJS_VERSION são versões de formato e de protocolo e não acompanham a publicação.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPackagesDir = fileURLToPath(new URL('../packages/', import.meta.url));

/** Pasta de `packages/*` → nome da constante em `src/version.ts`. */
export const VERSION_CONSTANTS = {
  export: 'EXPORT_VERSION',
  interaction: 'INTERACTION_VERSION',
  persistence: 'PERSISTENCE_VERSION',
  'renderer-canvas2d': 'RENDERER_VERSION',
  react: 'REACT_ADAPTER_VERSION',
  vue: 'VUE_ADAPTER_VERSION',
  'web-components': 'WEB_COMPONENTS_VERSION',
};

/** Linha exata que o `set-version` escreve e que a verificação lê. */
export const versionFileLine = (constant, version) => `export const ${constant} = '${version}';`;

/** Pastas de pacote (as que têm package.json), em ordem alfabética. */
export const listPackageDirs = (packagesDir = defaultPackagesDir) =>
  readdirSync(packagesDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')),
    )
    .map((entry) => entry.name)
    .sort();

const readManifestVersion = (path) => {
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
};

const CHANGELOG_DATE = /^\d{4}-\d{2}-\d{2}[ \t]*$/;

/** Há uma linha `## <versão> — AAAA-MM-DD`? Compara por prefixo, sem montar regex com a versão. */
const hasChangelogSection = (text, version) => {
  const prefix = `## ${version} — `;
  return text
    .split(/\r?\n/)
    .some((line) => line.startsWith(prefix) && CHANGELOG_DATE.test(line.slice(prefix.length)));
};

/**
 * Confere que os manifestos de `packages/*` dizem todos a mesma versão, que cada constante da
 * tabela repete essa versão e que o CHANGELOG.md de cada pacote tem a seção dela. Devolve a versão única (a do primeiro manifesto) e os problemas, cada
 * um com o arquivo, relativo à raiz do repositório.
 */
export const checkVersionCoherence = ({ packagesDir = defaultPackagesDir } = {}) => {
  const root = dirname(packagesDir.replace(/[\\/]+$/, ''));
  const rel = (path) => relative(root, path).split('\\').join('/');
  const problems = [];
  const names = listPackageDirs(packagesDir);
  const versions = new Map();

  for (const name of names) {
    const path = join(packagesDir, name, 'package.json');
    const version = readManifestVersion(path);
    if (version === undefined) {
      problems.push({ file: rel(path), message: 'o manifesto não tem o campo "version"' });
      continue;
    }
    versions.set(name, version);
  }

  const unique = [...new Set(versions.values())];
  const expected = versions.size > 0 ? versions.values().next().value : undefined;
  if (unique.length > 1) {
    for (const [name, version] of versions) {
      if (version === expected) continue;
      problems.push({
        file: rel(join(packagesDir, name, 'package.json')),
        message: `versão ${version} difere da dos demais pacotes (${expected})`,
      });
    }
  }

  for (const [name, constant] of Object.entries(VERSION_CONSTANTS)) {
    const path = join(packagesDir, name, 'src', 'version.ts');
    if (!existsSync(path)) {
      problems.push({ file: rel(path), message: `faltou o arquivo com ${constant}` });
      continue;
    }
    const match = new RegExp(`export const ${constant} = '([^']*)';`).exec(
      readFileSync(path, 'utf8'),
    );
    if (match === null) {
      problems.push({ file: rel(path), message: `não declara ${constant} no formato esperado` });
      continue;
    }
    const manifestVersion = versions.get(name);
    if (manifestVersion !== undefined && match[1] !== manifestVersion) {
      problems.push({
        file: rel(path),
        message: `${constant} é ${match[1]}, mas o manifesto diz ${manifestVersion}`,
      });
    }
  }

  for (const [name, version] of versions) {
    const path = join(packagesDir, name, 'CHANGELOG.md');
    if (!existsSync(path)) {
      problems.push({ file: rel(path), message: 'faltou o CHANGELOG.md do pacote' });
      continue;
    }
    if (!hasChangelogSection(readFileSync(path, 'utf8'), version)) {
      problems.push({
        file: rel(path),
        message: `o changelog não tem a seção "## ${version} — AAAA-MM-DD"`,
      });
    }
  }

  return { version: expected, problems };
};
