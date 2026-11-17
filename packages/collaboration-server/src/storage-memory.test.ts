import { createCollaborationError, err, ok, type Result } from '@canvash/collaboration';
import type { CollaborationError } from '@canvash/collaboration';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { AppendBatch, RoomStorage, StoredCommit, StoredRoom } from './storage.js';
import { createMemoryRoomStorage } from './storage-memory.js';
import { roomStorageContractCases } from './testing/index.js';

/**
 * Armazenamento de uma linha por sala, sem log e sem recibos: grava `encodeSnapshot()` a cada
 * `append`, como um banco que guarda só o estado. A suíte confere estado, não formato.
 */
function createSnapshotOnlyStorage(): RoomStorage & { readonly documents: Map<string, unknown> } {
  const rooms = new Map<string, { roomEpoch: string; snapshot: Uint8Array }>();
  const documents = new Map<string, unknown>();
  const missing = (id: string): Result<never, CollaborationError> =>
    err(createCollaborationError('NOT_FOUND', `Sala "${id}" não existe.`));
  return {
    documents,
    load(id) {
      const room = rooms.get(id);
      return Promise.resolve(
        ok<StoredRoom | null>(
          room === undefined
            ? null
            : {
                provider: 'yjs',
                roomEpoch: room.roomEpoch,
                snapshot: room.snapshot,
                log: [],
                receipts: [],
              },
        ),
      );
    },
    create(id, room) {
      if (rooms.has(id)) return Promise.resolve(err(createCollaborationError('CONFLICT', id)));
      rooms.set(id, { roomEpoch: room.roomEpoch, snapshot: room.snapshot });
      return Promise.resolve(ok(undefined));
    },
    append(id, batch: AppendBatch) {
      const room = rooms.get(id);
      if (room === undefined) return Promise.resolve(missing(id));
      rooms.set(id, { roomEpoch: room.roomEpoch, snapshot: batch.encodeSnapshot() });
      documents.set(id, batch.document);
      return Promise.resolve(ok(undefined));
    },
    compact(id, snapshot) {
      const room = rooms.get(id);
      if (room === undefined) return Promise.resolve(missing(id));
      rooms.set(id, { roomEpoch: room.roomEpoch, snapshot });
      return Promise.resolve(ok(undefined));
    },
    reset(id, room) {
      if (!rooms.has(id)) return Promise.resolve(missing(id));
      rooms.set(id, { roomEpoch: room.roomEpoch, snapshot: room.snapshot });
      return Promise.resolve(ok(undefined));
    },
  };
}

describe('createMemoryRoomStorage: suíte de contrato', () => {
  const cases = roomStorageContractCases(() => createMemoryRoomStorage(), {
    // O armazenamento em memória reabre como a mesma instância: os dados são os do processo.
    reopen: (storage) => storage,
  });

  it('a suíte traz os casos do contrato, nenhum pulado', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((contractCase) => contractCase.skipped !== undefined)).toEqual([]);
  });

  for (const contractCase of cases) {
    it(contractCase.name, async () => {
      await contractCase.run();
    });
  }
});

describe('armazenamento sem log e sem recibos: a suíte confere estado, não formato', () => {
  const cases = roomStorageContractCases(() => createSnapshotOnlyStorage(), {
    keepsReceipts: false,
  });

  it('só os casos de recibo e de reinício ficam pulados, cada um com o motivo', () => {
    const skipped = cases.filter((contractCase) => contractCase.skipped !== undefined);

    expect(skipped.map((contractCase) => contractCase.name)).toEqual([
      'load continua estável depois de reabrir o armazenamento (reinício do processo)',
      'compact preserva os recibos dos commits que saíram do log',
      'compact com dropReceiptsBefore tira só os recibos mais antigos que o corte',
    ]);
    for (const contractCase of skipped) expect(contractCase.skipped).not.toBe('');
  });

  for (const contractCase of cases.filter((candidate) => candidate.skipped === undefined)) {
    it(contractCase.name, async () => {
      await contractCase.run();
    });
  }
});

