import type { CollaborationErrorCode, RoomAccess } from '@canvash/collaboration';
import type { CollaborationServerLogger } from './logger.js';
import type { AuthorizeRequest, AuthorizeResult } from './types.js';

export type Authorization =
  | {
      readonly allow: true;
      readonly access: RoomAccess;
      readonly user: { readonly id: string; readonly name?: string } | undefined;
    }
  | {
      readonly allow: false;
      readonly code: Extract<CollaborationErrorCode, 'UNAUTHORIZED' | 'NOT_FOUND'>;
      readonly reason: string | undefined;
    };

const DENIED: Authorization = { allow: false, code: 'UNAUTHORIZED', reason: undefined };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Confere a resposta do hook, que é código do host: qualquer coisa fora do contrato é recusa. */
function normalize(result: unknown): Authorization | undefined {
  if (!isRecord(result)) return undefined;
  if (result.allow === false) {
    return {
      allow: false,
      code: result.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAUTHORIZED',
      reason: typeof result.reason === 'string' ? result.reason : undefined,
    };
  }
  if (result.allow !== true || (result.access !== 'read' && result.access !== 'write')) {
    return undefined;
  }
  let user: { id: string; name?: string } | undefined;
  if (result.user !== undefined) {
    if (!isRecord(result.user) || typeof result.user.id !== 'string' || result.user.id === '') {
      return undefined;
    }
    // Só `id` e `name` seguem: o resto do que o host devolver não vai à rede.
    user =
      typeof result.user.name === 'string'
        ? { id: result.user.id, name: result.user.name }
        : { id: result.user.id };
  }
  return { allow: true, access: result.access, user };
}

/**
 * Chama o `authorize` do host. Exceção, rejeição ou resposta fora do contrato contam como
 * `UNAUTHORIZED` e vão ao logger só com o nome do erro, nunca com a mensagem dele.
 */
export async function runAuthorize(
  authorize: (request: AuthorizeRequest) => AuthorizeResult | Promise<AuthorizeResult>,
  request: AuthorizeRequest,
  logger: CollaborationServerLogger,
): Promise<Authorization> {
  const fields = { documentId: request.documentId, sessionId: request.sessionId };
  let result: unknown;
  try {
    result = await authorize(request);
  } catch (error) {
    logger.error('authorize falhou; a conexão foi recusada', {
      ...fields,
      code: 'UNAUTHORIZED',
      cause: error instanceof Error ? error.name : typeof error,
    });
    return DENIED;
  }
  const normalized = normalize(result);
  if (normalized === undefined) {
    logger.error('authorize devolveu uma resposta fora do contrato; a conexão foi recusada', {
      ...fields,
      code: 'UNAUTHORIZED',
    });
    return DENIED;
  }
  return normalized;
}
