import type { CanvasSectionApi } from '@canvash/core';
import { mountParticipants, type ShellParticipant } from './participants-island.js';

/**
 * Casca de ilhas do playground Vanilla: o menu hambúrguer, o título editável do projeto, o cartão
 * do playground e o aviso passageiro. É o mesmo comportamento de `<canvas-section>`, escrito à mão
 * sobre o HTML da página. No layout clássico (`?layout=classic`) o menu e o título não aparecem, o
 * playground fica solto na página e nada disto roda.
 */

/** Item do menu hambúrguer, dado pelo host. O rótulo entra como texto, nunca como HTML. */
export interface ShellMenuItem {
  readonly id: string;
  readonly label: string;
}

/** Pessoa logada, mostrada como avatar. O nome entra como texto, nunca como HTML. */
export interface ShellUser {
  readonly name: string;
  /** URL da foto. Sem ela, ou se ela falhar, o avatar mostra as iniciais do nome. */
  readonly avatarUrl?: string | undefined;
}

export type ExportFormat = 'svg' | 'png';

/** Estado do compartilhamento ao vivo, o mesmo `sharing` do `<canvas-section>`. */
export type ShellSharing = 'off' | 'connecting' | 'on';

export interface ShellHandle {
  /** Aviso passageiro (`role="status"`) logo abaixo do topo; some depois de 3 s. */
  notify(message: string): void;
  /** Reflete o estado do compartilhamento na pill Compartilhar. Só o host muda. */
  setSharing(state: ShellSharing): void;
  /** Quem está na sessão: a pilha de avatares e a ilha de participantes. */
  setParticipants(participants: readonly ShellParticipant[]): void;
  /** Quem a sessão local segue (`null` para ninguém): o botão, a faixa e a moldura. */
  setFollowing(sessionId: string | null): void;
  destroy(): void;
}

export interface ShellOptions {
  /** Só para saber do modo leitura: em leitura o título não se edita. */
  readonly section: CanvasSectionApi;
  /** O usuário confirmou outro título (aparado, com até 120 caracteres). */
  readonly onTitleChange?: ((title: string) => void) | undefined;
  /** Itens do menu hambúrguer, na ordem dada. */
  readonly menuItems?: readonly ShellMenuItem[] | undefined;
  /** A pessoa escolheu um item de `menuItems`. */
  readonly onMenuSelect?: ((id: string) => void) | undefined;
  /** Pessoa logada: mostra o avatar depois da pill Exportar. Sem ela, não há avatar. */
  readonly user?: ShellUser | undefined;
  /** O avatar foi clicado. */
  readonly onAvatarClick?: (() => void) | undefined;
  /** A pessoa escolheu um formato na ilha de exportação. Quem exporta é o host. */
  readonly onExportRequest?: ((format: ExportFormat) => void) | undefined;
  /** A pill Compartilhar foi clicada, com o estado do momento. Quem compartilha é o host. */
  readonly onShareRequest?: ((detail: { readonly sharing: ShellSharing }) => void) | undefined;
  /** "Parar compartilhamento" da ilha de participantes. Quem para é o host. */
  readonly onShareStop?: (() => void) | undefined;
  /** "Seguir" na ilha de participantes. Quem decide é o host. */
  readonly onFollow?: ((sessionId: string | null) => void) | undefined;
}

const MAX_TITLE_LENGTH = 120;

