/**
 * Participante da sessão, como o `<canvas-section>` o recebe. O tipo é estrutural: o host o monta a
 * partir da colaboração (por exemplo, com `toShellParticipants`), e o shell não importa pacote
 * de colaboração. Nome e foto vêm de outra pessoa: o nome é sempre texto, nunca HTML.
 */
export interface ShellParticipant {
  /** `sessionId` do participante. */
  readonly id: string;
  readonly name: string;
  /** Cor `#rrggbb` do anel e do cursor. */
  readonly color: string;
  readonly avatarUrl?: string;
  /** A pessoa local: aparece na lista da ilha, sem botão Seguir, e não entra na pilha. */
  readonly self?: boolean;
  /**
   * Dá para seguir esta pessoa? `false` quando o cliente dela não publica a vista (versão sem
   * suporte): o botão Seguir fica desabilitado. Padrão: `true`.
   */
  readonly canFollow?: boolean;
}

/** Quantos avatares a pilha mostra antes do "+N". */
export const MAX_STACK_AVATARS = 3;

export interface ParticipantStack {
  /** Os outros participantes, na ordem de chegada. */
  readonly remotes: readonly ShellParticipant[];
  /** Os avatares da pilha: a pessoa seguida primeiro, depois quem chegou antes. */
  readonly shown: readonly ShellParticipant[];
  /** Quantos ficam no "+N". */
  readonly extra: number;
}

export function stackOf(
  participants: readonly ShellParticipant[],
  followingId?: string | null,
): ParticipantStack {
  const remotes = participants.filter((participant) => participant.self !== true);
  const followed = remotes.find((participant) => participant.id === followingId);
  const ordered = followed
    ? [followed, ...remotes.filter((participant) => participant !== followed)]
    : remotes;
  return {
    remotes,
    shown: ordered.slice(0, MAX_STACK_AVATARS),
    extra: Math.max(0, ordered.length - MAX_STACK_AVATARS),
  };
}

/** Até duas iniciais do nome: a primeira letra da primeira e da última palavra. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return '?';
  const letter = (word: string) => (Array.from(word)[0] ?? '').toLocaleUpperCase();
  return words.length === 1 ? letter(first) : letter(first) + letter(last);
}

function relativeLuminance(hex: string): number | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return undefined;
  const channel = (value: string): number => {
    const c = parseInt(value, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(match[1]!) + 0.7152 * channel(match[2]!) + 0.0722 * channel(match[3]!);
}

/**
 * A cor do texto sobre `background`: branco se o contraste chega a 4,5:1 (AA); senão `#1f1f1f`;
 * e, nos tons médios em que nem esse chega, preto.
 */
export function initialsTextColor(background: string): string {
  const luminance = relativeLuminance(background);
  if (luminance === undefined) return '#1f1f1f';
  if (1.05 / (luminance + 0.05) >= 4.5) return '#ffffff';
  // Luminância relativa de #1f1f1f: 0,0137.
  return (luminance + 0.05) / (0.0137 + 0.05) >= 4.5 ? '#1f1f1f' : '#000000';
}
