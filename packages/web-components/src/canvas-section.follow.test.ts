import { describe, expect, it } from 'vitest';
import { CanvasSectionElement } from './canvas-section.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';
import { CANVASH_CSS_TOKENS, CANVASH_PARTS } from './theme.js';
import type { ShellParticipant } from './participants.js';

function templateText(result: unknown): string {
  if (Array.isArray(result)) return result.map(templateText).join('');
  if (result && typeof result === 'object' && 'strings' in result && 'values' in result) {
    const { strings, values } = result as { strings: readonly string[]; values: unknown[] };
    return strings.reduce(
      (text, part, i) => text + part + (i < values.length ? templateText(values[i]) : ''),
      '',
    );
  }
  if (typeof result === 'function' || result === undefined || result === null) return '';
  if (typeof result === 'symbol') return '';
  return String(result);
}

interface Internals {
  _toggleParticipants(): void;
  _followParticipant(id: string): void;
  _stopFollowing(): void;
}

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

function shell(extra: Partial<{ following: string | null }> = {}, open = true) {
  const el = new CanvasSectionElement();
  el.sharing = 'on';
  el.participants = [me, person('a', 'Ana', { color: '#dc2626' }), person('b', 'Caio')];
  if (extra.following !== undefined) el.following = extra.following;
  const internals = el as unknown as Internals;
  if (open) internals._toggleParticipants();
  return { el, internals, html: () => templateText(el.render()) };
}

describe('<canvas-section>: seguir (US-FP.1, US-FP.8)', () => {
  it('following começa nulo e é só propriedade', () => {
    const el = new CanvasSectionElement();
    const properties = CanvasSectionElement.properties as unknown as Record<
      string,
      { attribute?: unknown }
    >;

    expect(el.following).toBeNull();
    expect(properties['following']?.attribute).toBe(false);
  });

  it('sem seguir, a ilha mostra Seguir com aria-pressed=false e não há faixa nem moldura', () => {
    const { html } = shell();

    expect(html()).not.toContain('part="following-banner"');
    expect(html()).not.toContain('part="follow-frame"');
    expect(html().match(/aria-pressed=false/g)).toHaveLength(2);
    expect(html()).not.toContain('Seguindo');
  });

  it('seguindo alguém, o botão dela vira Seguindo (aria-pressed=true) e o outro segue Seguir', () => {
    const { html } = shell({ following: 'a' });
    const text = html();

    expect(text.match(/aria-pressed=true/g)).toHaveLength(1);
    expect(text.match(/aria-pressed=false/g)).toHaveLength(1);
    expect(text).toMatch(/>\s*Seguindo\s*</);
  });

  it('mostra a faixa "Seguindo <Nome>" com o botão Parar e a moldura na cor dela', () => {
    const { html } = shell({ following: 'a' }, false);
    const text = html();

    expect(text).toContain('part="following-banner"');
    expect(text).toContain('role="status"');
    expect(text).toContain('Seguindo Ana');
    expect(text).toContain('part="following-stop"');
    expect(text).toContain('part="follow-frame"');
    expect(text).toContain('--follow-color: #dc2626');
  });

  it('a pessoa seguida vem primeiro na pilha', () => {
    const { html } = shell({ following: 'b' }, false);
    const text = html();

    expect(text.indexOf('data-session-id=b')).toBeLessThan(text.indexOf('data-session-id=a'));
  });

  it('sem a pessoa seguida na lista, ou com o compartilhamento desligado, não há faixa', () => {
    const missing = shell({ following: 'fantasma' }, false);
    expect(missing.html()).not.toContain('part="following-banner"');

    const off = shell({ following: 'a' }, false);
    off.el.sharing = 'off';
    expect(off.html()).not.toContain('part="following-banner"');
    expect(off.html()).not.toContain('part="follow-frame"');
  });

  it('quem não publica a vista fica com o botão desabilitado e o título explicativo (US-FP.8)', () => {
    const el = new CanvasSectionElement();
    el.sharing = 'on';
    el.participants = [me, person('a', 'Ana', { canFollow: false }), person('b', 'Caio')];
    (el as unknown as Internals)._toggleParticipants();

    const text = templateText(el.render());

    expect(text).toContain('title=Versão sem suporte a seguir');
    expect(text.match(/\bdisabled\b/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('Seguir emite follow-change com o id; Seguindo e Parar emitem null', () => {
    const { el, internals } = shell({ following: 'a' });
    const details: unknown[] = [];
    el.addEventListener('follow-change', (event) => details.push((event as CustomEvent).detail));

    internals._followParticipant('b');
    internals._followParticipant('a');
    internals._stopFollowing();

    expect(details).toEqual([{ sessionId: 'b' }, { sessionId: null }, { sessionId: null }]);
  });

  it('mensagens em pt-BR e en', () => {
    expect(defaultI18nPtBR.shell.followingBanner('Ana')).toBe('Seguindo Ana');
    expect(defaultI18nPtBR.shell.stopFollowing).toBe('Parar');
    expect(defaultI18nPtBR.shell.followLeft('Ana')).toBe('Ana saiu; você parou de seguir');
    expect(defaultI18nPtBR.shell.followUnsupported).toBe('Versão sem suporte a seguir');
    expect(defaultI18nEnUS.shell.followingBanner('Ana')).toBe('Following Ana');
    expect(defaultI18nEnUS.shell.stopFollowing).toBe('Stop');
    expect(defaultI18nEnUS.shell.followLeft('Ana')).toBe('Ana left; you stopped following');
    expect(defaultI18nEnUS.shell.followUnsupported.length).toBeGreaterThan(0);
  });

  it('token e partes novos entram na API de tema', () => {
    expect(CANVASH_CSS_TOKENS.followFrameWidth).toBe('--canvash-follow-frame-width');
    expect(CANVASH_PARTS.shell).toEqual(
      expect.arrayContaining(['following-banner', 'following-stop', 'follow-frame']),
    );
  });
});
