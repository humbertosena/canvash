import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import { createPlacements } from './placement.js';
import { validateDocument } from './validate.js';

// Qualquer sequência de comandos de organização produz um documento válido, com todo
// descendente de board à frente do board na ordem visual (spec boards, §3.3 e §6).

type Op =
  | { readonly kind: 'attach'; readonly board: number; readonly ids: readonly number[] }
  | { readonly kind: 'detach'; readonly ids: readonly number[] }
  | {
      readonly kind: 'reorder';
      readonly id: number;
      readonly index: number;
      readonly layer: boolean;
    }
  | { readonly kind: 'remove'; readonly id: number }
  | { readonly kind: 'group'; readonly ids: readonly number[] }
  | { readonly kind: 'ungroup'; readonly id: number }
  | { readonly kind: 'lock'; readonly id: number }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' };

/** Universo fixo: seis retângulos, três grupos possíveis, dois boards e duas camadas. */
const NODES = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'];
const GROUPS = ['g0', 'g1', 'g2'];
const BOARDS = ['b0', 'b1'];
const ALL = [...NODES, ...GROUPS, ...BOARDS];

const pick = (list: readonly string[], n: number): string => list[n % list.length]!;
const picks = (list: readonly string[], ns: readonly number[]): string[] => [
  ...new Set(ns.map((n) => pick(list, n))),
];

const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('attach' as const),
      board: fc.nat(1),
      ids: fc.array(fc.nat(20), { minLength: 1, maxLength: 2 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('detach' as const),
      ids: fc.array(fc.nat(20), { minLength: 1, maxLength: 1 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('reorder' as const),
      id: fc.nat(20),
      index: fc.nat(6),
      layer: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('remove' as const), id: fc.nat(20) }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('group' as const),
      ids: fc.array(fc.nat(20), { minLength: 2, maxLength: 3 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('ungroup' as const), id: fc.nat(20) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('lock' as const), id: fc.nat(20) }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'redo' as const }) },
);

function initial(): CanvasSectionApi {
  const section = createCanvasSection();
  section.transact([
    { type: 'layer.create', layer: { id: 'L1' } },
    ...BOARDS.map((id, index) => ({
      type: 'shape.create' as const,
      shape: { id, type: 'board' as const, x: index * 600, y: 0, width: 500, height: 300 },
    })),
    ...NODES.map((id, index) => ({
      type: 'shape.create' as const,
      layerId: index % 3 === 2 ? 'L1' : undefined,
      shape: {
        id,
        type: 'rectangle' as const,
        x: index * 20,
        y: 40,
        width: 10,
        height: 10,
        rotation: 0,
      },
    })),
  ] as CanvasCommand[]);
  return section;
}

/** Os IDs que existem agora e satisfazem `keep`, para o gerador mirar em algo que existe. */
function existing(section: CanvasSectionApi, keep: (id: string) => boolean): string[] {
  const { nodes } = section.getSnapshot().document;
  return Object.values(nodes)
    .flatMap((node) => (node.type === 'board' ? node.childIds : []))
    .filter(keep);
}

function commandOf(op: Op, section: CanvasSectionApi): CanvasCommand | undefined {
  switch (op.kind) {
    case 'attach':
      return {
        type: 'board.attach',
        boardId: BOARDS[op.board]!,
        ids: picks(ALL.slice(0, 9), op.ids),
      };
    case 'detach': {
      // Mira num filho de board que existe agora; sem nenhum, tenta um qualquer (e é recusado).
      const children = existing(section, () => true);
      const ids =
        children.length > 0 ? [pick(children, op.ids[0]!)] : picks([...NODES, ...GROUPS], op.ids);
      return { type: 'board.detach', ids };
    }
    case 'reorder':
      return {
        type: 'node.reorder',
        id: pick(ALL, op.id),
        index: op.index,
        ...(op.layer ? { layerId: 'L1' } : {}),
      };
    case 'remove':
      return { type: 'shape.remove', id: pick(ALL, op.id) };
    case 'group':
      return { type: 'group.create', id: pick(GROUPS, op.ids[0]!), childIds: picks(NODES, op.ids) };
    case 'ungroup': {
      const groups = Object.values(section.getSnapshot().document.nodes)
        .filter((node) => node.type === 'group')
        .map((node) => node.id);
      return {
        type: 'group.ungroup',
        id: groups.length > 0 ? pick(groups, op.id) : pick(GROUPS, op.id),
      };
    }
    case 'lock':
      return { type: 'shape.update', id: pick(ALL, op.id), patch: { locked: true } } as never;
    default:
      return undefined;
  }
}

function apply(section: CanvasSectionApi, op: Op): void {
  if (op.kind === 'undo') section.undo();
  else if (op.kind === 'redo') section.redo();
  else section.dispatch(commandOf(op, section)!);
}

function expectInvariants(section: CanvasSectionApi): void {
  const { document } = section.getSnapshot();
  // O documento que os comandos produzem passa pelo validador de carga.
  const validated = validateDocument(JSON.parse(JSON.stringify(document)));
  if (!validated.ok)
    throw new Error(`documento inválido: ${JSON.stringify(validated.error.details)}`);

  const placements = createPlacements()(document);
  expect(placements.size).toBe(Object.keys(document.nodes).length);
  for (const node of Object.values(document.nodes)) {
    if (node.type !== 'board') continue;
    const boardRank = placements.get(node.id)!.rank;
    for (const childId of node.childIds) {
      const child = document.nodes[childId]!;
      expect(placements.get(childId)!.rank).toBeGreaterThan(boardRank);
      expect(section.getNodeInfo(childId)!.boardId).toBe(node.id);
      expect(placements.get(childId)!.layer.id).toBe(placements.get(node.id)!.layer.id);
      if (child.type === 'group') {
        for (const memberId of child.childIds) {
          expect(placements.get(memberId)!.rank).toBeGreaterThan(boardRank);
          expect(section.getNodeInfo(memberId)!.boardId).toBe(node.id);
        }
      }
    }
  }
}

describe('propriedade: comandos de organização com boards', () => {
  it('toda sequência produz um documento válido, com os descendentes à frente do board', () => {
    fc.assert(
      fc.property(fc.array(opArbitrary, { maxLength: 24 }), (ops) => {
        const section = initial();
        for (const op of ops) {
          apply(section, op);
          expectInvariants(section);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('desfazer cada comando aceito volta ao documento inicial, e refazer, ao final', () => {
    fc.assert(
      fc.property(fc.array(opArbitrary, { maxLength: 16 }), (ops) => {
        const section = initial();
        const first = section.getSnapshot().document;
        let applied = 0;
        for (const op of ops) {
          const command = commandOf(op, section);
          if (command === undefined) continue;
          const res = section.dispatch(command);
          if (res.ok && res.value.changed) applied += 1;
        }
        const last = section.getSnapshot().document;

        for (let i = 0; i < applied; i += 1) section.undo();
        expect(section.getSnapshot().document).toEqual(first);
        for (let i = 0; i < applied; i += 1) section.redo();
        expect(section.getSnapshot().document).toEqual(last);
      }),
      { numRuns: 100 },
    );
  });
});
