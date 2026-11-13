/** O que o controlador precisa do elemento dono dos menus. */
export interface ToolMenuHost extends HTMLElement {
  readonly renderRoot: ParentNode & Node;
  readonly updateComplete: Promise<unknown>;
  readonly orientation: 'horizontal' | 'vertical';
  requestUpdate(): void;
}

/** Tempo de permanência do mouse no botão antes da ilha abrir por hover. */
export const HOVER_OPEN_MS = 80;
/** Tolerância para o mouse cruzar o vão entre o botão e a ilha, e voltar, antes de fechar. */
export const HOVER_CLOSE_MS = 250;

/** Trecho contíguo de entradas desenhado como uma grade própria. */
export interface ToolMenuBlock {
  readonly start: number;
  readonly count: number;
  readonly columns: number;
}

export interface ToolMenuConfig {
  readonly host: ToolMenuHost;
  /** Colunas da grade: as setas para cima e para baixo andam uma linha. */
  readonly columns: number;
  /** Quantidade de entradas navegáveis; função quando o conteúdo muda com o estado. */
  readonly count: number | (() => number);
  /**
   * Grades diferentes empilhadas no mesmo menu: as setas para cima e para baixo andam uma linha
   * dentro do bloco e, na borda, passam ao bloco vizinho, na mesma coluna ou na última dele.
   */
  readonly blocks?: () => readonly ToolMenuBlock[];
  /** Seletor do conjunto botão + menu, para saber se o foco ainda está nele. */
  readonly groupSelector: string;
  readonly menuSelector: string;
  readonly toggleSelector: string;
  /** Seletor da entrada de índice `index` dentro do menu aberto. */
  readonly entrySelector: (index: number) => string;
  /** Entrada que recebe o foco ao abrir. */
  readonly initialIndex: () => number;
  /** O hover pode abrir a ilha? Sem isto, sempre. */
  readonly canHover?: () => boolean;
  /** Chamado ao abrir, por hover, clique ou teclado: o dono fecha as outras ilhas. */
  readonly onOpen?: () => void;
}

/**
 * Comportamento comum dos menus suspensos da toolbar: abrir e fechar, fechar por clique fora ou
 * perda de foco, navegação por teclado em grade, foco devolvido ao botão de abrir e inversão de
 * lado quando o menu estouraria o viewport. O estado vive aqui; o elemento só o desenha.
 *
 * O mouse e a caneta também abrem o menu por hover (ilha "solta"), com tolerância para cruzar o
 * vão até ele. Clique, Enter, Espaço e teclado abrem a ilha "fixada", que não segue o ponteiro.
 */
export class ToolMenu {
  open = false;
  /** O menu abriu invertido, porque o lado padrão estouraria o viewport. */
  flipped = false;
  /** Entrada que recebe o foco por teclado (roving tabindex). */
  focusedIndex = 0;
  /** Aberto por clique ou teclado: sair com o ponteiro não fecha. */
  pinned = false;

  private outsideClick: ((event: Event) => void) | undefined;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  /** Um pressionar do ponteiro está em curso dentro do grupo: o foco que muda por ele não fecha. */
  private pressing = false;
  private endPress: (() => void) | undefined;

  constructor(private readonly config: ToolMenuConfig) {}

  /** Clique no botão: abre fixado, fixa a ilha aberta por hover ou fecha a que já estava fixada. */
  toggle(): void {
    if (this.open && !this.pinned) {
      this.clearHoverTimer();
      this.pinned = true;
      this.config.host.requestUpdate();
    } else if (this.open) {
      this.close({ restoreFocus: false });
    } else {
      this.openMenu();
    }
  }

  /** Abre fixado e leva o foco à entrada ativa: é o caminho do clique e do teclado. */
  openMenu(): void {
    this.clearHoverTimer();
    if (this.open) {
      this.pinned = true;
      return;
    }
    this.show({ pinned: true });
  }

  close(options: { readonly restoreFocus: boolean }): void {
    this.clearHoverTimer();
    if (!this.open) return;
    this.open = false;
    this.pinned = false;
    this.flipped = false;
    this.stopWatchingOutsideClicks();
    this.config.host.requestUpdate();
    if (options.restoreFocus) this.toggleElement()?.focus();
  }

