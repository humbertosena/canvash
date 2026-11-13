import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isFreeEndpoint } from './arrows.js';
import { createCanvasSection, type CanvasSectionApi } from './canvas-section.js';
import type { CanvasCommand } from './commands.js';
import type { CanvasDocument } from './document.js';
import { validateDocument } from './validate.js';

// Sequências geradas de comandos, undo e redo. A cada passo o documento precisa continuar
// válido e igual ao de um modelo simples: uma lista de documentos e um cursor.

// Limite baixo, para as sequências geradas passarem dele com frequência.
const HISTORY_LIMIT = 3;

function counter(): () => string {
  let count = 0;
  return () => `id-${++count}`;
}

/** Confere as invariantes do documento sem usar o código que as produz. */
function expectValidDocument(document: CanvasDocument): void {
  const seen = new Set<string>([document.id]);
  const placed: string[] = [];
  for (const layer of document.layers) {
    expect(seen.has(layer.id)).toBe(false);
    seen.add(layer.id);
    placed.push(...layer.childIds);
  }
  // Cada nó está em exatamente uma camada, e toda referência aponta para um nó que existe.
  expect([...placed].sort()).toEqual(Object.keys(document.nodes).sort());
  expect(new Set(placed).size).toBe(placed.length);

  for (const [key, node] of Object.entries(document.nodes)) {
    expect(node.id).toBe(key);
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    if (node.type === 'group') {
      expect(Array.isArray(node.childIds)).toBe(true);
      continue;
    }
    // Nenhum comando cria board ainda; o laço de formas pula o nó.
    if (node.type === 'board') continue;
    const numbers =
      node.type === 'line'
        ? [node.start.x, node.start.y, node.end.x, node.end.y]
        : node.type === 'bezier'
          ? [node.start, node.control1, node.control2, node.end].flatMap((p) => [p.x, p.y])
          : node.type === 'arrow'
            ? [
                ...(isFreeEndpoint(node.start)
                  ? [node.start.x, node.start.y]
                  : [node.start.anchor.x, node.start.anchor.y]),
                ...(isFreeEndpoint(node.end)
                  ? [node.end.x, node.end.y]
                  : [node.end.anchor.x, node.end.anchor.y]),
              ]
            : [node.x, node.y, node.width, node.height, node.rotation];
    expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
    if (node.type === 'line' || node.type === 'bezier') {
      expect(node.start.x !== node.end.x || node.start.y !== node.end.y).toBe(true);
    } else if (node.type === 'arrow') {
      expect(['none', 'arrow', 'dot']).toContain(node.startMarker);
      expect(['none', 'arrow', 'dot']).toContain(node.endMarker);
    } else {
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
      expect(node.rotation).toBeGreaterThanOrEqual(-Math.PI);
      expect(node.rotation).toBeLessThan(Math.PI);
    }
    // O elemento de traços não tem contorno: o estilo dele é só a opacidade.
    if (node.type === 'ink') {
      expect(node.style.opacity).toBeGreaterThanOrEqual(0);
      continue;
    }
    expect(node.style.strokeWidth).toBeGreaterThanOrEqual(0);
    expect(node.style.opacity).toBeGreaterThanOrEqual(0);
    expect(node.style.opacity).toBeLessThanOrEqual(1);
  }
  expect(Object.isFrozen(document)).toBe(true);
  expect(Object.isFrozen(document.nodes)).toBe(true);
  // O validador de carga precisa aceitar todo documento que os comandos produzem.
  expect(validateDocument(document)).toMatchObject({ ok: true, value: document });
}

type Action =
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | {
      readonly kind: 'create';
      readonly shape: 'rectangle' | 'ellipse' | 'line';
      readonly a: number;
      readonly b: number;
    }
  | {
      readonly kind: 'update' | 'remove';
      readonly target: number;
      readonly a: number;
      readonly b: number;
    }
  | { readonly kind: 'invalid'; readonly target: number }
  | { readonly kind: 'batch'; readonly target: number; readonly a: number }
  | { readonly kind: 'layer'; readonly target: number; readonly a: number; readonly b: number };

// Valores inteiros pequenos, inclusive zero e negativos: geram dimensão inválida, linha de
// comprimento zero e alteração sem efeito, além dos casos válidos.
const small = fc.integer({ min: -3, max: 6 });
const target = fc.nat({ max: 50 });

const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Action>({ kind: 'undo' }) },
  { weight: 2, arbitrary: fc.constant<Action>({ kind: 'redo' }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('create' as const),
      shape: fc.constantFrom('rectangle' as const, 'ellipse' as const, 'line' as const),
      a: small,
      b: small,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('update' as const), target, a: small, b: small }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('remove' as const), target, a: small, b: small }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('invalid' as const), target }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('batch' as const), target, a: small }) },
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('layer' as const), target, a: small, b: small }),
  },
);

