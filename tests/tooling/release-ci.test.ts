import { spawnSync } from 'node:child_process';
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
import { afterEach, describe, expect, it } from 'vitest';

// O pipeline de release (`.github/workflows/release.yml`) não publica em registro: anexa à Release
// do GitHub os tarballs de `pnpm pack`, com as dependências entre pacotes apontando para os
// próprios arquivos da Release. As regras testáveis ficam em `scripts/release-ci.mjs`.

interface ReleasePlan {
  version: string;
  tag: string;
  prerelease: boolean;
  notes: string;
}

interface ReleaseCiModule {
  isPrerelease(version: string): boolean;
  tarballName(name: string, version: string): string;
  useReleaseUrls(options: { packagesDir: string; baseUrl: string }): string[];
  releaseNotes(packagesDir: string, version: string): string;
  plan(options: { packagesDir: string }): ReleasePlan;
}

const scriptPath = fileURLToPath(new URL('../../scripts/release-ci.mjs', import.meta.url));
const { isPrerelease, plan, releaseNotes, tarballName, useReleaseUrls } = (await import(
  new URL('../../scripts/release-ci.mjs', import.meta.url).href
)) as ReleaseCiModule;

const realPackagesDir = fileURLToPath(new URL('../../packages/', import.meta.url));
const workflowPath = fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url));
const BASE = 'https://github.com/dono/canvash/releases/download/v0.1.0-alpha';
const copies: string[] = [];

