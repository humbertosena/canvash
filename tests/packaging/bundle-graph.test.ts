import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(import.meta.dirname, '..', '..');

describe('Grafo de Dependências e Isolamento dos Adaptadores (ADAPTER-05)', () => {
  const readPackageJson = (pkgName: string) => {
    const raw = readFileSync(resolve(rootDir, 'packages', pkgName, 'package.json'), 'utf8');
    return JSON.parse(raw);
  };

  it('@canvash/react declara dependências isoladas sem dependência cruzada de vue', () => {
    const pkg = readPackageJson('react');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };

    expect(deps['vue']).toBeUndefined();
    expect(deps['@canvash/vue']).toBeUndefined();
    expect(pkg.peerDependencies['react']).toBeDefined();
    expect(pkg.peerDependencies['react-dom']).toBeDefined();
    expect(pkg.dependencies['@canvash/core']).toBeDefined();
    expect(pkg.dependencies['@canvash/web-components']).toBeDefined();
  });

  it('@canvash/vue declara dependências isoladas sem dependência cruzada de react', () => {
    const pkg = readPackageJson('vue');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };

    expect(deps['react']).toBeUndefined();
    expect(deps['react-dom']).toBeUndefined();
    expect(deps['@canvash/react']).toBeUndefined();
    expect(pkg.peerDependencies['vue']).toBeDefined();
    expect(pkg.dependencies['@canvash/core']).toBeDefined();
    expect(pkg.dependencies['@canvash/web-components']).toBeDefined();
  });

  it('o core e renderer não dependem de react, vue nem web-components', () => {
    const corePkg = readPackageJson('core');
    const rendererPkg = readPackageJson('renderer-canvas2d');

    const coreDeps = { ...corePkg.dependencies, ...corePkg.peerDependencies };
    const rendererDeps = { ...rendererPkg.dependencies, ...rendererPkg.peerDependencies };

    expect(coreDeps['react']).toBeUndefined();
    expect(coreDeps['vue']).toBeUndefined();
    expect(coreDeps['@canvash/web-components']).toBeUndefined();

    expect(rendererDeps['react']).toBeUndefined();
    expect(rendererDeps['vue']).toBeUndefined();
    expect(rendererDeps['@canvash/web-components']).toBeUndefined();
  });
});
