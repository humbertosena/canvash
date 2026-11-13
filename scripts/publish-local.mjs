#!/usr/bin/env node
// publish-local.mjs — publica os pacotes de `packages/*` no registro npm local (Verdaccio).
// Só publica se TODAS as pré-condições valem; qualquer uma que falhe sai com 2 sem publicar nada.
// As conferências locais (manifestos, git) vêm antes das de rede, para uma recusa local não abrir
// conexão. O registro só pode ser local: `--registry` aceita host `localhost` ou `127.0.0.1`.
// Uso: node scripts/publish-local.mjs [--registry <url>] [--dry-run]
//   --registry <url>  registro local (padrão http://localhost:4873/)
//   --dry-run         confere tudo e imprime o comando de publicação, sem executá-lo
//   --root <pasta>    raiz do repositório (padrão: a deste script; existe para os testes)
// Saída: 0 publicou (ou simulou); 1 falha durante a publicação; 2 pré-condição ou uso incorreto.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REGISTRY = 'http://localhost:4873/';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

class Refusal extends Error {}

const refuse = (message) => {
  throw new Refusal(message);
};

/** Normaliza para comparar: o registro sempre termina em `/`. */
const normalizeRegistry = (value) => (value.endsWith('/') ? value : `${value}/`);

/** Só registro local: o publish nunca vai ao npm público por engano. */
export const parseRegistry = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(`o registro "${value}" não é uma URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    refuse(`o registro precisa ser http ou https (recebi ${url.protocol})`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    refuse(
      `o registro "${value}" não é local: só localhost e 127.0.0.1 são aceitos (publicação no npm público não é feita por este script)`,
    );
  }
  return normalizeRegistry(url.toString());
};

/** Manifestos de `packages/*`, com nome, versão, registro declarado e dependências internas. */
export const readPackages = (root) => {
  const dir = join(root, 'packages');
  if (!existsSync(dir)) refuse(`não há pasta packages em ${root}`);
  const packages = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(path)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      refuse(`${path} não é um JSON válido: ${error.message}`);
    }
    packages.push({
      dir: entry.name,
      name: manifest.name,
      version: manifest.version,
      registry: manifest.publishConfig?.registry,
      dependencies: Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }),
    });
  }
  if (packages.length === 0) refuse('nenhum pacote em packages/*');
  return packages;
};

/** Ordem topológica: cada pacote depois dos @canvash/* de que depende. */
export const topologicalOrder = (packages) => {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const done = new Set();
  const ordered = [];
  const visit = (pkg) => {
    if (done.has(pkg.name)) return;
    done.add(pkg.name);
    for (const dep of pkg.dependencies) {
      const target = byName.get(dep);
      if (target !== undefined) visit(target);
    }
    ordered.push(pkg);
  };
  for (const pkg of packages) visit(pkg);
  return ordered;
};

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // Sem o binário (ENOENT) ou estourado o buffer, stdout e stderr vêm nulos: recusa em vez de lançar.
  if (result.error !== undefined) {
    refuse(`não consegui executar ${command}: ${result.error.message}`);
  }
  return result;
};

