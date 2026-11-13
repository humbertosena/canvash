import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasSectionElement } from './canvas-section.js';
import type { ShellParticipant } from './participants.js';

beforeAll(() => {
  if (!customElements.get('canvas-section'))
    customElements.define('canvas-section', CanvasSectionElement);
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __xss?: boolean }).__xss;
});

const person = (
  id: string,
  name = id,
  extra: Partial<ShellParticipant> = {},
): ShellParticipant => ({
  id,
  name,
  color: '#2563eb',
  ...extra,
});
const me = person('eu', 'Pessoa Exemplo', { self: true });

async function mountShell(participants: ShellParticipant[]): Promise<CanvasSectionElement> {
  const shell = document.createElement('canvas-section') as CanvasSectionElement;
  shell.style.cssText = 'display:block;width:1000px;height:600px';
  shell.participants = participants;
  shell.sharing = 'on';
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

const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true }));

const open = async (shell: CanvasSectionElement) => {
  part(shell, 'participants')!.click();
  await shell.updateComplete;
};

describe('<canvas-section>: ilha de participantes no navegador real', () => {
  it('fica abaixo da pilha, alinhada à direita, com o nome acessível e os papéis certos', async () => {
    const shell = await mountShell([me, person('a', 'Ana'), person('b', 'Caio')]);
    await open(shell);

    const stack = part(shell, 'participants')!.getBoundingClientRect();
    const island = part(shell, 'participants-island')!;
    const box = island.getBoundingClientRect();

    expect(island.getAttribute('role')).toBe('dialog');
    expect(island.getAttribute('aria-label')).toBe('Participantes');
    expect(part(shell, 'participants-list')!.getAttribute('role')).toBe('list');
    expect(part(shell, 'participants')!.getAttribute('aria-expanded')).toBe('true');
    expect(box.top).toBeGreaterThanOrEqual(stack.bottom);
    expect(Math.abs(box.right - stack.right)).toBeLessThanOrEqual(1);
    expect(part(shell, 'participants-title')!.textContent?.trim()).toBe('Na sessão (3)');
  });

  it('a pessoa local vem primeiro, com "(você)" e sem Seguir', async () => {
    const shell = await mountShell([person('a', 'Ana'), me, person('b', 'Caio')]);
    await open(shell);

    const rows = parts(shell, 'participant-row');
    expect(rows.map((row) => row.dataset['sessionId'])).toEqual(['eu', 'a', 'b']);
    expect(rows[0]!.textContent).toContain('(você)');
    expect(rows[0]!.querySelector('[part~="follow-button"]')).toBeNull();
    expect(rows[1]!.querySelector('[part~="follow-button"]')).not.toBeNull();
  });

  it('acima de 8 linhas a lista rola, e o título e o Parar continuam à vista', async () => {
    const many = Array.from({ length: 12 }, (_, i) => person(`p${i}`, `Pessoa ${i}`));
    const shell = await mountShell([me, ...many]);
    await open(shell);

    const list = part(shell, 'participants-list')!;
    const island = part(shell, 'participants-island')!.getBoundingClientRect();
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(list.clientHeight).toBeLessThanOrEqual(8 * 40 + 1);
    const stop = part(shell, 'share-stop-item')!.getBoundingClientRect();
    const title = part(shell, 'participants-title')!.getBoundingClientRect();
    expect(stop.bottom).toBeLessThanOrEqual(island.bottom);
    expect(title.top).toBeGreaterThanOrEqual(island.top);
  });

  it('abre pelo teclado com seta para baixo, percorre os controles e Esc devolve o foco à pilha', async () => {
    const shell = await mountShell([me, person('a', 'Ana'), person('b', 'Caio')]);
    const stack = part(shell, 'participants')!;
    stack.focus();

    key(stack, 'ArrowDown');
    await shell.updateComplete;
    const follows = parts(shell, 'follow-button');
    const stop = part(shell, 'share-stop-item')!;
    expect(shell.shadowRoot!.activeElement).toBe(follows[0]);

    key(follows[0]!, 'ArrowDown');
    expect(shell.shadowRoot!.activeElement).toBe(follows[1]);
    key(follows[1]!, 'ArrowDown');
    expect(shell.shadowRoot!.activeElement).toBe(stop);
    key(stop, 'ArrowDown');
    expect(shell.shadowRoot!.activeElement).toBe(follows[0]);
    key(follows[0]!, 'ArrowUp');
    expect(shell.shadowRoot!.activeElement).toBe(stop);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await shell.updateComplete;
    expect(part(shell, 'participants-island')).toBeNull();
    expect(shell.shadowRoot!.activeElement).toBe(stack);
  });

  it('o clique fora fecha, e o clique dentro não', async () => {
    const shell = await mountShell([me, person('a', 'Ana')]);
    await open(shell);

    part(shell, 'participants-title')!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true }),
    );
    await shell.updateComplete;
    expect(part(shell, 'participants-island')).not.toBeNull();

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await shell.updateComplete;
    expect(part(shell, 'participants-island')).toBeNull();
  });

  it('a lista atualiza sem fechar a ilha, e o foco numa linha que saiu vai para a seguinte (US-PI.5)', async () => {
    const shell = await mountShell([
      me,
      person('a', 'Ana'),
      person('b', 'Caio'),
      person('c', 'Eva'),
    ]);
    await open(shell);
    const follows = parts(shell, 'follow-button');
    follows[1]!.focus();

    shell.participants = [me, person('a', 'Ana'), person('c', 'Eva')];
    await shell.updateComplete;

    expect(part(shell, 'participants-island')).not.toBeNull();
    expect(parts(shell, 'participant-row')).toHaveLength(3);
    const after = parts(shell, 'follow-button');
    expect(shell.shadowRoot!.activeElement).toBe(after[1]);
    expect(after[1]!.closest<HTMLElement>('[data-session-id]')!.dataset['sessionId']).toBe('c');

    // Sem nenhuma outra pessoa, a pilha some e leva a ilha junto.
    shell.participants = [me];
    await shell.updateComplete;
    expect(part(shell, 'participants')).toBeNull();
    expect(part(shell, 'participants-island')).toBeNull();
  });

  it('o foco numa linha que saiu e era a última vai ao Parar', async () => {
    const shell = await mountShell([me, person('a', 'Ana'), person('b', 'Caio')]);
    await open(shell);
    parts(shell, 'follow-button')[1]!.focus();

    shell.participants = [me, person('a', 'Ana')];
    await shell.updateComplete;

    expect(shell.shadowRoot!.activeElement).toBe(part(shell, 'share-stop-item'));
  });

  it('nome com marcação aparece como texto, e foto que falha cai nas iniciais (US-PI.7)', async () => {
    const markup = '<img src=x onerror="window.__xss = true"><b>Ana</b>';
    const shell = await mountShell([
      me,
      person('a', markup, { avatarUrl: 'http://127.0.0.1:1/nao-existe.png' }),
    ]);
    await open(shell);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await shell.updateComplete;

    const name = parts(shell, 'participant-name')[1]!;
    expect(name.textContent?.trim()).toBe(markup);
    expect(name.querySelector('img, b')).toBeNull();
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
    expect(shell.shadowRoot!.querySelectorAll('[part~="participant-image"]')).toHaveLength(0);
    const rowAvatar = parts(shell, 'participant-row')[1]!.querySelector(
      '[part~="participant-avatar"]',
    )!;
    expect(rowAvatar.textContent?.trim().length).toBeGreaterThan(0);
    expect(rowAvatar.querySelector('img')).toBeNull();
  });

  it('Parar compartilhamento emite share-stop e a pilha some quando o host passa off', async () => {
    const shell = await mountShell([me, person('a', 'Ana')]);
    let stops = 0;
    shell.addEventListener('share-stop', () => stops++);
    await open(shell);

    part(shell, 'share-stop-item')!.click();
    await shell.updateComplete;
    expect(stops).toBe(1);
    expect(part(shell, 'participants-island')).toBeNull();

    shell.sharing = 'off';
    await shell.updateComplete;
    expect(part(shell, 'participants')).toBeNull();
  });
});
