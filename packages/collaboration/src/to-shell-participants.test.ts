import type { CanvasPeer } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { toShellParticipants } from './to-shell-participants.js';

const peer = (sessionId: string, name: string, extra: Partial<CanvasPeer> = {}): CanvasPeer => ({
  sessionId,
  name,
  color: '#dc2626',
  cursor: null,
  selection: [],
  selectedAt: null,
  drag: null,
  view: null,
  locks: [],
  followed: false,
  ...extra,
});

describe('toShellParticipants', () => {
  it('põe a pessoa local primeiro, marcada como self, e mantém a ordem de chegada dos outros', () => {
    const result = toShellParticipants([peer('b', 'Bia'), peer('c', 'Caio')], {
      id: 'a',
      name: 'Ana',
      color: '#2563eb',
    });

    expect(result).toEqual([
      { id: 'a', name: 'Ana', color: '#2563eb', self: true },
      { id: 'b', name: 'Bia', color: '#dc2626', canFollow: false },
      { id: 'c', name: 'Caio', color: '#dc2626', canFollow: false },
    ]);
  });

  it('leva a foto quando há, sem criar a chave quando não há', () => {
    const [self, other] = toShellParticipants(
      [peer('b', 'Bia', { avatarUrl: 'https://x.com/b.png' })],
      { id: 'a', name: 'Ana', color: '#2563eb', avatarUrl: 'https://x.com/a.png' },
    );

    expect(self).toMatchObject({ avatarUrl: 'https://x.com/a.png', self: true });
    expect(other).toMatchObject({ avatarUrl: 'https://x.com/b.png' });
    expect('avatarUrl' in toShellParticipants([peer('c', 'Caio')])[0]!).toBe(false);
  });

  it('canFollow é verdadeiro só para quem publica a vista', () => {
    const [withView, without] = toShellParticipants([
      peer('b', 'Bia', { view: { center: { x: 0, y: 0 }, zoom: 1 } }),
      peer('c', 'Caio'),
    ]);

    expect(withView?.canFollow).toBe(true);
    expect(without?.canFollow).toBe(false);
  });

  it('sem a pessoa local devolve só os outros', () => {
    expect(toShellParticipants([peer('b', 'Bia')]).map((p) => p.id)).toEqual(['b']);
    expect(toShellParticipants([])).toEqual([]);
  });

  it('não muda a lista de entrada e devolve objetos novos', () => {
    const peers = [peer('b', 'Bia')];
    const result = toShellParticipants(peers);

    expect(result[0]).not.toBe(peers[0]);
    expect(peers).toHaveLength(1);
  });
});
