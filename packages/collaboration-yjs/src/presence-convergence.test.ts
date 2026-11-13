import { createCanvasSection } from '@canvash/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LocalAwarenessState } from './awareness.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

/** Mensagens de presença de dois remetentes, com `updatedAt` crescente por remetente. */
function stateOf(sender: 'a' | 'b', step: number): LocalAwarenessState {
  return {
    sessionId: `sess-${sender}`,
    userId: `user-${sender}`,
    userName: sender.toUpperCase(),
    color: sender === 'a' ? '#dc2626' : '#2563eb',
    cursor: { x: step * 10, y: step },
    selection: [`n${step}`],
    selectedAt: step,
    drag: step % 2 === 0 ? { ids: [`n${step}`], dx: step, dy: 0 } : null,
    view: { center: { x: step, y: step }, zoom: 1 },
    updatedAt: 1000 * step,
  };
}

const MESSAGES = [
  stateOf('a', 1),
  stateOf('a', 2),
  stateOf('a', 3),
  stateOf('b', 1),
  stateOf('b', 2),
];

function makeSessions(count: number) {
  const server = new CollaborativeServerEmulator('epoch-1');
  const transport = new DeterministicTransportHub(server);
  return Array.from({ length: count }, (_, i) => {
    const section = createCanvasSection();
    return new YjsCollaborationSession(
      transport,
      {
        documentId: 'doc-presence',
        section,
        roomEpoch: 'epoch-1',
        presenceTimeoutMs: 10_000_000,
        user: { id: `receiver-${i}`, name: `R${i}`, color: '#16a34a' },
      },
      `receiver-${i}`,
      server.getSnapshot(),
    );
  });
}

function snapshotOf(session: YjsCollaborationSession) {
  // As próprias sessões do teste se enxergam pelo transporte; a convergência é sobre quem foi injetado.
  return [...session.getPresences()]
    .filter((presence) => presence.sessionId.startsWith('sess-'))
    .sort((x, y) => x.sessionId.localeCompare(y.sessionId))
    .map(({ sessionId, cursor, selection, selectedAt, drag, view, updatedAt }) => ({
      sessionId,
      cursor,
      selection,
      selectedAt,
      drag,
      view,
      updatedAt,
    }));
}

describe('Convergência de presença com três sessões (US-PC.4)', () => {
  it('presença duplicada, atrasada e reordenada converge para os mesmos pares', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...MESSAGES), { minLength: 1, maxLength: 12 }),
        (delivered) => {
          const [s1, s2, s3] = makeSessions(3) as [
            YjsCollaborationSession,
            YjsCollaborationSession,
            YjsCollaborationSession,
          ];
          for (const session of [s1, s2, s3]) {
            // Cada sessão recebe a mesma lista, em ordens diferentes (rotação) e com duplicatas.
            const order = delivered.slice().reverse();
            for (const state of order) {
              session.handleTransportMessage({
                type: 'presence',
                senderSessionId: state.sessionId,
                payload: state,
              });
            }
            for (const state of delivered) {
              session.handleTransportMessage({
                type: 'presence',
                senderSessionId: state.sessionId,
                payload: state,
              });
            }
          }

          const expected = (['a', 'b'] as const)
            .map((sender) => {
              const mine = delivered.filter((m) => m.sessionId === `sess-${sender}`);
              return mine.length === 0
                ? null
                : mine.reduce((best, m) => (m.updatedAt > best.updatedAt ? m : best));
            })
            .filter((m): m is LocalAwarenessState => m !== null);

          for (const session of [s1, s2, s3]) {
            const seen = snapshotOf(session);
            for (const last of expected) {
              expect(seen.find((p) => p.sessionId === last.sessionId)).toMatchObject({
                cursor: last.cursor,
                selection: last.selection,
                selectedAt: last.selectedAt,
                drag: last.drag,
                view: last.view,
                updatedAt: last.updatedAt,
              });
            }
          }
          expect(snapshotOf(s1)).toEqual(snapshotOf(s2));
          expect(snapshotOf(s2)).toEqual(snapshotOf(s3));
          for (const session of [s1, s2, s3]) session.destroy();
        },
      ),
      { numRuns: 60 },
    );
  });

  it('uma saída (null) tira o participante de todas as sessões', () => {
    const [s1, s2] = makeSessions(2) as [YjsCollaborationSession, YjsCollaborationSession];
    for (const session of [s1, s2]) {
      session.handleTransportMessage({
        type: 'presence',
        senderSessionId: 'sess-a',
        payload: stateOf('a', 1),
      });
      session.handleTransportMessage({
        type: 'presence',
        senderSessionId: 'sess-a',
        payload: null,
      });
    }

    expect(snapshotOf(s1)).toHaveLength(0);
    expect(snapshotOf(s2)).toHaveLength(0);
    s1.destroy();
    s2.destroy();
  });
});
