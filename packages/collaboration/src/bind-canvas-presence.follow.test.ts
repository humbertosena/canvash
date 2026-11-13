import {
  clampZoom,
  createCanvasSection,
  screenToWorld,
  type CanvasSectionApi,
} from '@canvash/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindCanvasPresence,
  type CanvasPresenceBinding,
  type CanvasPresenceSession,
  type PointerTargetLike,
} from './bind-canvas-presence.js';
import type { PresenceUpdate, RemotePresence } from './types.js';

class FakeSession implements CanvasPresenceSession {
  readonly updates: PresenceUpdate[] = [];
  presences: RemotePresence[] = [];
  private readonly listeners = new Set<(list: readonly RemotePresence[]) => void>();
  constructor(readonly sessionId = 'me') {}
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
  lastView(): PresenceUpdate['view'] {
    for (let i = this.updates.length - 1; i >= 0; i--) {
      if ('view' in this.updates[i]!) return this.updates[i]!.view;
    }
    return undefined;
  }
}

class FakeTarget extends EventTarget implements PointerTargetLike {
  constructor(public rect = { left: 0, top: 0, width: 800, height: 600 }) {
    super();
  }
  getBoundingClientRect = () => this.rect as DOMRect;
}

const remote = (overrides: Partial<RemotePresence> = {}): RemotePresence => ({
  sessionId: 'ana',
  userId: 'u-ana',
  userName: 'Ana',
  color: '#dc2626',
  cursor: null,
  selection: [],
  view: { center: { x: 100, y: 50 }, zoom: 2 },
  updatedAt: Date.now(),
  ...overrides,
});