// Cópia só do que a verificação lê: manifestos, `src/version.ts` e `CHANGELOG.md`.
function copyPackages(): string {
  const root = mkdtempSync(join(tmpdir(), 'canvash-release-ci-'));
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

const readManifest = (packagesDir: string, name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(packagesDir, name, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;

const cli = (args: string[]) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('versão e nome dos tarballs', () => {
  it('pré-release tem hífen; versão estável não', () => {
    expect(isPrerelease('0.1.0-alpha')).toBe(true);
    expect(isPrerelease('0.2.0-beta.1')).toBe(true);
    expect(isPrerelease('0.1.0')).toBe(false);
    expect(isPrerelease('1.0.0')).toBe(false);
  });

  it('o nome do tarball é o do `pnpm pack`: escopo sem arroba nem barra', () => {
    expect(tarballName('@canvash/core', '0.1.0-alpha')).toBe('canvash-core-0.1.0-alpha.tgz');
    expect(tarballName('@canvash/renderer-canvas2d', '1.2.3')).toBe(
      'canvash-renderer-canvas2d-1.2.3.tgz',
    );
  });
});

describe('useReleaseUrls: dependências internas viram arquivos da Release', () => {
  it('troca todo `workspace:` entre pacotes pela URL do tarball do irmão', () => {
    const packagesDir = copyPackages();
    const changed = useReleaseUrls({ packagesDir, baseUrl: BASE });

    expect(changed.sort()).toEqual(
      [
        '@canvash/collaboration',
        '@canvash/collaboration-yjs',
        '@canvash/export',
        '@canvash/interaction',
        '@canvash/persistence',
        '@canvash/react',
        '@canvash/renderer-canvas2d',
        '@canvash/vue',
        '@canvash/web-components',
      ].sort(),
    );
    const react = readManifest(packagesDir, 'react') as { dependencies: Record<string, string> };
    expect(react.dependencies['@canvash/core']).toBe(`${BASE}/canvash-core-0.1.0-alpha.tgz`);
    expect(react.dependencies['@canvash/web-components']).toBe(
      `${BASE}/canvash-web-components-0.1.0-alpha.tgz`,
    );
    for (const entry of readdirSync(packagesDir)) {
      expect(readFileSync(join(packagesDir, entry, 'package.json'), 'utf8')).not.toContain(
        'workspace:',
      );
    }
  });

  it('não mexe em dependências de fora nem em outros campos, e mantém o formato do arquivo', () => {
    const packagesDir = copyPackages();
    const path = join(packagesDir, 'collaboration-yjs', 'package.json');
    const before = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    useReleaseUrls({ packagesDir, baseUrl: BASE });
    const text = readFileSync(path, 'utf8');
    const after = JSON.parse(text) as Record<string, unknown>;

    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "name"');
    const { dependencies: depsBefore, ...restBefore } = before as {
      dependencies: Record<string, string>;
    } & Record<string, unknown>;
    const { dependencies: depsAfter, ...restAfter } = after as {
      dependencies: Record<string, string>;
    } & Record<string, unknown>;
    expect(restAfter).toEqual(restBefore);
    expect(Object.keys(depsAfter)).toEqual(Object.keys(depsBefore));
  });

  it('repetir a troca não muda nada: devolve lista vazia', () => {
    const packagesDir = copyPackages();
    useReleaseUrls({ packagesDir, baseUrl: BASE });
    expect(useReleaseUrls({ packagesDir, baseUrl: BASE })).toEqual([]);
  });

  it('aceita a base com barra no fim sem duplicá-la', () => {
    const packagesDir = copyPackages();
    useReleaseUrls({ packagesDir, baseUrl: `${BASE}/` });
    const react = readManifest(packagesDir, 'react') as { dependencies: Record<string, string> };
    expect(react.dependencies['@canvash/core']).toBe(`${BASE}/canvash-core-0.1.0-alpha.tgz`);
  });

  it('recusa base que não seja https (http só em loopback)', () => {
    const packagesDir = copyPackages();
    expect(() =>
      useReleaseUrls({ packagesDir, baseUrl: 'http://exemplo.com/release' }),
    ).toThrowError(/https/);
    expect(() => useReleaseUrls({ packagesDir, baseUrl: 'não é url' })).toThrowError(/URL/);
    expect(() => useReleaseUrls({ packagesDir, baseUrl: 'ftp://127.0.0.1/x' })).toThrowError(
      /https/,
    );
    expect(() =>
      useReleaseUrls({ packagesDir, baseUrl: 'http://127.0.0.1:8080/release' }),
    ).not.toThrow();
  });

  it('recusa um `workspace:` que aponta para pacote fora de packages/*', () => {
    const packagesDir = copyPackages();
    const path = join(packagesDir, 'core', 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    manifest.dependencies = { '@canvash/inexistente': 'workspace:*' };
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => useReleaseUrls({ packagesDir, baseUrl: BASE })).toThrowError(
      /@canvash\/inexistente/,
    );
  });
});

describe('plan e notas da release', () => {
  it('lê a versão dos manifestos e deriva a tag e o pré-release', () => {
    const packagesDir = copyPackages();
    const result = plan({ packagesDir });
    expect(result.version).toBe('0.1.0-alpha');
    expect(result.tag).toBe('v0.1.0-alpha');
    expect(result.prerelease).toBe(true);
  });

  it('recusa versões incoerentes e cita o arquivo', () => {
    const packagesDir = copyPackages();
    const path = join(packagesDir, 'vue', 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    manifest.version = '0.9.9';
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => plan({ packagesDir })).toThrowError(/packages\/vue\/package\.json/);
  });

  it('recusa uma versão que não é semver, mesmo coerente em todos os arquivos', () => {
    const packagesDir = copyPackages();
    const forced = '0.1.0+build.7';
    for (const dir of readdirSync(packagesDir)) {
      const manifestPath = join(packagesDir, dir, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      manifest.version = forced;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const versionPath = join(packagesDir, dir, 'src', 'version.ts');
      if (existsSync(versionPath)) {
        writeFileSync(
          versionPath,
          readFileSync(versionPath, 'utf8').replace("'0.1.0-alpha'", `'${forced}'`),
        );
      }
      const changelogPath = join(packagesDir, dir, 'CHANGELOG.md');
      writeFileSync(
        changelogPath,
        readFileSync(changelogPath, 'utf8').replace('## 0.1.0-alpha — ', `## ${forced} — `),
      );
    }

    expect(() => plan({ packagesDir })).toThrowError(/semver/);
  });

  it('as notas dizem o que a instalação exige: blockExoticSubdeps e o core direto', () => {
    const notes = plan({ packagesDir: copyPackages() }).notes;
    expect(notes).toContain('blockExoticSubdeps: false');
    expect(notes).toContain('canvash-core');
    expect(notes).toContain('SHA256SUMS');
  });

  it('as notas reúnem a seção da versão de cada pacote e ignoram as anteriores', () => {
    const packagesDir = copyPackages();
    const path = join(packagesDir, 'core', 'CHANGELOG.md');
    const text = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      text.replace(
        '# Changelog\n',
        '# Changelog\n\n## 0.1.1 — 2026-12-01\n\n- futuro não entra\n',
      ) + '\n## 0.0.9 — 2026-01-01\n\n- antigo não entra\n',
    );

    const notes = releaseNotes(packagesDir, '0.1.0-alpha');
    expect(notes).toContain('### @canvash/core');
    expect(notes).toContain('### @canvash/vue');
    expect(notes).toContain('Documento, camadas e formas');
    expect(notes).not.toContain('antigo não entra');
    expect(notes).not.toContain('futuro não entra');
    expect(notes).not.toContain('## 0.1.0-alpha —');
  });
});

describe('release-ci (linha de comando)', () => {
  it('plan imprime chave=valor e grava as notas no arquivo pedido', () => {
    const packagesDir = copyPackages();
    const notesFile = join(packagesDir, '..', 'notas.md');
    const result = cli(['plan', '--packages-dir', packagesDir, '--notes-file', notesFile]);

    expect(result.status).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual([
      'version=0.1.0-alpha',
      'tag=v0.1.0-alpha',
      'prerelease=true',
    ]);
    expect(readFileSync(notesFile, 'utf8')).toContain('### @canvash/core');
  });

  it('plan sai com 2 e explica quando a versão é incoerente', () => {
    const packagesDir = copyPackages();
    const path = join(packagesDir, 'core', 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    manifest.version = '0.9.9';
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = cli(['plan', '--packages-dir', packagesDir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('release-ci:');
    expect(result.stdout).toBe('');
  });

  it('use-release-urls reescreve os manifestos e diz quantos mudaram', () => {
    const packagesDir = copyPackages();
    const result = cli(['use-release-urls', '--packages-dir', packagesDir, '--base-url', BASE]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('9 manifestos');
    expect(readFileSync(join(packagesDir, 'react', 'package.json'), 'utf8')).toContain(
      `${BASE}/canvash-core-0.1.0-alpha.tgz`,
    );
  });

  it('recusa comando desconhecido, base ausente e argumento sobrando, sempre com 2', () => {
    const packagesDir = copyPackages();
    expect(cli(['publicar']).status).toBe(2);
    expect(cli([]).status).toBe(2);
    expect(cli(['use-release-urls', '--packages-dir', packagesDir]).status).toBe(2);
    expect(cli(['plan', '--packages-dir', packagesDir, '--nada']).status).toBe(2);
    expect(cli(['plan', '--notes-file']).status).toBe(2);
  });
});

// Regras do arquivo do workflow que um erro de edição quebraria sem ninguém ver: ações presas ao
// hash, permissões declaradas, nenhum segredo, e nada de `${{ }}` dentro de `run:` (injeção de
// script por entrada controlada de fora).
describe('workflow de release', () => {
  const lines = readFileSync(workflowPath, 'utf8').split('\n');

  it('só dispara à mão (workflow_dispatch) e só roda a partir da main', () => {
    const text = lines.join('\n');
    expect(text).toMatch(/^on:\n {2}workflow_dispatch:/m);
    // Só o bloco `on:`: o job também se chama `release`.
    const onBlock = /^on:\n((?: {2}.*\n|\n)+)/m.exec(text)?.[1] ?? '';
    expect(onBlock).not.toBe('');
    expect(onBlock).not.toMatch(/^ {2}(push|pull_request|pull_request_target|release|schedule):/m);
    expect(text).toContain("github.ref == 'refs/heads/main'");
  });

  it('toda ação vem presa ao hash de um commit', () => {
    const uses = lines.filter((line) => /^\s*-?\s*uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses:\s+[\w./-]+@[0-9a-f]{40}(\s|$)/);
    }
  });

  it('declara as permissões no topo, sem escrita por padrão', () => {
    const text = lines.join('\n');
    expect(text).toMatch(/^permissions:\n {2}contents: read\n/m);
  });

  it('não usa segredo algum além do GITHUB_TOKEN e não publica em registro npm', () => {
    const text = lines.join('\n');
    const secrets = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(secrets.every((name) => name === 'GITHUB_TOKEN')).toBe(true);
    expect(text).not.toMatch(/pnpm[^\n]*\bpublish\b|npm publish|NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it('o checkout não deixa o token gravado no disco durante o build de terceiros', () => {
    const text = lines.join('\n');
    expect(text).toContain('persist-credentials: false');
  });

  it('só um 404 do GitHub conta como tag livre', () => {
    const text = lines.join('\n');
    expect(text).toContain('git/ref/tags/');
    expect(text).toContain('HTTP 404');
    expect(text).not.toContain('git ls-remote');
  });

  it('nenhum bloco `run:` interpola expressões ${{ }}', () => {
    let runIndent = -1;
    for (const [index, line] of lines.entries()) {
      const indent = line.length - line.trimStart().length;
      if (runIndent >= 0 && line.trim() !== '' && indent <= runIndent) runIndent = -1;
      const start = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(line);
      if (start !== null) {
        runIndent = (start[1] ?? '').length + (start[2] === undefined ? 0 : 2);
        if ((start[3] ?? '').includes('${{')) {
          throw new Error(`linha ${index + 1}: run com expressão: ${line.trim()}`);
        }
        continue;
      }
      if (runIndent >= 0 && line.includes('${{')) {
        throw new Error(`linha ${index + 1}: run com expressão: ${line.trim()}`);
      }
    }
  });
});

// A instalação por URL carrega a versão da Release numa linha `V=<versão>`. O `version:set` não a
// reescreve, então este teste reprova enquanto algum guia ficar com a versão anterior, como faz o
// teste de coerência com o CHANGELOG.
describe('instruções de instalação pela Release', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const manifestVersion = (
    JSON.parse(readFileSync(join(repoRoot, 'packages', 'core', 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  const docs = [
    'README.md',
    join('docs', 'guia-para-agentes.md'),
    ...readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join('packages', entry.name, 'README.md')),
  ];

  it.each(docs)('%s traz V=<versão dos manifestos>', (doc) => {
    const text = readFileSync(join(repoRoot, doc), 'utf8');
    const versions = [...text.matchAll(/^\s*V=(\S+)/gm)].map((match) => match[1]);
    expect(versions.length, `${doc}: falta a linha V=<versão>`).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set([manifestVersion]));
  });

  it.each(docs)('%s manda liberar blockExoticSubdeps e não aponta para registro local', (doc) => {
    const text = readFileSync(join(repoRoot, doc), 'utf8');
    expect(text).toContain('blockExoticSubdeps');
    expect(text).not.toContain('@canvash:registry=');
  });
});
