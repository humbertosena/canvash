import type { CollaborationError, CommitReceipt, Result } from '@canvash/collaboration';
import { createCanvasSection, type CanvasDocument } from '@canvash/core';
import * as Y from 'yjs';
import type { AppendBatch, RoomStorage, StoredCommit, StoredRoom } from '../storage.js';

export interface ContractCase {
  readonly name: string;
  /** Motivo pelo qual o caso não confere nada com estas opções. Ausente: o caso roda. */
  readonly skipped?: string;
  /** Rejeita com `Error` quando o contrato é violado. Não depende de nenhum executor de testes. */
  run(): Promise<void>;
}

export type RoomStorageFactory = () => RoomStorage | Promise<RoomStorage>;

export interface RoomStorageContractOptions {
  /**
   * O armazenamento guarda os recibos dos commits? Padrão `true`. Com `false`, os casos de
   * recibo ficam na lista marcados com `skipped` e não conferem nada.
   */
  readonly keepsReceipts?: boolean;
  /**
   * Reabre o armazenamento sobre os mesmos dados, como um reinício do processo. Sem ele, o caso
   * de `load` estável depois do reinício fica marcado com `skipped`.
   */
  readonly reopen?: (storage: RoomStorage) => RoomStorage | Promise<RoomStorage>;
}

function violation(message: string): Error {
  return new Error(`Contrato do armazenamento: ${message}`);
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw violation(message);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Update Yjs que só grava uma chave em `meta`: não cria nó, então qualquer sala o aceita. */
function markerUpdate(label: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('meta').set(`contract:${label}`, label);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** Os rótulos que a sala reproduz: aplica o snapshot e depois o log, como o servidor faz. */
function replayLabels(room: StoredRoom): string[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, room.snapshot);
    for (const commit of room.log) Y.applyUpdate(doc, commit.update);
    return [...doc.getMap('meta').keys()]
      .filter((key) => key.startsWith('contract:'))
      .map((key) => key.slice('contract:'.length))
      .sort();
  } finally {
    doc.destroy();
  }
}

function emptyDocument(): CanvasDocument {
  return createCanvasSection().getSnapshot().document;
}

function receiptFor(label: string, timestamp: number, roomEpoch: string): CommitReceipt {
  return { commitId: `commit-${label}`, roomEpoch, timestamp, durable: true };
}

function commitOf(label: string, timestamp: number, roomEpoch = 'epoch-1'): StoredCommit {
  return {
    commitId: `commit-${label}`,
    update: markerUpdate(label),
    receipt: receiptFor(label, timestamp, roomEpoch),
  };
}

function roomOf(labels: readonly string[], roomEpoch = 'epoch-1'): StoredRoom {
  const doc = new Y.Doc();
  for (const label of labels) Y.applyUpdate(doc, markerUpdate(label));
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return { provider: 'yjs', roomEpoch, snapshot, log: [], receipts: [] };
}

/**
 * Acompanha o estado da sala do lado da suíte, para montar cada lote com o `document` e o
 * `encodeSnapshot` que o servidor entregaria.
 */
class Tracker {
  private readonly doc = new Y.Doc();
  private readonly commits: StoredCommit[] = [];

  constructor(initial: StoredRoom) {
    Y.applyUpdate(this.doc, initial.snapshot);
  }

  batch(...commits: StoredCommit[]): AppendBatch {
    for (const commit of commits) {
      Y.applyUpdate(this.doc, commit.update);
      this.commits.push(commit);
    }
    const doc = this.doc;
    return {
      commits,
      document: emptyDocument(),
      encodeSnapshot: () => Y.encodeStateAsUpdate(doc),
    };
  }

  snapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  destroy(): void {
    this.doc.destroy();
  }
}

/** Todos os recibos que o armazenamento conhece da sala: os compactados e os do log. */
function knownReceipts(room: StoredRoom): CommitReceipt[] {
  return [...room.receipts, ...room.log.map((commit) => commit.receipt)];
}

function describeError(result: Result<unknown, CollaborationError>): string {
  return result.ok ? 'ok' : JSON.stringify(result.error);
}

/**
 * Casos de contrato do `RoomStorage`, no mesmo formato de `transportContractCases`: cada caso
 * rejeita com `Error` quando o contrato é violado e não depende de executor de testes. Cada caso
 * pede um armazenamento novo à fábrica e usa um `documentId` próprio.
 *
 * A suíte confere estado, não formato: reproduz `snapshot` + `log` e compara os rótulos
 * gravados. Um armazenamento sem log, que grava `batch.encodeSnapshot()` a cada `append`, passa.
 */
