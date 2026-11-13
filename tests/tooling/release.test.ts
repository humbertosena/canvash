import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// A versão do pacote vive no `package.json` e, em sete pacotes, também numa constante de
// `src/version.ts`. A verificação de coerência acusa qualquer divergência e cita o arquivo.

interface CoherenceProblem {
  file: string;
  message: string;
}

interface CoherenceReport {
  version: string | undefined;
  problems: CoherenceProblem[];
}

interface ReleasePackagesModule {
  VERSION_CONSTANTS: Record<string, string>;
  listPackageDirs(packagesDir?: string): string[];
  checkVersionCoherence(options?: { packagesDir?: string }): CoherenceReport;
}

const scriptUrl = new URL('../../scripts/release-packages.mjs', import.meta.url);
const { VERSION_CONSTANTS, checkVersionCoherence, listPackageDirs } = (await import(
  scriptUrl.href
)) as ReleasePackagesModule;

const setVersionScript = fileURLToPath(new URL('../../scripts/set-version.mjs', import.meta.url));
const realPackagesDir = fileURLToPath(new URL('../../packages/', import.meta.url));
const copies: string[] = [];

// Cópia só do que a verificação lê: manifestos, `src/version.ts` e `CHANGELOG.md`.
function copyPackages(): string {
  const root = mkdtempSync(join(tmpdir(), 'canvash-release-'));
  copies.push(root);
  const packagesDir = join(root, 'packages');
  for (const entry of readdirSync(realPackagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = join(realPackagesDir, entry.name);
    const to = join(packagesDir, entry.name);
    mkdirSync(join(to, 'src'), { recursive: true });
    copyFileSync(join(from, 'package.json'), join(to, 'package.json'));
    if (existsSync(join(from, 'src', 'version.ts'))) {
      copyFileSync(join(from, 'src', 'version.ts'), join(to, 'src', 'version.ts'));
    }
    if (existsSync(join(from, 'CHANGELOG.md'))) {
      copyFileSync(join(from, 'CHANGELOG.md'), join(to, 'CHANGELOG.md'));
    }
  }
  return packagesDir;
}

function setManifestVersion(packagesDir: string, name: string, version: string): void {
  const path = join(packagesDir, name, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  manifest.version = version;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('tabela pacote → constante de versão', () => {
  it('lista os sete pacotes da premissa 2 com o nome de cada constante', () => {
    expect(VERSION_CONSTANTS).toEqual({
      export: 'EXPORT_VERSION',
      interaction: 'INTERACTION_VERSION',
      persistence: 'PERSISTENCE_VERSION',
      'renderer-canvas2d': 'RENDERER_VERSION',
      react: 'REACT_ADAPTER_VERSION',
      vue: 'VUE_ADAPTER_VERSION',
      'web-components': 'WEB_COMPONENTS_VERSION',
    });
  });

  it('só `collaboration`, `collaboration-yjs` e `core` ficam de fora: versão de formato não é do pacote', () => {
    const outside = readdirSync(realPackagesDir).filter((name) => !(name in VERSION_CONSTANTS));
    expect(outside.sort()).toEqual(['collaboration', 'collaboration-yjs', 'core']);
  });
});

describe('coerência de versão (US-R.2)', () => {
  it('no repositório real, manifestos e constantes dizem a mesma versão', () => {
    const report = checkVersionCoherence();
    expect(report.problems).toEqual([]);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('numa cópia fiel, passa e informa a versão única', () => {
    const report = checkVersionCoherence({ packagesDir: copyPackages() });
    expect(report.problems).toEqual([]);
    expect(report.version).toBeDefined();
  });

  it('uma constante divergente do manifesto falha e cita o arquivo da constante', () => {
    const packagesDir = copyPackages();
    writeFileSync(
      join(packagesDir, 'export', 'src', 'version.ts'),
      "export const EXPORT_VERSION = '9.9.9';\n",
    );
    const report = checkVersionCoherence({ packagesDir });
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]?.file).toBe('packages/export/src/version.ts');
    expect(report.problems[0]?.message).toContain('9.9.9');
  });

  it('dois manifestos com versões diferentes falham e citam os dois arquivos', () => {
    const packagesDir = copyPackages();
    setManifestVersion(packagesDir, 'core', '0.2.0');
    setManifestVersion(packagesDir, 'react', '0.3.0');
    const files = checkVersionCoherence({ packagesDir }).problems.map((problem) => problem.file);
    expect(files).toContain('packages/core/package.json');
    expect(files).toContain('packages/react/package.json');
    expect(files).toContain('packages/react/src/version.ts');
  });

  it('um version.ts sem a constante esperada falha e cita o arquivo', () => {
    const packagesDir = copyPackages();
    writeFileSync(join(packagesDir, 'vue', 'src', 'version.ts'), 'export {};\n');
    const report = checkVersionCoherence({ packagesDir });
    expect(report.problems.map((problem) => problem.file)).toEqual(['packages/vue/src/version.ts']);
    expect(report.problems[0]?.message).toContain('VUE_ADAPTER_VERSION');
  });

  it('um pacote da tabela sem version.ts falha e cita o arquivo que falta', () => {
    const packagesDir = copyPackages();
    rmSync(join(packagesDir, 'persistence', 'src', 'version.ts'));
    const report = checkVersionCoherence({ packagesDir });
    expect(report.problems.map((problem) => problem.file)).toEqual([
      'packages/persistence/src/version.ts',
    ]);
  });

  it('um changelog sem a seção da versão do manifesto falha e cita o arquivo', () => {
    const packagesDir = copyPackages();
    writeFileSync(
      join(packagesDir, 'persistence', 'CHANGELOG.md'),
      '# Changelog\n\n## 0.0.1 — 2026-01-01\n\nAntiga.\n',
    );
    const report = checkVersionCoherence({ packagesDir });
    expect(report.problems.map((problem) => problem.file)).toEqual([
      'packages/persistence/CHANGELOG.md',
    ]);
    expect(report.problems[0]?.message).toContain(`## ${report.version}`);
  });

  it('a seção do changelog exige a data no formato AAAA-MM-DD', () => {
    const packagesDir = copyPackages();
    const version = checkVersionCoherence({ packagesDir }).version;
    writeFileSync(
      join(packagesDir, 'export', 'CHANGELOG.md'),
      `# Changelog\n\n## ${version} — ontem\n`,
    );
    const files = checkVersionCoherence({ packagesDir }).problems.map((problem) => problem.file);
    expect(files).toEqual(['packages/export/CHANGELOG.md']);
  });

  it('um pacote sem CHANGELOG.md falha e cita o arquivo que falta', () => {
    const packagesDir = copyPackages();
    rmSync(join(packagesDir, 'core', 'CHANGELOG.md'));
    const report = checkVersionCoherence({ packagesDir });
    expect(report.problems.map((problem) => problem.file)).toEqual(['packages/core/CHANGELOG.md']);
  });

  it('um manifesto sem `version` falha e cita o arquivo', () => {
    const packagesDir = copyPackages();
    const path = join(packagesDir, 'vue', 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    delete manifest.version;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const files = checkVersionCoherence({ packagesDir }).problems.map((problem) => problem.file);
    expect(files).toContain('packages/vue/package.json');
  });
});

// O `set-version` roda sempre sobre a cópia temporária: o repositório real nunca é gravado aqui.
function runSetVersion(packagesDir: string, ...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [setVersionScript, ...args, '--packages-dir', packagesDir],
    { encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function snapshot(packagesDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of listPackageDirs(packagesDir)) {
    for (const rel of ['package.json', join('src', 'version.ts')]) {
      const path = join(packagesDir, name, rel);
      if (existsSync(path)) files[`${name}/${rel}`] = readFileSync(path, 'utf8');
    }
  }
  return files;
}

describe('pnpm version:set (US-R.1)', () => {
  it('grava a versão nos dez manifestos e nas sete constantes e lista os arquivos alterados', () => {
    const packagesDir = copyPackages();
    const before = snapshot(packagesDir);
    const result = runSetVersion(packagesDir, '0.2.0');
    expect(result.status).toBe(0);

    const manifests = listPackageDirs(packagesDir);
    expect(manifests).toHaveLength(10);
    for (const name of manifests) {
      const manifest = JSON.parse(
        readFileSync(join(packagesDir, name, 'package.json'), 'utf8'),
      ) as {
        version: string;
      };
      expect(manifest.version, name).toBe('0.2.0');
    }
    for (const [name, constant] of Object.entries(VERSION_CONSTANTS)) {
      const text = readFileSync(join(packagesDir, name, 'src', 'version.ts'), 'utf8');
      expect(text, name).toContain(`export const ${constant} = '0.2.0';`);
      expect(text, name).toMatch(/^\/\/ Gerado por scripts\/set-version\.mjs/);
    }
    for (const name of manifests) {
      expect(result.stdout).toContain(`packages/${name}/package.json`);
    }
    for (const name of Object.keys(VERSION_CONSTANTS)) {
      expect(result.stdout).toContain(`packages/${name}/src/version.ts`);
    }
    // Pacote fora da tabela só recebe o package.json.
    expect(snapshot(packagesDir)['core/src/version.ts']).toBeUndefined();
    expect(before['collaboration/src/version.ts']).toBe(
      snapshot(packagesDir)['collaboration/src/version.ts'],
    );
    // O `set-version` não escreve changelog: só a seção da versão nova fica por escrever.
    const problems = checkVersionCoherence({ packagesDir }).problems;
    expect(problems.filter((problem) => !problem.file.endsWith('CHANGELOG.md'))).toEqual([]);
  });

  it('muda no manifesto só a linha da versão e preserva o resto byte a byte', () => {
    const packagesDir = copyPackages();
    const before = snapshot(packagesDir);
    runSetVersion(packagesDir, '0.2.0');
    const after = snapshot(packagesDir);
    for (const name of listPackageDirs(packagesDir)) {
      const key = `${name}/package.json`;
      const original = before[key] as string;
      expect(after[key], key).toBe(original.replace(/^( {2}"version": ")[^"]*(")/m, '$10.2.0$2'));
    }
  });

  it('repetido com a mesma versão, não altera nenhum arquivo e diz que já estava nela', () => {
    const packagesDir = copyPackages();
    runSetVersion(packagesDir, '0.2.0');
    const before = snapshot(packagesDir);
    const result = runSetVersion(packagesDir, '0.2.0');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('já estava na versão 0.2.0');
    expect(snapshot(packagesDir)).toEqual(before);
  });

  it.each(['1.0', 'v0.1.0', '01.2.3', '0.1.0+build', '', ' 0.1.0'])(
    'recusa %j com código 2 e não altera nada',
    (version) => {
      const packagesDir = copyPackages();
      const before = snapshot(packagesDir);
      const result = runSetVersion(packagesDir, version);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('semver');
      expect(snapshot(packagesDir)).toEqual(before);
    },
  );

  it('sem argumento sai com 2 e não altera nada', () => {
    const packagesDir = copyPackages();
    const before = snapshot(packagesDir);
    const result = runSetVersion(packagesDir);
    expect(result.status).toBe(2);
    expect(snapshot(packagesDir)).toEqual(before);
  });

  it.each(['1.0.0-01', '1.0.0-rc.01', '1.0.0-', '1.0.0-rc..1', '1.0.0-rc.'])(
    'recusa o pré-release inválido %j',
    (version) => {
      const packagesDir = copyPackages();
      const before = snapshot(packagesDir);
      expect(runSetVersion(packagesDir, version).status).toBe(2);
      expect(snapshot(packagesDir)).toEqual(before);
    },
  );

  it.each(['1.0.0-0', '1.0.0-rc.1', '1.0.0-alpha-01', '1.0.0-0a', '1.0.0-x.7.z.92'])(
    'aceita o pré-release válido %j',
    (version) => {
      expect(runSetVersion(copyPackages(), version).status).toBe(0);
    },
  );

  it('aceita pré-release', () => {
    const packagesDir = copyPackages();
    expect(runSetVersion(packagesDir, '0.2.0-rc.1').status).toBe(0);
    expect(checkVersionCoherence({ packagesDir }).version).toBe('0.2.0-rc.1');
  });
});

describe('destino de publicação (US-R.3 e US-R.4)', () => {
  const readJson = (path: string): { private?: boolean; publishConfig?: { registry?: string } } =>
    JSON.parse(readFileSync(path, 'utf8'));
  const rootDir = fileURLToPath(new URL('../../', import.meta.url));

  it.each(listPackageDirs())('packages/%s não é private', (name) => {
    expect(readJson(join(realPackagesDir, name, 'package.json')).private).toBeUndefined();
  });

  it('a raiz e os quatro exemplos continuam private', () => {
    const examples = readdirSync(join(rootDir, 'examples'), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(rootDir, 'examples', entry.name, 'package.json')),
      )
      .map((entry) => entry.name)
      .sort();
    expect(examples).toEqual(['react', 'vanilla', 'vue', 'web-components']);
    expect(readJson(join(rootDir, 'package.json')).private).toBe(true);
    for (const name of examples) {
      expect(readJson(join(rootDir, 'examples', name, 'package.json')).private, name).toBe(true);
    }
  });

  it.each(listPackageDirs())('packages/%s publica no registro local por padrão', (name) => {
    expect(readJson(join(realPackagesDir, name, 'package.json')).publishConfig?.registry).toBe(
      'http://localhost:4873/',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// publish:local. Cada caso roda o script num repositório git temporário, contra um registro falso
// servido pelo próprio teste. O registro real (`localhost:4873`) nunca é usado: toda chamada leva
// `--registry` explícito e o `HOME` é um diretório temporário, sem credencial do usuário.

interface PublishLocalModule {
  parseRegistry(value: string): string;
  topologicalOrder(
    packages: { name: string; dependencies: string[] }[],
  ): { name: string; dependencies: string[] }[];
}

const publishLocalUrl = new URL('../../scripts/publish-local.mjs', import.meta.url);
const publishLocalScript = fileURLToPath(publishLocalUrl);
const { parseRegistry, topologicalOrder } = (await import(
  publishLocalUrl.href
)) as PublishLocalModule;

interface FakeRegistry {
  server: Server;
  port: number;
  url: string;
  requests: string[];
  whoamiStatus: number;
  existing: Set<string>;
  publishedVersion: string;
  putStatus: number;
  failPutFor: string | null;
}

const fake = {} as FakeRegistry;

beforeAll(async () => {
  fake.requests = [];
  fake.existing = new Set();
  fake.publishedVersion = '0.1.0';
  fake.whoamiStatus = 200;
  fake.putStatus = 201;
  fake.failPutFor = null;
  fake.server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    fake.requests.push(`${req.method} ${decodeURIComponent(path)}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'PUT') {
      const published = decodeURIComponent(path.slice(1));
      req.resume();
      req.on('end', () => {
        const failing = fake.putStatus >= 400 || fake.failPutFor === published;
        if (!failing) fake.existing.add(published);
        send(failing ? 500 : fake.putStatus, { ok: !failing });
      });
      return;
    }
    if (path === '/-/ping') return send(200, {});
    if (path === '/-/whoami') {
      return fake.whoamiStatus === 200
        ? send(200, { username: 'tester' })
        : send(fake.whoamiStatus, { error: 'não autenticado' });
    }
    const name = decodeURIComponent(path.slice(1));
    if (fake.existing.has(name)) {
      return send(200, {
        name,
        'dist-tags': { latest: fake.publishedVersion },
        versions: {
          [fake.publishedVersion]: {
            name,
            version: fake.publishedVersion,
            dist: { tarball: `${fake.url}x.tgz` },
          },
        },
      });
    }
    return send(404, { error: 'not found' });
  });
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  fake.port = (fake.server.address() as AddressInfo).port;
  fake.url = `http://127.0.0.1:${String(fake.port)}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => fake.server.close(() => resolve()));
});

beforeEach(() => {
  fake.requests.length = 0;
  fake.existing.clear();
  fake.publishedVersion = '0.1.0';
  fake.whoamiStatus = 200;
  fake.putStatus = 201;
  fake.failPutFor = null;
});

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

interface RepoOptions {
  registry?: string;
  secondRegistry?: string;
  branch?: string;
  tag?: string | null;
  dirty?: boolean;
  install?: boolean;
  version?: string;
}

// Dois pacotes: `pa` depende de `pb`, então a ordem topológica (pb, pa) difere da alfabética.
function makeRepo(options: RepoOptions = {}): { root: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'canvash-publish-'));
  const home = mkdtempSync(join(tmpdir(), 'canvash-publish-home-'));
  copies.push(root, home);
  const registry = options.registry ?? fake.url;
  const write = (path: string, content: string) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  write(join(root, 'package.json'), '{"name":"tmp-root","version":"0.0.0","private":true}\n');
  // Sem retentativa: o registro falso responde 500 de propósito e o pnpm esperaria minutos.
  write(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\nfetchRetries: 0\n");
  write(join(root, '.npmrc'), `//127.0.0.1:${String(fake.port)}/:_authToken=token-de-teste\n`);
  const manifest = (name: string, extra: object, reg: string) =>
    `${JSON.stringify({ name, version: options.version ?? '0.1.0', license: 'MIT', publishConfig: { registry: reg }, ...extra }, null, 2)}\n`;
  write(
    join(root, 'packages', 'pa', 'package.json'),
    manifest('@canvash/pa', { dependencies: { '@canvash/pb': 'workspace:*' } }, registry),
  );
  write(
    join(root, 'packages', 'pb', 'package.json'),
    manifest('@canvash/pb', {}, options.secondRegistry ?? registry),
  );
  write(join(root, '.gitignore'), 'node_modules\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'teste@example.com');
  git(root, 'config', 'user.name', 'Teste');
  if (options.install === true) {
    // O `workspace:*` de `pb` só se resolve com o workspace instalado (sem rede: só links locais).
    const installed = spawnSync('pnpm', ['install', '--offline', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home },
    });
    if (installed.status !== 0)
      throw new Error(`pnpm install: ${installed.stdout}${installed.stderr}`);
  }
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'inicial');
  if (options.tag !== null) {
    git(root, 'tag', '-a', options.tag ?? `v${options.version ?? '0.1.0'}`, '-m', 'versão');
  }
  if (options.branch !== undefined) git(root, 'checkout', '-q', '-b', options.branch);
  if (options.dirty === true) write(join(root, 'sujeira.txt'), 'x');
  return { root, home };
}

// Assíncrono de propósito: o registro falso vive neste processo, e um `spawnSync` o travaria
// (o script esperaria uma resposta que o teste, bloqueado, não pode dar).
function runPublishLocal(
  repo: { root: string; home: string },
  ...args: string[]
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [publishLocalScript, '--root', repo.root, ...args], {
      cwd: repo.root,
      env: { PATH: process.env.PATH ?? '', HOME: repo.home, USERPROFILE: repo.home },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

const puts = () => fake.requests.filter((request) => request.startsWith('PUT'));

describe('registro e ordem (unidade)', () => {
  it('aceita só registro local e normaliza a barra final', () => {
    expect(parseRegistry('http://localhost:4873')).toBe('http://localhost:4873/');
    expect(parseRegistry('http://127.0.0.1:4873/')).toBe('http://127.0.0.1:4873/');
  });

  it.each([
    'https://registry.npmjs.org/',
    'http://example.com:4873/',
    'http://localhost.evil.com/',
    'ftp://localhost/',
    'não é url',
  ])('recusa %j', (value) => {
    expect(() => parseRegistry(value)).toThrow();
  });

  it('ordena cada pacote depois dos que ele usa', () => {
    const order = topologicalOrder([
      { name: 'c', dependencies: ['b', 'externo'] },
      { name: 'b', dependencies: ['a'] },
      { name: 'a', dependencies: [] },
    ]).map((pkg) => pkg.name);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('pnpm publish:local: recusas (US-R.5, V6 e V7)', () => {
  it('um manifesto que declara outro registro: sai com 2, cita o pacote e não abre conexão', async () => {
    const repo = makeRepo({ secondRegistry: 'https://registry.npmjs.org/' });
    const result = await runPublishLocal(repo, '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('@canvash/pb');
    expect(result.stderr).toContain('registry.npmjs.org');
    expect(fake.requests).toEqual([]);
  });

  it('árvore com alteração: sai com 2 e não abre conexão', async () => {
    const result = await runPublishLocal(makeRepo({ dirty: true }), '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sujeira.txt');
    expect(fake.requests).toEqual([]);
  });

  it('branch diferente da main: sai com 2 e não abre conexão', async () => {
    const result = await runPublishLocal(makeRepo({ branch: 'outra' }), '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"outra"');
    expect(fake.requests).toEqual([]);
  });

  it('HEAD sem a tag da versão: sai com 2 e não abre conexão', async () => {
    const result = await runPublishLocal(makeRepo({ tag: null }), '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('v0.1.0');
    expect(fake.requests).toEqual([]);
  });

  it('tag de outra versão no HEAD não vale', async () => {
    const result = await runPublishLocal(makeRepo({ tag: 'v9.9.9' }), '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('v0.1.0');
  });

  it('registro que não responde: sai com 2 e não publica', async () => {
    // Uma porta livre que ninguém escuta.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const url = `http://127.0.0.1:${String(port)}/`;
    const result = await runPublishLocal(makeRepo({ registry: url }), '--registry', url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('não responde');
    expect(puts()).toEqual([]);
  });

  it('sem usuário autenticado: sai com 2 e não publica', async () => {
    fake.whoamiStatus = 401;
    const result = await runPublishLocal(makeRepo(), '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usuário');
    expect(puts()).toEqual([]);
  });

  it('versão que já existe no registro: sai com 2 e não publica', async () => {
    fake.existing.add('@canvash/pa');
    const result = await runPublishLocal(makeRepo(), '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('@canvash/pa@0.1.0');
    expect(puts()).toEqual([]);
  });

  it.each([
    'https://registry.npmjs.org/',
    'http://example.com:4873/',
    'http://localhost.evil.com/',
  ])(
    'registro não local %s: sai com 2 antes de qualquer verificação e o registro falso nunca recebe PUT',
    async (url) => {
      const result = await runPublishLocal(makeRepo(), '--registry', url);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('não é local');
      expect(fake.requests).toEqual([]);
    },
  );

  it('argumento desconhecido: sai com 2', async () => {
    const result = await runPublishLocal(makeRepo(), '--registry', fake.url, '--force');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--force');
  });
});

describe('pnpm publish:local: segunda versão e entradas inválidas', () => {
  it('pacote já publicado em 0.1.0 e versão nova 0.1.1: confere e deixa publicar (simulação)', async () => {
    // O pnpm view diz PACKAGE_NOT_FOUND (e não 404) quando o pacote existe e a versão não.
    fake.existing.add('@canvash/pa');
    fake.existing.add('@canvash/pb');
    const result = await runPublishLocal(
      makeRepo({ version: '0.1.1' }),
      '--registry',
      fake.url,
      '--dry-run',
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(puts()).toEqual([]);
  });

  it('a mesma versão já publicada continua recusada quando o registro tem outras', async () => {
    fake.existing.add('@canvash/pa');
    const result = await runPublishLocal(makeRepo(), '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('@canvash/pa@0.1.0');
  });

  it('package.json inválido: sai com 2, não com 1, e não abre conexão', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo.root, 'packages', 'pa', 'package.json'), 'isto não é json');
    git(repo.root, 'commit', '-q', '-am', 'quebra o manifesto');
    const result = await runPublishLocal(repo, '--registry', fake.url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('packages/pa/package.json');
    expect(fake.requests).toEqual([]);
  });

  it('git fora do PATH: sai com 2 com a causa, sem lançar', async () => {
    const repo = makeRepo();
    const child = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const proc = spawn(
        process.execPath,
        [publishLocalScript, '--root', repo.root, '--registry', fake.url],
        {
          cwd: repo.root,
          env: { PATH: '', HOME: repo.home },
        },
      );
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      proc.on('close', (status) => resolve({ status, stderr }));
    });
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('git');
  });
});

describe('pnpm publish:local: publicação (US-R.5)', () => {
  it('com tudo em ordem, a simulação imprime o comando e não publica', async () => {
    const result = await runPublishLocal(makeRepo(), '--registry', fake.url, '--dry-run');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `pnpm -r --filter ./packages/* publish --registry ${fake.url} --no-git-checks`,
    );
    expect(puts()).toEqual([]);
  });

  it('publica em ordem topológica e lista nome e versão de cada pacote', async () => {
    const result = await runPublishLocal(makeRepo({ install: true }), '--registry', fake.url);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(puts()).toEqual(['PUT /@canvash/pb', 'PUT /@canvash/pa']);
    expect(result.stdout).toMatch(
      /publicados:\n {2}@canvash\/pb@0\.1\.0\n {2}@canvash\/pa@0\.1\.0/,
    );
  }, 60_000);

  it('falha durante a publicação: sai com 1 e diz que nenhum pacote subiu', async () => {
    fake.putStatus = 500;
    const result = await runPublishLocal(makeRepo({ install: true }), '--registry', fake.url);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Nenhum pacote chegou a subir');
  }, 60_000);

  it('falha no segundo pacote da ordem topológica: sai com 1 e diz quais já subiram', async () => {
    fake.failPutFor = '@canvash/pa';
    const result = await runPublishLocal(makeRepo({ install: true }), '--registry', fake.url);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Já subiram: @canvash/pb@0.1.0.');
  }, 60_000);
});
