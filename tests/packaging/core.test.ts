import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packDirOf } from './global-setup.js';

// Contrato de distribuição do @canvash/core (CORE-01). O pacote é construído e empacotado com
// `pnpm pack` pelo globalSetup e extraído em um projeto temporário fora do workspace, onde nada
// mais está instalado: um import de pacote externo quebraria os smokes.

const packs = inject('canvashPacks');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const namesFile = fileURLToPath(new URL('../../scripts/legacy-names.json', import.meta.url));

// Binários de Node extras para a matriz de compatibilidade, separados pelo delimitador de
// PATH. Sem a variável, os smokes rodam só no Node corrente.
const nodeBinaries = [
  process.execPath,
  ...(process.env.PACKAGING_NODE_BINARIES ?? '').split(delimiter).filter(Boolean),
];

const SMOKE_REPORT = `
const snapshot = createCanvasSection().getSnapshot();
console.log(
  JSON.stringify({
    entry: resolved.split('/@canvash/core/')[1],
    schemaVersion: snapshot.document.schemaVersion,
    layers: snapshot.document.layers.length,
    revision: snapshot.revision,
    frozen: Object.isFrozen(snapshot.document),
    dom: typeof document,
  }),
);
`;

// Cada smoke informa o arquivo que o Node escolheu pelo mapa de exports.
const SMOKE_IMPORT = `
import { createCanvasSection } from '@canvash/core';
const resolved = import.meta.resolve('@canvash/core');
${SMOKE_REPORT}`;
const SMOKE_REQUIRE = `
const { createCanvasSection } = require('@canvash/core');
const resolved = require.resolve('@canvash/core');
${SMOKE_REPORT}`;