export function roomStorageContractCases(
  factory: RoomStorageFactory,
  options: RoomStorageContractOptions = {},
): readonly ContractCase[] {
  const keepsReceipts = options.keepsReceipts ?? true;
  const noReceipts = keepsReceipts
    ? undefined
    : 'o armazenamento declarou que não guarda recibos (`keepsReceipts: false`)';

  async function withRoom(
    labels: readonly string[],
    body: (storage: RoomStorage, tracker: Tracker, documentId: string) => Promise<void>,
  ): Promise<void> {
    const storage = await factory();
    const initial = roomOf(labels);
    const documentId = `contrato-${labels.join('-') || 'vazia'}`;
    const created = await storage.create(documentId, initial);
    check(created.ok, `create de uma sala nova falhou: ${describeError(created)}`);
    const tracker = new Tracker(initial);
    try {
      await body(storage, tracker, documentId);
    } finally {
      tracker.destroy();
    }
  }

  async function loaded(storage: RoomStorage, documentId: string): Promise<StoredRoom> {
    const result = await storage.load(documentId);
    check(result.ok, `load falhou: ${describeError(result)}`);
    check(result.value !== null, `load de "${documentId}" devolveu null depois do create`);
    return result.value;
  }

  const cases: ContractCase[] = [
    {
      name: 'load de uma sala que não existe devolve null, sem erro',
      async run() {
        const storage = await factory();
        const result = await storage.load('contrato-inexistente');
        check(result.ok && result.value === null, 'load de sala inexistente não devolveu ok(null)');
      },
    },
    {
      name: 'create grava a sala e load a devolve equivalente',
      async run() {
        const storage = await factory();
        const room = roomOf(['base'], 'epoch-7');
        const created = await storage.create('contrato-create', room);
        check(created.ok, `create falhou: ${describeError(created)}`);

        const back = await loaded(storage, 'contrato-create');

        check(back.provider === 'yjs', `provider devolvido: ${back.provider}`);
        check(back.roomEpoch === 'epoch-7', `roomEpoch devolvida: ${back.roomEpoch}`);
        check(sameBytes(back.snapshot, room.snapshot), 'o snapshot devolvido difere do gravado');
        check(replayLabels(back).join() === 'base', 'o estado devolvido não reproduz o gravado');
        check(back.log.length === 0, 'uma sala recém-criada devolveu log');
      },
    },
    {
      name: 'create de uma sala que já existe falha com CONFLICT e não mexe na original',
      async run() {
        await withRoom(['base'], async (storage, _tracker, documentId) => {
          const again = await storage.create(documentId, roomOf(['outra'], 'epoch-2'));

          check(
            !again.ok && again.error.code === 'CONFLICT',
            `esperava CONFLICT: ${describeError(again)}`,
          );
          const back = await loaded(storage, documentId);
          check(back.roomEpoch === 'epoch-1', 'o create recusado trocou a epoch da sala');
          check(replayLabels(back).join() === 'base', 'o create recusado trocou o estado da sala');
        });
      },
    },
    {
      name: 'append de um lote grava todos os commits, em ordem, e load reproduz o estado',
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          const first = tracker.batch(commitOf('a', 1_000), commitOf('b', 1_001));
          const second = tracker.batch(commitOf('c', 1_002));

          for (const batch of [first, second]) {
            const appended = await storage.append(documentId, batch);
            check(appended.ok, `append falhou: ${describeError(appended)}`);
          }

          const back = await loaded(storage, documentId);
          check(
            replayLabels(back).join() === 'a,b,base,c',
            `estado depois dos lotes: ${replayLabels(back).join()}`,
          );
          const logged = back.log.map((commit) => commit.commitId);
          check(
            logged.length === 0 || logged.join() === 'commit-a,commit-b,commit-c',
            `ordem do log: ${logged.join()}`,
          );
        });
      },
    },
    {
      name: 'um lote de vários commits aparece inteiro no load seguinte (tudo ou nada)',
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          const batch = tracker.batch(
            commitOf('x1', 2_000),
            commitOf('x2', 2_001),
            commitOf('x3', 2_002),
          );

          const appended = await storage.append(documentId, batch);

          check(appended.ok, `append falhou: ${describeError(appended)}`);
          const labels = replayLabels(await loaded(storage, documentId));
          check(labels.join() === 'base,x1,x2,x3', `o lote não apareceu inteiro: ${labels.join()}`);
        });
      },
    },
    {
      name: 'append numa sala que não existe falha com NOT_FOUND e não cria a sala',
      async run() {
        const storage = await factory();
        const tracker = new Tracker(roomOf([]));
        try {
          const result = await storage.append('contrato-fantasma', tracker.batch(commitOf('a', 1)));

          check(
            !result.ok && result.error.code === 'NOT_FOUND',
            `esperava NOT_FOUND: ${describeError(result)}`,
          );
          const back = await storage.load('contrato-fantasma');
          check(back.ok && back.value === null, 'o append recusado criou a sala');
        } finally {
          tracker.destroy();
        }
      },
    },
    {
      name: 'load é estável: duas cargas seguidas devolvem o mesmo snapshot e a mesma epoch',
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          const empty = await loaded(storage, documentId);
          const emptyAgain = await loaded(storage, documentId);
          check(empty.roomEpoch === emptyAgain.roomEpoch, 'a epoch mudou entre duas cargas');
          check(
            sameBytes(empty.snapshot, emptyAgain.snapshot),
            'o snapshot mudou entre duas cargas',
          );

          await storage.append(documentId, tracker.batch(commitOf('a', 3_000)));
          const first = await loaded(storage, documentId);
          const second = await loaded(storage, documentId);

          check(first.roomEpoch === second.roomEpoch, 'a epoch mudou entre duas cargas, com log');
          check(
            sameBytes(first.snapshot, second.snapshot),
            'o snapshot mudou entre duas cargas, com log',
          );
          check(
            replayLabels(first).join() === replayLabels(second).join(),
            'o estado mudou entre duas cargas',
          );
        });
      },
    },
    {
      name: 'load continua estável depois de reabrir o armazenamento (reinício do processo)',
      skipped: options.reopen
        ? undefined
        : 'sem `reopen`, a suíte não tem como simular o reinício do processo',
      async run() {
        const reopen = options.reopen;
        if (reopen === undefined) return;
        await withRoom(['base'], async (storage, tracker, documentId) => {
          await storage.append(documentId, tracker.batch(commitOf('a', 4_000)));
          const before = await loaded(storage, documentId);

          const reopened = await reopen(storage);
          const after = await loaded(reopened, documentId);

          check(before.roomEpoch === after.roomEpoch, 'a epoch mudou com o reinício');
          check(
            replayLabels(before).join() === replayLabels(after).join(),
            'o estado mudou com o reinício',
          );
        });
      },
    },
    {
      name: 'compact troca o snapshot, esvazia o log e preserva o estado e a epoch',
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          await storage.append(
            documentId,
            tracker.batch(commitOf('a', 5_000), commitOf('b', 5_001)),
          );
          await storage.append(documentId, tracker.batch(commitOf('c', 5_002)));

          // O servidor compacta dentro da fila da sala: o snapshot é o estado até o último commit.
          const compacted = await storage.compact(documentId, tracker.snapshot(), 'commit-c');

          check(compacted.ok, `compact falhou: ${describeError(compacted)}`);
          const back = await loaded(storage, documentId);
          check(
            replayLabels(back).join() === 'a,b,base,c',
            `estado depois do compact: ${replayLabels(back).join()}`,
          );
          check(back.log.length === 0, 'o log depois do compact devia estar vazio');
          check(back.roomEpoch === 'epoch-1', 'o compact trocou a epoch');
        });
      },
    },
    {
      name: 'um append depois do compact continua somando ao estado',
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          await storage.append(documentId, tracker.batch(commitOf('a', 5_100)));
          await storage.compact(documentId, tracker.snapshot(), 'commit-a');

          await storage.append(documentId, tracker.batch(commitOf('b', 5_101)));

          const back = await loaded(storage, documentId);
          check(
            replayLabels(back).join() === 'a,b,base',
            `estado depois do compact e de um novo append: ${replayLabels(back).join()}`,
          );
        });
      },
    },
    {
      name: 'compact preserva os recibos dos commits que saíram do log',
      skipped: noReceipts,
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          await storage.append(
            documentId,
            tracker.batch(commitOf('a', 6_000), commitOf('b', 6_001)),
          );

          await storage.compact(documentId, tracker.snapshot(), 'commit-b');

          const back = await loaded(storage, documentId);
          const known = knownReceipts(back)
            .map((receipt) => receipt.commitId)
            .sort();
          check(known.join() === 'commit-a,commit-b', `recibos depois do compact: ${known.join()}`);
          const receiptA = knownReceipts(back).find((receipt) => receipt.commitId === 'commit-a');
          check(
            receiptA?.timestamp === 6_000 && receiptA.roomEpoch === 'epoch-1' && receiptA.durable,
            'o recibo preservado mudou de conteúdo',
          );
        });
      },
    },
    {
      name: 'compact com dropReceiptsBefore tira só os recibos mais antigos que o corte',
      skipped: noReceipts,
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          await storage.append(documentId, tracker.batch(commitOf('a', 7_000)));
          await storage.compact(documentId, tracker.snapshot(), 'commit-a');
          await storage.append(documentId, tracker.batch(commitOf('b', 8_000)));

          await storage.compact(documentId, tracker.snapshot(), 'commit-b', {
            dropReceiptsBefore: 7_500,
          });

          const back = await loaded(storage, documentId);
          const known = knownReceipts(back).map((receipt) => receipt.commitId);
          check(known.join() === 'commit-b', `recibos depois da poda: ${known.join()}`);
          check(
            replayLabels(back).join() === 'a,b,base',
            'a poda de recibos mexeu no estado da sala',
          );
        });
      },
    },
    {
      name: 'compact numa sala que não existe falha com NOT_FOUND',
      async run() {
        const storage = await factory();
        const result = await storage.compact('contrato-fantasma', roomOf([]).snapshot, 'commit-a');
        check(
          !result.ok && result.error.code === 'NOT_FOUND',
          `esperava NOT_FOUND: ${describeError(result)}`,
        );
      },
    },
    {
      name: 'reset começa uma epoch nova, com o snapshot novo e sem log nem recibos',
      async run() {
        await withRoom(['base'], async (storage, tracker, documentId) => {
          await storage.append(documentId, tracker.batch(commitOf('a', 9_000)));

          const reset = await storage.reset(documentId, roomOf(['novo'], 'epoch-2'));

          check(reset.ok, `reset falhou: ${describeError(reset)}`);
          const back = await loaded(storage, documentId);
          check(back.roomEpoch === 'epoch-2', `epoch depois do reset: ${back.roomEpoch}`);
          check(
            replayLabels(back).join() === 'novo',
            `estado depois do reset: ${replayLabels(back).join()}`,
          );
          check(back.log.length === 0, 'o reset deixou commits no log');
          check(knownReceipts(back).length === 0, 'o reset deixou recibos da epoch anterior');
        });
      },
    },
    {
      name: 'reset numa sala que não existe falha com NOT_FOUND e não cria a sala',
      async run() {
        const storage = await factory();

        const result = await storage.reset('contrato-fantasma', roomOf(['novo'], 'epoch-2'));

        check(
          !result.ok && result.error.code === 'NOT_FOUND',
          `esperava NOT_FOUND: ${describeError(result)}`,
        );
        const back = await storage.load('contrato-fantasma');
        check(back.ok && back.value === null, 'o reset recusado criou a sala');
      },
    },
    {
      name: 'salas de documentos diferentes são independentes',
      async run() {
        const storage = await factory();
        const left = roomOf(['esquerda'], 'epoch-esq');
        const right = roomOf(['direita'], 'epoch-dir');
        await storage.create('contrato-esq', left);
        await storage.create('contrato-dir', right);
        const tracker = new Tracker(left);
        try {
          await storage.append('contrato-esq', tracker.batch(commitOf('so-esq', 10_000)));
          await storage.reset('contrato-dir', roomOf(['direita-nova'], 'epoch-dir-2'));

          const leftBack = await loaded(storage, 'contrato-esq');
          const rightBack = await loaded(storage, 'contrato-dir');

          check(
            replayLabels(leftBack).join() === 'esquerda,so-esq' &&
              leftBack.roomEpoch === 'epoch-esq',
            `a sala da esquerda mudou com a da direita: ${replayLabels(leftBack).join()}`,
          );
          check(
            replayLabels(rightBack).join() === 'direita-nova' &&
              rightBack.roomEpoch === 'epoch-dir-2',
            `a sala da direita ficou errada: ${replayLabels(rightBack).join()}`,
          );
        } finally {
          tracker.destroy();
        }
      },
    },
  ];
  return cases;
}
