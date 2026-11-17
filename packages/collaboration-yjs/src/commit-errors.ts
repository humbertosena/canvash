import {
  createCollaborationError,
  type CollaborationError,
  type CollaborationErrorCode,
} from '@canvash/collaboration';

/** Códigos que o hub e o emulador devolvem num commit recusado → erro do contrato. */
const COMMIT_ERRORS: Readonly<Record<string, { code: CollaborationErrorCode; message: string }>> = {
  ROOM_EPOCH_MISMATCH: {
    code: 'ROOM_EPOCH_MISMATCH',
    message: 'A sala está em outra epoch',
  },
  INVALID_DOCUMENT: {
    code: 'INVALID_DOCUMENT',
    message: 'O update não é um update válido do provider',
  },
  STORAGE_UNAVAILABLE: {
    code: 'STORAGE_UNAVAILABLE',
    message: 'O servidor não conseguiu gravar o commit',
  },
  NETWORK_PARTITION: { code: 'DISCONNECTED', message: 'O commit não chegou ao servidor' },
  CRASHED: { code: 'DISCONNECTED', message: 'O servidor não respondeu ao commit' },
};

/** Traduz o código de um commit recusado pelo hub em memória; o original vai em `details.reason`. */
export function commitError(code: string): CollaborationError {
  const known = COMMIT_ERRORS[code];
  if (known === undefined) {
    return createCollaborationError('DISCONNECTED', 'O commit não foi confirmado', {
      reason: code,
    });
  }
  return createCollaborationError(known.code, known.message, { reason: code });
}

export function transportNotOpen(): CollaborationError {
  return createCollaborationError('DISCONNECTED', 'O transporte não está aberto');
}
