import {
  err,
  ok,
  type CollaborationError,
  type CollaborationProvider,
  type ConnectOptions,
  type CreateTransport,
  type Result,
} from '@canvash/collaboration';
import { createMemoryTransport } from './memory-transport.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

export interface YjsProviderOptions {
  /**
   * Fábrica do transporte de rede. Com ela, o provider não usa o emulador nem o hub em memória.
   * Sem ela, as sessões falam com `server` por `transport`, no mesmo processo.
   */
  createTransport?: CreateTransport;
  server?: CollaborativeServerEmulator;
  transport?: DeterministicTransportHub;
}

export class YjsCollaborationProvider implements CollaborationProvider {
  public readonly name = 'yjs';
  private readonly server: CollaborativeServerEmulator;
  private readonly transport: DeterministicTransportHub;
  private readonly createTransport: CreateTransport;

  constructor(options: YjsProviderOptions = {}) {
    this.server = options.server ?? new CollaborativeServerEmulator();
    this.transport = options.transport ?? new DeterministicTransportHub(this.server);
    this.createTransport = options.createTransport ?? createMemoryTransport(this.transport);
  }

  getServer(): CollaborativeServerEmulator {
    return this.server;
  }

  getTransport(): DeterministicTransportHub {
    return this.transport;
  }

  async connect(
    options: ConnectOptions,
  ): Promise<Result<YjsCollaborationSession, CollaborationError>> {
    const sessionId = crypto.randomUUID();
    const transport = this.createTransport({ documentId: options.documentId, sessionId });

    // O handshake vem antes da sessão: credencial e epoch (COLLAB-06, COLLAB-14) são conferidas
    // por quem está do outro lado do transporte. Nas reconexões, o `hello` é o da sessão, com o
    // vetor de estado atual.
    const current: { session?: YjsCollaborationSession } = {};
    const welcome = await transport.open(
      () =>
        current.session?.createHello() ?? {
          provider: this.name,
          documentId: options.documentId,
          sessionId,
          ...(options.roomEpoch === undefined ? {} : { roomEpoch: options.roomEpoch }),
          ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
          syncState: new Uint8Array(),
        },
    );
    if (!welcome.ok) {
      transport.close();
      return err(welcome.error);
    }

    const session = new YjsCollaborationSession(
      transport,
      options,
      sessionId,
      welcome.value,
      this.createTransport,
    );
    current.session = session;
    return ok(session);
  }
}
