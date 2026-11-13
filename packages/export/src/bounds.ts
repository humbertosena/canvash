import {
  STICKY_SHADOW,
  boundsUnion,
  shapeBounds,
  type BoardNode,
  type CanvasDocument,
  type Bounds,
  type Result,
  type ShapeNode,
} from '@canvash/core';
import { err, ok, type ExportError, type InvalidScopeDetails } from './errors.js';
import type { CommonExportOptions, ExportSource, PrepareExportOptions } from './types.js';

export interface PreparedExportContext {
  readonly document: CanvasDocument;
  readonly bounds: Bounds;
  readonly candidateIds?: ReadonlySet<string>;
  /** Só no escopo de board: o ID do item pintado sem recorte. */
  readonly boardId?: string;
  /** Só no escopo de board: o retângulo que recorta os filhos. */
  readonly clip?: Bounds;
}

function withShadow(box: Bounds): Bounds {
  const reach = STICKY_SHADOW.reach;
  return {
    x: box.x - reach,
    y: box.y - reach,
    width: box.width + 2 * reach,
    height: box.height + 2 * reach,
  };
}

/** O escopo é um objeto com a chave própria `board`? */
function isBoardScope(scope: unknown): scope is Record<string, unknown> {
  return typeof scope === 'object' && scope !== null && Object.hasOwn(scope, 'board');
}

const documentOf = (source: ExportSource): CanvasDocument =>
  'getSnapshot' in source ? source.getSnapshot().document : source;

const invalidScope = (details: InvalidScopeDetails, message: string): Result<never, ExportError> =>
  err('INVALID_SCOPE', message, details);

/**
 * Valida o board e devolve o contexto da exportação só dele: a área é o retângulo do board mais
 * meia borda (0,5 com `stroke`) e o `padding`; `clip` é o retângulo, sem a faixa do título; e
 * `candidateIds` reúne o board, os filhos visíveis e os membros dos grupos filhos. Não lança e
 * não mexe no documento. Funciona com a sessão e com o documento.
 *
 * @example
 * const context = prepareBoardExportContext(section, 'plano');
 * if (!context.ok && context.error.code === 'INVALID_SCOPE') {
 *   context.error.details.reason; // 'not-found' | 'not-a-board' | 'hidden' | 'malformed'
 * }
 */
export function prepareBoardExportContext(
  source: ExportSource,
  boardId: unknown,
  options: Omit<CommonExportOptions, 'scope'> = {},
): Result<PreparedExportContext, ExportError> {
  if (typeof boardId !== 'string' || boardId === '') {
    return invalidScope({ reason: 'malformed' }, 'The board scope needs a non-empty board ID.');
  }
  const document = documentOf(source);
  const node = Object.hasOwn(document.nodes, boardId) ? document.nodes[boardId] : undefined;
  if (node === undefined) {
    return invalidScope({ reason: 'not-found', id: boardId }, `No node with ID "${boardId}".`);
  }
  if (node.type !== 'board') {
    return invalidScope(
      { reason: 'not-a-board', id: boardId },
      `Node "${boardId}" is not a board.`,
    );
  }
  const layer = document.layers.find((candidate) => candidate.childIds.includes(boardId));
  if (!node.visible || (layer !== undefined && !layer.visible)) {
    return invalidScope({ reason: 'hidden', id: boardId }, `Board "${boardId}" is hidden.`);
  }

  const padding = Math.max(0, options.padding ?? 0);
  const reach = node.style.stroke === null ? 0 : 0.5;
  const bounds: Bounds = {
    x: node.x - reach - padding,
    y: node.y - reach - padding,
    width: Math.max(1, node.width + 2 * reach + 2 * padding),
    height: Math.max(1, node.height + 2 * reach + 2 * padding),
  };

  const candidateIds = new Set<string>([boardId]);
  for (const childId of node.childIds) {
    const child = document.nodes[childId];
    if (!child || !child.visible) continue;
    if (child.type === 'group') {
      for (const memberId of child.childIds) {
        if (document.nodes[memberId]?.visible) candidateIds.add(memberId);
      }
    } else {
      candidateIds.add(childId);
    }
  }

  return ok({
    document,
    bounds,
    candidateIds,
    boardId,
    clip: { x: node.x, y: node.y, width: node.width, height: node.height },
  });
}

/**
 * Escolhe o contexto pelo escopo, nesta ordem: ausente, `'document'` ou `'selection'`; objeto
 * com a chave `board` (que precisa ser a única); `Bounds` (`x` e `width`); qualquer outro valor é
 * `INVALID_SCOPE`. `prepareExportContext` não faz essa validação, para não mudar o que já fazia.
 */
