import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Nome do pacote (`@canvash/core`) → diretório que contém só o tarball dele. */
    canvashPacks: Record<string, string>;
  }
}

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const packagesDir = join(rootDir, 'packages');
const execFileAsync = promisify(execFile);

const buildAll = (): void => {
  // Build explícito a cada execução: o tarball testado nunca sai de um dist defasado, mesmo
  // com os scripts de ciclo de vida do pnpm desligados no ambiente. É o mesmo `pnpm build`
  // da raiz, em ordem topológica, uma vez por execução em vez de uma vez por arquivo.
  const result = spawnSync('pnpm', ['--filter', './packages/*', 'run', 'build'], {
    cwd: rootDir,
    encoding: 'utf8',
    // O padrão de 1 MiB mataria o build com ENOBUFS se a saída dos 10 pacotes crescer.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm build falhou (status ${String(result.status)}):\n${result.stdout}${result.stderr}`,
      { cause: result.error },
    );
  }
};

const readPackageName = (packageDir: string): string => {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('name' in manifest) ||
    typeof manifest.name !== 'string'
  ) {
    throw new Error(`${packageDir}/package.json não declara "name"`);
  }
  return manifest.name;
};

// Um subdiretório por pacote: num diretório único, `canvash-collaboration-*.tgz` também casaria
// com o tarball de `collaboration-yjs`.
const packOne = async (dirName: string, destination: string): Promise<[string, string]> => {
  const packageDir = join(packagesDir, dirName);
  const packDir = join(destination, dirName);
  mkdirSync(packDir);
  await execFileAsync(
    'pnpm',
    ['pack', '--config.ignore-scripts=true', '--pack-destination', packDir],
    {
      cwd: packageDir,
    },
  );
  return [readPackageName(packageDir), packDir];
};

export default async function setup({ provide }: TestProject): Promise<() => void> {
  buildAll();

  const sharedDir = mkdtempSync(join(tmpdir(), 'canvash-packs-'));
  const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const removeSharedDir = (): void => {
    rmSync(sharedDir, { recursive: true, force: true });
  };
  // allSettled espera todos os packs antes de apagar o diretório: com Promise.all, um pack ainda
  // em curso o recriaria. Se o setup lança, o Vitest não chama o teardown, então limpa aqui.
  const settled = await Promise.allSettled(
    packageDirs.map((dirName) => packOne(dirName, sharedDir)),
  );
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure !== undefined) {
    removeSharedDir();
    throw failure.reason;
  }
  const packs = Object.fromEntries(
    settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : [])),
  );
  provide('canvashPacks', packs);

  return removeSharedDir;
}

/** Diretório do tarball de `name`; falha se o globalSetup não o empacotou. */
export const packDirOf = (packs: Record<string, string>, name: string): string => {
  const dir = packs[name];
  if (dir === undefined) {
    throw new Error(`o globalSetup de tests/packaging não empacotou ${name}`);
  }
  return dir;
};

/** Caminho do único tarball de `name`, para instalar dependências internas no consumidor. */
export const packedTarball = (packs: Record<string, string>, name: string): string => {
  const dir = packDirOf(packs, name);
  const tarballs = readdirSync(dir).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`esperava um tarball de ${name} em ${dir}, achei ${String(tarballs.length)}`);
  }
  return join(dir, String(tarballs[0]));
};
