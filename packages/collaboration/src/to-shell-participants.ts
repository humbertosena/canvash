import type { CanvasPeer } from '@canvash/core';

/**
 * A forma que o `<canvas-shell>` espera de um participante (`ShellParticipant`). O tipo é
 * estrutural de propósito: o shell não importa este pacote.
 */
export interface ShellParticipantLike {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly avatarUrl?: string;
  readonly self?: boolean;
  /** `false` quando o cliente dela não publica a vista: não dá para seguir. */
  readonly canFollow?: boolean;
}

/** A pessoa local, que a lista mostra primeiro e sem o botão Seguir. */
export interface LocalParticipant {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly avatarUrl?: string | undefined;
}

/**
 * Converte os participantes do canvas na lista do shell: a pessoa local primeiro, com `self`, e
 * os outros na ordem de chegada. Função pura.
 */
export function toShellParticipants(
  peers: readonly CanvasPeer[],
  self?: LocalParticipant,
): ShellParticipantLike[] {
  const result: ShellParticipantLike[] = [];
  if (self) {
    result.push({
      id: self.id,
      name: self.name,
      color: self.color,
      ...(self.avatarUrl === undefined ? {} : { avatarUrl: self.avatarUrl }),
      self: true,
    });
  }
  for (const peer of peers) {
    result.push({
      id: peer.sessionId,
      name: peer.name,
      color: peer.color,
      ...(peer.avatarUrl === undefined ? {} : { avatarUrl: peer.avatarUrl }),
      canFollow: peer.view !== null,
    });
  }
  return result;
}