// Uso tipado da API pública. Cada @ts-expect-error reprova a compilação se os tipos do pacote
// resolverem para `any` em vez das declarações publicadas.
const TYPED_USAGE = `
import {
  createCanvasSection,
  type CanvasSectionApi,
  type CanvasDocument,
  type CanvasSnapshot,
  type CreateCanvasSectionOptions,
  type Layer,
} from '@canvash/core';

let count = 0;
const options: CreateCanvasSectionOptions = { generateId: () => \`id-\${++count}\`, now: () => 0 };
const section: CanvasSectionApi = createCanvasSection(options);
const snapshot: CanvasSnapshot = section.getSnapshot();
const canvasDocument: CanvasDocument = snapshot.document;
export const revision: number = snapshot.revision;
export const layers: readonly Layer[] = canvasDocument.layers;

const firstLayer = canvasDocument.layers[0];
if (firstLayer) {
  // @ts-expect-error o snapshot é somente leitura
  firstLayer.name = 'outro nome';
}

// @ts-expect-error getSnapshot não aceita argumentos
section.getSnapshot(1);

// @ts-expect-error createCanvasSection não aceita opção desconhecida
createCanvasSection({ unknownOption: true });

// Daqui em diante: a API inteira, como um consumidor a usaria.
import {
  DEFAULT_LIMITS,
  DEFAULT_ZOOM_LIMITS,
  SCHEMA_VERSION,
  fitViewportToBounds,
  isJsonArray,
  isJsonObject,
  screenToWorld,
  shapeBounds,
  validateDocument,
  zoomAt,
  type CanvasChange,
  type CanvasCommand,
  type CanvasError,
  type CanvasNode,
  type Bounds,
  type JsonValue,
  type PreviewInput,
  type Viewport,
  type Result,
  type ShapeNode,
} from '@canvash/core';

const commands: CanvasCommand[] = [
  { type: 'shape.create', shape: { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 } },
  { type: 'shape.create', shape: { type: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }, layerId: undefined },
  { type: 'layer.create', layer: { name: 'Top' } },
  { type: 'shape.update', id: 'l', patch: { style: { strokeWidth: 3 }, metadata: null } },
  { type: 'node.reorder', id: 'l', index: 0 },
];

// As uniões públicas podem crescer: o consumidor trata o que conhece e deixa um default.
function describeError(error: CanvasError): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return error.details.issues.map((issue) => issue.path.join('.') + ' ' + issue.rule).join('; ');
    case 'NOT_FOUND':
      return error.details.kind + ' ' + error.details.id;
    case 'LOCKED':
      return error.details.lockedBy;
    case 'LIMIT_EXCEEDED':
      return error.details.limit + ' ' + String(error.details.max);
    default:
      return error.code;
  }
}

const transacted = section.transact(commands);
export const outcome: string = transacted.ok
  ? transacted.value.createdIds.join(',')
  : describeError(transacted.error);

const changes: CanvasChange[] = [];
const unsubscribe: () => void = section.subscribe((change) => changes.push(change));
const moved: Result<void> = section.setViewport(zoomAt(section.getSnapshot().session.viewport, { x: 0, y: 0 }, DEFAULT_ZOOM_LIMITS.max));
const fitted: Viewport | null = fitViewportToBounds({ x: 0, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }, { padding: 8 });
export const fittedZoom: number | undefined = fitted?.zoom;
section.setSelection(['l']);
section.setTool('hand');
section.setReadOnly(false);
section.setPreview({ additions: [{ id: 'ghost', type: 'ellipse', x: 0, y: 0, width: 1, height: 1, rotation: 0 }], marquee: null });
section.setPreview(null);
unsubscribe();

const hit: string | undefined = section.hitTest(screenToWorld(section.getSnapshot().session.viewport, { x: 1, y: 1 }), { includePreview: false });
const culled: readonly string[] = section.queryBounds({ x: 0, y: 0, width: 100, height: 100 }, { includePreview: true });
const selected: readonly string[] = section.queryMarquee({ x: 0, y: 0, width: 100, height: 100 }, { mode: 'intersect', includePreview: false });
const frame: Bounds | undefined = section.getBounds(selected, { includePreview: false, stroke: false });
const rawNode: CanvasNode | undefined = section.getSnapshot().document.nodes['l'];
const node: ShapeNode | undefined =
  rawNode !== undefined && rawNode.type !== 'group' && rawNode.type !== 'board'
    ? rawNode
    : undefined;
export const nodeBox: Bounds | undefined = node === undefined ? undefined : shapeBounds(node);
export const info = section.getNodeInfo('l');
export const queried = { hit, culled, frame, moved, changes };

const reloaded = validateDocument(JSON.parse(JSON.stringify(section.getSnapshot().document)), { limits: DEFAULT_LIMITS });
export const sameVersion: boolean = reloaded.ok && reloaded.value.schemaVersion === SCHEMA_VERSION;
if (reloaded.ok) section.replaceDocument(reloaded.value, { viewport: { x: 0, y: 0, zoom: 1 } });
section.undo();
section.redo();
section.destroy();

// Funções exportadas com tipo de retorno inferido: quem emite declarações precisa que o
// TypeScript consiga escrever esses tipos a partir do que o pacote exporta.
export function issuesOf(error: CanvasError) {
  return error.code === 'VALIDATION_ERROR' ? error.details : undefined;
}
export function limitOf(error: CanvasError) {
  return error.code === 'LIMIT_EXCEEDED' ? error.details : undefined;
}
export function firstAddition(preview: PreviewInput) {
  return preview.additions?.[0];
}

// Um valor JSON de metadata estreita sem virar any.
export function tagsOf(value: JsonValue): readonly JsonValue[] {
  if (isJsonArray(value)) {
    // @ts-expect-error o array de metadata é somente leitura
    value.push('x');
    return value;
  }
  return isJsonObject(value) ? Object.values(value) : [];
}

// @ts-expect-error toda consulta espacial diz se considera o preview
section.hitTest({ x: 0, y: 0 }, {});

// @ts-expect-error o tipo de comando é uma união fechada de literais
section.dispatch({ type: 'shape.explode' });
`;

// O exemplo de uso, linha a linha, com as leituras que o teste confere entre os passos.
const USAGE_EXAMPLE = `
const section = createCanvasSection();
const result = section.dispatch({
  type: 'shape.create',
  shape: {
    type: 'rectangle',
    x: 100,
    y: 80,
    width: 240,
    height: 120,
    rotation: 0,
  },
});

if (!result.ok) {
  console.error(result.error.code);
}

const created = Object.values(section.getSnapshot().document.nodes);
section.undo();
const afterUndo = Object.keys(section.getSnapshot().document.nodes).length;
section.destroy();
const afterDestroy = section.dispatch({ type: 'shape.remove', id: 'x' });

console.log(JSON.stringify({ ok: result.ok, created, afterUndo, afterDestroy }));
`;
const EXAMPLE_IMPORT = `import { createCanvasSection } from '@canvash/core';\n${USAGE_EXAMPLE}`;
const EXAMPLE_REQUIRE = `const { createCanvasSection } = require('@canvash/core');\n${USAGE_EXAMPLE}`;

