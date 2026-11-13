import { describe, expect, it, vi } from 'vitest';
import { createCanvasSection } from './canvas-section.js';
import type { CanvasChange } from './events.js';
import type { CanvasPeer } from './peers.js';

const PEER: CanvasPeer = {
  sessionId: 's1',
  name: 'Ana',
  color: '#2563eb',
  cursor: { x: 10, y: 20 },
  selection: ['a'],
  selectedAt: 100,
  drag: null,
  view: null,
  locks: ['a'],
  followed: false,
};

const peer = (overrides: Partial<CanvasPeer> = {}): CanvasPeer => ({ ...PEER, ...overrides });

function sectionWithNode() {
  const section = createCanvasSection();
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
  return section;
}

describe('section.setPeers / getPeers (US-PC.3)', () => {
  it('começa sem participantes', () => {
    expect(createCanvasSection().getPeers()).toEqual([]);
  });

  it('guarda os participantes sem mexer em revisão, histórico, documento nem JSON', () => {
    const section = sectionWithNode();
    const before = section.getSnapshot();
    const json = JSON.stringify(before.document);

    const result = section.setPeers([peer()]);

    expect(result.ok).toBe(true);
    expect(section.getPeers()).toEqual([PEER]);
    const after = section.getSnapshot();
    expect(after).toBe(before);
    expect(after.revision).toBe(before.revision);
    expect(after.history).toEqual(before.history);
    expect(JSON.stringify(after.document)).toBe(json);
    expect(JSON.stringify(after)).not.toContain('Ana');
  });

  it('publica a área peers com origem remote e o mesmo snapshot', () => {
    const section = sectionWithNode();
    const changes: CanvasChange[] = [];
    section.subscribe((change) => changes.push(change));

    section.setPeers([peer()]);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.areas).toEqual(['peers']);
    expect(changes[0]?.origin).toBe('remote');
    expect(changes[0]?.affectedIds).toEqual([]);
    expect(changes[0]?.snapshot).toBe(section.getSnapshot());
  });

  it('valor igual ao atual não publica nada e mantém a referência', () => {
    const section = sectionWithNode();
    section.setPeers([peer()]);
    const first = section.getPeers();
    const listener = vi.fn();
    section.subscribe(listener);

    section.setPeers([peer()]);

    expect(listener).not.toHaveBeenCalled();
    expect(section.getPeers()).toBe(first);
  });

  it('devolve a lista e cada participante congelados', () => {
    const section = createCanvasSection();
    section.setPeers([peer()]);

    const peers = section.getPeers();
    expect(Object.isFrozen(peers)).toBe(true);
    expect(Object.isFrozen(peers[0])).toBe(true);
    expect(Object.isFrozen(peers[0]?.selection)).toBe(true);
    expect(Object.isFrozen(peers[0]?.cursor)).toBe(true);
  });

  it('copia a entrada: mudar a lista original depois não altera o canvas', () => {
    const section = createCanvasSection();
    const list = [peer()];
    section.setPeers(list);

    list.length = 0;

    expect(section.getPeers()).toHaveLength(1);
  });

  it('funciona em modo somente leitura', () => {
    const section = createCanvasSection();
    section.setReadOnly(true);

    expect(section.setPeers([peer()]).ok).toBe(true);
    expect(section.getPeers()).toHaveLength(1);
  });

  it('replaceDocument não limpa os participantes, e destroy limpa', () => {
    const section = createCanvasSection();
    section.setPeers([peer()]);

    section.replaceDocument(section.getSnapshot().document);
    expect(section.getPeers()).toHaveLength(1);

    section.destroy();
    expect(section.getPeers()).toEqual([]);
    expect(section.setPeers([peer()]).ok).toBe(false);
  });

  it('aceita ids que o documento não conhece e o desenho completo de drag e view', () => {
    const section = createCanvasSection();
    const result = section.setPeers([
      peer({
        selection: ['ainda-nao-chegou'],
        drag: { ids: ['x'], dx: 5, dy: -5 },
        view: { center: { x: 1, y: 2 }, zoom: 2 },
        followed: true,
        avatarUrl: 'https://x.com/a.png',
        selectedAt: null,
        cursor: null,
      }),
    ]);

    expect(result.ok).toBe(true);
    expect(section.getPeers()[0]?.view).toEqual({ center: { x: 1, y: 2 }, zoom: 2 });
    expect(section.getPeers()[0]?.avatarUrl).toBe('https://x.com/a.png');
  });

  it('um participante inválido recusa a lista inteira e o estado anterior continua', () => {
    const section = createCanvasSection();
    section.setPeers([peer()]);
    const before = section.getPeers();

    const cases: unknown[] = [
      'x',
      [peer({ color: 'vermelho' })],
      [peer({ cursor: { x: NaN, y: 0 } })],
      [peer({ cursor: { x: 10_000_001, y: 0 } })],
      [peer({ cursor: 'aqui' as never })],
      [peer({ drag: { ids: [], dx: 0, dy: Infinity } })],
      [peer({ drag: 3 as never })],
      [peer({ view: { center: { x: 0, y: 0 }, zoom: 0 } })],
      [peer({ view: 'x' as never })],
      [peer({ name: 'a'.repeat(65) })],
      [peer({ selection: Array.from({ length: 1001 }, (_, i) => `n${i}`) })],
      [peer({ selection: 'a' as never })],
      [peer({ selection: [3] as never })],
      [peer({ sessionId: '' })],
      [peer({ avatarUrl: 3 as never })],
      [{ ...peer(), extra: 1 }],
      [peer(), peer({ name: 'Outra' })],
      [peer({ followed: 'sim' as unknown as boolean })],
      [peer({ selectedAt: NaN })],
      [3],
      Array.from({ length: 257 }, (_, i) => peer({ sessionId: `s${i}` })),
    ];

    for (const input of cases) {
      const result = section.setPeers(input as never);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(section.getPeers()).toBe(before);
    }
  });

  it('dentro de um listener, setPeers é recusado como as outras alterações', () => {
    const section = createCanvasSection();
    let nested: ReturnType<typeof section.setPeers> | undefined;
    section.subscribe(() => {
      nested ??= section.setPeers([peer({ sessionId: 'dentro' })]);
    });

    section.setPeers([peer()]);

    expect(nested?.ok).toBe(false);
  });
});

