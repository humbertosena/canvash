import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packedTarball } from './global-setup.js';

// O que o tarball leva além do código: licença, README e changelog. Os contratos por pacote já
// admitem esses arquivos; aqui se confere que eles estão lá, nos dez pacotes.

const packs = inject('canvashPacks');
const rootLicense = readFileSync(new URL('../../LICENSE', import.meta.url));
const packagesDir = fileURLToPath(new URL('../../packages/', import.meta.url));

const packageNames = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const manifest = JSON.parse(
      readFileSync(new URL(`../../packages/${entry.name}/package.json`, import.meta.url), 'utf8'),
    ) as { name: string };
    return manifest.name;
  })
  .sort();

// Lê um arquivo de dentro do tarball sem extrair o resto.
const readFromTarball = (name: string, file: string): Buffer | undefined => {
  const tarball = packedTarball(packs, name);
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n');
  if (!entries.includes(`package/${file}`)) return undefined;
  return execFileSync('tar', ['-xzOf', tarball, `package/${file}`], {
    maxBuffer: 16 * 1024 * 1024,
  });
};

const packedManifest = (name: string): { version: string; dependencies?: Record<string, string> } =>
  JSON.parse((readFromTarball(name, 'package.json') as Buffer).toString('utf8'));

describe('arquivos de apoio nos tarballs', () => {
  it('cobre os dez pacotes de packages/*', () => {
    expect(packageNames).toHaveLength(10);
  });

  describe.each(packageNames)('%s', (name) => {
    it('traz README.md com título, instalação, exemplo e dependências (US-R.6, US-R.8)', () => {
      const readme = readFromTarball(name, 'README.md');
      expect(readme, `${name} não traz README.md`).toBeDefined();
      const text = (readme as Buffer).toString('utf8');
      expect(text.startsWith(`# ${name}\n`)).toBe(true);
      for (const section of ['## Instalação', '## Exemplo', '## Depende de', '## Licença']) {
        expect(text, `${name}: falta a seção "${section}"`).toContain(section);
      }
      expect(text).toContain('```');
      expect(text).toContain(`pnpm add `);
    });

    it('traz CHANGELOG.md com a seção da versão do manifesto (US-R.6)', () => {
      const changelog = readFromTarball(name, 'CHANGELOG.md');
      expect(changelog, `${name} não traz CHANGELOG.md`).toBeDefined();
      const version = packedManifest(name).version;
      // Por prefixo, sem montar regex com a versão.
      const prefix = `## ${version} — `;
      const sections = (changelog as Buffer)
        .toString('utf8')
        .split('\n')
        .filter((line) => line.startsWith(prefix));
      expect(sections.length, `${name}: falta "${prefix}AAAA-MM-DD"`).toBeGreaterThan(0);
      expect(sections.some((line) => /^\d{4}-\d{2}-\d{2}$/.test(line.slice(prefix.length)))).toBe(
        true,
      );
    });

    it('converte as dependências internas em versão exata, igual à do manifesto (US-R.6)', () => {
      const manifest = packedManifest(name);
      const internal = Object.entries(manifest.dependencies ?? {}).filter(([dep]) =>
        dep.startsWith('@canvash/'),
      );
      for (const [dep, range] of internal) {
        expect(range, `${name} → ${dep}`).toBe(manifest.version);
      }
    });

    it('traz LICENSE byte a byte igual ao da raiz (US-R.6)', () => {
      const license = readFromTarball(name, 'LICENSE');
      expect(license, `${name} não traz LICENSE`).toBeDefined();
      expect((license as Buffer).equals(rootLicense)).toBe(true);
    });
  });
});
