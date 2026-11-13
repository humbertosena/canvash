import { createCanvasSection, type CanvasSectionApi } from '@canvash/core';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindCanvasPresence,
  type CanvasPresenceSession,
  type BindCanvasPresenceOptions,
  type PointerTargetLike,
} from './bind-canvas-presence.js';
import { expectTypeOf } from 'vitest';
import { resolveLocks } from './peer-locks.js';
import type { PresenceUpdate, RemotePresence } from './types.js';

class FakeSession implements CanvasPresenceSession {
  constructor(readonly sessionId = 'me') {}
  readonly updates: PresenceUpdate[] = [];
  presences: RemotePresence[] = [];
  private readonly listeners = new Set<(list: readonly RemotePresence[]) => void>();
  updatePresence = (update: PresenceUpdate): void => {
    this.updates.push(update);
  };
  getPresences = (): readonly RemotePresence[] => this.presences;
  onPresenceChange = (listener: (list: readonly RemotePresence[]) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  emit(list: RemotePresence[]): void {
    this.presences = list;
    for (const listener of this.listeners) listener(list);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  /** O último valor publicado de um campo. */
  last<K extends keyof PresenceUpdate>(key: K): PresenceUpdate[K] | undefined {
    for (let i = this.updates.length - 1; i >= 0; i--) {
      const update = this.updates[i]!;
      if (key in update) return update[key];
    }
    return undefined;
  }
}

class FakeTarget extends EventTarget implements PointerTargetLike {
  rect = { left: 100, top: 50, width: 800, height: 600 };
  getBoundingClientRect = () => this.rect as DOMRect;
  count = 0;
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
    this.count++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
    this.count--;
    super.removeEventListener(...args);
  }
  pointer(type: 'pointermove' | 'pointerleave', clientX = 0, clientY = 0): void {
    this.dispatchEvent(Object.assign(new Event(type), { clientX, clientY }));
  }
}

const STYLE = { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 } as const;
const rect = (id: string, x: number, y: number, width = 10, height = 10) => ({
  id,
  type: 'rectangle' as const,
  x,
  y,
  width,
  height,
  rotation: 0,
  visible: true,
  locked: false,
  style: STYLE,
});

function sectionWithNodes(): CanvasSectionApi {
  const section = createCanvasSection();
  for (const id of ['a', 'b']) {
    section.dispatch({ type: 'shape.create', shape: rect(id, id === 'a' ? 0 : 100, 0) });
  }
  return section;
}

function remote(overrides: Partial<RemotePresence> = {}): RemotePresence {
  return {
    sessionId: 'other',
    userId: 'u2',
    userName: 'Bia',
    color: '#dc2626',
    cursor: { x: 1, y: 2 },
    selection: ['a'],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('bindCanvasPresence', () => {
  let session: FakeSession;
  let target: FakeTarget;
  let section: CanvasSectionApi;
  let clock: number;

  beforeEach(() => {
    session = new FakeSession();
    target = new FakeTarget();
    section = sectionWithNodes();
    clock = 1000;
  });

  afterEach(() => vi.useRealTimers());

  const bind = (extra: Partial<Parameters<typeof bindCanvasPresence>[0]> = {}) =>
    bindCanvasPresence({ session, section, pointerTarget: target, now: () => clock, ...extra });

  it('publica a seleção e a vista logo ao ligar', () => {
    bind();

    expect(session.last('selection')).toEqual([]);
    expect(session.last('view')).toEqual({ center: { x: 400, y: 300 }, zoom: 1 });
  });

  it('selecionar publica selection e selectedAt, que só muda quando o conjunto muda (US-PC.5)', () => {
    bind();

    section.setSelection(['a']);
    expect(session.last('selection')).toEqual(['a']);
    expect(session.last('selectedAt')).toBe(1000);

    clock = 2000;
    section.setSelection(['a']);
    expect(session.last('selectedAt')).toBe(1000);

    clock = 3000;
    section.setSelection(['a', 'b']);
    expect(session.last('selectedAt')).toBe(3000);
    expect(session.last('selection')).toEqual(['a', 'b']);
  });

  it('desselecionar publica a seleção vazia', () => {
    bind();
    section.setSelection(['a']);

    section.setSelection([]);

    expect(session.last('selection')).toEqual([]);
  });

  it('mover pelo preview publica drag com dx e dy únicos e termina com drag nulo', () => {
    bind();
    section.setSelection(['a', 'b']);

    section.setPreview({ updates: [rect('a', 30, 40), rect('b', 130, 40)] });
    expect(session.last('drag')).toEqual({ ids: ['a', 'b'], dx: 30, dy: 40 });

    section.setPreview({ updates: [rect('a', 35, 45), rect('b', 135, 45)] });
    expect(session.last('drag')).toEqual({ ids: ['a', 'b'], dx: 35, dy: 45 });

    section.setPreview(null);
    expect(session.last('drag')).toBeNull();
  });

  it('um preview misto, de redimensionar ou de criação publica drag nulo', () => {
    bind();
    const startDrag = () => {
      section.setPreview({ updates: [rect('a', 30, 40)] });
      expect(session.last('drag')).toEqual({ ids: ['a'], dx: 30, dy: 40 });
    };

    startDrag();
    section.setPreview({ updates: [rect('a', 30, 0), rect('b', 100, 77)] });
    expect(session.last('drag')).toBeNull();

    startDrag();
    section.setPreview({ updates: [rect('a', 0, 0, 50, 10)] });
    expect(session.last('drag')).toBeNull();

    startDrag();
    section.setPreview({ updates: [], additions: [rect('novo', 5, 5)] });
    expect(session.last('drag')).toBeNull();

    startDrag();
    section.setPreview({ updates: [rect('a', 0, 0)] });
    expect(session.last('drag')).toBeNull();
  });

  it('view.center é o centro do alvo em mundo e muda com pan e zoom', () => {
    bind();

    section.setViewport({ x: -100, y: 0, zoom: 1 });
    expect(session.last('view')).toEqual({ center: { x: 500, y: 300 }, zoom: 1 });

    section.setViewport({ x: 0, y: 0, zoom: 2 });
    expect(session.last('view')).toEqual({ center: { x: 200, y: 150 }, zoom: 2 });
  });

  it('sem alvo de ponteiro não publica a vista nem escuta o cursor', () => {
    bindCanvasPresence({ session, section, now: () => clock });
    section.setViewport({ x: 5, y: 5, zoom: 1 });

    expect(session.updates.some((update) => 'view' in update)).toBe(false);
  });

  it('o ponteiro publica o cursor em mundo, e sair do alvo publica nulo', () => {
    bind();
    section.setViewport({ x: 20, y: 10, zoom: 2 });

    target.pointer('pointermove', 100 + 220, 50 + 110);
    expect(session.last('cursor')).toEqual({ x: 100, y: 50 });

    target.pointer('pointerleave');
    expect(session.last('cursor')).toBeNull();
  });

  it('traduz as presenças dos outros para section.setPeers, sem a própria sessão e sem as expiradas', () => {
    const now = Date.now();
    bind();

    session.emit([
      remote({ sessionId: 'other', updatedAt: now }),
      remote({ sessionId: 'me', userName: 'Eu', updatedAt: now }),
      remote({ sessionId: 'velha', updatedAt: now - 60_000 }),
    ]);

    expect(section.getPeers().map((p) => p.sessionId)).toEqual(['other']);
    expect(section.getPeers()[0]).toMatchObject({
      name: 'Bia',
      color: '#dc2626',
      cursor: { x: 1, y: 2 },
      selection: ['a'],
      selectedAt: null,
      drag: null,
      view: null,
      // Ninguém mais seleciona 'a': quem a selecionou detém o bloqueio.
      locks: ['a'],
      followed: false,
    });
  });

  it('mantém os campos novos e usa um nome padrão quando falta', () => {
    bind();

    session.emit([
      remote({
        userName: undefined,
        selectedAt: 5,
        drag: { ids: ['a'], dx: 1, dy: 2 },
        view: { center: { x: 3, y: 4 }, zoom: 2 },
        avatarUrl: 'https://x.com/a.png',
      }),
    ]);

    expect(section.getPeers()[0]).toMatchObject({
      name: 'Participante',
      selectedAt: 5,
      drag: { ids: ['a'], dx: 1, dy: 2 },
      view: { center: { x: 3, y: 4 }, zoom: 2 },
      avatarUrl: 'https://x.com/a.png',
    });
  });

  it('descarta só a presença inválida e avisa onError', () => {
    const onError = vi.fn();
    bind({ onError });

    session.emit([remote({ sessionId: 'boa' }), remote({ sessionId: 'ruim', color: 'vermelho' })]);

    expect(section.getPeers().map((p) => p.sessionId)).toEqual(['boa']);
    expect(onError).toHaveBeenCalledWith({ reason: 'INVALID_COLOR', field: 'color' });
  });

  it('uma saída remove o participante dos peers', () => {
    bind();
    session.emit([remote()]);
    expect(section.getPeers()).toHaveLength(1);

    session.emit([]);

    expect(section.getPeers()).toHaveLength(0);
  });

  it('destroy é idempotente, solta tudo e limpa os peers (US-PC.7)', () => {
    const binding = bind();
    session.emit([remote()]);
    expect(session.listenerCount).toBe(1);
    expect(target.count).toBeGreaterThan(0);

    binding.destroy();
    binding.destroy();

    expect(session.listenerCount).toBe(0);
    expect(target.count).toBe(0);
    expect(section.getPeers()).toEqual([]);
    expect(session.last('drag')).toBeNull();
    expect(session.last('cursor')).toBeNull();

    const published = session.updates.length;
    target.pointer('pointermove', 300, 300);
    section.setSelection(['a']);
    section.setViewport({ x: 9, y: 9, zoom: 1 });
    session.emit([remote()]);
    expect(session.updates.length).toBe(published);
    expect(section.getPeers()).toEqual([]);
  });

  it('destroy depois de o canvas ser destruído não lança', () => {
    const binding = bind();
    section.destroy();

    expect(() => binding.destroy()).not.toThrow();
  });

  describe('bloqueio por seleção (US-RL.4)', () => {
    const flush = async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    };

    it('quem selecionou depois perde o nó, que sai da seleção, e onLockLost vem uma vez', async () => {
      const onLockLost = vi.fn();
      bind({ onLockLost });
      session.emit([remote({ sessionId: 'other', selection: ['a'], selectedAt: 500 })]);
      expect(section.getPeers()[0]?.locks).toEqual(['a']);

      clock = 900;
      section.setSelection(['a', 'b']);
      await flush();

      expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
      expect(onLockLost).toHaveBeenCalledTimes(1);
      expect(onLockLost.mock.calls[0]?.[0]).toBe('a');
      expect(onLockLost.mock.calls[0]?.[1]).toMatchObject({ sessionId: 'other', name: 'Bia' });
      expect(session.last('selection')).toEqual(['b']);
    });

    it('perder um nó não entra no histórico nem avança a revisão', async () => {
      bind();
      session.emit([remote({ selection: ['a'], selectedAt: 500 })]);
      const before = section.getSnapshot();

      section.setSelection(['a']);
      await flush();

      expect(section.getSnapshot().revision).toBe(before.revision);
      expect(section.getSnapshot().history).toEqual(before.history);
    });

    it('quem selecionou antes mantém o nó, e o outro participante fica sem o bloqueio', async () => {
      clock = 100;
      bind();
      section.setSelection(['a']);
      session.emit([remote({ selection: ['a'], selectedAt: 800 })]);
      await flush();

      expect(section.getSnapshot().session.selectedIds).toEqual(['a']);
      expect(section.getPeers()[0]?.locks).toEqual([]);
    });

    it('no empate vence o menor sessionId', async () => {
      const onLockLost = vi.fn();
      clock = 700;
      bind({ onLockLost });
      section.setSelection(['a']);
      // 'me' < 'other': a sessão local vence o empate.
      session.emit([remote({ sessionId: 'other', selection: ['a'], selectedAt: 700 })]);
      await flush();
      expect(section.getSnapshot().session.selectedIds).toEqual(['a']);
      expect(onLockLost).not.toHaveBeenCalled();

      // 'a0' < 'me': agora quem vence é o outro.
      session.emit([remote({ sessionId: 'a0', selection: ['a'], selectedAt: 700 })]);
      await flush();
      expect(section.getSnapshot().session.selectedIds).toEqual([]);
      expect(onLockLost).toHaveBeenCalledTimes(1);
    });

    it('selecionar o membro de um grupo travado pelo grupo é perder', async () => {
      section.dispatch({ type: 'group.create', id: 'g1', childIds: ['a', 'b'] });
      const onLockLost = vi.fn();
      bind({ onLockLost });
      session.emit([remote({ selection: ['g1'], selectedAt: 10 })]);

      clock = 50;
      section.setSelection(['a']);
      await flush();

      expect(section.getSnapshot().session.selectedIds).toEqual([]);
      expect(section.getPeerLock('a')?.sessionId).toBe('other');
      expect(onLockLost).toHaveBeenCalledWith('a', expect.objectContaining({ sessionId: 'other' }));
    });

    it('tirar nós da seleção não renova o selectedAt publicado', async () => {
      bind();
      clock = 100;
      section.setSelection(['a', 'b']);
      expect(session.last('selectedAt')).toBe(100);

      clock = 900;
      section.setSelection(['a']);

      expect(session.last('selectedAt')).toBe(100);
    });

    it('o participante que sai libera o nó', async () => {
      bind();
      session.emit([remote({ selection: ['a'], selectedAt: 10 })]);
      expect(section.getPeerLock('a')?.sessionId).toBe('other');

      session.emit([]);

      expect(section.getPeerLock('a')).toBeUndefined();
    });

    it('propriedade: três vínculos com as mesmas presenças, em qualquer ordem, dão o mesmo dono', async () => {
      const ids = ['a', 'b'] as const;
      const claim = fc.record({
        selectedAt: fc.integer({ min: 1, max: 3 }),
        selection: fc.subarray([...ids], { minLength: 1 }),
      });

      await fc.assert(
        fc.asyncProperty(
          fc.tuple(claim, claim, claim),
          fc.array(fc.nat(2), { minLength: 0, maxLength: 6 }),
          async (claims, noise) => {
            const names = ['s1', 's2', 's3'] as const;
            const rigs = names.map((name) => {
              const own = new FakeSession(name);
              const ownSection = sectionWithNodes();
              return { name, own, section: ownSection };
            });
            const times = new Map<string, number>();
            const stateOf = (name: string, index: number): RemotePresence => ({
              sessionId: name,
              userId: `u-${name}`,
              userName: name,
              color: '#dc2626',
              cursor: null,
              selection: claims[index]!.selection,
              selectedAt: claims[index]!.selectedAt,
              updatedAt: Date.now(),
            });
            rigs.forEach((rig, index) => {
              times.set(rig.name, claims[index]!.selectedAt);
              bindCanvasPresence({
                session: rig.own,
                section: rig.section,
                now: () => times.get(rig.name)!,
              });
              rig.section.setSelection(claims[index]!.selection);
            });
            await flush();

            // Cada vínculo recebe as outras presenças na ordem que o ruído sortear, com repetição.
            for (const [index, rig] of rigs.entries()) {
              const others = rigs
                .map((other, otherIndex) => ({ other, otherIndex }))
                .filter(({ other }) => other.name !== rig.name);
              const order = [...others].sort(
                (x, y) =>
                  ((noise[x.otherIndex] ?? 0) - (noise[y.otherIndex] ?? 0)) *
                  (index % 2 === 0 ? 1 : -1),
              );
              let arrived: RemotePresence[] = [];
              for (const { other, otherIndex } of [...order, ...order]) {
                arrived = [
                  ...arrived.filter((p) => p.sessionId !== other.name),
                  stateOf(other.name, otherIndex),
                ];
                rig.own.emit(arrived);
              }
            }
            await flush();

            const expected = resolveLocks(
              names.map((name, index) => ({
                sessionId: name,
                selectedAt: claims[index]!.selectedAt,
                selection: claims[index]!.selection,
              })),
            );
            for (const rig of rigs) {
              for (const id of ids) {
                const holder = rig.section.getSnapshot().session.selectedIds.includes(id)
                  ? rig.name
                  : rig.section.getPeerLock(id)?.sessionId;
                expect(holder).toBe(expected.get(id));
              }
            }
          },
        ),
        { numRuns: 60 },
      );
    });
  });
});

describe('contrato de tipos de BindCanvasPresenceOptions', () => {
  it('recebe a instância em section e não tem a chave antiga', () => {
    type LegacyKey = `${'bo'}${'ard'}`;

    expectTypeOf<BindCanvasPresenceOptions['section']>().toEqualTypeOf<CanvasSectionApi>();
    expectTypeOf<
      LegacyKey extends keyof BindCanvasPresenceOptions ? true : false
    >().toEqualTypeOf<false>();
  });
});

describe('bindCanvasPresence com board (US-BD.15)', () => {
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  /** Um canvas com o board `b` (filhos `c` e `d`) e uma forma `fora`; cada sessão tem o seu. */
  function boardSection(extraChildren = 0): CanvasSectionApi {
    const section = createCanvasSection();
    const extra = Array.from({ length: extraChildren }, (_, i) => `x${i}`);
    const result = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 500, height: 300 },
      },
      ...['c', 'd', 'fora', ...extra].map((id, i) => ({
        type: 'shape.create',
        shape: rect(id, 10 + i * 12, 20),
      })),
      { type: 'board.attach', boardId: 'b', ids: ['c', 'd', ...extra] },
    ] as never);
    expect(result.ok).toBe(true);
    return section;
  }

  function open(sessionId: string, section = boardSection()) {
    const session = new FakeSession(sessionId);
    const onLockLost = vi.fn();
    const binding = bindCanvasPresence({ session, section, now: () => 1000, onLockLost });
    return { session, section, onLockLost, binding };
  }

  const claim = (sessionId: string, selection: string[], selectedAt: number) =>
    remote({ sessionId, userName: sessionId, selection, selectedAt });

  it('board primeiro: A vence o board e o filho, B perde o filho da seleção e onLockLost vem uma vez', async () => {
    const { session, section, onLockLost } = open('sb');
    section.setSelection(['c']);
    session.emit([claim('sa', ['b'], 5)]);
    await flush();

    expect(section.getSnapshot().session.selectedIds).toEqual([]);
    expect(onLockLost).toHaveBeenCalledTimes(1);
    expect(onLockLost).toHaveBeenCalledWith('c', expect.objectContaining({ sessionId: 'sa' }));
    expect(section.getPeers()[0]).toMatchObject({ sessionId: 'sa', locks: ['b'] });
    expect(section.getPeers()[0]).not.toHaveProperty('released');
    expect(section.getPeerLock('c')?.sessionId).toBe('sa');
  });

  it('filho primeiro: A vence só o board, mantém a seleção dele, e o filho de B fica livre para B', async () => {
    // A é a sessão local: selecionou o board depois de B ter selecionado o filho.
    const a = open('sa');
    a.section.setSelection(['b']);
    a.session.emit([claim('sb', ['c'], 1)]);
    await flush();

    expect(a.section.getSnapshot().session.selectedIds).toEqual(['b']);
    expect(a.onLockLost).not.toHaveBeenCalled();
    expect(a.section.getPeerLock('c')?.sessionId).toBe('sb');
    expect(a.section.getPeerLock('d')).toBeUndefined();

    // Do lado de B: A trava o board e libera o filho que B ganhou.
    const b = open('sb');
    b.section.setSelection(['c']);
    b.session.emit([claim('sa', ['b'], 9999)]);
    await flush();

    expect(b.section.getSnapshot().session.selectedIds).toEqual(['c']);
    expect(b.onLockLost).not.toHaveBeenCalled();
    expect(b.section.getPeers()[0]).toMatchObject({
      sessionId: 'sa',
      locks: ['b'],
      released: ['c'],
    });
    expect(b.section.getPeerLock('c')).toBeUndefined();
    expect(b.section.getPeerLock('d')?.sessionId).toBe('sa');
  });

  it('uma terceira sessão vê o mesmo vencedor do filho nas duas ordens de chegada', async () => {
    const presences = [claim('sa', ['b'], 5), claim('sb', ['c'], 1)];
    const first = open('sc');
    first.session.emit(presences);
    const second = open('sc');
    second.session.emit([...presences].reverse());
    await flush();

    for (const { section } of [first, second]) {
      expect(section.getPeerLock('c')?.sessionId).toBe('sb');
      expect(section.getPeerLock('d')?.sessionId).toBe('sa');
      expect(section.getPeerLock('b')?.sessionId).toBe('sa');
    }
    expect(first.section.getPeers().find((peer) => peer.sessionId === 'sa')).toMatchObject({
      locks: ['b'],
      released: ['c'],
    });
    expect(first.section.getPeers()).toEqual(
      [...second.section.getPeers()].sort(
        (x, y) =>
          presences.findIndex((p) => p.sessionId === x.sessionId) -
          presences.findIndex((p) => p.sessionId === y.sessionId),
      ),
    );
  });

  it('locks não cresce com o tamanho do board, e released só traz os descendentes disputados', async () => {
    const { session, section } = open('sc', boardSection(60));
    session.emit([claim('sa', ['b'], 5), claim('sb', ['x7'], 1)]);
    await flush();

    const a = section.getPeers().find((peer) => peer.sessionId === 'sa')!;
    expect(a.locks).toEqual(['b']);
    expect(a.released).toEqual(['x7']);
    expect(section.getPeers().find((peer) => peer.sessionId === 'sb')?.locks).toEqual(['x7']);
  });

  it('quem perde um descendente de um board selecionado mantém o board', async () => {
    const { session, section, onLockLost } = open('sa');
    section.setSelection(['b']);
    session.emit([claim('sb', ['c', 'd'], 1)]);
    await flush();

    expect(section.getSnapshot().session.selectedIds).toEqual(['b']);
    expect(onLockLost).not.toHaveBeenCalled();
  });

  it('o participante que sai libera o board e os filhos', async () => {
    const { session, section } = open('sc');
    session.emit([claim('sa', ['b'], 5)]);
    expect(section.getPeerLock('c')?.sessionId).toBe('sa');

    session.emit([]);

    expect(section.getPeerLock('c')).toBeUndefined();
  });
});