describe('section.getPeerLock (US-RL.9)', () => {
  function sectionWithGroup() {
    const section = createCanvasSection();
    for (const id of ['m1', 'm2', 'solo']) {
      section.dispatch({
        type: 'shape.create',
        shape: {
          id,
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          style: { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 },
        },
      });
    }
    const grouped = section.dispatch({ type: 'group.create', id: 'g1', childIds: ['m1', 'm2'] });
    expect(grouped.ok).toBe(true);
    return section;
  }

  it('devolve quem detém o nó, com nome e cor, e undefined para nó livre', () => {
    const section = sectionWithGroup();
    section.setPeers([peer({ locks: ['solo'] })]);

    expect(section.getPeerLock('solo')).toEqual({ sessionId: 's1', name: 'Ana', color: '#2563eb' });
    expect(section.getPeerLock('m1')).toBeUndefined();
    expect(section.getPeerLock('inexistente')).toBeUndefined();
  });

  it('um membro de grupo travado devolve o bloqueio, e o grupo também', () => {
    const section = sectionWithGroup();
    section.setPeers([peer({ locks: ['m1'] })]);

    expect(section.getPeerLock('m1')?.sessionId).toBe('s1');
    expect(section.getPeerLock('g1')?.sessionId).toBe('s1');
    expect(section.getPeerLock('solo')).toBeUndefined();
  });

  it('um grupo travado trava os membros isolados', () => {
    const section = sectionWithGroup();
    section.setPeers([peer({ locks: ['g1'] })]);

    expect(section.getPeerLock('m2')?.sessionId).toBe('s1');
    expect(section.getPeerLock('g1')?.sessionId).toBe('s1');
  });

  it('sem participantes não há bloqueio, e sair da lista libera o nó', () => {
    const section = sectionWithGroup();
    expect(section.getPeerLock('solo')).toBeUndefined();

    section.setPeers([peer({ locks: ['solo'] })]);
    section.setPeers([]);

    expect(section.getPeerLock('solo')).toBeUndefined();
  });

  it('não muda o estado: duas consultas dão o mesmo resultado e nenhuma revisão', () => {
    const section = sectionWithGroup();
    section.setPeers([peer({ locks: ['solo'] })]);
    const revision = section.getSnapshot().revision;

    expect(section.getPeerLock('solo')).toEqual(section.getPeerLock('solo'));
    expect(section.getSnapshot().revision).toBe(revision);
  });
});

