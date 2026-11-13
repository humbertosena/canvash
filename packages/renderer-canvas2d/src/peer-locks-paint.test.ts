import { describe, expect, it, vi } from 'vitest';
import { paintPeerLocks, readableTextColor } from './peer-locks-paint.js';

describe('readableTextColor', () => {
  it('usa texto branco sobre cores escuras e escuro sobre cores claras', () => {
    expect(readableTextColor('#1d4ed8')).toBe('#ffffff');
    expect(readableTextColor('#dc2626')).toBe('#ffffff');
    expect(readableTextColor('#fde047')).toBe('#1f1f1f');
    expect(readableTextColor('#ffffff')).toBe('#1f1f1f');
    expect(readableTextColor('#0891b2')).toBe('#000000');
  });

  it('cai no branco quando a cor não é hexadecimal', () => {
    expect(readableTextColor('vermelho')).toBe('#ffffff');
  });
});

describe('paintPeerLocks', () => {
  const context = () =>
    ({
      save: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 30 })),
    }) as unknown as CanvasRenderingContext2D;

  it('não toca no contexto sem contornos', () => {
    const ctx = context();
    paintPeerLocks(ctx, { x: 0, y: 0, zoom: 1 }, []);

    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('coloca a etiqueta dentro da caixa quando não cabe acima dela', () => {
    const ctx = context();
    paintPeerLocks(ctx, { x: 0, y: 0, zoom: 1 }, [
      { bounds: { x: 5, y: 4, width: 10, height: 10 }, color: '#dc2626', name: 'Ana' },
    ]);

    expect(ctx.strokeRect).toHaveBeenCalledWith(5, 4, 10, 10);
    expect(ctx.fillRect).toHaveBeenCalledWith(5, 4, 42, 18);
  });

  it('coloca a etiqueta acima do canto quando há espaço', () => {
    const ctx = context();
    paintPeerLocks(ctx, { x: 0, y: 0, zoom: 2 }, [
      { bounds: { x: 10, y: 20, width: 10, height: 10 }, color: '#dc2626', name: 'Ana' },
    ]);

    expect(ctx.strokeRect).toHaveBeenCalledWith(20, 40, 20, 20);
    expect(ctx.fillRect).toHaveBeenCalledWith(20, 22, 42, 18);
  });
});
