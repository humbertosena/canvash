import type {
  CollaborationError,
  CollaborationTransport,
  CreateTransport,
  TransportHello,
  TransportInbound,
  TransportState,
  TransportWelcome,
} from '@canvash/collaboration';
import * as Y from 'yjs';

/** O que a suíte precisa do transporte sob teste e do servidor do outro lado. */
export interface TransportContractHarness {
  /**
   * Fábrica do transporte sob teste. Cada `documentId` novo cai numa sala vazia do servidor sob
   * teste; a suíte gera um por caso.
   */
  readonly createTransport: CreateTransport;
  /** Derruba o enlace da sessão pelo lado do servidor; o transporte tem de voltar sozinho. */
  dropLink(sessionId: string): void | Promise<void>;
  /**
   * Faz as próximas `count` gravações da sala falharem. Sem ele, os casos de reenvio ficam na
   * lista marcados com `skipped` e não conferem nada.
   */
  failNextAppends?(documentId: string, count: number): void | Promise<void>;
}

export interface ContractCase {
  readonly name: string;
  /** Motivo pelo qual o caso não confere nada com este harness. Ausente: o caso roda. */
  readonly skipped?: string;
  /** Rejeita com `Error` quando o contrato é violado. Não depende de nenhum executor de testes. */
  run(): Promise<void>;
}

const WAIT_TIMEOUT_MS = 5_000;
const WAIT_STEP_MS = 5;