export function resolveExportContext(
  source: ExportSource,
  options: CommonExportOptions = {},
): Result<PreparedExportContext, ExportError> {
  const scope: unknown = options.scope;
  if (scope === undefined || scope === 'document' || scope === 'selection') {
    return ok(prepareExportContext(source, options as PrepareExportOptions));
  }
  if (isBoardScope(scope)) {
    if (Object.keys(scope).length !== 1) {
      return invalidScope({ reason: 'malformed' }, 'The board scope accepts only the "board" key.');
    }
    return prepareBoardExportContext(source, scope['board'], {
      ...(options.padding === undefined ? {} : { padding: options.padding }),
      ...(options.background === undefined ? {} : { background: options.background }),
    });
  }
  if (typeof scope === 'object' && scope !== null && 'x' in scope && 'width' in scope) {
    return ok(prepareExportContext(source, options as PrepareExportOptions));
  }
  return invalidScope({ reason: 'malformed' }, 'The export scope is not recognized.');
}

/**
 * Contexto da exportação para os escopos `'document'`, `'selection'` e `Bounds`. Com o escopo
 * `{ board }` lança `TypeError`: use `prepareBoardExportContext`, que devolve `Result`.
 */
export function prepareExportContext(
  source: ExportSource,
  options: PrepareExportOptions = {},
): PreparedExportContext {
  if (isBoardScope(options.scope)) {
    throw new TypeError('Use prepareBoardExportContext for board scope');
  }
  const document: CanvasDocument = 'getSnapshot' in source ? source.getSnapshot().document : source;
  const padding = Math.max(0, options.padding ?? 0);

  let candidateIds: Set<string> | undefined;

  if (options.scope === 'selection') {
    candidateIds = new Set<string>();
    const selectedIds = 'getSnapshot' in source ? source.getSnapshot().session.selectedIds : [];
    for (const id of selectedIds) {
      const node = document.nodes[id];
      if (!node) continue;
      if (node.type === 'group') {
        for (const childId of node.childIds) {
          candidateIds.add(childId);
        }
      } else if (node.type === 'board') {
        // O board leva os descendentes: os filhos e os membros dos grupos dentro dele.
        candidateIds.add(id);
        for (const childId of node.childIds) {
          const child = document.nodes[childId];
          if (child?.type === 'group') {
            for (const memberId of child.childIds) candidateIds.add(memberId);
          } else {
            candidateIds.add(childId);
          }
        }
      } else {
        candidateIds.add(id);
      }
    }
  }

  // Se bounds foram especificados explicitamente como objeto { x, y, width, height }
  if (
    options.scope &&
    typeof options.scope === 'object' &&
    'x' in options.scope &&
    'width' in options.scope
  ) {
    const rawBounds = options.scope;
    const bounds: Bounds = {
      x: rawBounds.x - padding,
      y: rawBounds.y - padding,
      width: Math.max(1, rawBounds.width + 2 * padding),
      height: Math.max(1, rawBounds.height + 2 * padding),
    };
    return { document, bounds, candidateIds };
  }

  // Caso contrário, calcula a união das caixas delimitadoras de todos os nós visíveis em escopo
  const getNode = (id: string): ShapeNode | undefined => {
    const n = document.nodes[id];
    return n && n.type !== 'group' && n.type !== 'board' ? n : undefined;
  };

  // Num objeto, porque `measure` o atualiza de dentro de uma função.
  const total: { box: Bounds | null } = { box: null };

  /** Soma a caixa de um nó ao total, se ele está no escopo. */
  const measure = (shape: ShapeNode | BoardNode): void => {
    if (candidateIds && !candidateIds.has(shape.id)) return;
    const painted = shapeBounds(shape, { stroke: true, getNode });
    // A sombra da nota passa da caixa: o recorte da exportação a inclui.
    const box = shape.type === 'sticky' ? withShadow(painted) : painted;
    total.box = total.box ? boundsUnion(total.box, box) : box;
  };

  /** Mede um filho de camada ou de board: a forma, ou os membros visíveis do grupo. */
  const measureChild = (childId: string): void => {
    const node = document.nodes[childId];
    if (!node || !node.visible || node.type === 'board') return;
    if (node.type === 'group') {
      for (const subId of node.childIds) {
        const sub = document.nodes[subId];
        if (sub && sub.visible && sub.type !== 'group' && sub.type !== 'board') measure(sub);
      }
    } else {
      measure(node);
    }
  };

  for (const layer of document.layers) {
    if (!layer.visible) continue;
    for (const childId of layer.childIds) {
      const node = document.nodes[childId];
      if (!node || !node.visible) continue;
      if (node.type === 'board') {
        // A caixa do board leva a faixa do título; os filhos ficam fora de `Layer.childIds`.
        measure(node);
        for (const boardChildId of node.childIds) measureChild(boardChildId);
      } else {
        measureChild(childId);
      }
    }
  }

  const totalBounds = total.box;
  if (!totalBounds) {
    // Documento vazio ou seleção vazia -> fallback mínimo válido (IO-05)
    return {
      document,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      candidateIds,
    };
  }

  const bounds: Bounds = {
    x: totalBounds.x - padding,
    y: totalBounds.y - padding,
    width: Math.max(1, totalBounds.width + 2 * padding),
    height: Math.max(1, totalBounds.height + 2 * padding),
  };

  return { document, bounds, candidateIds };
}