describe('bindCanvasPresence: seguir o apresentador (US-FP.1, US-FP.2, US-FP.4 a US-FP.6)', () => {
  let session: FakeSession;
  let target: FakeTarget;
  let section: CanvasSectionApi;
  let binding: CanvasPresenceBinding;
  let events: Array<[string | null, string]>;

  const centerOf = (): { x: number; y: number } => {
    const rect = target.rect;
    return screenToWorld(section.getSnapshot().session.viewport, {
      x: rect.width / 2,
      y: rect.height / 2,
    });
  };

  beforeEach(() => {
    session = new FakeSession();
    target = new FakeTarget();
    section = createCanvasSection();
    binding = bindCanvasPresence({ session, section, pointerTarget: target });
    events = [];
    binding.onFollowChange((id, reason) => events.push([id, reason]));
    session.emit([remote()]);
  });

  it('recusa quem não está na sessão (NOT_FOUND) e quem não publica a vista (UNSUPPORTED)', () => {
    const missing = binding.follow('fantasma');
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');

    session.emit([remote(), remote({ sessionId: 'velho', userName: 'Velho', view: undefined })]);
    const old = binding.follow('velho');
    expect(!old.ok && old.error.code).toBe('UNSUPPORTED');
    expect(binding.getFollowing()).toBeNull();
    expect(events).toEqual([]);
  });

  it('sem alvo de ponteiro não dá para alinhar o centro: UNSUPPORTED', () => {
    const bareSession = new FakeSession('x');
    const bare = bindCanvasPresence({ session: bareSession, section: createCanvasSection() });
    bareSession.emit([remote()]);

    const result = bare.follow('ana');

    expect(!result.ok && result.error.code).toBe('UNSUPPORTED');
  });

  it('a primeira aplicação é imediata: mesmo zoom e centro dela no centro local (US-FP.1)', () => {
    const result = binding.follow('ana');

    expect(result.ok).toBe(true);
    expect(binding.getFollowing()).toBe('ana');
    expect(events).toEqual([['ana', 'user']]);
    expect(section.getSnapshot().session.viewport.zoom).toBe(2);
    const center = centerOf();
    expect(center.x).toBeCloseTo(100, 6);
    expect(center.y).toBeCloseTo(50, 6);
  });

  it('acompanha cada vista nova, com telas de tamanhos diferentes (US-FP.2)', () => {
    target.rect = { left: 10, top: 20, width: 1000, height: 500 };
    binding.follow('ana');

    session.emit([remote({ view: { center: { x: -300, y: 40 }, zoom: 0.5 } })]);

    expect(section.getSnapshot().session.viewport.zoom).toBe(0.5);
    expect(centerOf().x).toBeCloseTo(-300, 6);
    expect(centerOf().y).toBeCloseTo(40, 6);

    session.emit([
      remote({ view: { center: { x: 7, y: 9 }, zoom: 4 }, updatedAt: Date.now() + 1 }),
    ]);
    expect(centerOf().x).toBeCloseTo(7, 6);
    expect(section.getSnapshot().session.viewport.zoom).toBe(4);
  });

  it('leva o zoom à faixa aceita pelo clampZoom', () => {
    binding.follow('ana');

    session.emit([remote({ view: { center: { x: 0, y: 0 }, zoom: 100 } })]);
    expect(section.getSnapshot().session.viewport.zoom).toBe(clampZoom(100));
    expect(centerOf().x).toBeCloseTo(0, 6);

    session.emit([
      remote({ view: { center: { x: 5, y: 5 }, zoom: 0.0001 }, updatedAt: Date.now() + 1 }),
    ]);
    expect(section.getSnapshot().session.viewport.zoom).toBe(clampZoom(0.0001));
  });

  it('um setViewport que não vem do vínculo encerra com "gesture" (US-FP.4)', () => {
    binding.follow('ana');
    events.length = 0;

    section.setViewport({ x: 5, y: 5, zoom: 1 });

    expect(binding.getFollowing()).toBeNull();
    expect(events).toEqual([[null, 'gesture']]);
    session.emit([remote({ view: { center: { x: 900, y: 900 }, zoom: 1 } })]);
    expect(section.getSnapshot().session.viewport).toEqual({ x: 5, y: 5, zoom: 1 });
  });

  it('selecionar e editar não encerram (US-FP.5)', () => {
    section.dispatch({
      type: 'shape.create',
      shape: {
        id: 'a',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        style: { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 },
      },
    });
    binding.follow('ana');

    section.setSelection(['a']);
    section.dispatch({ type: 'shape.update', id: 'a', patch: { x: 50 } });
    section.setTool('hand');

    expect(binding.getFollowing()).toBe('ana');
  });

  it('a pessoa seguida sair ou expirar encerra com "left" (US-FP.6)', () => {
    binding.follow('ana');
    events.length = 0;

    session.emit([]);

    expect(binding.getFollowing()).toBeNull();
    expect(events).toEqual([[null, 'left']]);

    session.emit([remote()]);
    binding.follow('ana');
    events.length = 0;
    session.emit([remote({ updatedAt: Date.now() - 120_000 })]);
    expect(events).toEqual([[null, 'left']]);
  });

  it('destroy encerra com "stopped", e follow(null) encerra com "user"', () => {
    binding.follow('ana');
    events.length = 0;
    binding.follow(null);
    expect(events).toEqual([[null, 'user']]);

    binding.follow('ana');
    events.length = 0;
    binding.destroy();
    expect(events).toEqual([[null, 'stopped']]);
    expect(binding.getFollowing()).toBeNull();
  });

  it('seguir outra pessoa troca o alvo, e seguir a mesma de novo não repete o aviso', () => {
    session.emit([remote(), remote({ sessionId: 'caio', userName: 'Caio' })]);
    binding.follow('ana');
    events.length = 0;

    binding.follow('ana');
    expect(events).toEqual([]);
    binding.follow('caio');
    expect(events).toEqual([['caio', 'user']]);
  });

  it('marca followed no peer seguido e só nele', () => {
    session.emit([remote(), remote({ sessionId: 'caio', userName: 'Caio' })]);

    binding.follow('caio');

    expect(section.getPeers().map((peer) => [peer.sessionId, peer.followed])).toEqual([
      ['ana', false],
      ['caio', true],
    ]);
    binding.follow(null);
    expect(section.getPeers().every((peer) => !peer.followed)).toBe(true);
  });

  it('onFollowChange devolve o cancelamento', () => {
    const listener = vi.fn();
    const off = binding.onFollowChange(listener);
    off();

    binding.follow('ana');

    expect(listener).not.toHaveBeenCalled();
  });

  it('o viewport espelhado é republicado como a vista local (seguir em cadeia)', () => {
    binding.follow('ana');

    const view = session.lastView();
    expect(view?.zoom).toBe(2);
    expect(view?.center.x).toBeCloseTo(100, 6);
    expect(view?.center.y).toBeCloseTo(50, 6);
  });

  it('o viewport seguido não entra no documento nem na revisão', () => {
    const revision = section.getSnapshot().revision;
    const document = JSON.stringify(section.getSnapshot().document);

    binding.follow('ana');
    session.emit([
      remote({ view: { center: { x: 1, y: 1 }, zoom: 3 }, updatedAt: Date.now() + 1 }),
    ]);

    expect(section.getSnapshot().revision).toBe(revision);
    expect(JSON.stringify(section.getSnapshot().document)).toBe(document);
    expect(section.getSnapshot().history.canUndo).toBe(false);
  });
});

