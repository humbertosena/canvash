import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type CollaborationProvider,
  type ConnectOptions,
  type Result,
} from '@canvash/collaboration';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

export interface YjsProviderOptions {
  server?: CollaborativeServerEmulator;
  transport?: DeterministicTransportHub;
}

export class YjsCollaborationProvider implements CollaborationProvider {
  public readonly name = 'yjs';
  private readonly server: CollaborativeServerEmulator;
  private readonly transport: DeterministicTransportHub;
  private sessionCounter = 0;

  constructor(options: YjsProviderOptions = {}) {
    this.server = options.server ?? new CollaborativeServerEmulator();
    this.transport = options.transport ?? new DeterministicTransportHub(this.server);
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
    // 1. Verificação de credenciais e autorização (COLLAB-06)
    if (options.credentials?.token === 'invalid_token') {
      return err(
        createCollaborationError(
          'UNAUTHORIZED',
          'Credenciais de autorização rejeitadas pelo backend',
        ),
      );
    }

    // 2. Verificação de compatibilidade de roomEpoch (COLLAB-14)
    const serverEpoch = this.server.getRoomEpoch();
    if (options.roomEpoch && options.roomEpoch !== serverEpoch) {
      return err(
        createCollaborationError(
          'ROOM_EPOCH_MISMATCH',
          `Room epoch incompatível: esperado "${options.roomEpoch}", atual no servidor "${serverEpoch}"`,
          { clientEpoch: options.roomEpoch, serverEpoch },
        ),
      );
    }

    const sessionId = `sess_${++this.sessionCounter}_${Math.random().toString(36).slice(2, 8)}`;
    const snapshot = this.server.getSnapshot();

    const session = new YjsCollaborationSession(this.transport, options, sessionId, snapshot);

    return ok(session);
  }
}
