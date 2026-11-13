import { isBoardNode, type BoardNode, type CanvasSectionApi } from '@canvash/core';

/**
 * Seção "Board" do painel de Propriedades do Vanilla (spec boards, US-BD.10 e US-BD.17). Como a
 * seção "Texto na forma", é exceção ao painel de um nó só: aparece para toda seleção que é só de
 * boards, mostra o estado misto como a `<canvas-properties>` e aplica a todos numa só entrada de
 * histórico (`transact`). Com um nó que não é board na seleção, some, e nada é enviado. Os `part`
 * e `data-*` são os do componente, para os specs servirem aos quatro exemplos.
 */

export interface BoardSectionHandle {
  destroy(): void;
}

const MIXED_COLOR = '#cbd5e1';
const NONE_LABEL = 'Nenhum';

interface Common<T> {
  readonly mixed: boolean;
  readonly value: T | undefined;
}

function common<S, T>(items: readonly S[], read: (item: S) => T): Common<T> {
  const first = read(items[0]!);
  for (let i = 1; i < items.length; i++) {
    if (read(items[i]!) !== first) return { mixed: true, value: undefined };
  }
  return { mixed: false, value: first };
}

type ColorField = 'fill' | 'stroke';

export function mountBoardSection(section: CanvasSectionApi): BoardSectionHandle | null {
  const root = document.getElementById('board-section');
  if (!root) return null;
  const byField = <T extends HTMLElement>(name: string): T =>
    root.querySelector<T>(`[data-field="${name}"]`)!;
  const titleRow = byField<HTMLElement>('board-title-row');
  const titleInput = root.querySelector<HTMLInputElement>('[data-property="board-title"]')!;
  const opacityInput = root.querySelector<HTMLInputElement>(
    '[data-property="board-fill-opacity"]',
  )!;
  const colors: Record<
    ColorField,
    { input: HTMLInputElement; value: HTMLElement; none: HTMLButtonElement }
  > = {
    fill: {
      input: byField<HTMLInputElement>('board-fill'),
      value: byField('board-fill-value'),
      none: byField<HTMLButtonElement>('board-fill-none'),
    },
    stroke: {
      input: byField<HTMLInputElement>('board-stroke'),
      value: byField('board-stroke-value'),
      none: byField<HTMLButtonElement>('board-stroke-none'),
    },
  };

  /** Os boards da seleção, se ela é só de boards; senão, nenhum. */
  const selectedBoards = (): BoardNode[] => {
    const { document: doc, session } = section.getSnapshot();
    const nodes = session.selectedIds.map((id) => doc.nodes[id]);
    return nodes.length > 0 && nodes.every((node) => node !== undefined && isBoardNode(node))
      ? (nodes as BoardNode[])
      : [];
  };

  /** Aplica o patch a todos os boards, numa só entrada de histórico. */
  const apply = (patch: Record<string, unknown>): void => {
    const commands = selectedBoards().map((board) => ({
      type: 'shape.update' as const,
      id: board.id,
      patch,
    }));
    if (commands.length === 0) return;
    if (commands.length === 1) section.dispatch(commands[0]!);
    else section.transact(commands);
  };

  const disposers: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    target.addEventListener(type, handler);
    disposers.push(() => target.removeEventListener(type, handler));
  };

  listen(titleInput, 'change', () => {
    const boards = selectedBoards();
    if (boards.length !== 1) return;
    const title = titleInput.value.trim();
    if (title === '' || title === boards[0]!.title) {
      titleInput.value = boards[0]!.title;
      return;
    }
    apply({ title });
  });
  listen(opacityInput, 'change', () => {
    const raw = parseFloat(opacityInput.value);
    if (Number.isNaN(raw)) return;
    apply({ style: { fillOpacity: Math.min(1, Math.max(0, raw / 100)) } });
  });
  for (const field of ['fill', 'stroke'] as const) {
    const { input, none } = colors[field];
    listen(input, 'input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(input.value)) {
        apply({ style: { [field]: input.value.toLowerCase() } });
      }
    });
    listen(none, 'click', () => apply({ style: { [field]: null } }));
  }

  const render = (): void => {
    const boards = selectedBoards();
    root.hidden = boards.length === 0;
    if (boards.length === 0) return;

    const { readOnly } = section.getSnapshot().session;
    const disabled =
      readOnly ||
      boards.some((board) => board.locked) ||
      boards.some((board) => section.getPeerLock(board.id) !== undefined);

    titleRow.hidden = boards.length !== 1;
    // Não sobrescreve o que a pessoa está digitando.
    if (boards.length === 1 && document.activeElement !== titleInput) {
      titleInput.value = boards[0]!.title;
    }
    titleInput.disabled = disabled;

    const opacity = common(boards, (board) => Math.round(board.style.fillOpacity * 100));
    opacityInput.value = opacity.mixed ? '' : String(opacity.value);
    opacityInput.placeholder = opacity.mixed ? 'Misto' : '';
    opacityInput.disabled = disabled;

    for (const field of ['fill', 'stroke'] as const) {
      const { input, value, none } = colors[field];
      const state = common(boards, (board) => board.style[field]);
      const shown = state.mixed ? undefined : (state.value ?? undefined);
      input.value = shown ?? '#000000';
      input.disabled = disabled;
      value.textContent = state.mixed ? 'Misto' : (shown ?? NONE_LABEL);
      value.style.background = state.mixed ? MIXED_COLOR : '';
      none.setAttribute('aria-pressed', String(!state.mixed && state.value === null));
      none.disabled = disabled;
    }
  };

  const unsubscribe = section.subscribe((event) => {
    if (event.areas.some((area) => ['selection', 'document', 'readOnly', 'peers'].includes(area))) {
      render();
    }
  });
  render();

  return {
    destroy(): void {
      unsubscribe();
      for (const dispose of disposers) dispose();
    },
  };
}