function violation(message: string): Error {
  return new Error(`Contrato do transporte: ${message}`);
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

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw violation(`${what} não aconteceu em ${WAIT_TIMEOUT_MS} ms`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

/** Update Yjs que só grava uma chave em `meta`: não cria nó, então qualquer sala o aceita. */
function markerUpdate(label: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('meta').set(`contract:${label}`, label);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function hasMarker(doc: Y.Doc, label: string): boolean {
  return doc.getMap('meta').get(`contract:${label}`) === label;
}

interface Peer {
  readonly sessionId: string;
  readonly transport: CollaborationTransport;
  readonly inbound: TransportInbound[];
  readonly states: Array<{ state: TransportState; error?: CollaborationError }>;
  /** Quantas vezes o transporte pediu o `hello`. */
  readonly hellos: { count: number };
  /** O que o cliente conhece da sala: `missing` do `welcome` mais o que ele aplicar. */
  readonly known: Y.Doc;
  welcome: TransportWelcome;
}

interface Scenario {
  readonly documentId: string;
  peer(extra?: Partial<TransportHello>): Promise<Peer>;
  /** Abre sem exigir sucesso: devolve o transporte e o resultado do `open`. */
  attempt(extra: Partial<TransportHello>): Promise<{
    transport: CollaborationTransport;
    result: Awaited<ReturnType<CollaborationTransport['open']>>;
  }>;
  /** Transporte criado e ainda não aberto. */
  idle(sessionId?: string): CollaborationTransport;
}

function createScenario(harness: TransportContractHarness, opened: CollaborationTransport[]) {
  const documentId = `contract-${crypto.randomUUID()}`;

  const create = (sessionId: string): CollaborationTransport => {
    const transport = harness.createTransport({ documentId, sessionId });
    opened.push(transport);
    return transport;
  };

  const scenario: Scenario = {
    documentId,

    idle(sessionId = crypto.randomUUID()) {
      return create(sessionId);
    },

    async attempt(extra) {
      const sessionId = extra.sessionId ?? crypto.randomUUID();
      const transport = create(sessionId);
      const result = await transport.open(() => ({
        provider: 'yjs',
        documentId,
        sessionId,
        syncState: new Uint8Array(),
        ...extra,
      }));
      return { transport, result };
    },

    async peer(extra = {}) {
      const sessionId = extra.sessionId ?? crypto.randomUUID();
      const transport = create(sessionId);
      const inbound: TransportInbound[] = [];
      const states: Peer['states'] = [];
      const hellos = { count: 0 };
      const known = new Y.Doc();
      transport.onInbound((message) => inbound.push(message));
      transport.onStateChange((state, error) =>
        states.push(error === undefined ? { state } : { state, error }),
      );
      const result = await transport.open(() => {
        hellos.count += 1;
        return {
          provider: 'yjs',
          documentId,
          sessionId,
          syncState: Y.encodeStateVector(known),
          ...extra,
        };
      });
      check(result.ok, `open devolveu ${result.ok ? 'ok' : result.error.code} numa sala nova`);
      Y.applyUpdate(known, result.value.missing);
      return { sessionId, transport, inbound, states, hellos, known, welcome: result.value };
    },
  };
  return scenario;
}

type CaseBody = (scenario: Scenario, harness: TransportContractHarness) => Promise<void>;

function defineCase(
  harness: TransportContractHarness,
  name: string,
  body: CaseBody,
  skipped?: string,
): ContractCase {
  if (skipped !== undefined) {
    return { name, skipped, run: () => Promise.resolve() };
  }
  return {
    name,
    async run() {
      const opened: CollaborationTransport[] = [];
      try {
        await body(createScenario(harness, opened), harness);
      } finally {
        for (const transport of opened) transport.close();
      }
    },
  };
}

/**
 * Casos de contrato de `CollaborationTransport`, para quem escreve o próprio meio (WebSocket,
 * SSE+POST ou outro). Cada caso abre os transportes que precisa numa sala nova e os fecha no fim.
 *
 * ```ts
 * for (const contractCase of transportContractCases(harness)) {
 *   test(contractCase.name, contractCase.run);
 * }
 * ```
 */
export function transportContractCases(harness: TransportContractHarness): readonly ContractCase[] {
  const noAppendFailure =
    harness.failNextAppends === undefined
      ? 'o harness não tem failNextAppends: sem como provocar falha de gravação'
      : undefined;

  return [
    defineCase(
      harness,
      'open passa por connecting e devolve o welcome completo',
      async (scenario) => {
        const peer = await scenario.peer();
        const { welcome, transport, states } = peer;

        check(transport.state === 'open', `depois do open o estado é "${transport.state}"`);
        check(
          states.map((entry) => entry.state).join(',') === 'connecting,open',
          `estados avisados no open: ${states.map((entry) => entry.state).join(',')}`,
        );
        check(
          typeof welcome.roomEpoch === 'string' && welcome.roomEpoch.length > 0,
          'roomEpoch vazia',
        );
        check(welcome.access === 'write' || welcome.access === 'read', 'access fora de write/read');
        check(welcome.missing instanceof Uint8Array, 'missing não é Uint8Array');
        check(welcome.serverSyncState instanceof Uint8Array, 'serverSyncState não é Uint8Array');
        check(Number.isFinite(welcome.serverTime), 'serverTime não é um número finito');
        check(
          sameBytes(Y.encodeStateVector(peer.known), welcome.serverSyncState),
          'aplicar missing não leva o cliente ao vetor de estado do servidor',
        );
      },
    ),

    defineCase(harness, 'getHello é chamado uma vez em cada conexão', async (scenario, h) => {
      const peer = await scenario.peer();
      // Lido por função: a contagem muda na reconexão, fora da vista do compilador.
      const helloCount = (): number => peer.hellos.count;
      check(helloCount() === 1, `getHello chamado ${helloCount()} vezes no open`);

      await h.dropLink(peer.sessionId);
      await waitFor(
        () => peer.inbound.some((message) => message.type === 'resync'),
        'o resync depois da queda',
      );

      check(helloCount() === 2, `getHello chamado ${helloCount()} vezes após a reconexão`);
    }),

    defineCase(harness, 'erro de handshake volta tipado e fecha o transporte', async (scenario) => {
      const provider = await scenario.attempt({ provider: 'contract-unknown-provider' });
      check(!provider.result.ok, 'provider desconhecido foi aceito');
      check(
        provider.result.error.code === 'UNSUPPORTED',
        `provider desconhecido devolveu ${provider.result.error.code}`,
      );
      check(provider.transport.state === 'closed', 'transporte não fechou após o erro');

      // Garante que a sala existe antes de pedir uma epoch que ela não tem.
      await scenario.peer();
      const epoch = await scenario.attempt({ roomEpoch: 'contract-unknown-epoch' });
      check(!epoch.result.ok, 'epoch desconhecida foi aceita');
      check(
        epoch.result.error.code === 'ROOM_EPOCH_MISMATCH',
        `epoch desconhecida devolveu ${epoch.result.error.code}`,
      );
      check(epoch.transport.state === 'closed', 'transporte não fechou após o erro de epoch');
    }),

    defineCase(
      harness,
      'commit devolve recibo durável e o mesmo recibo no reenvio',
      async (scenario) => {
        const peer = await scenario.peer();
        const update = markerUpdate('recibo');
        const commitId = `commit-${crypto.randomUUID()}`;

        const first = await peer.transport.commit(commitId, update, peer.welcome.roomEpoch);
        const second = await peer.transport.commit(commitId, update, peer.welcome.roomEpoch);

        check(first.ok, `commit devolveu ${first.ok ? 'ok' : first.error.code}`);
        check(second.ok, `reenvio devolveu ${second.ok ? 'ok' : second.error.code}`);
        check(first.value.commitId === commitId, 'o recibo traz outro commitId');
        check(first.value.roomEpoch === peer.welcome.roomEpoch, 'o recibo traz outra roomEpoch');
        check(first.value.durable, 'o recibo não é durável');
        check(
          second.value.commitId === first.value.commitId &&
            second.value.roomEpoch === first.value.roomEpoch &&
            second.value.timestamp === first.value.timestamp &&
            second.value.durable === first.value.durable,
          'o reenvio do mesmo commitId devolveu um recibo diferente',
        );
      },
    ),

    defineCase(
      harness,
      'o commit chega aos outros como update, com o from de quem enviou, e não volta a ele',
      async (scenario) => {
        const sender = await scenario.peer();
        const receiver = await scenario.peer();
        const update = markerUpdate('repasse');
        const commitId = `commit-${crypto.randomUUID()}`;

        const result = await sender.transport.commit(commitId, update, sender.welcome.roomEpoch);
        check(result.ok, `commit devolveu ${result.ok ? 'ok' : result.error.code}`);
        await waitFor(
          () => receiver.inbound.some((message) => message.type === 'update'),
          'o update no outro cliente',
        );

        const message = receiver.inbound.find((entry) => entry.type === 'update');
        check(message?.type === 'update', 'update não chegou');
        check(message.commitId === commitId, 'o update chegou com outro commitId');
        check(
          message.from === sender.sessionId,
          `from é "${message.from}", não o sessionId de quem enviou`,
        );
        check(sameBytes(message.update, update), 'os bytes do update mudaram no caminho');
        check(
          !sender.inbound.some((entry) => entry.type === 'update' && entry.commitId === commitId),
          'quem enviou recebeu o próprio update',
        );
      },
    ),

    defineCase(harness, 'commit fora de open resolve com DISCONNECTED', async (scenario) => {
      const idle = scenario.idle();
      const before = await idle.commit('commit-antes', markerUpdate('antes'), 'qualquer');
      check(
        !before.ok && before.error.code === 'DISCONNECTED',
        'commit antes do open não deu DISCONNECTED',
      );

      const peer = await scenario.peer();
      peer.transport.close();
      const after = await peer.transport.commit(
        'commit-depois',
        markerUpdate('depois'),
        peer.welcome.roomEpoch,
      );
      check(
        !after.ok && after.error.code === 'DISCONNECTED',
        'commit depois do close não deu DISCONNECTED',
      );
    }),

    defineCase(
      harness,
      'commit com outra epoch volta ROOM_EPOCH_MISMATCH e o enlace segue aberto',
      async (scenario) => {
        const peer = await scenario.peer();

        const result = await peer.transport.commit(
          `commit-${crypto.randomUUID()}`,
          markerUpdate('epoch'),
          'contract-unknown-epoch',
        );

        check(!result.ok, 'commit com epoch errada foi aceito');
        check(result.error.code === 'ROOM_EPOCH_MISMATCH', `devolveu ${result.error.code}`);
        check(peer.transport.state === 'open', 'o enlace caiu por causa de um erro não fatal');
      },
    ),

    defineCase(harness, 'sync devolve o que falta a partir do vetor dado', async (scenario) => {
      const writer = await scenario.peer();
      const reader = await scenario.peer();

      const committed = await writer.transport.commit(
        `commit-${crypto.randomUUID()}`,
        markerUpdate('sync'),
        writer.welcome.roomEpoch,
      );
      check(committed.ok, `commit devolveu ${committed.ok ? 'ok' : committed.error.code}`);
      const synced = await reader.transport.sync(Y.encodeStateVector(reader.known));

      check(synced.ok, `sync devolveu ${synced.ok ? 'ok' : synced.error.code}`);
      Y.applyUpdate(reader.known, synced.value);
      check(hasMarker(reader.known, 'sync'), 'o que o sync devolveu não traz o commit confirmado');
    }),

    defineCase(harness, 'a presença chega aos outros com o from do enlace', async (scenario) => {
      const publisher = await scenario.peer();
      const watcher = await scenario.peer();
      const state = { sessionId: publisher.sessionId, cursor: { x: 1, y: 2 } };

      publisher.transport.sendPresence(state);
      await waitFor(
        () =>
          watcher.inbound.some((message) => message.type === 'presence' && message.state !== null),
        'a presença no outro cliente',
      );

      const message = watcher.inbound.find(
        (entry) => entry.type === 'presence' && entry.state !== null,
      );
      check(message?.type === 'presence', 'presença não chegou');
      check(
        message.from === publisher.sessionId,
        `from é "${message.from}", não o sessionId de quem publicou`,
      );
      check(
        !publisher.inbound.some(
          (entry) => entry.type === 'presence' && entry.from === publisher.sessionId,
        ),
        'quem publicou recebeu a própria presença',
      );
    }),

    defineCase(
      harness,
      'queda do enlace: reconnecting, resync com o que faltou e volta a open',
      async (scenario, h) => {
        const dropped = await scenario.peer();
        const other = await scenario.peer();

        await h.dropLink(dropped.sessionId);
        const committed = await other.transport.commit(
          `commit-${crypto.randomUUID()}`,
          markerUpdate('queda'),
          other.welcome.roomEpoch,
        );
        check(
          committed.ok,
          `commit do outro cliente devolveu ${committed.ok ? 'ok' : committed.error.code}`,
        );
        await waitFor(
          () => dropped.inbound.some((message) => message.type === 'resync'),
          'o resync depois da queda',
        );
        await waitFor(() => dropped.transport.state === 'open', 'a volta a open');

        const seen = dropped.states.map((entry) => entry.state);
        check(
          seen.includes('reconnecting'),
          `a queda não passou por reconnecting: ${seen.join(',')}`,
        );
        check(
          seen[seen.length - 1] === 'open',
          `o último estado avisado foi "${seen[seen.length - 1]}"`,
        );
        for (const message of dropped.inbound) {
          if (message.type === 'resync') Y.applyUpdate(dropped.known, message.welcome.missing);
          if (message.type === 'update') Y.applyUpdate(dropped.known, message.update);
        }
        check(
          hasMarker(dropped.known, 'queda'),
          'o commit feito durante a queda não chegou a quem voltou',
        );

        const after = await dropped.transport.commit(
          `commit-${crypto.randomUUID()}`,
          markerUpdate('depois-da-queda'),
          dropped.welcome.roomEpoch,
        );
        check(after.ok, `commit depois da volta devolveu ${after.ok ? 'ok' : after.error.code}`);
      },
    ),

    defineCase(harness, 'o mesmo sessionId substitui o enlace anterior', async (scenario) => {
      const old = await scenario.peer();

      const replacement = await scenario.peer({ sessionId: old.sessionId });
      await waitFor(() => old.transport.state === 'closed', 'o fechamento do enlace substituído');

      const last = old.states[old.states.length - 1];
      check(
        last?.state === 'closed' && last.error !== undefined,
        'o enlace substituído fechou sem erro',
      );
      check(replacement.transport.state === 'open', 'o enlace novo não ficou aberto');
      const result = await replacement.transport.commit(
        `commit-${crypto.randomUUID()}`,
        markerUpdate('substituto'),
        replacement.welcome.roomEpoch,
      );
      check(result.ok, `commit pelo enlace novo devolveu ${result.ok ? 'ok' : result.error.code}`);
    }),

    defineCase(harness, 'close é idempotente e anuncia a saída aos outros', async (scenario) => {
      const leaving = await scenario.peer();
      const staying = await scenario.peer();

      leaving.transport.close();
      leaving.transport.close();
      await waitFor(
        () =>
          staying.inbound.some(
            (message) =>
              message.type === 'presence' &&
              message.from === leaving.sessionId &&
              message.state === null,
          ),
        'o anúncio de saída',
      );

      check(
        leaving.transport.state === 'closed',
        `estado depois do close: "${leaving.transport.state}"`,
      );
      const sync = await leaving.transport.sync(new Uint8Array());
      check(
        !sync.ok && sync.error.code === 'DISCONNECTED',
        'sync depois do close não deu DISCONNECTED',
      );
    }),

    defineCase(
      harness,
      'falha de gravação volta STORAGE_UNAVAILABLE sem derrubar o enlace, e o reenvio recebe recibo',
      async (scenario, h) => {
        const peer = await scenario.peer();
        const update = markerUpdate('gravacao');
        const commitId = `commit-${crypto.randomUUID()}`;

        await h.failNextAppends?.(scenario.documentId, 1);
        const failed = await peer.transport.commit(commitId, update, peer.welcome.roomEpoch);
        const retried = await peer.transport.commit(commitId, update, peer.welcome.roomEpoch);

        check(!failed.ok, 'o commit foi aceito com a gravação falhando');
        check(failed.error.code === 'STORAGE_UNAVAILABLE', `devolveu ${failed.error.code}`);
        check(peer.transport.state === 'open', 'o enlace caiu por causa da falha de gravação');
        check(retried.ok, `o reenvio devolveu ${retried.ok ? 'ok' : retried.error.code}`);
        check(retried.value.commitId === commitId, 'o recibo do reenvio traz outro commitId');
      },
      noAppendFailure,
    ),
  ];
}
