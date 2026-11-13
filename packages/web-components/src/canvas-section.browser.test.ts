import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasSectionElement, type ShellMenuItem } from './canvas-section.js';

beforeAll(() => {
  if (!customElements.get('canvas-section'))
    customElements.define('canvas-section', CanvasSectionElement);
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function mount(setup: (shell: CanvasSectionElement) => void): Promise<CanvasSectionElement> {
  const shell = document.createElement('canvas-section') as CanvasSectionElement;
  setup(shell);
  document.body.append(shell);
  await shell.updateComplete;
  return shell;
}

const part = <T extends Element = HTMLElement>(
  shell: CanvasSectionElement,
  name: string,
): T | null => shell.shadowRoot?.querySelector<T>(`[part~="${name}"]`) ?? null;

const parts = <T extends Element = HTMLElement>(shell: CanvasSectionElement, name: string): T[] => [
  ...(shell.shadowRoot?.querySelectorAll<T>(`[part~="${name}"]`) ?? []),
];

describe('<canvas-section> no navegador real: itens do menu', () => {
  const items: ShellMenuItem[] = [
    { id: 'new', label: 'Novo projeto' },
    {
      id: 'open',
      label: 'Abrir projeto…',
      icon: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
    },
    { id: 'about', label: 'Sobre', disabled: true },
  ];

  it('rótulos com marcação aparecem como texto, sem criar elementos', async () => {
    const markup = '<img src=x onerror="window.__xss = true"><b>negrito</b>';
    const shell = await mount((el) => {
      el.menuItems = [{ id: 'evil', label: markup }];
      el.menuOpen = true;
    });
    await shell.updateComplete;

    const [item] = parts(shell, 'menu-item');
    expect(item?.textContent?.trim()).toBe(markup);
    expect(item?.querySelector('img, b')).toBeNull();
    expect(shell.shadowRoot?.querySelectorAll('img')).toHaveLength(0);
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  });

  it('desenha os itens em ordem, o ícone só onde existe e o desabilitado inativo', async () => {
    const shell = await mount((el) => {
      el.menuItems = items;
      el.menuOpen = true;
    });

    const buttons = parts<HTMLButtonElement>(shell, 'menu-item');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Novo projeto',
      'Abrir projeto…',
      'Sobre',
    ]);
    expect(buttons.map((button) => button.disabled)).toEqual([false, false, true]);
    const icons = shell.shadowRoot?.querySelectorAll<HTMLImageElement>('.menu-item img') ?? [];
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute('alt')).toBe('');
    expect(icons[0]?.width).toBe(20);
  });

  it('clicar num item emite menu-select uma vez, fecha o menu e foca o botão', async () => {
    const shell = await mount((el) => {
      el.menuItems = items;
      el.menuOpen = true;
    });
    const received: string[] = [];
    document.body.addEventListener('menu-select', (event) =>
      received.push((event as CustomEvent<{ id: string }>).detail.id),
    );

    parts<HTMLButtonElement>(shell, 'menu-item')[1]?.click();
    await shell.updateComplete;

    expect(received).toEqual(['open']);
    expect(shell.menuOpen).toBe(false);
    expect(part(shell, 'menu')).toBeNull();
    expect(shell.shadowRoot?.activeElement).toBe(part(shell, 'menu-button'));
  });

  it('clicar no item desabilitado não emite nem fecha o menu', async () => {
    const shell = await mount((el) => {
      el.menuItems = items;
      el.menuOpen = true;
    });
    let count = 0;
    document.body.addEventListener('menu-select', () => count++);

    parts<HTMLButtonElement>(shell, 'menu-item')[2]?.click();
    await shell.updateComplete;

    expect(count).toBe(0);
    expect(shell.menuOpen).toBe(true);
  });

  it('o conteúdo do slot "menu" vem depois da lista', async () => {
    const shell = await mount((el) => {
      el.menuItems = items;
      el.menuOpen = true;
    });
    const card = part(shell, 'menu');
    const children = [...(card?.children ?? [])].map((child) => child.localName);

    expect(children).toEqual(['ul', 'slot']);
  });
});