describe('bindCanvasPresence: seguir sem laço (US-FP.7)', () => {
  it('dois vínculos que se seguem convergem com poucas atualizações de viewport', () => {
    const sessionA = new FakeSession('a');
    const sessionB = new FakeSession('b');
    const sectionA = createCanvasSection();
    const sectionB = createCanvasSection();
    const targetA = new FakeTarget({ left: 0, top: 0, width: 800, height: 600 });
    const targetB = new FakeTarget({ left: 0, top: 0, width: 1200, height: 700 });
    const bindingA = bindCanvasPresence({
      session: sessionA,
      section: sectionA,
      pointerTarget: targetA,
    });
    const bindingB = bindCanvasPresence({
      session: sessionB,
      section: sectionB,
      pointerTarget: targetB,
    });
    let viewportEventsA = 0;
    let viewportEventsB = 0;
    sectionA.subscribe((c) => c.areas.includes('viewport') && viewportEventsA++);
    sectionB.subscribe((c) => c.areas.includes('viewport') && viewportEventsB++);

    const asPresence = (id: string, session: FakeSession): RemotePresence => ({
      sessionId: id,
      userId: `u-${id}`,
      userName: id,
      color: '#16a34a',
      cursor: null,
      selection: [],
      view: session.lastView() ?? undefined,
      updatedAt: Date.now(),
    });
    // Troca de presenças em rodadas, até estabilizar ou estourar o limite.
    const pump = (): void => {
      sessionA.emit([asPresence('b', sessionB)]);
      sessionB.emit([asPresence('a', sessionA)]);
    };
    pump();
    expect(bindingA.follow('b').ok).toBe(true);
    expect(bindingB.follow('a').ok).toBe(true);
    for (let round = 0; round < 20; round += 1) pump();

    expect(viewportEventsA).toBeLessThan(10);
    expect(viewportEventsB).toBeLessThan(10);
    expect(bindingA.getFollowing()).toBe('b');
    expect(bindingB.getFollowing()).toBe('a');
  });

  it('em cadeia, A segue B e B segue C: A termina vendo o que C vê', () => {
    const names = ['a', 'b', 'c'] as const;
    const sessions = Object.fromEntries(names.map((n) => [n, new FakeSession(n)])) as Record<
      (typeof names)[number],
      FakeSession
    >;
    const canvas = Object.fromEntries(names.map((n) => [n, createCanvasSection()])) as Record<
      (typeof names)[number],
      CanvasSectionApi
    >;
    const bindings = Object.fromEntries(
      names.map((n) => [
        n,
        bindCanvasPresence({
          session: sessions[n],
          section: canvas[n],
          pointerTarget: new FakeTarget(),
        }),
      ]),
    ) as Record<(typeof names)[number], CanvasPresenceBinding>;
    const presenceOf = (from: (typeof names)[number]): RemotePresence => ({
      sessionId: from,
      userId: `u-${from}`,
      userName: from,
      color: '#9333ea',
      cursor: null,
      selection: [],
      view: sessions[from].lastView() ?? undefined,
      updatedAt: Date.now(),
    });
    const pump = (): void => {
      for (const n of names) sessions[n].emit(names.filter((m) => m !== n).map(presenceOf));
    };
    pump();
    bindings.a.follow('b');
    bindings.b.follow('c');

    canvas.c.setViewport({ x: -300, y: 120, zoom: 1.5 });
    for (let round = 0; round < 6; round += 1) pump();

    expect(canvas.b.getSnapshot().session.viewport.zoom).toBeCloseTo(1.5, 6);
    expect(canvas.a.getSnapshot().session.viewport.zoom).toBeCloseTo(1.5, 6);
    expect(canvas.a.getSnapshot().session.viewport.x).toBeCloseTo(
      canvas.c.getSnapshot().session.viewport.x,
      4,
    );
  });
});
