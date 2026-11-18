import { type CollaborationTransport, type TransportInbound } from '@canvash/collaboration';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { createMemoryTransport } from './memory-transport.js';
import { YjsCollaborationProvider } from './provider.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { benchmarkDocument, percentile } from './test-support/bench-scene.js';
import { DeterministicTransportHub } from './transport.js';

// Medição, não gate (SPEC-collab-server, P11): quanto leva, na sessão que recebe, desde a chegada
// de um `update` remoto até o fim de `replaceDocument` (aplicar no Y.Doc, reprojetar e trocar o
// documento da section). Sem `CANVASH_BENCH=1` roda uma escala pequena; com ela, a completa.

const FULL = process.env.CANVASH_BENCH === '1';
const SIZES = FULL ? [1_000, 10_000] : [200];
const SAMPLES = FULL ? 40 : 6;

/** Transporte que cronometra o tratamento de cada `update` recebido pela sessão. */
function timing(inner: CollaborationTransport, samples: number[]): CollaborationTransport {
  return {
    get state() {
      return inner.state;
    },
    open: (getHello) => inner.open(getHello),
    commit: (commitId, update, roomEpoch) => inner.commit(commitId, update, roomEpoch),
    sync: (syncState) => inner.sync(syncState),
    sendPresence: (state) => inner.sendPresence(state),
    onStateChange: (listener) => inner.onStateChange(listener),
    close: () => inner.close(),
    onInbound(listener) {
      return inner.onInbound((message: TransportInbound) => {
        const started = performance.now();
        listener(message);
        if (message.type === 'update') samples.push(performance.now() - started);
      });
    },
  };
}

describe('reprojeção no cliente (medição, sem gate)', () => {
  it.each(SIZES)(
    'sala de %i nós: do update remoto ao fim do replaceDocument, p50 e p95',
    async (nodes) => {
      const server = new CollaborativeServerEmulator();
      const hub = new DeterministicTransportHub(server);
      const samples: number[] = [];
      const writer = new YjsCollaborationProvider({ server, transport: hub });
      const reader = new YjsCollaborationProvider({
        createTransport: (context) => timing(createMemoryTransport(hub)(context), samples),
        server,
        transport: hub,
      });
      const writerSection = createCanvasSection();
      const replaced = writerSection.replaceDocument(benchmarkDocument(nodes));
      if (!replaced.ok) throw new Error('não carregou a cena');
      const writing = await writer.connect({
        documentId: 'doc-reprojecao',
        section: writerSection,
      });
      if (!writing.ok) throw new Error(writing.error.message);
      const readerSection = createCanvasSection();
      const reading = await reader.connect({
        documentId: 'doc-reprojecao',
        section: readerSection,
      });
      if (!reading.ok) throw new Error(reading.error.message);
      await hub.settle();
      expect(Object.keys(readerSection.getSnapshot().document.nodes)).toHaveLength(nodes);
      samples.length = 0;

      for (let index = 0; index < SAMPLES; index += 1) {
        const created = writerSection.dispatch({
          type: 'shape.create',
          shape: {
            id: `novo-${index}`,
            type: 'rectangle',
            x: index,
            y: 0,
            width: 10,
            height: 10,
            rotation: 0,
          },
        });
        if (!created.ok) throw new Error('não criou a forma');
        await hub.settle();
      }

      const result = {
        nodes,
        updates: samples.length,
        reprojectionP50Ms: Number(percentile(samples, 0.5).toFixed(2)),
        reprojectionP95Ms: Number(percentile(samples, 0.95).toFixed(2)),
      };
      console.log(`MEDIÇÃO reprojecao ${JSON.stringify(result)}`);
      expect(result.updates).toBeGreaterThanOrEqual(SAMPLES);
      expect(Object.keys(readerSection.getSnapshot().document.nodes)).toHaveLength(nodes + SAMPLES);
      writing.value.destroy();
      reading.value.destroy();
      server.destroy();
    },
    300_000,
  );
});
