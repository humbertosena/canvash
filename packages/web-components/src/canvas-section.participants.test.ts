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

function shellWith(
  participants: ShellParticipant[],
  sharing: 'off' | 'connecting' | 'on' = 'on',
): CanvasSectionElement {
  const el = new CanvasSectionElement();
  el.participants = participants;
  el.sharing = sharing;
  return el;
}

const stackIn = (el: CanvasSectionElement) => templateText(el.render());

describe('<canvas-section>: pilha de avatares (US-PI.1, US-PI.2)', () => {
  it('só aparece em sharing=on e com pelo menos um participante remoto', () => {
    expect(stackIn(shellWith([me, person('a')], 'on'))).toContain('part="participants"');
    expect(stackIn(shellWith([me, person('a')], 'off'))).not.toContain('part="participants"');
    expect(stackIn(shellWith([me, person('a')], 'connecting'))).not.toContain(
      'part="participants"',
    );
    expect(stackIn(shellWith([me], 'on'))).not.toContain('part="participants"');
    expect(stackIn(shellWith([], 'on'))).not.toContain('part="participants"');
  });

  it('hide-participants esconde a pilha mesmo com participantes', () => {
    const el = shellWith([me, person('a')]);
    el.hideParticipants = true;
    const properties = CanvasSectionElement.properties as unknown as Record<
      string,
      { attribute?: string; reflect?: boolean }
    >;

    expect(stackIn(el)).not.toContain('part="participants"');
    expect(properties['hideParticipants']?.attribute).toBe('hide-participants');
    expect(properties['hideParticipants']?.reflect).toBe(true);
    expect(new CanvasSectionElement().hideParticipants).toBe(false);
    expect(new CanvasSectionElement().participants).toEqual([]);
  });

  it('com 5 remotos mostra 3 avatares e "+2", e o nome acessível diz "5 outras pessoas"', () => {
    const html = stackIn(shellWith([me, ...['a', 'b', 'c', 'd', 'e'].map((id) => person(id))]));

    expect(html.match(/part="participant-avatar"/g)).toHaveLength(3);
    expect(html).toContain('part="participants-more"');
    expect(html).toContain('>+2<');
    expect(html).toContain('aria-label=Participantes: 5 outras pessoas na sessão');
  });

  it('com 3 ou menos remotos não há "+N"', () => {
    const html = stackIn(shellWith([me, person('a'), person('b')]));

    expect(html.match(/part="participant-avatar"/g)).toHaveLength(2);
    expect(html).not.toContain('participants-more');
  });

  it('o botão é um popup de diálogo, fechado, com o nome de cada pessoa no title', () => {
    const html = stackIn(shellWith([me, person('a', 'Ana B')]));

    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded=false');
    expect(html).toContain('title=Ana B');
  });

  it('cada avatar tem anel na cor do participante, iniciais e contraste', () => {
    const html = stackIn(
      shellWith([
        me,
        person('a', 'Ana Beatriz', { color: '#fde047' }),
        person('b', 'Caio', { color: '#1d4ed8' }),
      ]),
    );

    expect(html).toContain('--ring: #fde047');
    expect(html).toContain('--ring: #1d4ed8');
    expect(html).toMatch(/>\s*AB\s*</);
    expect(html).toMatch(/>\s*C\s*</);
    expect(html).toContain('color: #1f1f1f');
    expect(html).toContain('color: #ffffff');
  });

  it('a pessoa com foto mostra a imagem, e as iniciais ficam para quando ela falhar', () => {
    const html = stackIn(shellWith([me, person('a', 'Ana', { avatarUrl: 'https://x.com/a.png' })]));

    expect(html).toContain('part="participant-image"');
    expect(html).toContain('src=https://x.com/a.png');
  });

  it('uma foto que falhou cai nas iniciais', () => {
    const el = shellWith([me, person('a', 'Ana', { avatarUrl: 'https://x.com/a.png' })]);
    (el as unknown as { _failedPhotos: Set<string> })._failedPhotos = new Set(['a']);

    const html = stackIn(el);

    expect(html).not.toContain('participant-image');
    expect(html).toMatch(/>\s*A\s*</);
  });

  it('a pilha fica entre o slot actions e a pill Compartilhar', () => {
    const html = stackIn(shellWith([me, person('a')]));

    expect(html.indexOf('<slot name="actions">')).toBeLessThan(html.indexOf('part="participants"'));
    expect(html.indexOf('part="participants"')).toBeLessThan(html.indexOf('part="share-button"'));
  });

  it('mensagens em pt-BR e en, com singular e plural', () => {
    expect(defaultI18nPtBR.shell.participants(1)).toBe('Participantes: 1 outra pessoa na sessão');
    expect(defaultI18nPtBR.shell.participants(3)).toBe('Participantes: 3 outras pessoas na sessão');
    expect(defaultI18nEnUS.shell.participants(1)).toBe(
      'Participants: 1 other person in the session',
    );
    expect(defaultI18nEnUS.shell.participants(2)).toBe(
      'Participants: 2 other people in the session',
    );
  });

  it('tokens e partes novos entram na API de tema', () => {
    expect(CANVASH_CSS_TOKENS.avatarStackSize).toBe('--canvash-avatar-stack-size');
    expect(CANVASH_CSS_TOKENS.avatarRingWidth).toBe('--canvash-avatar-ring-width');
    expect(CANVASH_PARTS.shell).toEqual(
      expect.arrayContaining([
        'participants',
        'participant-avatar',
        'participant-image',
        'participants-more',
      ]),
    );
  });
});
