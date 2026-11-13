import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CanvasSectionElement } from './canvas-section.js';
import type { ShellParticipant } from './participants.js';

beforeAll(() => {
  if (!customElements.get('canvas-section'))
    customElements.define('canvas-section', CanvasSectionElement);
});

afterEach(() => {
  document.body.innerHTML = '';
});

const people: ShellParticipant[] = [
  { id: 'eu', name: 'Pessoa Exemplo', color: '#2563eb', self: true },
  { id: 'a', name: 'Ana Beatriz da Silva Pereira', color: '#dc2626' },
  { id: 'b', name: 'Caio', color: '#16a34a' },
];

async function mountShell(width: number, height: number): Promise<CanvasSectionElement> {
  const shell = document.createElement('canvas-section') as CanvasSectionElement;
  shell.style.cssText = `display:block;width:${width}px;height:${height}px`;
  shell.projectTitle = 'Um título de projeto razoavelmente longo';
  shell.participants = people;
  shell.sharing = 'on';
  shell.following = 'a';
  document.body.append(shell);
  await shell.updateComplete;
  return shell;
}

const rect = (shell: CanvasSectionElement, name: string) =>
  shell.shadowRoot!.querySelector(`[part~="${name}"]`)!.getBoundingClientRect();
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('<canvas-section>: faixa e moldura de seguir no navegador real', () => {
  it('a moldura de 2 px na cor da pessoa cobre a área e não captura o ponteiro', async () => {
    const shell = await mountShell(1024, 700);
    const frame = shell.shadowRoot!.querySelector<HTMLElement>('[part~="follow-frame"]')!;
    const style = getComputedStyle(frame);

    expect(style.pointerEvents).toBe('none');
    expect(style.boxShadow).toContain('rgb(220, 38, 38)');
    expect(style.boxShadow).toContain('2px');
    const box = frame.getBoundingClientRect();
    const host = shell.getBoundingClientRect();
    expect(Math.round(box.width)).toBe(Math.round(host.width));
    expect(Math.round(box.height)).toBe(Math.round(host.height));
  });

  it('o chip fica no centro, é um status e não cobre o título nem o cluster da direita', async () => {
    for (const [width, height] of [
      [1024, 768],
      [375, 667],
    ] as const) {
      {
        const shell = await mountShell(width, height);
        const banner = rect(shell, 'following-banner');
        const hostBox = shell.getBoundingClientRect();

        expect(overlaps(banner, rect(shell, 'title'))).toBe(false);
        expect(overlaps(banner, rect(shell, 'top-end'))).toBe(false);
        expect(overlaps(banner, rect(shell, 'menu-button'))).toBe(false);
        expect(banner.left).toBeGreaterThanOrEqual(hostBox.left);
        expect(banner.right).toBeLessThanOrEqual(hostBox.right);
        expect(
          Math.abs(banner.left + banner.width / 2 - (hostBox.left + hostBox.width / 2)),
        ).toBeLessThanOrEqual(1);
        const status = shell.shadowRoot!.querySelector(
          '[part~="following-banner"] [role="status"]',
        )!;
        expect(status.textContent).toBe('Seguindo Ana Beatriz da Silva Pereira');
        shell.remove();
      }
    }
  });

  it('Parar emite follow-change com null', async () => {
    const shell = await mountShell(1024, 768);
    const details: unknown[] = [];
    shell.addEventListener('follow-change', (event) => details.push((event as CustomEvent).detail));

    shell.shadowRoot!.querySelector<HTMLElement>('[part~="following-stop"]')!.click();

    expect(details).toEqual([{ sessionId: null }]);
  });

  it('a ilha mostra Seguindo (pressionado) para a pessoa seguida e Seguir para a outra', async () => {
    const shell = await mountShell(1024, 768);
    shell.shadowRoot!.querySelector<HTMLElement>('[part~="participants"]')!.click();
    await shell.updateComplete;

    const buttons = [...shell.shadowRoot!.querySelectorAll<HTMLElement>('[part~="follow-button"]')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Seguindo', 'Seguir']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });
});