const keydown = (target: Element, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

const pointerdownOutside = (): void => {
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
};

describe('<canvas-section> no navegador real: ilha Exportar', () => {
  const exportButton = (shell: CanvasSectionElement) =>
    part<HTMLButtonElement>(shell, 'export-button');
  const exportItems = (shell: CanvasSectionElement) =>
    parts<HTMLButtonElement>(shell, 'export-item');
  const focused = (shell: CanvasSectionElement) => shell.shadowRoot?.activeElement ?? null;

  async function opened(): Promise<CanvasSectionElement> {
    const shell = await mount(() => undefined);
    exportButton(shell)?.click();
    await shell.updateComplete;
    return shell;
  }

  it('clicar na pill abre a ilha com os dois formatos, aria-expanded e foco no primeiro item', async () => {
    const shell = await opened();

    expect(exportButton(shell)?.getAttribute('aria-expanded')).toBe('true');
    expect(part(shell, 'export-menu')?.getAttribute('role')).toBe('menu');
    expect(exportItems(shell).map((item) => item.textContent?.trim())).toEqual([
      'Exportar SVG',
      'Exportar PNG',
    ]);
    expect(exportItems(shell).map((item) => item.dataset['format'])).toEqual(['svg', 'png']);
    expect(focused(shell)).toBe(exportItems(shell)[0]);
  });

  it('clicar de novo na pill fecha a ilha', async () => {
    const shell = await opened();

    exportButton(shell)?.click();
    await shell.updateComplete;

    expect(part(shell, 'export-menu')).toBeNull();
    expect(exportButton(shell)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('seta para baixo na pill abre a ilha com foco no primeiro item', async () => {
    const shell = await mount(() => undefined);
    const button = exportButton(shell);
    button?.focus();

    const event = keydown(button as HTMLElement, 'ArrowDown');
    await shell.updateComplete;

    expect(event.defaultPrevented).toBe(true);
    expect(exportItems(shell)).toHaveLength(2);
    expect(focused(shell)).toBe(exportItems(shell)[0]);
  });

  it('outras teclas na pill fechada não abrem a ilha', async () => {
    const shell = await mount(() => undefined);

    keydown(exportButton(shell) as HTMLElement, 'ArrowUp');
    await shell.updateComplete;

    expect(part(shell, 'export-menu')).toBeNull();
  });

  it('as setas andam entre os itens, com volta ao início e ao fim, e Home e End vão às pontas', async () => {
    const shell = await opened();
    const [svg, png] = exportItems(shell);

    keydown(svg as HTMLElement, 'ArrowDown');
    expect(focused(shell)).toBe(png);
    keydown(png as HTMLElement, 'ArrowDown');
    expect(focused(shell)).toBe(svg);
    keydown(svg as HTMLElement, 'ArrowUp');
    expect(focused(shell)).toBe(png);
    keydown(png as HTMLElement, 'Home');
    expect(focused(shell)).toBe(svg);
    keydown(svg as HTMLElement, 'End');
    expect(focused(shell)).toBe(png);
  });

  it('Esc fecha a ilha e devolve o foco à pill', async () => {
    const shell = await opened();

    keydown(document.body, 'Escape');
    await shell.updateComplete;

    expect(part(shell, 'export-menu')).toBeNull();
    expect(focused(shell)).toBe(exportButton(shell));
  });

  it('Tab fecha a ilha e deixa o foco na pill, de onde o Tab seguinte continua', async () => {
    const shell = await opened();

    const event = keydown(exportItems(shell)[0] as HTMLElement, 'Tab');
    await shell.updateComplete;

    expect(event.defaultPrevented).toBe(true);
    expect(part(shell, 'export-menu')).toBeNull();
    expect(focused(shell)).toBe(exportButton(shell));
  });

  it('clicar fora fecha a ilha; clicar dentro dela não', async () => {
    const shell = await opened();

    exportItems(shell)[0]?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true }),
    );
    await shell.updateComplete;
    expect(part(shell, 'export-menu')).not.toBeNull();

    pointerdownOutside();
    await shell.updateComplete;
    expect(part(shell, 'export-menu')).toBeNull();
  });

  it('escolher um item emite export-request uma vez com o formato, fecha e foca a pill', async () => {
    const shell = await opened();
    const formats: string[] = [];
    document.body.addEventListener('export-request', (event) =>
      formats.push((event as CustomEvent<{ format: string }>).detail.format),
    );

    exportItems(shell)[1]?.click();
    await shell.updateComplete;

    expect(formats).toEqual(['png']);
    expect(part(shell, 'export-menu')).toBeNull();
    expect(focused(shell)).toBe(exportButton(shell));
  });

  it('abrir a ilha fecha o menu hambúrguer, e abrir o menu fecha a ilha', async () => {
    const shell = await mount((el) => {
      el.menuOpen = true;
    });

    exportButton(shell)?.click();
    await shell.updateComplete;
    expect(shell.menuOpen).toBe(false);
    expect(part(shell, 'export-menu')).not.toBeNull();

    part<HTMLButtonElement>(shell, 'menu-button')?.click();
    await shell.updateComplete;
    expect(shell.menuOpen).toBe(true);
    expect(part(shell, 'export-menu')).toBeNull();
  });

  it('segue ativa com o canvas em modo leitura e some com hide-export', async () => {
    const { createCanvasSection } = await import('@canvash/core');
    const section = createCanvasSection();
    section.setReadOnly(true);
    const shell = await mount((el) => {
      el.section = section;
    });

    exportButton(shell)?.click();
    await shell.updateComplete;
    expect(part(shell, 'export-menu')).not.toBeNull();

    shell.hideExport = true;
    await shell.updateComplete;
    expect(part(shell, 'export')).toBeNull();
  });
});

describe('<canvas-section> no navegador real: Compartilhar e Avatar', () => {
  it('cada clique em Compartilhar emite share-request', async () => {
    const shell = await mount(() => undefined);
    let count = 0;
    document.body.addEventListener('share-request', () => count++);

    part<HTMLButtonElement>(shell, 'share-button')?.click();
    part<HTMLButtonElement>(shell, 'share-button')?.click();

    expect(count).toBe(2);
  });

  it('hide-share remove a pill e a Exportar segue', async () => {
    const shell = await mount((el) => {
      el.hideShare = true;
    });

    expect(part(shell, 'share-button')).toBeNull();
    expect(part(shell, 'export-button')).not.toBeNull();
  });

  it('as pills ficam na ordem Compartilhar, Exportar, Avatar, depois do slot actions', async () => {
    const shell = await mount((el) => {
      el.user = { name: 'Ana Silva' };
    });

    const order = [
      ...(part(shell, 'top-end')?.querySelectorAll(
        'slot, [part~="share-button"], [part~="export"], [part~="avatar"]',
      ) ?? []),
    ].map((node) => (node.localName === 'slot' ? 'slot' : (node.getAttribute('part') ?? '')));
    expect(order).toEqual(['slot', 'share-button', 'export', 'avatar']);
  });

  it('a foto é um círculo de 32 px; com o clique emite avatar-click', async () => {
    const shell = await mount((el) => {
      el.user = {
        name: 'Ana Silva',
        avatarUrl:
          'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
      };
    });
    let clicks = 0;
    document.body.addEventListener('avatar-click', () => clicks++);
    const avatar = part<HTMLButtonElement>(shell, 'avatar');
    const box = avatar?.getBoundingClientRect();
    const style = avatar ? getComputedStyle(avatar) : undefined;

    expect(avatar?.getAttribute('aria-label')).toBe('Conta: Ana Silva');
    expect(box?.width).toBe(32);
    expect(box?.height).toBe(32);
    expect(style?.borderTopWidth).toBe('0px');
    expect(style?.boxShadow).toBe('none');
    expect(style?.borderRadius).toBe('50%');
    expect(part(shell, 'avatar-image')).not.toBeNull();

    avatar?.click();
    expect(clicks).toBe(1);
  });

  it('se a imagem falhar, mostra as iniciais em branco sobre #1f1f1f', async () => {
    const shell = await mount((el) => {
      el.user = { name: 'Ana Silva', avatarUrl: '/nao-existe.png' };
    });

    part(shell, 'avatar-image')?.dispatchEvent(new Event('error'));
    await shell.updateComplete;

    const initials = part(shell, 'avatar-initials');
    expect(part(shell, 'avatar-image')).toBeNull();
    expect(initials?.textContent).toBe('AS');
    const avatarStyle = getComputedStyle(part(shell, 'avatar') as HTMLElement);
    expect(avatarStyle.backgroundColor).toBe('rgb(31, 31, 31)');
    expect(avatarStyle.color).toBe('rgb(255, 255, 255)');
  });

  it('o nome com marcação aparece como texto, no rótulo e nas iniciais', async () => {
    const name = '<img src=x onerror="window.__xss = true"> <b>b</b>';
    const shell = await mount((el) => {
      el.user = { name };
    });

    expect(part(shell, 'avatar')?.getAttribute('aria-label')).toBe(`Conta: ${name}`);
    expect(part(shell, 'avatar')?.querySelector('img, b')).toBeNull();
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  });
});

describe('<canvas-section> no navegador real: estilo do título', () => {
  const computed = (element: Element | null) => getComputedStyle(element as Element);

  it('em repouso o título é negrito (700), sem fundo nem borda', async () => {
    const shell = await mount((el) => {
      el.projectTitle = 'Meu projeto';
    });

    const style = computed(part(shell, 'title'));

    expect(style.fontWeight).toBe('700');
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.backgroundImage).toBe('none');
    expect(style.borderTopWidth).toBe('0px');
  });

  it('em edição o campo é itálico, sem negrito, transparente, sem contorno e com a linha em degradê embaixo', async () => {
    const shell = await mount((el) => {
      el.projectTitle = 'Meu projeto';
    });

    part<HTMLButtonElement>(shell, 'title')?.click();
    await shell.updateComplete;
    const input = part<HTMLInputElement>(shell, 'title-input');
    const style = computed(input);

    expect(shell.shadowRoot?.activeElement).toBe(input);
    expect(style.fontStyle).toBe('italic');
    expect(style.fontWeight).toBe('400');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderTopColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.outlineStyle).toBe('none');
    // Fundo transparente: nenhum preenchimento, nem cor nem gradiente.
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.backgroundImage).toBe('none');
    // A linha: borda de baixo de 2 px, em degradê do tom de seleção dos itens ao fundo do canvas.
    expect(style.borderBottomWidth).toBe('2px');
    expect(style.borderImageSource).toContain('linear-gradient');
    expect(style.borderImageSource.indexOf('rgb(204, 206, 211)')).toBeGreaterThan(-1);
    expect(style.borderImageSource.indexOf('rgb(204, 206, 211)')).toBeLessThan(
      style.borderImageSource.indexOf('rgb(242, 243, 245)'),
    );
  });

  it('o campo em edição tem a altura de antes: 27 px, e a linha não empurra o topo', async () => {
    const shell = await mount((el) => {
      el.projectTitle = 'Meu projeto';
    });

    part<HTMLButtonElement>(shell, 'title')?.click();
    await shell.updateComplete;

    expect(part(shell, 'title-input')?.getBoundingClientRect().height).toBe(27);
  });

  it('sobrescrever --canvash-title-edit-line muda a linha, e --canvash-surface-float-item-hover o início dela', async () => {
    const shell = await mount((el) => {
      el.projectTitle = 'Meu projeto';
      el.style.setProperty('--canvash-title-edit-line', 'linear-gradient(90deg, red, blue)');
    });

    part<HTMLButtonElement>(shell, 'title')?.click();
    await shell.updateComplete;
    expect(computed(part(shell, 'title-input')).borderImageSource).toContain('rgb(255, 0, 0)');

    shell.style.removeProperty('--canvash-title-edit-line');
    shell.style.setProperty('--canvash-surface-float-item-hover', 'rgb(1, 2, 3)');
    await shell.updateComplete;
    expect(computed(part(shell, 'title-input')).borderImageSource).toContain('rgb(1, 2, 3)');
  });

  it('sobrescrever --canvash-title-edit-bg muda o fundo do campo', async () => {
    const shell = await mount((el) => {
      el.projectTitle = 'Meu projeto';
      el.style.setProperty('--canvash-title-edit-bg', 'rgb(255, 0, 0)');
    });

    part<HTMLButtonElement>(shell, 'title')?.click();
    await shell.updateComplete;
    const style = computed(part(shell, 'title-input'));

    expect(style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(style.backgroundImage).toBe('none');
  });
});

