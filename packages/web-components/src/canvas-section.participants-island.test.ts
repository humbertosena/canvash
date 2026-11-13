import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSectionElement } from './canvas-section.js';
import { defaultI18nEnUS, defaultI18nPtBR } from './i18n.js';
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
  _participantsOpen: boolean;
  _participantsPinned: boolean;
  _participantsPointerEnter(event: { pointerType: string }): void;
  _participantsPointerLeave(event: { pointerType: string }): void;
  _toggleParticipants(): void;
  _closeParticipants(restoreFocus?: boolean): void;
  _stopSharing(): void;
  _followParticipant(id: string): void;
  willUpdate(changed: Map<string, unknown>): void;
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

function shell(participants: ShellParticipant[] = [me, person('a', 'Ana'), person('b', 'Caio')]) {
  const el = new CanvasSectionElement();
  el.participants = participants;
  el.sharing = 'on';
  return { el, internals: el as unknown as Internals };
}

const mouse = { pointerType: 'mouse' };

describe('<canvas-section>: ilha de participantes, abertura (US-PI.3, US-PI.4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('o hover abre em 80 ms e, ao sair, fecha em 250 ms', () => {
    const { internals } = shell();

    internals._participantsPointerEnter(mouse);
    vi.advanceTimersByTime(79);
    expect(internals._participantsOpen).toBe(false);
    vi.advanceTimersByTime(1);
    expect(internals._participantsOpen).toBe(true);
    expect(internals._participantsPinned).toBe(false);

    internals._participantsPointerLeave(mouse);
    vi.advanceTimersByTime(249);
    expect(internals._participantsOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(internals._participantsOpen).toBe(false);
  });

  it('voltar antes de 250 ms cancela o fechamento, e sair antes de 80 ms cancela a abertura', () => {
    const { internals } = shell();
    internals._participantsPointerEnter(mouse);
    internals._participantsPointerLeave(mouse);
    vi.advanceTimersByTime(500);
    expect(internals._participantsOpen).toBe(false);

    internals._participantsPointerEnter(mouse);
    vi.advanceTimersByTime(80);
    internals._participantsPointerLeave(mouse);
    vi.advanceTimersByTime(200);
    internals._participantsPointerEnter(mouse);
    vi.advanceTimersByTime(500);
    expect(internals._participantsOpen).toBe(true);
  });

  it('o toque não abre por hover', () => {
    const { internals } = shell();

    internals._participantsPointerEnter({ pointerType: 'touch' });
    vi.advanceTimersByTime(500);

    expect(internals._participantsOpen).toBe(false);
  });

  it('o clique abre fixado; sair com o ponteiro não fecha; o segundo clique fecha', () => {
    const { internals } = shell();

    internals._toggleParticipants();
    expect(internals._participantsOpen).toBe(true);
    expect(internals._participantsPinned).toBe(true);

    internals._participantsPointerLeave(mouse);
    vi.advanceTimersByTime(1000);
    expect(internals._participantsOpen).toBe(true);

    internals._toggleParticipants();
    expect(internals._participantsOpen).toBe(false);
    expect(internals._participantsPinned).toBe(false);
  });

  it('o clique fixa a ilha que o hover abriu', () => {
    const { internals } = shell();
    internals._participantsPointerEnter(mouse);
    vi.advanceTimersByTime(80);

    internals._toggleParticipants();
    internals._participantsPointerLeave(mouse);
    vi.advanceTimersByTime(1000);

    expect(internals._participantsOpen).toBe(true);
    expect(internals._participantsPinned).toBe(true);
  });

  it('fecha sozinha quando a pilha some (sharing off ou sem outras pessoas)', () => {
    const { el, internals } = shell();
    internals._toggleParticipants();

    el.sharing = 'off';
    internals.willUpdate(new Map([['sharing', 'on']]));
    expect(internals._participantsOpen).toBe(false);

    el.sharing = 'on';
    internals._toggleParticipants();
    el.participants = [me];
    internals.willUpdate(new Map([['participants', []]]));
    expect(internals._participantsOpen).toBe(false);
  });

  it('os listeners de clique fora e de Esc só existem com a ilha aberta', () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: remove });
    const { el, internals } = shell();

    expect(add).not.toHaveBeenCalled();
    internals._toggleParticipants();
    expect(add).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function));

    internals._closeParticipants();
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));

    internals._toggleParticipants();
    el.disconnectedCallback();
    expect(remove).toHaveBeenCalledTimes(4);
    expect(internals._participantsOpen).toBe(false);
  });

  it('desconectar cancela o timer do hover', () => {
    const { el, internals } = shell();
    internals._participantsPointerEnter(mouse);

    el.disconnectedCallback();
    vi.advanceTimersByTime(500);

    expect(internals._participantsOpen).toBe(false);
  });
});

describe('<canvas-section>: ilha de participantes, conteúdo e eventos (US-PI.3, US-PI.6)', () => {
  it('fechada, a ilha não é desenhada, e a pilha diz aria-expanded=false', () => {
    const { el } = shell();
    const html = templateText(el.render());

    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('aria-expanded=false');
  });

  it('aberta, mostra o diálogo com "Na sessão (N)", a pessoa local com "(você)" e os outros com Seguir', () => {
    const { el, internals } = shell();
    internals._toggleParticipants();

    const html = templateText(el.render());

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label=Participantes');
    expect(html).toContain('Na sessão (3)');
    expect(html).toContain('aria-expanded=true');
    expect(html).toContain('role="list"');
    expect(html.match(/part="participant-row"/g)).toHaveLength(3);
    expect(html).toContain('(você)');
    expect(html.match(/part="follow-button"/g)).toHaveLength(2);
    expect(html).toContain('part="share-stop-item"');
    expect(html).toContain('Parar compartilhamento');
    expect(html).toContain('role="separator"');
  });

  it('Parar compartilhamento emite share-stop uma vez, composto, e fecha a ilha', () => {
    const { el, internals } = shell();
    const events: CustomEvent[] = [];
    el.addEventListener('share-stop', (event) => events.push(event as CustomEvent));
    internals._toggleParticipants();

    internals._stopSharing();

    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({});
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);
    expect(internals._participantsOpen).toBe(false);
  });

  it('Seguir emite follow-change com o sessionId, sem fechar a ilha', () => {
    const { el, internals } = shell();
    const events: CustomEvent[] = [];
    el.addEventListener('follow-change', (event) => events.push(event as CustomEvent));
    internals._toggleParticipants();

    internals._followParticipant('a');

    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({ sessionId: 'a' });
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);
    expect(internals._participantsOpen).toBe(true);
  });

  it('mensagens em pt-BR e en', () => {
    expect(defaultI18nPtBR.shell.inSession(4)).toBe('Na sessão (4)');
    expect(defaultI18nPtBR.shell.you).toBe('(você)');
    expect(defaultI18nPtBR.shell.follow).toBe('Seguir');
    expect(defaultI18nPtBR.shell.following).toBe('Seguindo');
    expect(defaultI18nPtBR.shell.participantsDialog).toBe('Participantes');
    expect(defaultI18nEnUS.shell.inSession(4)).toBe('In session (4)');
    expect(defaultI18nEnUS.shell.you).toBe('(you)');
    expect(defaultI18nEnUS.shell.follow).toBe('Follow');
    expect(defaultI18nEnUS.shell.following).toBe('Following');
    expect(defaultI18nEnUS.shell.participantsDialog).toBe('Participants');
  });
});