function existingId(document: CanvasDocument, index: number): string {
  const ids = Object.keys(document.nodes);
  return ids[index % Math.max(ids.length, 1)] ?? 'sem-nos';
}

function commandsFor(
  act: Exclude<Action, { kind: 'undo' } | { kind: 'redo' }>,
  section: CanvasSectionApi,
): CanvasCommand[] {
  const { document } = section.getSnapshot();
  switch (act.kind) {
    case 'create':
      return [
        {
          type: 'shape.create',
          shape:
            act.shape === 'line'
              ? { type: 'line', start: { x: act.a, y: act.b }, end: { x: act.b, y: act.a } }
              : {
                  type: act.shape,
                  x: act.a,
                  y: act.b,
                  width: act.a,
                  height: act.b,
                  rotation: act.a,
                },
        },
      ];
    case 'update': {
      const id = existingId(document, act.target);
      const patch =
        document.nodes[id]?.type === 'line'
          ? { end: { x: act.a, y: act.b }, style: { opacity: (act.b + 3) / 9 } }
          : { x: act.a, width: act.b, rotation: act.a * 2 };
      return [{ type: 'shape.update', id, patch }];
    }
    case 'remove':
      return [{ type: 'shape.remove', id: existingId(document, act.target) }];
    case 'invalid':
      return [
        {
          type: 'shape.create',
          shape: { type: 'ellipse', x: 0, y: 0, width: 1, height: 1, rotation: 0 },
        },
        { type: 'shape.remove', id: 'nunca-existiu' },
      ];
    case 'batch': {
      const id = existingId(document, act.target);
      return [
        {
          type: 'shape.create',
          shape: { type: 'rectangle', x: 0, y: 0, width: 2, height: 2, rotation: 0 },
        },
        { type: 'shape.update', id, patch: { visible: act.a % 2 === 0 } },
        { type: 'shape.update', id, patch: { locked: act.a > 0 } },
      ];
    }
    case 'layer': {
      // Camadas e ordem: cria, renomeia, oculta ou bloqueia camada, reordena camada e nó e
      // leva nó de uma camada para outra. Índices fora da faixa e alvos bloqueados também saem.
      const layers = document.layers;
      const layer = layers[act.target % layers.length]?.id ?? 'sem-camada';
      const id = existingId(document, act.target);
      const options: CanvasCommand[] = [
        { type: 'layer.create', index: act.a },
        { type: 'layer.create' },
        { type: 'layer.update', id: layer, patch: { locked: act.b > 2, visible: act.b % 2 === 0 } },
        { type: 'layer.reorder', id: layer, index: act.a },
        { type: 'node.reorder', id, index: act.a },
        { type: 'node.reorder', id, index: act.b, layerId: layer },
      ];
      return [options[(act.a + 3) % options.length] ?? { type: 'layer.create' }];
    }
  }
}

describe('sequências geradas de comandos, undo e redo', () => {
  it('mantêm o documento válido e restauram exatamente cada estado (CORE-04)', () => {
    fc.assert(
      // `size: 'max'` usa o comprimento todo: o padrão do fast-check gera sequências curtas demais
      // para passar do limite do histórico.
      fc.property(fc.array(action, { maxLength: 60, size: 'max' }), (actions) => {
        const section = createCanvasSection({ generateId: counter(), historyLimit: HISTORY_LIMIT });
        // Modelo: os documentos alcançáveis pelo histórico, e a posição atual entre eles.
        let states = [section.getSnapshot().document];
        let cursor = 0;
        let revision = 0;

        for (const act of actions) {
          const before = section.getSnapshot();
          let changed: boolean;

          if (act.kind === 'undo' || act.kind === 'redo') {
            const result = section[act.kind]();
            if (!result.ok) throw new Error(`${act.kind} devolveu erro: ${result.error.code}`);
            changed = result.value.changed;
            const next = cursor + (act.kind === 'undo' ? -1 : 1);
            expect(changed).toBe(next >= 0 && next < states.length);
            if (changed) cursor = next;
          } else {
            const result = section.transact(commandsFor(act, section));
            changed = result.ok && result.value.changed;
            if (changed) {
              states = [...states.slice(0, cursor + 1), section.getSnapshot().document];
              if (states.length > HISTORY_LIMIT + 1) states = states.slice(1);
              cursor = states.length - 1;
            }
          }

          const after = section.getSnapshot();
          if (changed) revision += 1;
          else expect(after).toBe(before);
          expect(after.revision).toBe(revision);
          expect(after.document).toEqual(states[cursor]);
          expect(after.history).toEqual({
            canUndo: cursor > 0,
            canRedo: cursor < states.length - 1,
          });
          expectValidDocument(after.document);
        }
      }),
      { seed: 20261011, numRuns: 150 },
    );
    // Milhares de comandos com o documento conferido a cada passo: o prazo padrão é curto em
    // máquina ocupada.
  }, 30_000);
});
