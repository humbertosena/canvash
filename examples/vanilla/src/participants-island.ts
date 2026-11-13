/**
 * Pilha de avatares e ilha de participantes do shell Vanilla. É o mesmo comportamento da do
 * `<canvas-section>`, escrito à mão sobre o HTML da página, com as mesmas partes (`part`) e textos:
 * - a pilha aparece com o compartilhamento ligado e pelo menos uma outra pessoa;
 * - o hover abre a ilha em 80 ms e, ao sair, ela fecha em 250 ms; clique, Enter e seta para baixo
 *   fixam; Esc, clique fora e Tab fecham, e o foco volta à pilha;
 * - nomes e fotos vêm de outras pessoas: o nome entra sempre como texto, nunca como HTML.
 */

export interface ShellParticipant {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly avatarUrl?: string;
  readonly self?: boolean;
  /** `false` quando o cliente dela não publica a vista: não dá para seguir. */
  readonly canFollow?: boolean;
}

type Sharing = 'off' | 'connecting' | 'on';

export interface ParticipantsHandle {
  setSharing(state: Sharing): void;
  setParticipants(participants: readonly ShellParticipant[]): void;
  /** `id` da pessoa seguida, ou `null`: o botão, a faixa e a moldura. */
  setFollowing(sessionId: string | null): void;
  destroy(): void;
}

export interface ParticipantsOptions {
  /** Onde a pilha entra: antes de `before`, ou no fim do `host`. */
  readonly host: HTMLElement;
  readonly before?: Element | null;
  /** "Parar compartilhamento". Quem para é o host. */
  readonly onShareStop: () => void;
  /** "Seguir" (com o id) ou "Parar"/"Seguindo" (com `null`). Quem decide é o host. */
  readonly onFollow?: (sessionId: string | null) => void;
}

const HOVER_OPEN_MS = 80;
const HOVER_CLOSE_MS = 250;
const MAX_STACK_AVATARS = 3;

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return '?';
  const letter = (word: string): string => (Array.from(word)[0] ?? '').toLocaleUpperCase();
  return words.length === 1 ? letter(first) : letter(first) + letter(last);
}

