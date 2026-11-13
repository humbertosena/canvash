import type { CanvasSectionApi } from '@canvash/core';

/**
 * O nó está bloqueado por outro participante da sessão? O bloqueio é cooperativo: só a interação
 * o respeita; a API do host (`dispatch`, `transact`, `setSelection`) não.
 */
export function isPeerLocked(section: CanvasSectionApi, id: string): boolean {
  return typeof section.getPeerLock === 'function' && section.getPeerLock(id) !== undefined;
}

/** Alguma outra sessão bloqueia algum nó? Sem bloqueio, nenhum nó precisa ser consultado. */
export function hasPeerLocks(section: CanvasSectionApi): boolean {
  if (typeof section.getPeers !== 'function') return typeof section.getPeerLock === 'function';
  return section.getPeers().some((peer) => peer.locks.length > 0);
}
