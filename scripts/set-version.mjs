#!/usr/bin/env node
// set-version.mjs — grava uma versão única nos pacotes de `packages/*`.
// Troca o campo `version` de cada package.json, sem mexer no resto do arquivo, e regrava
// `src/version.ts` nos sete pacotes que têm constante de versão (tabela em release-packages.mjs).
// Não toca em `examples/*`, na raiz, no lockfile nem nos changelogs.
// Uso: node scripts/set-version.mjs <versão> [--packages-dir <pasta>]
// Saída: 0 gravou ou já estava na versão; 2 argumento que não é semver ou uso incorreto.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_CONSTANTS, listPackageDirs, versionFileLine } from './release-packages.mjs';

// Identificador de pré-release numérico não tem zero à esquerda (semver 2.0, item 9).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const MANIFEST_VERSION_LINE = /^( {2}"version": ")[^"]*(")/m;
const HEADER = '// Gerado por scripts/set-version.mjs a partir do package.json. Não edite à mão.';

export const isSemver = (value) => typeof value === 'string' && SEMVER.test(value);

/**
 * Grava `version` nos manifestos e nas constantes. Só escreve o arquivo cujo conteúdo muda.
 * Devolve os caminhos alterados, relativos à raiz do repositório.
 */
export const setVersion = ({ version, packagesDir }) => {
  if (!isSemver(version)) {
    throw new TypeError(`"${version}" não é semver (MAJOR.MINOR.PATCH, pré-release opcional)`);
  }
  const root = dirname(packagesDir.replace(/[\\/]+$/, ''));
  const changed = [];
  const write = (path, next) => {
    if (readFileSync(path, 'utf8') === next) return;
    writeFileSync(path, next);
    changed.push(relative(root, path).split('\\').join('/'));
  };

  for (const name of listPackageDirs(packagesDir)) {
    const manifestPath = join(packagesDir, name, 'package.json');
    const manifest = readFileSync(manifestPath, 'utf8');
    if (!MANIFEST_VERSION_LINE.test(manifest)) {
      throw new Error(`${relative(root, manifestPath)} não tem a linha "version" no nível raiz`);
    }
    write(manifestPath, manifest.replace(MANIFEST_VERSION_LINE, `$1${version}$2`));

    const constant = VERSION_CONSTANTS[name];
    if (constant === undefined) continue;
    const versionPath = join(packagesDir, name, 'src', 'version.ts');
    const next = `${HEADER}\n${versionFileLine(constant, version)}\n`;
    if (existsSync(versionPath)) write(versionPath, next);
    else {
      writeFileSync(versionPath, next);
      changed.push(relative(root, versionPath).split('\\').join('/'));
    }
  }
  return changed;
};

const main = (argv) => {
  const args = [...argv];
  let packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));
  const flag = args.indexOf('--packages-dir');
  if (flag !== -1) {
    const value = args[flag + 1];
    if (value === undefined) {
      console.error('set-version: --packages-dir pede uma pasta');
      return 2;
    }
    packagesDir = value;
    args.splice(flag, 2);
  }
  const [version, ...extra] = args;
  if (version === undefined || extra.length > 0 || !isSemver(version)) {
    console.error(
      `set-version: informe uma versão semver sem prefixo, por exemplo 0.1.0 (recebi ${JSON.stringify(version ?? '')}).\n` +
        'Uso: pnpm version:set <versão>',
    );
    return 2;
  }
  const changed = setVersion({ version, packagesDir });
  if (changed.length === 0) {
    console.log(`set-version: tudo já estava na versão ${version}; nenhum arquivo alterado.`);
    return 0;
  }
  console.log(`set-version: ${changed.length} arquivos na versão ${version}:`);
  for (const file of changed) console.log(`  ${file}`);
  return 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
