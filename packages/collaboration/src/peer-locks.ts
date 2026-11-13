/** Uma sessão que seleciona nós: a local ou uma remota. */
export interface LockContender {
  readonly sessionId: string;
  /** Quando a seleção começou, no relógio da sessão. Sem valor, perde para quem tem. */
  readonly selectedAt: number | null | undefined;
  readonly selection: readonly string[];
}

/**
 * A chave da disputa de um nó: o grupo dele, se ele é membro de um, ou o próprio ID. Assim um
 * membro e o grupo disputam o mesmo bloqueio.
 */
export function lockKey(id: string, groupOf: ReadonlyMap<string, string>): string {
  return groupOf.get(id) ?? id;
}

function wins(candidate: LockContender, current: LockContender): boolean {
  const a = candidate.selectedAt ?? Infinity;
  const b = current.selectedAt ?? Infinity;
  if (a !== b) return a < b;
  return candidate.sessionId < current.sessionId;
}

/**
 * Decide quem detém o bloqueio de cada chave: vence o menor `selectedAt` e, no empate ou sem
 * `selectedAt` de ambos, o menor `sessionId`. A ordem é total, então todas as sessões que vêem
 * as mesmas seleções chegam ao mesmo vencedor, em qualquer ordem de chegada.
 *
 * `descendantsOf` dá, para cada board, as chaves dos descendentes dele (os filhos e, no lugar dos
 * membros de um grupo, o grupo). Quem seleciona um board disputa a chave dele e a de cada
 * descendente, com a mesma ordem: quem selecionou um filho antes de o board ser selecionado fica
 * com o filho, e o board fica com o outro.
 *
 * Devolve a chave da disputa e o `sessionId` vencedor.
 */
export function resolveLocks(
  contenders: readonly LockContender[],
  groupOf: ReadonlyMap<string, string> = new Map(),
  descendantsOf: ReadonlyMap<string, readonly string[]> = new Map(),
): Map<string, string> {
  const winners = new Map<string, LockContender>();
  const claim = (key: string, contender: LockContender): void => {
    const current = winners.get(key);
    if (current === undefined || wins(contender, current)) winners.set(key, contender);
  };
  for (const contender of contenders) {
    for (const id of contender.selection) {
      claim(lockKey(id, groupOf), contender);
      for (const key of descendantsOf.get(id) ?? []) claim(key, contender);
    }
  }
  return new Map([...winners].map(([key, winner]) => [key, winner.sessionId]));
}
