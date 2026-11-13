import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packedTarball } from './global-setup.js';

// Um app React escrito do zero, sem workspace: só os tarballs do globalSetup, o React e o Lit da
// raiz. É o caminho de quem consome a biblioteca: instalar, compilar com o Vite e abrir no navegador.

const packs = inject('canvashPacks');
const rootNodeModules = fileURLToPath(new URL('../../node_modules/', import.meta.url));
const webComponentsModules = fileURLToPath(
  new URL('../../packages/web-components/node_modules/', import.meta.url),
);
const reactModules = fileURLToPath(new URL('../../packages/react/node_modules/', import.meta.url));

const INDEX_HTML = `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8" /><title>Desenho</title></head>
  <body style="margin: 0">
    <div id="root" style="height: 100vh"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasSection } from '@canvash/core';
import { CanvasSection, CanvasSurface, CanvasToolbar, useCanvasSnapshot } from '@canvash/react';

function App() {
  const [section] = useState(() => createCanvasSection());
  const snapshot = useCanvasSnapshot(section);
  return (
    <CanvasSection section={section} style={{ display: 'block', width: '100%', height: '100%' }}>
      <CanvasSurface
        section={section}
        grid
        ariaLabel="Desenho"
        onCanvasReady={() => {
          (window as unknown as { __ready: boolean }).__ready = true;
        }}
      />
      <CanvasToolbar slot="toolbar" section={section} orientation="vertical" />
      <output slot="overlay" id="count">
        {Object.keys(snapshot?.document.nodes ?? {}).length}
      </output>
    </CanvasSection>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
`;

type Variant = 'production' | 'development';
const VARIANTS: Variant[] = ['production', 'development'];

const CONSUMED = ['core', 'interaction', 'renderer-canvas2d', 'web-components', 'react'] as const;

let projectDir = '';
const servers: Partial<Record<Variant, PreviewServer>> = {};
let browser: Browser | undefined;
const urls: Partial<Record<Variant, string>> = {};

// Prefere o node_modules do pacote que declara a dependência, como os demais contratos.
const dependencyDir = (name: string, ...candidates: string[]): string | undefined =>
  [...candidates, rootNodeModules].map((dir) => join(dir, name)).find((dir) => existsSync(dir));

// Os arquivos do app de prova são constantes deste teste, gravadas no diretório temporário dele.
const writeProjectFile = (relativePath: string, content: string): void => {
  writeFileSync(join(projectDir, relativePath), content);
};

const link = (name: string, ...candidates: string[]): void => {
  const target = dependencyDir(name, ...candidates);
  if (target === undefined) return;
  const destination = join(projectDir, 'node_modules', name);
  mkdirSync(join(destination, '..'), { recursive: true });
  symlinkSync(target, destination, 'dir');
};

beforeAll(async () => {
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-react-app-'));

  for (const name of CONSUMED) {
    const installDir = join(projectDir, 'node_modules', '@canvash', name);
    mkdirSync(installDir, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      packedTarball(packs, `@canvash/${name}`),
      '-C',
      installDir,
      '--strip-components=1',
    ]);
  }

  for (const name of ['react', 'react-dom']) link(name, reactModules);
  for (const name of ['lit', 'lit-html', 'lit-element']) link(name, webComponentsModules);
  const litScope = dependencyDir('@lit', webComponentsModules);
  if (litScope !== undefined) {
    for (const sub of readdirSync(litScope)) {
      const destination = join(projectDir, 'node_modules', '@lit', sub);
      mkdirSync(join(destination, '..'), { recursive: true });
      symlinkSync(join(litScope, sub), destination, 'dir');
    }
  }

  mkdirSync(join(projectDir, 'src'));
  writeProjectFile('index.html', INDEX_HTML);
  writeProjectFile(join('src', 'main.tsx'), MAIN_TSX);

  browser = await chromium.launch();
}, 120_000);

// O Vitest define NODE_ENV=test, e o Vite escolheria o Lit de desenvolvimento em todo build.
// Cada variante fixa o NODE_ENV: produção é o app publicado; desenvolvimento é o `vite dev`,
// onde o Lit acusa campos de classe que escondem os acessores reativos.
const buildVariant = async (mode: 'production' | 'development'): Promise<void> => {
  const inline = {
    root: projectDir,
    configFile: false,
    logLevel: 'silent',
    mode,
    build: { outDir: `dist-${mode}`, minify: mode === 'production' },
    resolve: mode === 'development' ? { conditions: ['development'] } : {},
  } as const;
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = mode;
  try {
    await build(inline);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
  servers[mode] = await preview({ ...inline, preview: { host: '127.0.0.1', port: 0 } });
  const address = servers[mode]?.httpServer.address() as AddressInfo;
  urls[mode] = `http://127.0.0.1:${String(address.port)}/`;
};
afterAll(async () => {
  await browser?.close();
  for (const variant of VARIANTS) await servers[variant]?.close();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe.each(VARIANTS)('app React montado só com os tarballs (%s)', (variant) => {
  beforeAll(() => buildVariant(variant), 120_000);

  it('compila, monta o canvas e desenha um retângulo pela toolbar, sem erro no console', async () => {
    const page = await (browser as Browser).newPage();
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
    });

    await page.goto(urls[variant] as string);
    // Sem `canvas-ready`, a mensagem traz o que o navegador reportou.
    await page
      .waitForFunction('window.__ready === true', undefined, { timeout: 15_000 })
      .catch((error: unknown) => {
        throw new Error(`canvas-ready não chegou: ${String(error)}\n${problems.join('\n')}`, {
          cause: error,
        });
      });

    const defined = await page.evaluate(
      `['canvas-section', 'canvas-surface', 'canvas-toolbar'].map((tag) => !!customElements.get(tag))`,
    );
    expect(defined).toEqual([true, true, true]);
    await expect(page.locator('#count').textContent()).resolves.toBe('0');

    const box = await page.locator('#root').boundingBox();
    expect(box).not.toBeNull();
    const { x, y } = box as { x: number; y: number };
    await page
      .getByRole('button', { name: /Retângulo/ })
      .first()
      .click();
    await page.mouse.move(x + 300, y + 200);
    await page.mouse.down();
    await page.mouse.move(x + 500, y + 350, { steps: 8 });
    await page.mouse.up();

    await page.waitForFunction(`document.querySelector('#count')?.textContent === '1'`);
    expect(problems).toEqual([]);
    await page.close();
  }, 120_000);
});