const gitOutput = (root, args) => {
  const result = run('git', args, root);
  if (result.status !== 0) {
    refuse(`git ${args.join(' ')} falhou: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
};

/** Conferências locais: manifestos e git. Não abrem conexão. */
export const checkLocal = ({ root, registry }) => {
  const packages = readPackages(root);

  const wrongRegistry = packages.filter((pkg) => {
    return pkg.registry === undefined || normalizeRegistry(pkg.registry) !== registry;
  });
  if (wrongRegistry.length > 0) {
    refuse(
      `pacotes que não declaram publishConfig.registry = ${registry}: ${wrongRegistry
        .map((pkg) => `${pkg.name} (${pkg.registry ?? 'sem registro'})`)
        .join(', ')}`,
    );
  }

  const versions = [...new Set(packages.map((pkg) => pkg.version))];
  if (versions.length !== 1) {
    refuse(`os pacotes não têm uma versão só: ${versions.join(', ')}`);
  }
  const version = versions[0];

  const dirty = gitOutput(root, ['status', '--porcelain']);
  if (dirty !== '') refuse(`a árvore de trabalho tem alterações:\n${dirty}`);

  const branch = gitOutput(root, ['branch', '--show-current']);
  if (branch !== 'main')
    refuse(`a branch atual é "${branch || '(destacada)'}", e a publicação sai só da main`);

  const tag = `v${version}`;
  const tags = gitOutput(root, ['tag', '--points-at', 'HEAD']).split('\n');
  if (!tags.includes(tag)) {
    refuse(`o HEAD não tem a tag ${tag} (crie com: git tag -a ${tag} -m "${tag}")`);
  }

  return { packages: topologicalOrder(packages), version };
};

// O `pnpm view` de uma versão que não existe falha de dois jeitos: 404 quando o pacote inteiro não
// está no registro (primeira publicação) e PACKAGE_NOT_FOUND quando o pacote existe e a versão não
// (segunda publicação em diante). As duas dizem "pode publicar"; qualquer outra falha é de rede.
const NOT_FOUND =
  /ERR_PNPM_FETCH_404|ERR_PNPM_PACKAGE_NOT_FOUND|E404|is not in the npm registry|No matching version found/i;

/** Consulta o registro: a versão existe? Recusa se a consulta falha por outro motivo. */
const versionExists = (root, registry, pkg) => {
  const result = run(
    'pnpm',
    ['view', `${pkg.name}@${pkg.version}`, 'version', '--registry', registry],
    root,
  );
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) return result.stdout.trim() !== '';
  if (NOT_FOUND.test(output)) return false;
  refuse(`não consegui consultar ${pkg.name}@${pkg.version} em ${registry}:\n${output.trim()}`);
  return false;
};

/** Conferências de rede, depois das locais. */
export const checkRegistry = ({ root, registry, packages }) => {
  const ping = run('pnpm', ['ping', '--registry', registry], root);
  if (ping.status !== 0) {
    refuse(
      `o registro ${registry} não responde (suba o Verdaccio, veja docs/publicacao-local.md):\n${`${ping.stdout}${ping.stderr}`.trim()}`,
    );
  }
  const who = run('pnpm', ['whoami', '--registry', registry], root);
  if (who.status !== 0 || who.stdout.trim() === '') {
    refuse(
      `não há usuário autenticado em ${registry} (crie com: pnpm adduser --registry ${registry}):\n${`${who.stdout}${who.stderr}`.trim()}`,
    );
  }
  const existing = packages.filter((pkg) => versionExists(root, registry, pkg));
  if (existing.length > 0) {
    refuse(
      `a versão já existe no registro: ${existing.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}. Um registro não aceita republicar; suba a versão com pnpm version:set.`,
    );
  }
};

export const publishCommand = (registry) => [
  'pnpm',
  '-r',
  '--filter',
  './packages/*',
  'publish',
  '--registry',
  registry,
  '--no-git-checks',
];

const parseArgs = (argv) => {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) refuse(`${flag} pede um valor`);
    args.splice(i, 2);
    return value;
  };
  const registry = take('--registry');
  const root = take('--root');
  const dryRun = args.includes('--dry-run');
  if (dryRun) args.splice(args.indexOf('--dry-run'), 1);
  if (args.length > 0) refuse(`argumento desconhecido: ${args.join(' ')}`);
  return {
    registry: registry === undefined ? DEFAULT_REGISTRY : registry,
    root: root ?? fileURLToPath(new URL('..', import.meta.url)),
    dryRun,
  };
};

export const main = (argv, log = console) => {
  try {
    const options = parseArgs(argv);
    const registry = parseRegistry(options.registry);
    const { root } = options;

    const { packages, version } = checkLocal({ root, registry });
    checkRegistry({ root, registry, packages });

    const command = publishCommand(registry);
    if (options.dryRun) {
      log.log(`publish-local (simulação): ${command.join(' ')}`);
      return 0;
    }

    log.log(`publish-local: publicando ${packages.length} pacotes ${version} em ${registry}`);
    const result = spawnSync(command[0], command.slice(1), { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
      const published = [];
      const unknown = [];
      for (const pkg of packages) {
        try {
          if (versionExists(root, registry, pkg)) published.push(pkg);
        } catch (error) {
          if (!(error instanceof Refusal)) throw error;
          unknown.push(pkg);
        }
      }
      const names = (list) => list.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ');
      let summary = 'Nenhum pacote chegou a subir.';
      if (published.length > 0) summary = `Já subiram: ${names(published)}.`;
      if (unknown.length > 0) {
        summary += ` Não consegui conferir no registro: ${names(unknown)}; confira à mão antes de publicar de novo.`;
        if (published.length === 0)
          summary = summary.replace('Nenhum pacote chegou a subir.', 'Não sei quais subiram.');
      }
      log.error(
        `publish-local: a publicação falhou (código ${result.status ?? 'sinal'}). ${summary}`,
      );
      return 1;
    }
    log.log('publish-local: publicados:');
    for (const pkg of packages) log.log(`  ${pkg.name}@${pkg.version}`);
    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      log.error(`publish-local: ${error.message}`);
      return 2;
    }
    throw error;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
