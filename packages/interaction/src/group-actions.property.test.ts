import { createCanvasSection, type CanvasPeer, type CanvasSectionApi } from '@canvash/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getGroupActions } from './keyboard.js';

// A regra de `getGroupActions` confrontada com o core: o que ela diz que dá certo tem de dar
// certo no `group.create` e no `group.ungroup`, e o que ela diz que não dá tem de ser recusado.

interface Plan {
  /** Camadas além da padrão; cada uma diz se termina bloqueada. */
  readonly layers: readonly boolean[];
  /** Cada retângulo: camada (índice em `layers`) e se tem `locked`. */
  readonly nodes: readonly { readonly layer: number; readonly locked: boolean }[];
  /** Boards (b0, b1...): camada, retângulos que tentam entrar neles e se terminam `locked`. */
  readonly boards: readonly {
    readonly layer: number;
    readonly members: readonly number[];
    readonly locked: boolean;
  }[];
  /** Tentativas de grupo, com índices de retângulos; as recusadas pelo core ficam de fora. */
  readonly groups: readonly (readonly number[])[];
  /** Quais grupos criados terminam com `locked` (só um documento carregado os tem). */
  readonly lockedGroups: readonly number[];
  /** Índices, sobre todos os IDs, dos nós bloqueados por outra sessão. */
  readonly peerLocks: readonly number[];
  /** Índices, sobre todos os IDs mais um inexistente, da seleção. */
  readonly selection: readonly number[];
}

// Um em cada quatro é bloqueado: o bastante para aparecer, pouco para sobrarem grupos livres.
const sometimes = fc.nat(3).map((n) => n === 0);

const planArbitrary: fc.Arbitrary<Plan> = fc.record({
  layers: fc.array(sometimes, { minLength: 1, maxLength: 3 }),
  nodes: fc.array(fc.record({ layer: fc.nat(2), locked: sometimes }), {
    minLength: 2,
    maxLength: 8,
  }),
  boards: fc.array(
    fc.record({
      layer: fc.nat(2),
      members: fc.array(fc.nat(7), { maxLength: 5 }),
      locked: sometimes,
    }),
    { maxLength: 2 },
  ),
  groups: fc.array(fc.array(fc.nat(7), { minLength: 2, maxLength: 3 }), { maxLength: 3 }),
  lockedGroups: fc.array(fc.nat(2), { maxLength: 2 }),
  peerLocks: fc.array(fc.nat(15), { maxLength: 3 }),
  selection: fc.array(fc.nat(16), { maxLength: 6 }),
});

const peerLocking = (locks: string[]): CanvasPeer => ({
  sessionId: 'outra',
  name: 'Bia',
  color: '#dc2626',
  cursor: null,
  selection: locks,
  selectedAt: 1,
  drag: null,
  view: null,
  locks,
  followed: false,
});