  /** O mouse ou a caneta entrou no botão ou na ilha: abre em 80 ms ou cancela o fechamento. */
  onPointerEnter(event: Pick<PointerEvent, 'pointerType'>): void {
    if (!this.isHoverPointer(event)) return;
    this.clearHoverTimer();
    if (this.open || this.config.canHover?.() === false) return;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = undefined;
      if (!this.open) this.show({ pinned: false });
    }, HOVER_OPEN_MS);
  }

  /** O ponteiro saiu do botão e da ilha: cancela a abertura ou fecha a ilha solta em 250 ms. */
  onPointerLeave(event: Pick<PointerEvent, 'pointerType'>): void {
    if (!this.isHoverPointer(event)) return;
    this.clearHoverTimer();
    if (!this.open || this.pinned) return;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = undefined;
      if (!this.pinned) this.close({ restoreFocus: false });
    }, HOVER_CLOSE_MS);
  }

  /** Abre pelo teclado: seta para baixo na toolbar horizontal, para a esquerda na vertical. */
  onToggleKeydown(event: KeyboardEvent): void {
    const opener = this.config.host.orientation === 'vertical' ? 'ArrowLeft' : 'ArrowDown';
    if (event.key !== opener) return;
    event.preventDefault();
    this.openMenu();
  }

  /** Navegação pela grade: esquerda e direita andam uma entrada, cima e baixo uma linha. */
  onMenuKeydown(event: KeyboardEvent): void {
    const count = typeof this.config.count === 'function' ? this.config.count() : this.config.count;
    const last = count - 1;
    const index = this.focusedIndex;
    const target: number | undefined = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: this.vertical(index, 1),
      ArrowUp: this.vertical(index, -1),
      Home: 0,
      End: last,
    }[event.key];

    if (target !== undefined) {
      event.preventDefault();
      this.focusEntry(Math.min(Math.max(target, 0), last));
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      // O menu sai do DOM ao fechar: leva o foco ao botão de abrir, de onde o Tab seguinte continua.
      event.preventDefault();
      this.close({ restoreFocus: true });
    }
  }

  /**
   * Pressionar o botão ou a ilha. O Safari não dá foco ao botão no clique: o foco cai no ancestral
   * focável (a própria toolbar), que está fora do grupo. Sem este aviso, o `focusout` desse
   * pressionar fecharia a ilha antes do `click` e o clique seguinte a reabriria.
   */
  onGroupPointerDown(): void {
    this.pressing = true;
    if (this.endPress || typeof document === 'undefined') return;
    // O pressionar termina ao soltar o ponteiro, onde for, e não por tempo: um foco legítimo logo
    // depois do clique ainda precisa fechar a ilha.
    this.endPress = () => this.stopPressing();
    document.addEventListener('pointerup', this.endPress, true);
    document.addEventListener('pointercancel', this.endPress, true);
  }

  /** O foco saiu do grupo para fora dele: fecha. Foco nulo (clique no vazio) fica com o clique fora. */
  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Element | null;
    if (next === null || this.pressing) return;
    const inside =
      this.config.host.renderRoot?.contains(next) === true &&
      next.closest(this.config.groupSelector) !== null;
    if (!inside) this.close({ restoreFocus: false });
  }

  /** Marca a entrada que recebeu o foco, para o roving tabindex. */
  noteFocus(index: number): void {
    this.focusedIndex = index;
    this.config.host.requestUpdate();
  }

  /** Remove o listener global; chamado ao desconectar o elemento. */
  dispose(): void {
    this.clearHoverTimer();
    this.stopPressing();
    this.stopWatchingOutsideClicks();
  }

  private stopPressing(): void {
    this.pressing = false;
    if (!this.endPress) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerup', this.endPress, true);
      document.removeEventListener('pointercancel', this.endPress, true);
    }
    this.endPress = undefined;
  }

  private show(options: { readonly pinned: boolean }): void {
    this.config.onOpen?.();
    this.open = true;
    this.pinned = options.pinned;
    this.flipped = false;
    this.focusedIndex = this.config.initialIndex();
    this.watchOutsideClicks();
    this.config.host.requestUpdate();
    // O menu só existe depois do render: então mede uma vez. O foco só vai à entrada ativa quando
    // a ilha é fixada; o hover não tira o foco de onde o usuário estava.
    void this.config.host.updateComplete.then(() => {
      if (!this.open) return;
      const wasFlipped = this.flipped;
      this.flipIfOverflowing();
      // Sem foco a mover (hover), nada mais pede um render: a inversão tem de pedir o seu.
      if (this.flipped !== wasFlipped) this.config.host.requestUpdate();
      if (this.pinned) this.entry(this.focusedIndex)?.focus();
    });
  }

  private isHoverPointer(event: Pick<PointerEvent, 'pointerType'>): boolean {
    return event.pointerType === 'mouse' || event.pointerType === 'pen';
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer === undefined) return;
    clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
  }

  /** Destino da seta para cima (-1) ou para baixo (1): uma linha, ou o bloco vizinho. */
  private vertical(index: number, direction: 1 | -1): number {
    const blocks = this.config.blocks?.();
    if (!blocks) return index + direction * this.config.columns;
    const at = blocks.findIndex(
      (block) => index >= block.start && index < block.start + block.count,
    );
    const block = blocks[at];
    if (!block) return index;
    const offset = index - block.start;
    const column = offset % block.columns;
    const row = Math.floor(offset / block.columns);
    const sameBlock = offset + direction * block.columns;
    if (sameBlock >= 0 && sameBlock < block.count) return block.start + sameBlock;
    if (direction === 1 && row < Math.floor((block.count - 1) / block.columns)) {
      // Última linha do bloco, mais curta que a coluna: desce para a última entrada.
      return block.start + block.count - 1;
    }
    const next = blocks[at + direction];
    if (!next) return index;
    if (direction === 1) return next.start + Math.min(column, next.count - 1);
    // Para cima, entra na última linha do bloco anterior, na mesma coluna ou na última dela.
    const lastRow = Math.floor((next.count - 1) / next.columns);
    return next.start + Math.min(lastRow * next.columns + column, next.count - 1);
  }

  private focusEntry(index: number): void {
    this.focusedIndex = index;
    this.config.host.requestUpdate();
    void this.config.host.updateComplete.then(() => this.entry(index)?.focus());
  }

  private entry(index: number): HTMLElement | null {
    return (
      this.config.host.renderRoot?.querySelector<HTMLElement>(this.config.entrySelector(index)) ??
      null
    );
  }

  private toggleElement(): HTMLElement | null {
    return (
      this.config.host.renderRoot?.querySelector<HTMLElement>(this.config.toggleSelector) ?? null
    );
  }

  /**
   * Mede o menu e a toolbar uma só vez, ao abrir: se o lado padrão (abaixo na horizontal, à
   * esquerda na vertical, que fica na borda direita da tela) estoura o viewport e o lado oposto
   * cabe, abre do outro lado. Sem listener de scroll ou resize: a posição vale enquanto o menu
   * estiver aberto.
   */
  private flipIfOverflowing(): void {
    const menu = this.config.host.renderRoot?.querySelector<HTMLElement>(this.config.menuSelector);
    if (!menu || typeof window === 'undefined') return;
    const menuBox = menu.getBoundingClientRect();
    const barBox = this.config.host.getBoundingClientRect();
    const vertical = this.config.host.orientation === 'vertical';
    const overflows = vertical ? menuBox.left < 0 : menuBox.bottom > window.innerHeight;
    const fitsOpposite = vertical
      ? barBox.right + menuBox.width <= window.innerWidth
      : barBox.top - menuBox.height >= 0;
    if (overflows && fitsOpposite) this.flipped = true;
  }

  /** O clique fora fecha o menu. O listener só existe enquanto o menu está aberto (WC-04). */
  private watchOutsideClicks(): void {
    if (this.outsideClick || typeof document === 'undefined') return;
    this.outsideClick = (event: Event) => {
      if (!event.composedPath().includes(this.config.host)) this.close({ restoreFocus: false });
    };
    document.addEventListener('pointerdown', this.outsideClick, true);
  }

  private stopWatchingOutsideClicks(): void {
    if (!this.outsideClick) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', this.outsideClick, true);
    }
    this.outsideClick = undefined;
  }
}
