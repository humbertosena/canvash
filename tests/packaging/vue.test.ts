import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packDirOf, packedTarball } from './global-setup.js';
import { manifestVersion } from './manifest-version.js';

const packs = inject('canvashPacks');
const webComponentsDir = fileURLToPath(new URL('../../packages/web-components/', import.meta.url));
const packageDir = fileURLToPath(new URL('../../packages/vue/', import.meta.url));
const rootNodeModules = fileURLToPath(new URL('../../node_modules/', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const nodeBinaries = [
  process.execPath,
  ...(process.env.PACKAGING_NODE_BINARIES ?? '').split(delimiter).filter(Boolean),
];

const SMOKE_REPORT = `
console.log(
  JSON.stringify({
    entry: resolved.split('/@canvash/vue/')[1],
    version: VUE_ADAPTER_VERSION,
  }),
);
`;

const SMOKE_IMPORT = `
import { VUE_ADAPTER_VERSION } from '@canvash/vue';
const resolved = import.meta.resolve('@canvash/vue');
${SMOKE_REPORT}`;

const SMOKE_REQUIRE = `
const { VUE_ADAPTER_VERSION } = require('@canvash/vue');
const resolved = require.resolve('@canvash/vue');
${SMOKE_REPORT}`;

const TYPED_USAGE = `
import {
  CanvasSurface,
  useCanvasSnapshot,
  CanvasToolbar,
  CanvasLayers,
  CanvasProperties,
} from '@canvash/vue';
import type { CanvasSectionApi } from '@canvash/core';

export const isObject = typeof CanvasSurface === 'object';
`;

const TYPE_CONSUMERS = [
  {
    name: 'esm-nodenext',
    type: 'module',
    module: 'NodeNext',
    resolution: 'NodeNext',
    declaration: 'index.d.mts',
  },
  {
    name: 'cjs-nodenext',
    type: 'commonjs',
    module: 'NodeNext',
    resolution: 'NodeNext',
    declaration: 'index.d.cts',
  },
  {
    name: 'bundler',
    type: 'module',
    module: 'ESNext',
    resolution: 'Bundler',
    declaration: 'index.d.mts',
  },
];

let projectDir = '';
let installDir = '';
let tarballFiles: string[] = [];

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

// Instala no consumidor o tarball que o globalSetup empacotou.
const installPacked = (packageName: string, destDir: string): void => {
  const tarball = packedTarball(packs, packageName);
  mkdirSync(destDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', destDir, '--strip-components=1']);
};

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-vue-'));

  // Build e pack ficam no globalSetup; aqui só se instalam os tarballs no consumidor temporário
  installPacked('@canvash/core', join(projectDir, 'node_modules', '@canvash', 'core'));
  installPacked(
    '@canvash/renderer-canvas2d',
    join(projectDir, 'node_modules', '@canvash', 'renderer-canvas2d'),
  );
  installPacked(
    '@canvash/interaction',
    join(projectDir, 'node_modules', '@canvash', 'interaction'),
  );
  installPacked(
    '@canvash/web-components',
    join(projectDir, 'node_modules', '@canvash', 'web-components'),
  );

  // Tarball do vue
  const packedDir = packDirOf(packs, '@canvash/vue');
  const tarballs = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  const tarball = join(packedDir, String(tarballs[0]));

  tarballFiles = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''))
    .sort();

  installDir = join(projectDir, 'node_modules', '@canvash', 'vue');
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);

  // Disponibiliza as dependências externas (vue, lit, etc.) para o consumidor isolado
  const consumerModules = join(projectDir, 'node_modules');
  const webCompModules = join(webComponentsDir, 'node_modules');
  const packageModules = join(packageDir, 'node_modules');

  for (const dep of ['lit', 'lit-html', 'lit-element']) {
    const target = existsSync(join(webCompModules, dep))
      ? join(webCompModules, dep)
      : join(rootNodeModules, dep);
    if (existsSync(target)) {
      symlinkSync(target, join(consumerModules, dep), 'dir');
    }
  }

  for (const dep of ['vue', '@vue']) {
    const target = existsSync(join(packageModules, dep))
      ? join(packageModules, dep)
      : join(rootNodeModules, dep);
    if (existsSync(target)) {
      symlinkSync(target, join(consumerModules, dep), 'dir');
    }
  }

  // @lit scoped packages
  const litScopeTarget = existsSync(join(webCompModules, '@lit'))
    ? join(webCompModules, '@lit')
    : join(rootNodeModules, '@lit');
  if (existsSync(litScopeTarget)) {
    mkdirSync(join(consumerModules, '@lit'), { recursive: true });
    for (const sub of readdirSync(litScopeTarget)) {
      symlinkSync(join(litScopeTarget, sub), join(consumerModules, '@lit', sub), 'dir');
    }
  }

  // @types scoped packages
  const typesTarget = existsSync(join(packageModules, '@types'))
    ? join(packageModules, '@types')
    : join(rootNodeModules, '@types');
  if (existsSync(typesTarget)) {
    mkdirSync(join(consumerModules, '@types'), { recursive: true });
    for (const sub of readdirSync(typesTarget)) {
      symlinkSync(join(typesTarget, sub), join(consumerModules, '@types', sub), 'dir');
    }
  }
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('distribuição do @canvash/vue', () => {
  it('o tarball contém apenas arquivos de dist e package.json', () => {
    expect(tarballFiles).toContain('package.json');
    expect(tarballFiles).toContain('dist/index.mjs');
    expect(tarballFiles).toContain('dist/index.cjs');
    expect(tarballFiles).toContain('dist/index.d.mts');
    expect(tarballFiles).toContain('dist/index.d.cts');
    expect(tarballFiles).toContain('dist/ssr.mjs');
    expect(tarballFiles).toContain('dist/ssr.cjs');
    expect(tarballFiles).toContain('dist/ssr.d.mts');
    expect(tarballFiles).toContain('dist/ssr.d.cts');
    expect(tarballFiles.some((f) => f.startsWith('src/'))).toBe(false);
  });

  it('o tarball não contém código do React nem de teste', () => {
    const distIndex = readFileSync(join(installDir, 'dist', 'index.mjs'), 'utf8');
    expect(distIndex).not.toContain('react');
    expect(distIndex).not.toContain('vitest');
  });

  describe.each(nodeBinaries)('execução no Node (%s)', (nodeBin) => {
    it('resolve a entrada ESM por import', () => {
      const runner = join(projectDir, 'smoke.mjs');
      writeFileSync(runner, SMOKE_IMPORT);
      const result = spawnSync(nodeBin, [runner], { cwd: projectDir, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout.trim());
      expect(report.entry).toBe('dist/index.mjs');
      expect(report.version).toBe(manifestVersion('vue'));
    });

    it('resolve a entrada CJS por require', () => {
      const runner = join(projectDir, 'smoke.cjs');
      writeFileSync(runner, SMOKE_REQUIRE);
      const result = spawnSync(nodeBin, [runner], { cwd: projectDir, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout.trim());
      expect(report.entry).toBe('dist/index.cjs');
      expect(report.version).toBe(manifestVersion('vue'));
    });
  });

  describe.each(TYPE_CONSUMERS)('consumidor TypeScript ($name)', (c) => {
    it('compila contra as declarações publicadas', () => {
      const subDir = join(projectDir, `type-${c.name}`);
      mkdirSync(subDir, { recursive: true });

      writeJson(join(subDir, 'package.json'), {
        name: `consumer-${c.name}`,
        type: c.type,
      });

      writeJson(join(subDir, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2022',
          module: c.module,
          moduleResolution: c.resolution,
          strict: true,
          noEmit: true,
          lib: ['DOM', 'DOM.Iterable', 'ES2022'],
          types: ['node'],
        },
        include: ['usage.ts'],
      });

      writeFileSync(join(subDir, 'usage.ts'), TYPED_USAGE);

      const result = spawnSync(process.execPath, [tsc, '-p', subDir], {
        cwd: subDir,
        encoding: 'utf8',
      });

      expect(result.status, result.stdout + result.stderr).toBe(0);
    });
  });
});
