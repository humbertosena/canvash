#!/usr/bin/env node
// release-ci.mjs — regras do pipeline de release (.github/workflows/release.yml).
// A biblioteca não vai a registro npm: a Release do GitHub guarda os tarballs de `pnpm pack`, e
// quem usa a biblioteca aponta o `pnpm add` para a URL de cada arquivo. As dependências entre os
// pacotes (`workspace:*` no repositório) precisam apontar para os arquivos da mesma Release, senão
// o pnpm iria procurá-las num registro que não as tem.
// Uso:
//   node scripts/release-ci.mjs plan [--notes-file <arquivo>] [--packages-dir <pasta>]
//       confere a coerência da versão e imprime version=, tag= e prerelease= (formato do
//       $GITHUB_OUTPUT); com --notes-file grava as notas da Release
//   node scripts/release-ci.mjs use-release-urls --base-url <url> [--packages-dir <pasta>]
//       troca `workspace:` entre pacotes pela URL do tarball do irmão na Release
// Saída: 0 ok; 2 pré-condição ou uso incorreto.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersionCoherence, listPackageDirs } from './release-packages.mjs';
import { isSemver } from './set-version.mjs';

const defaultPackagesDir = fileURLToPath(new URL('../packages/', import.meta.url));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

class Refusal extends Error {}

const refuse = (message) => {
  throw new Refusal(message);
};

/** Pré-release tem hífen na versão (semver 2.0, item 9). */
export const isPrerelease = (version) => version.includes('-');

/** Nome que o `pnpm pack` dá ao tarball: `@canvash/core` na versão X vira `canvash-core-X.tgz`. */
export const tarballName = (name, version) =>
  `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

const readManifest = (packagesDir, dir) => {
  const path = join(packagesDir, dir, 'package.json');
  return { path, manifest: JSON.parse(readFileSync(path, 'utf8')) };
};

/** https, ou http só em loopback (o teste serve a Release por um servidor local). */
const parseBaseUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(`a base "${value}" não é uma URL`);
  }
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    refuse(`a base precisa ser https (http só em localhost); recebi ${url.protocol}//${url.host}`);
  }
  return url.toString().replace(/\/+$/, '');
};

/**
 * Troca cada dependência `workspace:` de um pacote de `packages/*` pela URL do tarball dele na
 * Release. Devolve os nomes dos pacotes cujo manifesto mudou. Um `workspace:` que não aponta para
 * um pacote de `packages/*` é recusado: o tarball sairia com uma dependência impossível de resolver.
 */
export const useReleaseUrls = ({ packagesDir = defaultPackagesDir, baseUrl }) => {
  const base = parseBaseUrl(baseUrl);
  const entries = listPackageDirs(packagesDir).map((dir) => ({
    dir,
    ...readManifest(packagesDir, dir),
  }));
  const byName = new Map(entries.map((entry) => [entry.manifest.name, entry.manifest]));
  const changed = [];

  for (const { path, manifest } of entries) {
    let touched = false;
    for (const field of ['dependencies', 'optionalDependencies']) {
      const deps = manifest[field];
      if (deps === undefined) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
        const sibling = byName.get(name);
        if (sibling === undefined) {
          refuse(`${manifest.name} depende de ${name} (${spec}), que não está em packages/*`);
        }
        deps[name] = `${base}/${tarballName(sibling.name, sibling.version)}`;
        touched = true;
      }
    }
    if (touched) {
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      changed.push(manifest.name);
    }
  }
  return changed;
};

/** Corpo da seção `## <versão> — data` de um changelog, sem o título; vazio se não houver. */
const changelogSection = (text, version) => {
  const lines = text.split(/\r?\n/);
  const prefix = `## ${version} — `;
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
};

/** Notas da Release: a seção da versão de cada pacote, em ordem alfabética. */
export const releaseNotes = (packagesDir, version) => {
  const parts = [`Canvash ${version}`];
  for (const dir of listPackageDirs(packagesDir)) {
    const { manifest } = readManifest(packagesDir, dir);
    const path = join(packagesDir, dir, 'CHANGELOG.md');
    const body = existsSync(path) ? changelogSection(readFileSync(path, 'utf8'), version) : '';
    parts.push(`### ${manifest.name}\n\n${body === '' ? 'Sem mudanças registradas.' : body}`);
  }
  parts.push(
    'Instalação (sem registro npm): no `pnpm-workspace.yaml` do app, `blockExoticSubdeps: false`; depois ' +
      'aponte o `pnpm add` para a URL de cada arquivo `.tgz` desta Release, incluindo sempre o ' +
      '`canvash-core`. Passo a passo: seção Instalação do README do repositório. O `SHA256SUMS` traz ' +
      'a soma de cada arquivo.',
  );
  return `${parts.join('\n\n')}\n`;
};

/** Versão única dos manifestos, tag e notas; recusa se a versão não for coerente. */
export const plan = ({ packagesDir = defaultPackagesDir } = {}) => {
  const { version, problems } = checkVersionCoherence({ packagesDir });
  if (problems.length > 0 || version === undefined) {
    refuse(
      `a versão não é coerente:\n${problems.map((p) => `  ${p.file}: ${p.message}`).join('\n')}`,
    );
  }
  if (!isSemver(version)) {
    refuse(`a versão "${version}" não é semver (sem prefixo v, sem metadado de build com +)`);
  }
  return {
    version,
    tag: `v${version}`,
    prerelease: isPrerelease(version),
    notes: releaseNotes(packagesDir, version),
  };
};

const parseOptions = (argv, allowed) => {
  const args = [...argv];
  const options = {};
  for (const flag of allowed) {
    const i = args.indexOf(flag);
    if (i === -1) continue;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) refuse(`${flag} pede um valor`);
    options[flag] = value;
    args.splice(i, 2);
  }
  if (args.length > 0) refuse(`argumento desconhecido: ${args.join(' ')}`);
  return options;
};

export const main = (argv, log = console) => {
  try {
    const [command, ...rest] = argv;
    if (command === 'plan') {
      const options = parseOptions(rest, ['--notes-file', '--packages-dir']);
      const result = plan({ packagesDir: options['--packages-dir'] ?? defaultPackagesDir });
      if (options['--notes-file'] !== undefined) {
        writeFileSync(options['--notes-file'], result.notes);
      }
      log.log(`version=${result.version}`);
      log.log(`tag=${result.tag}`);
      log.log(`prerelease=${result.prerelease}`);
      return 0;
    }
    if (command === 'use-release-urls') {
      const options = parseOptions(rest, ['--base-url', '--packages-dir']);
      if (options['--base-url'] === undefined) refuse('use-release-urls pede --base-url');
      const changed = useReleaseUrls({
        packagesDir: options['--packages-dir'] ?? defaultPackagesDir,
        baseUrl: options['--base-url'],
      });
      log.log(`release-ci: ${changed.length} manifestos apontam para os tarballs da Release`);
      return 0;
    }
    return refuse(`comando desconhecido: ${command ?? '(nenhum)'}. Use plan ou use-release-urls`);
  } catch (error) {
    if (error instanceof Refusal) {
      log.error(`release-ci: ${error.message}`);
      return 2;
    }
    throw error;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