/** Branco sobre a cor se chega a 4,5:1 (AA); senão `#1f1f1f`; nos tons médios, preto. */
function initialsTextColor(background: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background);
  if (!match) return '#1f1f1f';
  const channel = (value: string): number => {
    const c = parseInt(value, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(match[1]!) + 0.7152 * channel(match[2]!) + 0.0722 * channel(match[3]!);
  if (1.05 / (luminance + 0.05) >= 4.5) return '#ffffff';
  return (luminance + 0.05) / 0.0637 >= 4.5 ? '#1f1f1f' : '#000000';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  part: string | undefined,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (part) node.setAttribute('part', part);
  if (className) node.className = className;
  return node;
}

export function mountParticipants(options: ParticipantsOptions): ParticipantsHandle {
  const { host, before, onShareStop, onFollow } = options;
  let sharing: Sharing = 'off';
  let participants: readonly ShellParticipant[] = [];
  let following: string | null = null;
  let open = false;
  let pinned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refocus: number | undefined;
  const failedPhotos = new Set<string>();

  const area = host.closest<HTMLElement>('.shell') ?? document.body;
  let frame: HTMLElement | null = null;
  let banner: HTMLElement | null = null;

  const wrapper = el('div', undefined, 'participants');
  wrapper.id = 'shell-participants';
  wrapper.hidden = true;
  host.insertBefore(wrapper, before ?? null);

  const remotes = (): ShellParticipant[] => participants.filter((p) => p.self !== true);
  const visible = (): boolean => sharing === 'on' && remotes().length > 0;
  const button = (): HTMLButtonElement | null =>
    wrapper.querySelector<HTMLButtonElement>('[part~="participants"]');
  const controls = (): HTMLElement[] => [
    ...wrapper.querySelectorAll<HTMLElement>(
      '[part~="follow-button"]:not(:disabled), [part~="share-stop-item"]',
    ),
  ];

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const avatar = (participant: ShellParticipant): HTMLElement => {
    const node = el('span', 'participant-avatar', 'participant-avatar');
    node.title = participant.name;
    node.dataset['sessionId'] = participant.id;
    node.style.setProperty('--ring', participant.color);
    node.style.color = initialsTextColor(participant.color);
    if (participant.avatarUrl && !failedPhotos.has(participant.id)) {
      const image = el('img', 'participant-image');
      image.src = participant.avatarUrl;
      image.alt = '';
      image.width = 24;
      image.height = 24;
      image.addEventListener('error', () => {
        failedPhotos.add(participant.id);
        render();
      });
      node.append(image);
    } else {
      node.textContent = initialsOf(participant.name);
    }
    return node;
  };

  const renderIsland = (): HTMLElement => {
    const island = el('div', 'participants-island', 'participants-island');
    island.id = 'participants-island';
    island.setAttribute('role', 'dialog');
    island.setAttribute('aria-label', 'Participantes');
    const title = el('div', 'participants-title', 'participants-title');
    title.textContent = `Na sessão (${participants.length})`;
    const list = el('ul', 'participants-list', 'participants-list');
    list.setAttribute('role', 'list');
    const rows = [
      ...participants.filter((p) => p.self === true),
      ...participants.filter((p) => p.self !== true),
    ];
    for (const participant of rows) {
      const row = el('li', 'participant-row', 'participant-row');
      row.dataset['sessionId'] = participant.id;
      const name = el('span', 'participant-name', 'participant-name');
      name.textContent = participant.name;
      if (participant.self) {
        const you = el('span', undefined, 'participant-you');
        you.textContent = '(você)';
        name.append(' ', you);
      }
      row.append(avatar(participant), name);
      if (!participant.self) {
        const follow = el('button', 'follow-button', 'follow-button');
        follow.type = 'button';
        const isFollowed = participant.id === following;
        follow.setAttribute('aria-pressed', String(isFollowed));
        follow.textContent = isFollowed ? 'Seguindo' : 'Seguir';
        if (participant.canFollow === false) {
          follow.disabled = true;
          follow.title = 'Versão sem suporte a seguir';
        }
        follow.addEventListener('click', () => onFollow?.(isFollowed ? null : participant.id));
        row.append(follow);
      }
      list.append(row);
    }
    const divider = el('div', undefined, 'participants-divider');
    divider.setAttribute('role', 'separator');
    const stop = el('button', 'share-stop-item', 'share-stop-item');
    stop.type = 'button';
    stop.textContent = 'Parar compartilhamento';
    stop.addEventListener('click', () => {
      close(true);
      onShareStop();
    });
    island.append(title, list, divider, stop);
    return island;
  };

  /** Moldura na cor da pessoa seguida e chip "Seguindo <Nome>" com Parar. */
  function renderFollowing(): void {
    const followed = visible() ? remotes().find((p) => p.id === following) : undefined;
    if (!followed) {
      frame?.remove();
      banner?.remove();
      frame = null;
      banner = null;
      return;
    }
    if (!frame) {
      frame = el('div', 'follow-frame', 'follow-frame');
      frame.setAttribute('aria-hidden', 'true');
      area.append(frame);
    }
    frame.style.setProperty('--follow-color', followed.color);
    if (!banner) {
      banner = el('div', 'following-banner', 'following-banner');
      const text = document.createElement('span');
      text.setAttribute('role', 'status');
      const stop = el('button', 'following-stop', 'following-stop');
      stop.type = 'button';
      stop.textContent = 'Parar';
      stop.addEventListener('click', () => onFollow?.(null));
      banner.append(text, stop);
      area.append(banner);
    }
    const status = banner.querySelector('[role="status"]')!;
    // Nome de outra pessoa: sempre texto.
    status.textContent = `Seguindo ${followed.name}`;
  }

  function render(): void {
    renderFollowing();
    const shown = visible();
    wrapper.hidden = !shown;
    if (!shown) {
      if (open) close(false);
      wrapper.replaceChildren();
      return;
    }
    const active = document.activeElement;
    // O render recria a ilha: o foco volta ao controle em que estava (ou ao vizinho, se a pessoa saiu).
    const restore =
      open && wrapper.contains(active) && active instanceof HTMLElement
        ? controls().indexOf(active)
        : -1;
    const hadFocusOnStack = active === button();

    const stack = el('button', 'participants', 'participants-stack');
    stack.type = 'button';
    stack.setAttribute('aria-haspopup', 'dialog');
    stack.setAttribute('aria-expanded', String(open));
    stack.setAttribute('aria-controls', 'participants-island');
    const count = remotes().length;
    stack.setAttribute(
      'aria-label',
      `Participantes: ${count} ${count === 1 ? 'outra pessoa' : 'outras pessoas'} na sessão`,
    );
    const followed = remotes().find((p) => p.id === following);
    const ordered = followed ? [followed, ...remotes().filter((p) => p !== followed)] : remotes();
    const shownPeople = ordered.slice(0, MAX_STACK_AVATARS);
    for (const participant of shownPeople) stack.append(avatar(participant));
    if (count > MAX_STACK_AVATARS) {
      const more = el('span', 'participants-more', 'participants-more');
      more.setAttribute('aria-hidden', 'true');
      more.textContent = `+${count - MAX_STACK_AVATARS}`;
      stack.append(more);
    }
    stack.addEventListener('click', toggle);
    wrapper.replaceChildren(stack, ...(open ? [renderIsland()] : []));
    if (hadFocusOnStack) button()?.focus();
    if (restore >= 0) {
      const list = controls();
      list[Math.min(restore, list.length - 1)]?.focus();
    }
    if (refocus !== undefined) {
      refocus = undefined;
      controls()[0]?.focus();
    }
  }

  const onOutside = (event: Event): void => {
    if (!event.composedPath().includes(wrapper)) close(false);
  };
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close(true);
  };

  function openIsland(pin: boolean, focusFirst = false): void {
    if (open) {
      pinned = pinned || pin;
      return;
    }
    open = true;
    pinned = pin;
    if (focusFirst) refocus = 0;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onEscape);
    render();
  }

  function close(restoreFocus: boolean): void {
    clearTimer();
    if (!open) return;
    open = false;
    pinned = false;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onEscape);
    if (wrapper.hidden) return;
    render();
    if (restoreFocus) button()?.focus();
  }

  function toggle(): void {
    clearTimer();
    if (!open) openIsland(true);
    else if (!pinned) pinned = true;
    else close(false);
  }

  wrapper.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    clearTimer();
    if (open) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (visible()) openIsland(false);
    }, HOVER_OPEN_MS);
  });
  wrapper.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    clearTimer();
    if (!open || pinned) return;
    timer = setTimeout(() => {
      timer = undefined;
      close(false);
    }, HOVER_CLOSE_MS);
  });
  wrapper.addEventListener('keydown', (event) => {
    if (!open) {
      if (event.key === 'ArrowDown' && event.target === button()) {
        event.preventDefault();
        openIsland(true, true);
      }
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    const list = controls();
    const last = list.length - 1;
    const current = list.indexOf(event.target as HTMLElement);
    const next: number | undefined = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    list[next]?.focus();
  });

  return {
    setSharing(state) {
      sharing = state;
      render();
    },
    setParticipants(next) {
      participants = next;
      render();
    },
    setFollowing(sessionId) {
      following = sessionId;
      render();
    },
    destroy() {
      clearTimer();
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onEscape);
      frame?.remove();
      banner?.remove();
      wrapper.remove();
    },
  };
}