/** Até duas iniciais do nome: a primeira letra da primeira e da última palavra. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return '?';
  const letter = (word: string): string => (Array.from(word)[0] ?? '').toLocaleUpperCase();
  return words.length === 1 ? letter(first) : letter(first) + letter(last);
}

export function mountShell(options: ShellOptions): ShellHandle | null {
  if (document.body.classList.contains('classic')) {
    // Os controles do playground ficam soltos na página: sem popover, só o CSS os mostra.
    document.getElementById('playground-panel')?.removeAttribute('popover');
    return null;
  }

  const menuButton = document.getElementById('shell-menu-button') as HTMLButtonElement | null;
  const menu = document.getElementById('shell-menu');
  const titleButton = document.getElementById('shell-title') as HTMLButtonElement | null;
  if (!menuButton || !menu || !titleButton) return null;

  // Aviso passageiro ------------------------------------------------------------------------

  const statusEl = document.getElementById('app-status');
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = (message: string): void => {
    if (!statusEl) return;
    statusEl.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  };

  // Menu hambúrguer -------------------------------------------------------------------------

  const setMenu = (open: boolean, restoreFocus = false): void => {
    if (menu.hidden !== open) return;
    // Abrir uma ilha fecha a outra.
    if (open) setExport(false);
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) {
      document.addEventListener('pointerdown', onOutsidePointer, true);
      document.addEventListener('keydown', onKeydown);
    } else {
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      document.removeEventListener('keydown', onKeydown);
      if (restoreFocus) menuButton.focus();
    }
  };

  function onOutsidePointer(event: Event): void {
    const path = event.composedPath();
    if (!path.includes(menu!) && !path.includes(menuButton!)) setMenu(false);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setMenu(false, true);
  }

  menuButton.addEventListener('click', () => setMenu(menu.hidden === true));

  // Os itens vêm do host e entram como texto.
  const list = document.createElement('ul');
  list.className = 'shell-menu-items';
  for (const item of options.menuItems ?? []) {
    const entry = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shell-menu-item';
    button.dataset['menuItem'] = item.id;
    button.textContent = item.label;
    button.addEventListener('click', () => {
      setMenu(false, true);
      options.onMenuSelect?.(item.id);
    });
    entry.append(button);
    list.append(entry);
  }
  menu.replaceChildren(list);

  // Playground ------------------------------------------------------------------------------

  const playgroundPanel = document.getElementById('playground-panel');
  const playgroundButton = document.getElementById('btn-playground');
  const toolbar = document.getElementById('shell-toolbar');
  if (playgroundPanel && playgroundButton && toolbar) {
    // Abre colado à esquerda da toolbar, qualquer que seja a largura dela.
    playgroundPanel.addEventListener('beforetoggle', (event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const gap = 12;
      const margin = 16;
      const left = toolbar.getBoundingClientRect().left;
      playgroundPanel.style.right = `${document.documentElement.clientWidth - left + gap}px`;
      playgroundPanel.style.maxWidth = `min(360px, ${left - gap - margin}px)`;
    });
    // O botão acompanha o estado real do popover (Esc e clique fora também o fecham).
    playgroundPanel.addEventListener('toggle', (event) => {
      playgroundButton.setAttribute(
        'aria-expanded',
        String((event as ToggleEvent).newState === 'open'),
      );
    });
  }

  // Compartilhar ----------------------------------------------------------------------------

  const shareButton = document.getElementById('shell-share-button');
  const shareStatus = document.getElementById('shell-share-status');
  let sharing: ShellSharing = 'off';

  const participantsUi = shareButton?.parentElement
    ? mountParticipants({
        host: shareButton.parentElement,
        before: shareButton,
        onShareStop: () => options.onShareStop?.(),
        onFollow: (id) => options.onFollow?.(id),
      })
    : null;

  const setSharing = (state: ShellSharing): void => {
    sharing = state;
    participantsUi?.setSharing(state);
    if (!shareButton) return;
    shareButton.dataset['sharing'] = state;
    shareButton.setAttribute(
      'aria-label',
      state === 'connecting'
        ? 'Compartilhar, conectando'
        : state === 'on'
          ? 'Compartilhar, ativo'
          : 'Compartilhar',
    );
    if (shareStatus) {
      shareStatus.hidden = state === 'off';
      shareStatus.dataset['state'] = state;
    }
  };

  shareButton?.addEventListener('click', () => options.onShareRequest?.({ sharing }));

  // Ilha de exportação ----------------------------------------------------------------------

  const exportIsland = document.getElementById('shell-export');
  const exportButton = document.getElementById('shell-export-button') as HTMLButtonElement | null;
  const exportMenu = document.getElementById('shell-export-menu');
  const exportItems = [
    ...(exportMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];

  function setExport(open: boolean, restoreFocus = false): void {
    if (!exportMenu || !exportButton || exportMenu.hidden !== open) return;
    exportMenu.hidden = !open;
    exportButton.setAttribute('aria-expanded', String(open));
    if (open) {
      setMenu(false);
      document.addEventListener('pointerdown', onExportOutsidePointer, true);
      document.addEventListener('keydown', onExportEscape);
      exportItems[0]?.focus();
    } else {
      document.removeEventListener('pointerdown', onExportOutsidePointer, true);
      document.removeEventListener('keydown', onExportEscape);
      if (restoreFocus) exportButton.focus();
    }
  }

  function onExportOutsidePointer(event: Event): void {
    if (exportIsland && !event.composedPath().includes(exportIsland)) setExport(false);
  }

  function onExportEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setExport(false, true);
  }

  exportButton?.addEventListener('click', () => setExport(exportMenu?.hidden === true));

  // Seta para baixo abre a ilha; aberta, as setas andam pelos itens e Tab a fecha.
  exportIsland?.addEventListener('keydown', (event) => {
    if (!exportMenu) return;
    if (exportMenu.hidden) {
      if (event.key === 'ArrowDown' && event.target === exportButton) {
        event.preventDefault();
        setExport(true);
      }
      return;
    }
    if (event.key === 'Tab') {
      // A ilha some ao fechar: o foco vai à pill, de onde o Tab seguinte continua.
      event.preventDefault();
      setExport(false, true);
      return;
    }
    const last = exportItems.length - 1;
    const current = exportItems.indexOf(event.target as HTMLButtonElement);
    const next: number | undefined = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    exportItems[next]?.focus();
  });

  for (const item of exportItems) {
    item.addEventListener('click', () => {
      setExport(false, true);
      options.onExportRequest?.(item.dataset['format'] === 'png' ? 'png' : 'svg');
    });
  }

  // Avatar ----------------------------------------------------------------------------------

  const actions = document.getElementById('shell-actions');
  let avatar: HTMLButtonElement | null = null;
  if (options.user && actions) {
    const { name, avatarUrl } = options.user;
    avatar = document.createElement('button');
    avatar.type = 'button';
    avatar.id = 'shell-avatar';
    avatar.className = 'shell-avatar';
    avatar.dataset['testid'] = 'shell-avatar';
    avatar.setAttribute('aria-label', `Conta: ${name}`);
    avatar.addEventListener('click', () => options.onAvatarClick?.());
    const showInitials = (): void => {
      const initials = document.createElement('span');
      initials.className = 'shell-avatar-initials';
      initials.setAttribute('aria-hidden', 'true');
      initials.textContent = initialsOf(name);
      avatar?.replaceChildren(initials);
    };
    if (avatarUrl) {
      const photo = document.createElement('img');
      photo.alt = '';
      photo.width = 32;
      photo.height = 32;
      photo.addEventListener('error', showInitials);
      photo.src = avatarUrl;
      avatar.append(photo);
    } else {
      showInitials();
    }
    actions.append(avatar);
  }

  // Título ----------------------------------------------------------------------------------

  let title = titleButton.textContent?.trim() ?? '';
  let input: HTMLInputElement | null = null;

  const showTitle = (): void => {
    titleButton.textContent = title;
    titleButton.setAttribute('aria-label', `Editar título: ${title}`);
  };

  const finishEdit = (): void => {
    if (!input) return;
    const editing = input;
    input = null;
    editing.replaceWith(titleButton);
    titleButton.focus();
  };

  const commit = (value: string): void => {
    if (!input) return;
    finishEdit();
    const next = value.trim().slice(0, MAX_TITLE_LENGTH);
    if (next === '' || next === title) return;
    title = next;
    showTitle();
    options.onTitleChange?.(next);
  };

  const startEdit = (): void => {
    if (input || options.section.getSnapshot().session.readOnly) return;
    input = document.createElement('input');
    input.id = 'shell-title-input';
    input.type = 'text';
    input.maxLength = MAX_TITLE_LENGTH;
    input.value = title;
    input.setAttribute('aria-label', 'Título do projeto');
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit((event.target as HTMLInputElement).value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finishEdit();
      }
    });
    input.addEventListener('blur', (event) => commit((event.target as HTMLInputElement).value));
    titleButton.replaceWith(input);
    input.focus();
    input.select();
  };

  titleButton.addEventListener('click', startEdit);
  titleButton.addEventListener('keydown', (event) => {
    if (event.key !== 'F2') return;
    event.preventDefault();
    startEdit();
  });

  return {
    notify,
    setSharing,
    setParticipants: (participants) => participantsUi?.setParticipants(participants),
    setFollowing: (sessionId) => participantsUi?.setFollowing(sessionId),
    destroy(): void {
      participantsUi?.destroy();
      setMenu(false);
      setExport(false);
      avatar?.remove();
      input?.remove();
      clearTimeout(statusTimer);
    },
  };
}
