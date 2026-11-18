import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryTransport } from './memory-transport.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { transportContractCases, type TransportContractHarness } from './testing/index.js';
import { DeterministicTransportHub } from './transport.js';

describe('contrato do transporte: transporte em memória', () => {
  let hub: DeterministicTransportHub;

  beforeEach(() => {
    hub = new DeterministicTransportHub(new CollaborativeServerEmulator());
  });

  const harness: TransportContractHarness = {
    createTransport: (context) => createMemoryTransport(hub)(context),
    dropLink: (sessionId) => {
      hub.dropLink(sessionId);
      // A volta acontece depois, como numa rede de verdade: quem editar nesse intervalo
      // aparece no `resync`.
      setTimeout(() => hub.restoreLink(sessionId), 0);
    },
    failNextAppends: (_documentId, count) => {
      hub.failNextCommits(count, 'STORAGE_UNAVAILABLE');
    },
  };

  const cases = transportContractCases(harness);

  it('a suíte tem casos e nenhum fica de fora com o harness completo', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.filter((contractCase) => contractCase.skipped !== undefined)).toEqual([]);
    expect(new Set(cases.map((contractCase) => contractCase.name)).size).toBe(cases.length);
  });

  for (const contractCase of cases) {
    it(contractCase.name, contractCase.run);
  }
});

describe('contrato do transporte: harness sem falha de gravação', () => {
  it('os casos de reenvio continuam na lista, marcados, e não rodam nada', async () => {
    const hub = new DeterministicTransportHub(new CollaborativeServerEmulator());
    const cases = transportContractCases({
      createTransport: (context) => createMemoryTransport(hub)(context),
      dropLink: (sessionId) => hub.dropLink(sessionId),
    });

    const skipped = cases.filter((contractCase) => contractCase.skipped !== undefined);

    expect(skipped.length).toBeGreaterThanOrEqual(1);
    for (const contractCase of skipped) {
      expect(contractCase.skipped).toContain('failNextAppends');
      await expect(contractCase.run()).resolves.toBeUndefined();
    }
    expect(hub.getClientCount()).toBe(0);
  });
});

describe('contrato do transporte: acusa quem viola', () => {
  it('um transporte que perde o recibo no reenvio reprova o caso do recibo', async () => {
    const hub = new DeterministicTransportHub(new CollaborativeServerEmulator());
    let counter = 0;
    const cases = transportContractCases({
      createTransport: (context) => {
        const real = createMemoryTransport(hub)(context);
        return {
          get state() {
            return real.state;
          },
          open: (getHello) => real.open(getHello),
          // Viola o contrato: cada reenvio ganha um recibo diferente.
          commit: async (commitId, update, roomEpoch) => {
            const result = await real.commit(commitId, update, roomEpoch);
            counter += 1;
            return result.ok
              ? {
                  ok: true,
                  value: { ...result.value, timestamp: result.value.timestamp + counter },
                }
              : result;
          },
          sync: (syncState) => real.sync(syncState),
          sendPresence: (state) => real.sendPresence(state),
          onInbound: (listener) => real.onInbound(listener),
          onStateChange: (listener) => real.onStateChange(listener),
          close: () => real.close(),
        };
      },
      dropLink: (sessionId) => hub.dropLink(sessionId),
    });
    const receiptCase = cases.find((contractCase) => contractCase.name.includes('mesmo recibo'));

    await expect(receiptCase?.run()).rejects.toThrow(/Contrato do transporte/);
  });
});