/** Monta o canvas do plano; a mesma montagem dá sempre o mesmo documento. */
function build(plan: Plan): { section: CanvasSectionApi; ids: string[] } {
  const section = createCanvasSection();
  const layerId = (index: number) => `L${index % plan.layers.length}`;
  plan.layers.forEach((_, index) => {
    section.dispatch({ type: 'layer.create', layer: { id: `L${index}` } });
  });
  plan.nodes.forEach((node, index) => {
    section.dispatch({
      type: 'shape.create',
      layerId: layerId(node.layer),
      shape: {
        id: `n${index}`,
        type: 'rectangle',
        x: index * 20,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        ...(node.locked ? { locked: true } : {}),
      },
    });
  });
  const boardIds: string[] = [];
  plan.boards.forEach((board, index) => {
    const id = `b${index}`;
    const made = section.dispatch({
      type: 'shape.create',
      layerId: layerId(board.layer),
      shape: { id, type: 'board', x: -50, y: -50, width: 2000, height: 100 },
    });
    if (!made.ok) return;
    boardIds.push(id);
    // Os retângulos que o core aceita no board entram; os outros ficam onde estão.
    const members = [...new Set(board.members.map((m) => `n${m % plan.nodes.length}`))];
    for (const member of members) {
      section.dispatch({ type: 'board.attach', boardId: id, ids: [member] });
    }
  });
  const created: string[] = [];
  plan.groups.forEach((members, index) => {
    const childIds = [...new Set(members.map((m) => `n${m % plan.nodes.length}`))];
    const res = section.dispatch({ type: 'group.create', id: `g${index}`, childIds });
    if (res.ok) created.push(`g${index}`);
  });
  const { document } = section.getSnapshot();
  const nodes = { ...document.nodes };
  for (const pick of plan.lockedGroups) {
    const id = created[pick % Math.max(created.length, 1)];
    const group = id === undefined ? undefined : nodes[id];
    if (id !== undefined && group !== undefined) nodes[id] = { ...group, locked: true };
  }
  section.replaceDocument({ ...document, nodes });
  plan.boards.forEach((board, index) => {
    if (board.locked && boardIds.includes(`b${index}`)) {
      section.dispatch({ type: 'shape.update', id: `b${index}`, patch: { locked: true } });
    }
  });
  plan.layers.forEach((locked, index) => {
    if (locked)
      section.dispatch({ type: 'layer.update', id: `L${index}`, patch: { locked: true } });
  });
  const ids = [...plan.nodes.map((_, index) => `n${index}`), ...created, ...boardIds];
  if (plan.peerLocks.length > 0) {
    section.setPeers([peerLocking(plan.peerLocks.map((pick) => ids[pick % ids.length]!))]);
  }
  return { section, ids };
}

function selectionOf(plan: Plan, ids: readonly string[]): string[] {
  return plan.selection.map((pick) => {
    const index = pick % (ids.length + 1);
    return index === ids.length ? 'fantasma' : ids[index]!;
  });
}

/** Os nós da seleção que existem e que outra sessão não bloqueia. */
function freeNodes(section: CanvasSectionApi, selected: readonly string[]): string[] {
  return [...new Set(selected)].filter(
    (id) =>
      section.getSnapshot().document.nodes[id] !== undefined &&
      section.getPeerLock(id) === undefined,
  );
}

describe('getGroupActions: propriedade contra o core (spec §7)', () => {
  it('Agrupar habilitado é o que group.create aceita com os nós livres', () => {
    fc.assert(
      fc.property(planArbitrary, (plan) => {
        const { section, ids } = build(plan);
        const selected = selectionOf(plan, ids);
        const actions = getGroupActions(section, selected);
        const free = freeNodes(section, selected);
        const res = section.dispatch({ type: 'group.create', childIds: free });
        expect(actions.group === 'enabled').toBe(res.ok);
        if (free.length < 2) expect(actions.group).toBe('hidden');
      }),
      { numRuns: 300 },
    );
  });

  it('Desagrupar habilitado é o que o transact de group.ungroup aceita nos grupos livres', () => {
    fc.assert(
      fc.property(planArbitrary, (plan) => {
        const { section, ids } = build(plan);
        const selected = selectionOf(plan, ids);
        const actions = getGroupActions(section, selected);
        const groups = freeNodes(section, selected).filter(
          (id) => section.getSnapshot().document.nodes[id]?.type === 'group',
        );
        // Quais grupos o core desfaz, um a um, em montagens separadas.
        const ungroupable = groups.filter((id) => {
          const { section: alone } = build(plan);
          return alone.dispatch({ type: 'group.ungroup', id }).ok;
        });
        const res = section.transact(
          ungroupable.map((id) => ({ type: 'group.ungroup', id }) as const),
        );
        expect(actions.ungroup === 'enabled').toBe(ungroupable.length > 0 && res.ok);
        expect(actions.ungroup === 'hidden').toBe(groups.length === 0);
      }),
      { numRuns: 300 },
    );
  });

  it('somente leitura esconde as duas ações, qualquer que seja a seleção', () => {
    fc.assert(
      fc.property(planArbitrary, (plan) => {
        const { section, ids } = build(plan);
        section.setReadOnly(true);
        expect(getGroupActions(section, selectionOf(plan, ids))).toEqual({
          group: 'hidden',
          ungroup: 'hidden',
        });
      }),
      { numRuns: 50 },
    );
  });
});
