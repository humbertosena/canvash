import { describe, expect, it } from 'vitest';
import { MAX_PRESENCE_IDS } from './limits.js';
import { validatePresence } from './validate-presence.js';

const reasonOf = (value: unknown, options?: Parameters<typeof validatePresence>[1]) => {
  const result = validatePresence(value, options);
  return result.ok ? null : result.error;
};

describe('validatePresence (US-PC.1)', () => {
  it('aceita uma presença sem os campos novos', () => {
    const result = validatePresence({
      cursor: { x: 10, y: 20 },
      selection: ['a'],
      userName: 'Ana',
      color: '#2563eb',
    });

    expect(result.ok).toBe(true);
  });

  it('aceita todos os campos novos válidos e os campos de identidade', () => {
    const result = validatePresence({
      sessionId: 's1',
      userId: 'u1',
      updatedAt: 1000,
      cursor: null,
      selection: [],
      selectedAt: 123,
      drag: { ids: ['a', 'b'], dx: 10, dy: -5 },
      view: { center: { x: 1, y: 2 }, zoom: 1.5 },
      avatarUrl: 'https://exemplo.com/a.png',
    });

    expect(result.ok).toBe(true);
  });

  it('aceita drag e view nulos', () => {
    expect(validatePresence({ drag: null, view: null }).ok).toBe(true);
  });

  it('trata campo opcional escrito como undefined como ausente', () => {
    expect(validatePresence({ userName: undefined, avatarUrl: undefined, cursor: null }).ok).toBe(
      true,
    );
  });

  it('recusa valores que não são objeto', () => {
    expect(reasonOf(null)?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf('x')?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf([])?.reason).toBe('INVALID_SHAPE');
  });

  it('recusa campo desconhecido', () => {
    expect(reasonOf({ cursor: null, extra: 1 })).toEqual({
      reason: 'UNKNOWN_FIELD',
      field: 'extra',
    });
  });

  it('recusa número não finito', () => {
    expect(reasonOf({ cursor: { x: NaN, y: 0 } })?.reason).toBe('NOT_FINITE');
    expect(reasonOf({ cursor: { x: 0, y: Infinity } })?.reason).toBe('NOT_FINITE');
    expect(reasonOf({ selectedAt: Infinity })?.reason).toBe('NOT_FINITE');
    expect(reasonOf({ drag: { ids: [], dx: NaN, dy: 0 } })?.reason).toBe('NOT_FINITE');
    expect(reasonOf({ view: { center: { x: 0, y: 0 }, zoom: NaN } })?.reason).toBe('NOT_FINITE');
  });

  it('recusa coordenada acima de maxCoordinate e respeita o limite informado', () => {
    expect(reasonOf({ cursor: { x: 10_000_001, y: 0 } })?.reason).toBe('OUT_OF_RANGE');
    expect(reasonOf({ drag: { ids: [], dx: 0, dy: -10_000_001 } })?.reason).toBe('OUT_OF_RANGE');
    expect(
      reasonOf({ view: { center: { x: 0, y: 99 }, zoom: 1 } }, { maxCoordinate: 50 })?.reason,
    ).toBe('OUT_OF_RANGE');
    expect(validatePresence({ cursor: { x: 10_000_000, y: 0 } }).ok).toBe(true);
  });

  it('recusa zoom não positivo', () => {
    expect(reasonOf({ view: { center: { x: 0, y: 0 }, zoom: 0 } })?.reason).toBe('OUT_OF_RANGE');
    expect(reasonOf({ view: { center: { x: 0, y: 0 }, zoom: -1 } })?.reason).toBe('OUT_OF_RANGE');
  });

  it('recusa mais de 1000 IDs na seleção e no arrasto', () => {
    const many = Array.from({ length: MAX_PRESENCE_IDS + 1 }, (_, i) => `n${i}`);
    expect(MAX_PRESENCE_IDS).toBe(1000);
    expect(reasonOf({ selection: many })?.reason).toBe('TOO_MANY_IDS');
    expect(reasonOf({ drag: { ids: many, dx: 0, dy: 0 } })?.reason).toBe('TOO_MANY_IDS');
    expect(validatePresence({ selection: many.slice(0, MAX_PRESENCE_IDS) }).ok).toBe(true);
  });

  it('recusa ids que não são texto', () => {
    expect(reasonOf({ selection: [1] })?.reason).toBe('INVALID_SHAPE');
  });

  it('recusa userName com mais de 64 caracteres', () => {
    expect(reasonOf({ userName: 'a'.repeat(65) })?.reason).toBe('NAME_TOO_LONG');
    expect(validatePresence({ userName: 'a'.repeat(64) }).ok).toBe(true);
  });

  it('recusa cor fora de #rrggbb', () => {
    for (const color of ['red', '#fff', '#12345g', 'rgb(0,0,0)', '#1234567']) {
      expect(reasonOf({ color })?.reason).toBe('INVALID_COLOR');
    }
  });

  it('aceita avatarUrl https, data:image/ e http da mesma origem; recusa o resto', () => {
    expect(validatePresence({ avatarUrl: 'https://x.com/a.png' }).ok).toBe(true);
    expect(validatePresence({ avatarUrl: 'data:image/png;base64,AAAA' }).ok).toBe(true);
    expect(
      validatePresence({ avatarUrl: 'http://app.local/a.png' }, { origin: 'http://app.local' }).ok,
    ).toBe(true);
    expect(
      reasonOf({ avatarUrl: 'http://outra.com/a.png' }, { origin: 'http://app.local' })?.reason,
    ).toBe('INVALID_AVATAR_URL');
    expect(reasonOf({ avatarUrl: 'http://app.local/a.png' })?.reason).toBe('INVALID_AVATAR_URL');
    expect(reasonOf({ avatarUrl: 'javascript:alert(1)' })?.reason).toBe('INVALID_AVATAR_URL');
    expect(reasonOf({ avatarUrl: 'data:text/html;base64,AAAA' })?.reason).toBe(
      'INVALID_AVATAR_URL',
    );
    expect(reasonOf({ avatarUrl: 'não é url' })?.reason).toBe('INVALID_AVATAR_URL');
  });

  it('recusa formas erradas dos campos estruturados', () => {
    expect(reasonOf({ cursor: 'x' })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ cursor: { x: 1 } })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ selection: 'a' })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ drag: { ids: 'a', dx: 0, dy: 0 } })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ view: { center: 3, zoom: 1 } })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ userName: 3 })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ sessionId: 3 })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ updatedAt: 'x' })?.reason).toBe('INVALID_SHAPE');
    expect(reasonOf({ avatarUrl: 3 })?.reason).toBe('INVALID_SHAPE');
  });

  it('devolve o campo que causou a recusa', () => {
    expect(reasonOf({ drag: { ids: [], dx: NaN, dy: 0 } })).toEqual({
      reason: 'NOT_FINITE',
      field: 'drag.dx',
    });
  });
});