describe('createMemoryRoomStorage: isolamento e bordas', () => {
  function roomOf(label: string): StoredRoom {
    const doc = new Y.Doc();
    doc.getMap('meta').set(`contract:${label}`, label);
    return {
      provider: 'yjs',
      roomEpoch: 'epoch-1',
      snapshot: Y.encodeStateAsUpdate(doc),
      log: [],
      receipts: [],
    };
  }

  it('o que load devolve é cópia: mexer nos bytes devolvidos não altera a sala guardada', async () => {
    const storage = createMemoryRoomStorage();
    await storage.create('doc', roomOf('base'));
    const first = await storage.load('doc');
    if (!first.ok || first.value === null) throw new Error('load falhou');
    const original = [...first.value.snapshot];

    first.value.snapshot.fill(0);
    const second = await storage.load('doc');

    expect(second.ok && second.value !== null && [...second.value.snapshot]).toEqual(original);
  });

  it('o que create recebe é copiado: mexer nos bytes entregues depois não altera a sala', async () => {
    const storage = createMemoryRoomStorage();
    const room = roomOf('base');
    const original = [...room.snapshot];
    await storage.create('doc', room);

    room.snapshot.fill(0);
    const back = await storage.load('doc');

    expect(back.ok && back.value !== null && [...back.value.snapshot]).toEqual(original);
  });

  it('compact com um commit que não está no log troca o snapshot e deixa o log como está', async () => {
    const storage = createMemoryRoomStorage();
    const doc = new Y.Doc();
    doc.getMap('meta').set('contract:a', 'a');
    const update = Y.encodeStateAsUpdate(doc);
    await storage.create('doc', roomOf('base'));
    await storage.append('doc', {
      commits: [
        {
          commitId: 'commit-a',
          update,
          receipt: { commitId: 'commit-a', roomEpoch: 'epoch-1', timestamp: 1, durable: true },
        },
      ],
      document: {} as never,
      encodeSnapshot: () => update,
    });

    const compacted = await storage.compact('doc', roomOf('novo').snapshot, 'commit-desconhecido');
    const back = await storage.load('doc');

    expect(compacted.ok).toBe(true);
    expect(back.ok && back.value?.log.map((commit) => commit.commitId)).toEqual(['commit-a']);
  });

  it('compact até um commit do meio do log mantém os commits seguintes', async () => {
    const storage = createMemoryRoomStorage();
    const commitOf = (label: string, timestamp: number): StoredCommit => {
      const doc = new Y.Doc();
      doc.getMap('meta').set(`contract:${label}`, label);
      return {
        commitId: `commit-${label}`,
        update: Y.encodeStateAsUpdate(doc),
        receipt: { commitId: `commit-${label}`, roomEpoch: 'epoch-1', timestamp, durable: true },
      };
    };
    await storage.create('doc', roomOf('base'));
    await storage.append('doc', {
      commits: [commitOf('a', 1), commitOf('b', 2), commitOf('c', 3)],
      document: {} as never,
      encodeSnapshot: () => new Uint8Array(),
    });

    await storage.compact('doc', roomOf('ate-b').snapshot, 'commit-b', { dropReceiptsBefore: 2 });
    const back = await storage.load('doc');

    expect(back.ok && back.value?.log.map((commit) => commit.commitId)).toEqual(['commit-c']);
    expect(back.ok && back.value?.receipts.map((receipt) => receipt.commitId)).toEqual([
      'commit-b',
    ]);
  });

  it('a mensagem de NOT_FOUND diz qual sala não existe', async () => {
    const storage = createMemoryRoomStorage();

    const result = await storage.reset('doc-fantasma', roomOf('novo'));

    expect(!result.ok && result.error.message).toContain('doc-fantasma');
  });
});