describe('section.getPeerLock com board e released (US-BD.15)', () => {
  const style = { fill: '#ffffff', stroke: null, strokeWidth: 1, opacity: 1 };
  const rect = (id: string) => ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    style,
  });

  /** O board `b` com os filhos `c` e `d` e o grupo `g` (membros `m1` e `m2`), e `fora` solto. */
  function sectionWithBoard() {
    const section = createCanvasSection();
    const result = section.transact([
      {
        type: 'shape.create',
        shape: { id: 'b', type: 'board', x: 0, y: 0, width: 200, height: 100 },
      },
      ...['c', 'd', 'm1', 'm2', 'fora'].map((id) => ({ type: 'shape.create', shape: rect(id) })),
      { type: 'group.create', id: 'g', childIds: ['m1', 'm2'] },
      { type: 'board.attach', boardId: 'b', ids: ['c', 'd', 'g'] },
    ] as never);
    expect(result.ok).toBe(true);
    return section;
  }

  const A = (overrides: Partial<CanvasPeer> = {}) =>
    peer({ sessionId: 'a', name: 'Ana', color: '#2563eb', locks: ['b'], ...overrides });
  const B = (overrides: Partial<CanvasPeer> = {}) =>
    peer({ sessionId: 'b', name: 'Beto', color: '#dc2626', locks: ['c'], ...overrides });

  it('com o board de A travado, os filhos, o grupo e os membros apontam para A', () => {
    const section = sectionWithBoard();
    section.setPeers([A()]);

    for (const id of ['b', 'c', 'd', 'g', 'm1', 'm2']) {
      expect(section.getPeerLock(id)?.sessionId).toBe('a');
    }
    expect(section.getPeerLock('fora')).toBeUndefined();
  });

  it('o nó em released de A, detido por B, aponta para B', () => {
    const section = sectionWithBoard();
    section.setPeers([A({ released: ['c'] }), B()]);

    expect(section.getPeerLock('c')?.sessionId).toBe('b');
    expect(section.getPeerLock('d')?.sessionId).toBe('a');
    expect(section.getPeerLock('b')?.sessionId).toBe('a');
  });

  it('sem B nos peers (a sessão de B), o nó em released de A fica livre', () => {
    const section = sectionWithBoard();
    section.setPeers([A({ released: ['c'] })]);

    expect(section.getPeerLock('c')).toBeUndefined();
    expect(section.getPeerLock('d')?.sessionId).toBe('a');
  });

  it('o grupo em released libera os membros dele', () => {
    const section = sectionWithBoard();
    section.setPeers([A({ released: ['g'] })]);

    expect(section.getPeerLock('m1')).toBeUndefined();
    expect(section.getPeerLock('g')).toBeUndefined();
    expect(section.getPeerLock('c')?.sessionId).toBe('a');
  });

  it('o membro detido por B trava o grupo para B, mesmo com o board de A', () => {
    const section = sectionWithBoard();
    section.setPeers([A({ released: ['g'] }), B({ locks: ['m1'] })]);

    expect(section.getPeerLock('m1')?.sessionId).toBe('b');
    expect(section.getPeerLock('g')?.sessionId).toBe('b');
  });

  it('o board travado só vale para quem o detém: B com locks do próprio nó vence A sem released', () => {
    const section = sectionWithBoard();
    section.setPeers([A(), B()]);

    expect(section.getPeerLock('c')?.sessionId).toBe('b');
  });

  it('um peer sem released se comporta como antes', () => {
    const section = sectionWithBoard();
    const plain = A();

    section.setPeers([plain]);

    expect(section.getPeers()[0]).not.toHaveProperty('released');
    expect(section.getPeerLock('d')?.sessionId).toBe('a');
  });

  it('released acima do limite ou com ID inválido recusa o setPeers inteiro', () => {
    const section = sectionWithBoard();
    section.setPeers([A()]);

    const tooMany = section.setPeers([
      A({ released: Array.from({ length: 1001 }, (_, i) => `x${i}`) }),
    ]);
    const invalid = section.setPeers([A({ released: [''] })]);
    const wrongType = section.setPeers([A({ released: 'c' as never })]);

    for (const result of [tooMany, invalid, wrongType]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
    }
    expect(section.getPeers()).toHaveLength(1);
    expect(section.getPeers()[0]).not.toHaveProperty('released');
  });

  it('released chega congelado e fora do documento, do histórico e do snapshot JSON', () => {
    const section = sectionWithBoard();
    const before = JSON.stringify(section.getSnapshot());

    section.setPeers([A({ released: ['c'] })]);

    expect(Object.isFrozen(section.getPeers()[0]!.released)).toBe(true);
    expect(JSON.stringify(section.getSnapshot())).toBe(before);
  });
});
