import { describe, expect, it } from 'vitest';
import {
  MAX_STACK_AVATARS,
  initialsOf,
  initialsTextColor,
  stackOf,
  type ShellParticipant,
} from './participants.js';

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

describe('stackOf: quem aparece na pilha de avatares', () => {
  it('a pessoa local nunca entra na pilha, só os outros', () => {
    const stack = stackOf([person('eu', 'Eu', { self: true }), person('a'), person('b')]);

    expect(stack.remotes.map((p) => p.id)).toEqual(['a', 'b']);
    expect(stack.shown.map((p) => p.id)).toEqual(['a', 'b']);
    expect(stack.extra).toBe(0);
  });

  it('mostra até 3 e conta o resto em "+N", mantendo a ordem de chegada', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id));

    const stack = stackOf(list);

    expect(MAX_STACK_AVATARS).toBe(3);
    expect(stack.shown.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(stack.extra).toBe(2);
    expect(stack.remotes).toHaveLength(5);
  });

  it('a pessoa seguida vem sempre primeiro', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => person(id));

    const stack = stackOf(list, 'c');

    expect(stack.shown.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(stack.extra).toBe(1);
  });

  it('um seguido que não está na lista não muda a ordem', () => {
    expect(stackOf([person('a'), person('b')], 'fantasma').shown.map((p) => p.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('lista vazia, sem outros', () => {
    expect(stackOf([]).remotes).toEqual([]);
    expect(stackOf([person('eu', 'Eu', { self: true })]).remotes).toEqual([]);
  });
});

describe('iniciais e contraste', () => {
  it('iniciais: primeira letra da primeira e da última palavra', () => {
    expect(initialsOf('Ana Beatriz Costa')).toBe('AC');
    expect(initialsOf('  ana  ')).toBe('A');
    expect(initialsOf('')).toBe('?');
  });

  it('texto branco quando a cor dá contraste AA, escuro quando não dá', () => {
    expect(initialsTextColor('#2563eb')).toBe('#ffffff');
    expect(initialsTextColor('#dc2626')).toBe('#ffffff');
    expect(initialsTextColor('#fde047')).toBe('#1f1f1f');
    // Tom médio (o azul-petróleo da paleta): nem branco nem #1f1f1f chegam a 4,5:1.
    expect(initialsTextColor('#0891b2')).toBe('#000000');
    expect(initialsTextColor('#ffffff')).toBe('#1f1f1f');
    expect(initialsTextColor('amarelo')).toBe('#1f1f1f');
  });
});
