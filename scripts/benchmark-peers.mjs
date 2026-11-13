#!/usr/bin/env node
// Mede o custo, no quadro do observador, da prévia do arrasto dos outros participantes
// (collab-remote-drag-preview.md §3): 3 participantes arrastando 20 nós cada, numa cena de
// 10.000 nós. Compara o quadro com e sem a prévia e registra o resultado em docs/benchmarks/.
// Mede também `getGroupActions` (group-actions §7): 10.000 nós selecionados e um cursor remoto
// mudando a cada quadro, contra o orçamento de 1 ms.
// É medição, não gate: os orçamentos são comparados no relatório, e o script sai com 0.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'examples/vanilla/dist');
const REPORT = path.resolve(ROOT_DIR, 'docs/benchmarks/colaboracao-2026-10-peers.md');

const BUDGET_MS = 4;
const GROUP_ACTIONS_BUDGET_MS = 1;
const PEERS = 3;
const NODES_PER_PEER = 20;
const FRAMES = 120;
const DPR_LIST = [1, 2];
const RUNS_PER_DPR = 3;

function createPrng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 10.000 retângulos e elipses, a mesma forma da cena do Marco 2. */
function generateScene(seed = 42, total = 10000) {
  const random = createPrng(seed);
  const nodes = {};
  const childIds = [];
  for (let i = 0; i < total; i += 1) {
    const id = `node-${i}`;
    nodes[id] = {
      id,
      type: i % 2 === 0 ? 'rectangle' : 'ellipse',
      x: Math.round((random() * 5000 - 2500) * 10) / 10,
      y: Math.round((random() * 4000 - 2000) * 10) / 10,
      width: Math.round((40 + random() * 120) * 10) / 10,
      height: Math.round((40 + random() * 120) * 10) / 10,
      rotation: Math.round((random() * 2 * Math.PI - Math.PI) * 100) / 100,
      visible: true,
      locked: false,
      style: { fill: '#2563eb', stroke: '#0f172a', strokeWidth: 2, opacity: 0.9 },
    };
    childIds.push(id);
  }
  return {
    schemaVersion: 1,
    id: `doc-benchmark-peers-${seed}`,
    nodes,
    layers: [{ id: 'layer-bench', name: 'Benchmark', visible: true, locked: false, childIds }],
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

const mean = (values) =>
  values.length === 0
    ? 0
    : Math.round((values.reduce((total, v) => total + v, 0) / values.length) * 100) / 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqPath =
        !req.url || req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
      try {
        const file = path.join(DIST_DIR, reqPath);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        });
        res.end(readFileSync(file));
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Sem endereço'));
      resolve({ port: address.port, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

/** Roda no navegador: mede `FRAMES` quadros de pan/zoom, com ou sem prévia de arrasto. */
async function measureFrames(page, withPreview) {
  return page.evaluate(
    async ({ withPreview, frames, peersCount, perPeer }) => {
      const g = globalThis.__CANVASH_PLAYGROUND__;
      const section = g.section;
      const visible = section.queryBounds(
        { x: 0, y: 0, width: 1440, height: 900 },
        { includePreview: false, includeHidden: false },
      );
      const colors = ['#dc2626', '#16a34a', '#9333ea'];
      const peerFor = (index, dx) => {
        const ids = visible.slice(index * perPeer, (index + 1) * perPeer);
        return {
          sessionId: `peer-${index}`,
          name: `Participante ${index}`,
          color: colors[index % colors.length],
          cursor: { x: 200 + index * 100, y: 200 },
          selection: ids,
          selectedAt: index,
          drag: withPreview ? { ids, dx, dy: dx / 2 } : null,
          view: null,
          locks: ids,
          followed: false,
        };
      };
      const setPeers = (dx) =>
        section.setPeers(Array.from({ length: peersCount }, (_, index) => peerFor(index, dx)));

      // Aquecimento
      for (let f = 0; f < 30; f += 1) {
        setPeers(f);
        section.setViewport({ x: Math.sin(f / 5) * 100, y: Math.cos(f / 5) * 100, zoom: 1 });
        await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      }

      const durations = [];
      for (let f = 0; f < frames; f += 1) {
        const angle = (f / 30) * Math.PI;
        // Cada quadro é uma amostra nova do arrasto, o pior caso (a origem manda 20 por segundo).
        setPeers(20 + f * 3);
        section.setViewport({ x: Math.sin(angle) * 350, y: Math.cos(angle) * 250, zoom: 1 });
        await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
        const metrics = g.handle.getMetrics();
        if (typeof metrics.lastPaintDurationMs === 'number')
          durations.push(metrics.lastPaintDurationMs);
      }
      section.setPeers([]);
      return { durations, visibleCount: visible.length };
    },
    { withPreview, frames: FRAMES, peersCount: PEERS, perPeer: NODES_PER_PEER },
  );
}

/** Roda no navegador: o custo de `getGroupActions` com todos os nós selecionados e um cursor remoto. */
async function measureGroupActions(page) {
  return page.evaluate(async (frames) => {
    const g = globalThis.__CANVASH_PLAYGROUND__;
    const { getGroupActions } = globalThis.__CANVASH_INTERACTION__;
    const section = g.section;
    const ids = Object.keys(section.getSnapshot().document.nodes);
    section.setSelection(ids);
    const selected = section.getSnapshot().session.selectedIds;
    const cursorPeer = (f) => ({
      sessionId: 'peer-cursor',
      name: 'Participante',
      color: '#dc2626',
      cursor: { x: 200 + f * 3, y: 200 + f },
      selection: [],
      selectedAt: null,
      drag: null,
      view: null,
      locks: [],
      followed: false,
    });
    const durations = [];
    let last;
    for (let f = 0; f < 30 + frames; f += 1) {
      // Um cursor remoto novo a cada quadro; o documento não muda, e é isso que o índice aproveita.
      section.setPeers([cursorPeer(f)]);
      const start = globalThis.performance.now();
      last = getGroupActions(section, selected);
      const elapsed = globalThis.performance.now() - start;
      if (f >= 30) durations.push(elapsed);
      await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
    }
    section.setPeers([]);
    section.setSelection([]);
    return { durations, selectedCount: selected.length, group: last.group, ungroup: last.ungroup };
  }, FRAMES);
}

async function main() {
  console.log('--- Benchmark da prévia do arrasto remoto (collab-remote-drag-preview) ---');
  console.log('Compilando o playground (vite build)...');
  execSync('pnpm exec vite build examples/vanilla', { cwd: ROOT_DIR, stdio: 'inherit' });

  const server = await startStaticServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const scene = generateScene();
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const rows = [];

  try {
    for (const dpr of DPR_LIST) {
      for (let run = 1; run <= RUNS_PER_DPR; run += 1) {
        console.log(`\n-> DPR ${dpr}, execução ${run} de ${RUNS_PER_DPR}...`);
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: dpr,
        });
        const page = await context.newPage();
        await page.goto(`${baseUrl}/?layout=classic`);
        await page.waitForFunction(
          () => typeof globalThis.__CANVASH_PLAYGROUND__?.handle?.getMetrics === 'function',
        );
        await page.evaluate(async (doc) => {
          const g = globalThis.__CANVASH_PLAYGROUND__;
          const container = globalThis.document.getElementById('canvas-container');
          container.style.width = '1440px';
          container.style.height = '900px';
          g.handle.resize();
          const result = g.section.replaceDocument(doc);
          if (!result.ok)
            throw new Error(`replaceDocument falhou: ${JSON.stringify(result.error)}`);
          g.section.setViewport({ x: 0, y: 0, zoom: 1 });
          g.setGridEnabled(false);
          await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
        }, scene);

        const without = await measureFrames(page, false);
        const withPreview = await measureFrames(page, true);
        const row = {
          dpr,
          run,
          visible: without.visibleCount,
          p95Without: percentile(without.durations, 95),
          p95With: percentile(withPreview.durations, 95),
          meanWithout: mean(without.durations),
          meanWith: mean(withPreview.durations),
        };
        row.deltaP95 = Math.round((row.p95With - row.p95Without) * 100) / 100;
        row.deltaMean = Math.round((row.meanWith - row.meanWithout) * 100) / 100;
        rows.push(row);
        console.log(
          `sem prévia p95=${row.p95Without}ms | com prévia p95=${row.p95With}ms | diferença p95=${row.deltaP95}ms, média=${row.deltaMean}ms`,
        );
        const actions = await measureGroupActions(page);
        row.selected = actions.selectedCount;
        row.actionsP95 = percentile(actions.durations, 95);
        row.actionsMean = mean(actions.durations);
        row.actionsState = `${actions.group}/${actions.ungroup}`;
        console.log(
          `getGroupActions (${row.selected} nós) p95=${row.actionsP95}ms, média=${row.actionsMean}ms`,
        );
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const cpus = os.cpus();
  const machine = `${cpus[0]?.model ?? 'Desconhecido'} (${cpus.length} cores), ${
    Math.round((os.totalmem() / 1024 ** 3) * 10) / 10
  } GB RAM, ${os.type()} ${os.release()} (${os.arch()})`;
  const medianDeltaP95 = percentile(
    rows.map((r) => r.deltaP95),
    50,
  );
  const medianDeltaMean = percentile(
    rows.map((r) => r.deltaMean),
    50,
  );
  const within = medianDeltaP95 <= BUDGET_MS;
  const medianActionsP95 = percentile(
    rows.map((r) => r.actionsP95),
    50,
  );
  const actionsWithin = medianActionsP95 <= GROUP_ACTIONS_BUDGET_MS;
  const actionsTable = rows
    .map(
      (r) =>
        `| DPR ${r.dpr} | Run ${r.run} | ${r.selected} | ${r.actionsState} | ${r.actionsP95} | ${r.actionsMean} |`,
    )
    .join('\n');

  const table = rows
    .map(
      (r) =>
        `| DPR ${r.dpr} | Run ${r.run} | ${r.visible} | ${r.p95Without} | ${r.p95With} | ${r.deltaP95} | ${r.deltaMean} |`,
    )
    .join('\n');

  const report = `# Relatório de Benchmark: prévia do arrasto remoto (remote-drag-preview, US-DP.8)

Data: ${new Date().toISOString().slice(0, 10)}
Status: **prévia do arrasto ${within ? 'dentro' : 'ACIMA'} do orçamento; getGroupActions ${actionsWithin ? 'dentro' : 'ACIMA'} do orçamento** (medição, não gate)

## 1. Ambiente

| Propriedade | Valor |
| --- | --- |
| **Máquina** | ${machine} |
| **Navegador** | Chromium ${browserVersion} (Headless via Playwright) |
| **Runtime** | Node.js ${process.version}, Vite (build de produção do playground Vanilla) |

## 2. Cenário

Cena de 10.000 retângulos e elipses (semente 42), viewport 1440 × 900 CSS px, pan/zoom contínuo por ${FRAMES} quadros depois de 30 de aquecimento. ${PEERS} participantes arrastam ${NODES_PER_PEER} nós visíveis cada um, e **toda amostra do arrasto muda a cada quadro** (o pior caso: a origem publica no máximo 20 por segundo). Os dois lados têm os mesmos participantes, cursores e contornos de bloqueio; só muda o campo \`drag\`:

- **Sem prévia:** \`drag: null\` nos três.
- **Com prévia:** \`drag\` com os 20 nós de cada um, e o renderer desenha a silhueta simplificada.

Três execuções por DPR (1 e 2). A medida é a duração do trabalho de pintura do último quadro (\`lastPaintDurationMs\`).

## 3. Resultados

| DPR | Execução | Nós visíveis | p95 sem prévia (ms) | p95 com prévia (ms) | Diferença p95 (ms) | Diferença da média (ms) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${table}

## 4. Comparativo contra o orçamento

| Medida | Orçamento | Medido (mediana das execuções) | Situação |
| --- | --- | --- | --- |
| Quadro com prévia além do quadro sem prévia (p95) | ≤ ${BUDGET_MS} ms | **${medianDeltaP95} ms** | ${within ? 'Dentro' : 'Acima'} |
| Diferença da média por quadro | (informativo) | ${medianDeltaMean} ms | — |

O orçamento de ${BUDGET_MS} ms é uma proposta da spec e fica como **medição**: o número entra aqui a cada rodada e não reprova o \`check:full\`.

## 5. \`getGroupActions\` (group-actions, spec §7)

A função que diz se Agrupar e Desagrupar aparecem e valem. Cenário: a mesma cena de 10.000 nós, **todos selecionados**, e um cursor remoto novo a cada quadro (\`setPeers\`) por ${FRAMES} quadros, depois de 30 de aquecimento. O documento não muda entre as chamadas, então o índice de camadas e grupos, memorizado por documento, é reaproveitado; o que se paga a cada chamada é o filtro dos nós livres (\`getPeerLock\` por nó) e a conferência das regras.

| DPR | Execução | Nós selecionados | Agrupar/Desagrupar | p95 (ms) | Média (ms) |
| :---: | :---: | :---: | :---: | :---: | :---: |
${actionsTable}

| Medida | Orçamento | Medido (mediana dos p95) | Situação |
| --- | --- | --- | --- |
| \`getGroupActions\` com 10.000 nós selecionados (p95) | ≤ ${GROUP_ACTIONS_BUDGET_MS} ms | **${medianActionsP95} ms** | ${actionsWithin ? 'Dentro' : 'Acima'} |

O orçamento de ${GROUP_ACTIONS_BUDGET_MS} ms também é **medição**, sem gate. Se passar, a tarefa vira pergunta: o orçamento não muda por conta própria.
`;
  writeFileSync(REPORT, report, 'utf8');
  console.log(`\nRelatório gravado em ${path.relative(ROOT_DIR, REPORT)}`);
  console.log(
    `Diferença mediana do p95: ${medianDeltaP95} ms (orçamento ${BUDGET_MS} ms): ${within ? 'dentro' : 'ACIMA'}`,
  );
  console.log(
    `getGroupActions, mediana do p95: ${medianActionsP95} ms (orçamento ${GROUP_ACTIONS_BUDGET_MS} ms): ${actionsWithin ? 'dentro' : 'ACIMA'}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
