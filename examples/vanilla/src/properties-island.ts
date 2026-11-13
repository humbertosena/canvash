import type { CanvasSectionApi } from '@canvash/core';

/**
 * Botão e painel de Propriedades da toolbar do Vanilla (layout shell). É o mesmo comportamento da
 * `<canvas-toolbar>`, escrito à mão sobre o HTML da página:
 * - o botão fica desabilitado sem seleção ou em modo leitura, e explica o motivo no `title`;
 * - o clique alterna uma ilha `role="dialog"` à esquerda da toolbar, limitada à tela;
 * - o painel fecha com o botão, com Esc (o foco volta ao botão), quando a seleção fica vazia ou em
 *   modo leitura; trocar a seleção o mantém aberto;
 * - abrir Propriedades fecha as ilhas de grupo, e o contrário também vale.
 * No layout clássico (`?layout=classic`) o painel "Seleção & Tipo" fica na barra fixa e nada disto roda.
 */

export interface PropertiesIslandHandle {
  destroy(): void;
}

/** Aviso entre as ilhas: quem abre avisa, e as outras fecham. */
export const ISLAND_OPEN_EVENT = 'canvash:island-open';

const MARGIN = 16;

export function mountPropertiesIsland(section: CanvasSectionApi): PropertiesIslandHandle | null {
  if (document.body.classList.contains('classic')) return null;
  const button = document.getElementById('btn-properties') as HTMLButtonElement | null;
  const panel = document.getElementById('properties-panel');
  if (!button || !panel) return null;

  let open = false;

  const canOpen = (): boolean => {
    const { selectedIds, readOnly } = section.getSnapshot().session;
    return !readOnly && selectedIds.length > 0;
  };

  /** Largura de até 280 px, inversão de lado quando falta espaço e subida para caber embaixo. */
  const layout = (): void => {
    panel.style.translate = '';
    panel.classList.remove('flipped');
    let box = panel.getBoundingClientRect();
    const bar = button.closest('#shell-toolbar')?.getBoundingClientRect();
    if (bar && box.left < MARGIN && bar.right + box.width <= window.innerWidth) {
      panel.classList.add('flipped');
      box = panel.getBoundingClientRect();
    }
    const shift = Math.max(0, box.bottom - (window.innerHeight - MARGIN));
    const top = Math.max(MARGIN - (box.top - shift), 0);
    if (shift > 0 || top > 0) panel.style.translate = `0 ${top - shift}px`;
  };

  const setOpen = (next: boolean, restoreFocus = false): void => {
    if (next === open) return;
    open = next;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      document.dispatchEvent(
        new CustomEvent(ISLAND_OPEN_EVENT, { detail: { source: 'properties' } }),
      );
      layout();
    }
    button.dispatchEvent(
      new CustomEvent('properties-panel-toggle', { detail: { open }, bubbles: true }),
    );
    if (!open && restoreFocus) button.focus();
  };

  // Seleção travada por outro participante: o painel mostra quem e deixa os campos sem uso.
  const notice = document.createElement('div');
  notice.id = 'properties-peer-lock';
  notice.setAttribute('data-testid', 'properties-peer-lock');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  notice.style.cssText = 'padding:6px 12px;font-size:12px;font-weight:600;background:#f1f5f9;';
  panel.prepend(notice);

  const syncPeerLock = (): void => {
    let holder: { name: string; color: string } | undefined;
    for (const id of section.getSnapshot().session.selectedIds) {
      holder = section.getPeerLock(id);
      if (holder) break;
    }
    notice.hidden = holder === undefined;
    // O nome é de outra pessoa: sempre texto.
    notice.textContent = holder ? `Em edição por ${holder.name}` : '';
    notice.style.borderLeft = holder ? `4px solid ${holder.color}` : '';
    panel.toggleAttribute('data-peer-locked', holder !== undefined);
    if (holder) panel.setAttribute('aria-disabled', 'true');
    else panel.removeAttribute('aria-disabled');
    for (const child of panel.children) {
      if (child !== notice) (child as HTMLElement).inert = holder !== undefined;
    }
  };

  const sync = (): void => {
    syncPeerLock();
    const enabled = canOpen();
    button.disabled = !enabled;
    button.title = enabled ? 'Propriedades' : 'Selecione uma ou mais formas';
    if (open && !enabled) setOpen(false);
    else if (open) layout();
  };

  button.addEventListener('click', () => {
    if (!open && !canOpen()) return;
    setOpen(!open);
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setOpen(false, true);
  });
  const onOtherIsland = (event: Event): void => {
    if ((event as CustomEvent<{ source: string }>).detail.source !== 'properties') setOpen(false);
  };
  document.addEventListener(ISLAND_OPEN_EVENT, onOtherIsland);

  const unsubscribe = section.subscribe(sync);
  const observer = new ResizeObserver(() => open && layout());
  observer.observe(panel);
  sync();

  return {
    destroy(): void {
      unsubscribe();
      notice.remove();
      observer.disconnect();
      document.removeEventListener(ISLAND_OPEN_EVENT, onOtherIsland);
      setOpen(false);
    },
  };
}
