import {
  createCollaborationError,
  err,
  ok,
  type CollaborationError,
  type Result,
} from '@canvash/collaboration';
import { validateDocument, type CanvasDocument } from '@canvash/core';
import * as Y from 'yjs';
import { CanvasYDocWriter } from './canvas-to-ydoc.js';
import { getDocumentCollections } from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';

/** Origem das transações da semeadura. */
const SEED_ORIGIN = Symbol('canvash-seed');

function invalid(message: string, details?: unknown): Result<never, CollaborationError> {
  return err(createCollaborationError('INVALID_DOCUMENT', message, details));
}

/**
 * Estado Yjs completo de um documento do canvas, para semear uma sala a partir do que o host tem
 * salvo. Não cria a camada padrão (`layer-default`): leva só as camadas do documento, e guarda o
 * `id` dele no estado, para a projeção devolvê-lo.
 *
 * Cada chamada gera um estado novo, que não se mescla com o de outra chamada: gere uma vez por
 * sala e epoch, grave e reuse o que foi gravado. Semear de novo a mesma sala, com clientes que já
 * têm o estado anterior, duplicaria o conteúdo.
 */
export function encodeCanvasDocumentAsYjsState(
  document: CanvasDocument,
): Result<Uint8Array, CollaborationError> {
  const checked = validateDocument(document);
  if (!checked.ok) {
    return invalid('O documento não é um documento válido do canvas', { cause: checked.error });
  }
  const ydoc = new Y.Doc();
  try {
    const { meta } = getDocumentCollections(ydoc);
    ydoc.transact(() => {
      meta.set('schemaVersion', 1);
      meta.set('createdAt', Date.now());
      meta.set('documentId', checked.value.id);
    }, SEED_ORIGIN);
    new CanvasYDocWriter(ydoc, SEED_ORIGIN).write(checked.value);
    return ok(Y.encodeStateAsUpdate(ydoc));
  } finally {
    ydoc.destroy();
  }
}

/**
 * Projeta um estado Yjs completo de volta em documento do canvas, validado. O `id` é o que a
 * semeadura guardou; uma sala criada por uma sessão, sem ele, projeta `'collab-doc'`.
 */
export function projectYjsStateToCanvasDocument(
  state: Uint8Array,
): Result<CanvasDocument, CollaborationError> {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    const projected = projectYDocToCanvasDocument(ydoc);
    const checked = validateDocument(projected);
    if (!checked.ok) {
      return invalid('O estado não projeta em um documento válido do canvas', {
        cause: checked.error,
      });
    }
    return ok(checked.value);
  } catch (cause) {
    return invalid('O estado não é um estado Yjs legível do canvas', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    ydoc.destroy();
  }
}