// Tudo o que o pacote publicado exporta em execução. O resto é interno.
const PUBLIC_RUNTIME_EXPORTS = [
  'BOARD_TITLE_BAND',
  'BOARD_TITLE_FONT_SIZE',
  'DEFAULT_LIMITS',
  'DEFAULT_PEN_SETTINGS',
  'DEFAULT_SHAPE_LABEL',
  'DEFAULT_STICKY_SIZE',
  'DEFAULT_ZOOM_LIMITS',
  'ERASER_MIN_PIECE_CSS_PX',
  'ERASER_RADII',
  'ERASER_SIZE_NAMES',
  'FONT_SIZE_PRESETS',
  'INK_HIGHLIGHTER_ALPHA',
  'INK_KINDS',
  'INK_LIMITS',
  'INK_WIDTHS',
  'INK_WIDTH_NAMES',
  'MAX_PEERS',
  'MAX_PEER_IDS',
  'MAX_PEER_NAME_LENGTH',
  'PEN_PALETTE',
  'POLYGON_PRESETS',
  'SCHEMA_VERSION',
  'SHAPE_LABEL_LINE_HEIGHT',
  'SHAPE_LABEL_PADDING',
  'STICKY_COLORS',
  'STICKY_PADDING',
  'STICKY_SHADOW',
  'appendInkStroke',
  'bezierBounds',
  'bezierPoint',
  'boardTitleBounds',
  'boundsContain',
  'boundsFromPoints',
  'boundsIntersect',
  'boundsUnion',
  'braceBounds',
  'bracePath',
  'braceRadius',
  'canAppendInkStroke',
  'clampZoom',
  'computeSiblingReorderIndex',
  'containsHtmlTags',
  'createCanvasSection',
  'defaultBezierControls',
  'defaultTextMetricsAdapter',
  'distanceToSegment',
  'eraseFromInk',
  'eraseFromStrokes',
  'eraserRadiusWorld',
  'findGroupOfNode',
  'fitAspect',
  'fitStickyFontSize',
  'fitViewportToBounds',
  'flattenBezier',
  'flattenBrace',
  'inkBounds',
  'inkInputFromStroke',
  'inkPatchFromWorldStrokes',
  'inkPathSegments',
  'inkStrokeAlpha',
  'inkStrokeWidth',
  'inkStrokesToLocal',
  'inkStrokesToWorld',
  'isBindingEndpoint',
  'isBoardNode',
  'isBoxShape',
  'isFreeEndpoint',
  'isGroupNode',
  'isJsonArray',
  'isJsonObject',
  'isLabelable',
  'isZeroLengthArrow',
  'layoutText',
  'mirrorControl',
  'normalizeInkStrokes',
  'pointInShape',
  'resolveAnchorPosition',
  'resolveArrowEndpoints',
  'resolveEndpoint',
  'rotatePoint',
  'screenToWorld',
  'segmentOutsideCapsule',
  'shapeBounds',
  'shapeInsideRect',
  'shapeIntersectsRect',
  'shapeLabelArea',
  'shapeLabelColor',
  'shapeOutline',
  'simplifyPolyline',
  'stickyFoldColor',
  'stickyFoldSize',
  'stickyTextColor',
  'validateDocument',
  'worldToScreen',
  'zoomAt',
];

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

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'canvash-packaging-'));

  // O build e o pack ficam no globalSetup (tests/packaging/global-setup.ts), uma vez por execução.
  const packedDir = packDirOf(packs, '@canvash/core');
  const tarballs = readdirSync(packedDir).filter((name) => name.endsWith('.tgz'));
  expect(tarballs).toHaveLength(1);
  const tarball = join(packedDir, String(tarballs[0]));

  tarballFiles = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''))
    .sort();

  installDir = join(projectDir, 'node_modules', '@canvash', 'core');
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', installDir, '--strip-components=1']);

  writeJson(join(projectDir, 'package.json'), { name: 'packaging-consumer', private: true });
  writeFileSync(join(projectDir, 'smoke.mjs'), SMOKE_IMPORT);
  writeFileSync(join(projectDir, 'smoke.cjs'), SMOKE_REQUIRE);
  writeFileSync(join(projectDir, 'example.mjs'), EXAMPLE_IMPORT);
  writeFileSync(join(projectDir, 'example.cjs'), EXAMPLE_REQUIRE);
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('tarball de @canvash/core', () => {
  it('contém só o manifest e o dist, sem fonte nem testes', () => {
    expect(tarballFiles).toEqual(
      expect.arrayContaining([
        'package.json',
        'dist/index.mjs',
        'dist/index.mjs.map',
        'dist/index.d.mts',
        'dist/index.cjs',
        'dist/index.cjs.map',
        'dist/index.d.cts',
      ]),
    );
    // O pnpm sempre inclui manifest, README, LICENSE e CHANGELOG, mesmo com `files`.
    const unexpected = tarballFiles.filter(
      (file) =>
        !/^(package\.json|(README|LICEN[CS]E|CHANGELOG)(\.md)?)$/i.test(file) &&
        !/^dist\/[\w.-]+\.(mjs|cjs|d\.mts|d\.cts)(\.map)?$/.test(file),
    );
    expect(unexpected).toEqual([]);
    expect(tarballFiles.filter((file) => /\.test\./.test(file))).toEqual([]);
  });

  // Os nomes antigos vêm de scripts/legacy-names.json. Os reservados ficam de fora: o nó novo
  // da área do canvas reutiliza um deles.
  it('não deixa nome antigo nas declarações de tipos publicadas', () => {
    const entries = (
      JSON.parse(readFileSync(namesFile, 'utf8')) as {
        entries: { old: string; guard: string; kind: string }[];
      }
    ).entries.filter((entry) => entry.guard !== 'reserved' && entry.kind !== 'path');
    const isWord = (char: string | undefined): boolean => char !== undefined && /\w/.test(char);
    const hasWord = (text: string, token: string): boolean => {
      for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, at + 1)) {
        if (!isWord(text[at - 1]) && !isWord(text[at + token.length])) return true;
      }
      return false;
    };

    for (const declaration of ['dist/index.d.mts', 'dist/index.d.cts']) {
      const text = readFileSync(join(installDir, declaration), 'utf8');
      expect(entries.filter((entry) => hasWord(text, entry.old)).map((entry) => entry.old)).toEqual(
        [],
      );
    }
  });

  it('declara exports explícitos para import e require, cada um com seus tipos', () => {
    const manifest = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };

    expect(manifest.exports?.['.']).toEqual({
      import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
    });
  });

  // No repositório o manifesto aponta `exports` para o fonte e guarda as entradas de `dist` em
  // `publishConfig`; o `pnpm pack` faz a troca. Um manifesto publicado que ainda citasse `src`
  // apontaria para arquivos que não vão no tarball.
  it('publica o manifesto só com entradas de dist, só com o registro no publishConfig e sem caminho de fonte', () => {
    const text = readFileSync(join(installDir, 'package.json'), 'utf8');
    const manifest = JSON.parse(text) as Record<string, unknown>;

    // O pnpm troca exports, main, module e types; o registro local fica, como trava da US-R.4.
    expect(manifest.publishConfig).toEqual({ registry: 'http://localhost:4873/' });
    expect({ main: manifest.main, module: manifest.module, types: manifest.types }).toEqual({
      main: './dist/index.cjs',
      module: './dist/index.mjs',
      types: './dist/index.d.cts',
    });
    expect(text).not.toContain('src/');
    for (const entry of [manifest.main, manifest.module, manifest.types]) {
      expect(tarballFiles).toContain(String(entry).replace(/^\.\//, ''));
    }
  });

  it('não depende de nenhum pacote', () => {
    const manifest = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('traz sourcemaps autocontidos, só com fontes do pacote', () => {
    const maps = tarballFiles.filter((file) => /\.(mjs|cjs)\.map$/.test(file));
    expect(maps).toHaveLength(2);

    for (const file of maps) {
      const map = JSON.parse(readFileSync(join(installDir, file), 'utf8')) as {
        sources: string[];
        sourcesContent?: (string | null)[];
      };
      // Um caminho fora de ../src/ denuncia código de terceiros embutido no bundle (Lit,
      // React, Vue ou qualquer outro), mesmo sem dependência declarada.
      expect(map.sources.filter((source) => !source.startsWith('../src/'))).toEqual([]);
      // O fonte não vai no tarball: sem sourcesContent o mapa apontaria para o vazio.
      expect(map.sourcesContent?.map((content) => typeof content)).toEqual(
        map.sources.map(() => 'string'),
      );
    }
  });

  for (const nodeBinary of nodeBinaries) {
    for (const [entry, script, file] of [
      ['import', 'smoke.mjs', 'dist/index.mjs'],
      ['require', 'smoke.cjs', 'dist/index.cjs'],
    ] as const) {
      it(`executa createCanvasSection().getSnapshot() por ${entry}, sem DOM, em ${nodeBinary}`, () => {
        const result = spawnSync(nodeBinary, [script], {
          cwd: projectDir,
          encoding: 'utf8',
          env: {},
        });

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          entry: file,
          schemaVersion: 1,
          layers: 1,
          revision: 0,
          frozen: true,
          dom: 'undefined',
        });
      });
    }
  }

  for (const nodeBinary of nodeBinaries) {
    for (const [entry, script] of [
      ['import', 'example.mjs'],
      ['require', 'example.cjs'],
    ] as const) {
      it(`roda o exemplo de uso por ${entry}, em ${nodeBinary} (CORE-01)`, () => {
        const result = spawnSync(nodeBinary, [script], {
          cwd: projectDir,
          encoding: 'utf8',
          env: {},
        });

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          ok: true,
          created: [
            {
              id: expect.any(String),
              type: 'rectangle',
              x: 100,
              y: 80,
              width: 240,
              height: 120,
              rotation: 0,
              visible: true,
              locked: false,
              style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1 },
            },
          ],
          afterUndo: 0,
          afterDestroy: {
            ok: false,
            error: { code: 'DISPOSED', message: expect.any(String), details: {} },
          },
        });
      });
    }
  }

  it('exporta em execução só a API pública, igual por import e por require', () => {
    const listExports = (script: string, source: string): unknown => {
      writeFileSync(join(projectDir, script), source);
      const result = spawnSync(process.execPath, [script], {
        cwd: projectDir,
        encoding: 'utf8',
        env: {},
      });
      expect(result.stderr).toBe('');
      return JSON.parse(result.stdout);
    };

    const imported = listExports(
      'exports.mjs',
      "import * as core from '@canvash/core';\nconsole.log(JSON.stringify(Object.keys(core).sort()));",
    );
    const required = listExports(
      'exports.cjs',
      "console.log(JSON.stringify(Object.keys(require('@canvash/core')).sort()));",
    );

    expect(imported).toEqual(PUBLIC_RUNTIME_EXPORTS);
    expect(required).toEqual(PUBLIC_RUNTIME_EXPORTS);
  });

  it('não expõe nas declarações o que é interno ao pacote', () => {
    for (const file of ['dist/index.d.mts', 'dist/index.d.cts']) {
      const declarations = readFileSync(join(installDir, file), 'utf8');

      for (const internal of [
        'createCanvasSectionWith',
        'CommitCandidate',
        'class Draft',
        'class History',
        'SpatialIndex',
        'DocumentPatch',
      ]) {
        expect(declarations, `${file} cita ${internal}`).not.toContain(internal);
      }
    }
  });

  for (const consumer of TYPE_CONSUMERS) {
    it(`entrega tipos a um consumidor ${consumer.name}`, () => {
      const consumerDir = join(projectDir, consumer.name);
      mkdirSync(consumerDir);
      writeJson(join(consumerDir, 'package.json'), {
        name: consumer.name,
        private: true,
        type: consumer.type,
      });
      writeJson(join(consumerDir, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2022',
          module: consumer.module,
          moduleResolution: consumer.resolution,
          lib: ['ES2022'],
          types: [],
          strict: true,
          // As opções mais exigentes que um consumidor costuma ligar: os tipos publicados
          // precisam servir também a ele.
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          // Emite só declarações: é ao emiti-las que o TypeScript acusa um tipo do pacote que o
          // consumidor não consegue citar.
          declaration: true,
          emitDeclarationOnly: true,
          outDir: 'out',
          skipLibCheck: false,
        },
        files: ['index.ts'],
      });
      writeFileSync(join(consumerDir, 'index.ts'), TYPED_USAGE);

      // --listFiles compila e lista os arquivos do programa: mostra qual declaração do
      // pacote o TypeScript escolheu para este consumidor.
      const result = spawnSync(process.execPath, [tsc, '-p', consumerDir, '--listFiles'], {
        cwd: projectDir,
        encoding: 'utf8',
      });
      const lines = result.stdout.split('\n').filter(Boolean);

      expect({
        status: result.status,
        errors: lines.filter((line) => line.includes('error TS')),
        declarations: lines
          .filter((line) => line.includes('/@canvash/core/'))
          .map((line) => line.split('/@canvash/core/')[1]),
      }).toEqual({ status: 0, errors: [], declarations: [`dist/${consumer.declaration}`] });
    });
  }
});