describe('<canvas-section> no navegador real: fundo de hover e ilhas temporárias', () => {
  /** Fundo em repouso (`--canvash-surface-float`) e fundo forte (`--canvash-surface-float-hover`). */
  const RESTING = 'rgb(235, 236, 239)';
  const STRONG = 'rgb(217, 219, 224)';
  const background = (element: Element | null) =>
    getComputedStyle(element as Element).backgroundColor;

  it('em repouso, as ilhas têm o fundo da superfície', async () => {
    const shell = await mount((el) => {
      el.user = { name: 'Ana' };
    });

    expect(background(part(shell, 'menu-button'))).toBe(RESTING);
    expect(background(part(shell, 'share-button'))).toBe(RESTING);
    expect(background(part(shell, 'export-button'))).toBe(RESTING);
  });

  it('com o menu aberto, o botão e o cartão têm o fundo forte; fechado, o botão volta ao original', async () => {
    const shell = await mount((el) => {
      el.menuItems = [{ id: 'new', label: 'Novo' }];
      el.menuOpen = true;
    });

    expect(background(part(shell, 'menu-button'))).toBe(STRONG);
    expect(background(part(shell, 'menu'))).toBe(STRONG);

    shell.menuOpen = false;
    await shell.updateComplete;

    expect(background(part(shell, 'menu-button'))).toBe(RESTING);
    expect(part(shell, 'menu')).toBeNull();
  });

  it('com a ilha de exportação aberta, a pill e a ilha têm o fundo forte; a Compartilhar não muda', async () => {
    const shell = await mount(() => undefined);

    part<HTMLButtonElement>(shell, 'export-button')?.click();
    await shell.updateComplete;

    expect(background(part(shell, 'export-button'))).toBe(STRONG);
    expect(background(part(shell, 'export-menu'))).toBe(STRONG);
    expect(background(part(shell, 'share-button'))).toBe(RESTING);

    part<HTMLButtonElement>(shell, 'export-button')?.click();
    await shell.updateComplete;

    expect(background(part(shell, 'export-button'))).toBe(RESTING);
    expect(part(shell, 'export-menu')).toBeNull();
  });

  it('o fundo forte é opaco: o canvas não aparece através da ilha', async () => {
    const shell = await mount((el) => {
      el.menuOpen = true;
    });

    expect(background(part(shell, 'menu-button'))).not.toMatch(/rgba/);
    expect(background(part(shell, 'menu'))).not.toMatch(/rgba/);
  });

  it('sobrescrever --canvash-surface-float-hover muda o botão e a ilha temporária abertos', async () => {
    const shell = await mount((el) => {
      el.style.setProperty('--canvash-surface-float-hover', 'rgb(10, 20, 30)');
      el.menuOpen = true;
    });

    expect(background(part(shell, 'menu-button'))).toBe('rgb(10, 20, 30)');
    expect(background(part(shell, 'menu'))).toBe('rgb(10, 20, 30)');
  });

  it('Exportar e Compartilhar desenham os ícones novos, com a cor do texto', async () => {
    const shell = await mount(() => undefined);
    const iconOf = (name: string) => part(shell, name)?.querySelector('svg') ?? null;

    expect(iconOf('export-button')?.getAttribute('viewBox')).toBe('0 0 18 18');
    expect(iconOf('share-button')?.getAttribute('viewBox')).toBe('0 0 256 256');
    expect(iconOf('export-button')?.getBoundingClientRect().width).toBe(20);
    expect(iconOf('share-button')?.getBoundingClientRect().width).toBe(16);
    for (const name of ['export-button', 'share-button']) {
      const path = iconOf(name)?.querySelector('path');
      expect(getComputedStyle(path as Element).fill).toBe(
        getComputedStyle(part(shell, name) as Element).color,
      );
    }
  });
});
