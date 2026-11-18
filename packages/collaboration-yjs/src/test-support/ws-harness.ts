import {
  type CollaborationError,
  type CollaborationTransport,
  type CommitReceipt,
  type ServerMessage,
  type TransportHello,
  type TransportInbound,
  type TransportState,
} from '@canvash/collaboration';
import { FakeWebSocket } from './fake-websocket.js';
import { createWebSocketTransport, type WebSocketTransportOptions } from '../ws-transport.js';

export type Welcome = Extract<ServerMessage, { t: 'welcome' }>;

export const URL_OK = 'wss://exemplo.test/collab';

export function hello(overrides: Partial<TransportHello> = {}): TransportHello {
  return {
    provider: 'yjs',
    documentId: 'doc-1',
    sessionId: 'sessao-a',
    syncState: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

export function welcome(overrides: Partial<Welcome> = {}): Welcome {
  return {
    t: 'welcome',
    v: 1,
    roomEpoch: 'epoch-1',
    access: 'write',
    missing: new Uint8Array([9, 9]),
    serverSyncState: new Uint8Array([8]),
    serverTime: 1_700_000_000_000,
    ...overrides,
  };
}

export function receipt(commitId = 'commit-1'): CommitReceipt {
  return { commitId, roomEpoch: 'epoch-1', timestamp: 5, durable: true };
}

export interface Harness {
  readonly transport: CollaborationTransport;
  readonly states: Array<{ state: TransportState; error?: CollaborationError }>;
  readonly inbound: TransportInbound[];
}

export function build(extra: Partial<WebSocketTransportOptions> = {}): Harness {
  const transport = createWebSocketTransport({
    url: URL_OK,
    WebSocket: FakeWebSocket as unknown as WebSocketTransportOptions['WebSocket'],
    random: () => 0.5,
    ...extra,
  })({ documentId: 'doc-1', sessionId: 'sessao-a' });
  const states: Harness['states'] = [];
  const inbound: TransportInbound[] = [];
  transport.onStateChange((state, error) => states.push({ state, ...(error ? { error } : {}) }));
  transport.onInbound((message) => inbound.push(message));
  return { transport, states, inbound };
}

/** Abre o transporte e faz o handshake até o `welcome`. */
export async function openTransport(
  extra: Partial<WebSocketTransportOptions> = {},
  welcomeMessage: Welcome = welcome(),
): Promise<Harness> {
  const harness = build(extra);
  const opening = harness.transport.open(() => hello());
  await flush();
  FakeWebSocket.last().serverOpen();
  FakeWebSocket.last().serverSend(welcomeMessage);
  const result = await opening;
  if (!result.ok) throw new Error(`o handshake falhou: ${result.error.message}`);
  return harness;
}

export async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}
