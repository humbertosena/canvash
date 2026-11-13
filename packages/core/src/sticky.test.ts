import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STICKY_SIZE,
  STICKY_COLORS,
  STICKY_PADDING,
  fitStickyFontSize,
  stickyFoldColor,
  stickyFoldSize,
  stickyTextColor,
  type StickyFitInput,
} from './sticky.js';
import { FONT_SIZE_PRESETS, layoutText } from './text.js';

/** Razão de contraste WCAG entre duas cores `#rrggbb`, calculada de forma independente. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const channel = (offset: number): number => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function note(overrides: Partial<StickyFitInput> = {}): StickyFitInput {
  return {
    text: 'Olá',
    width: 200,
    height: 200,
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    lineHeight: 1.25,
    ...overrides,
  };
}

describe('constantes da nota adesiva', () => {
  it('a paleta tem as 6 cores pastel, congelada, e o padrão é o amarelo', () => {
    expect(STICKY_COLORS).toEqual({
      yellow: '#fff59d',
      pink: '#f8bbd0',
      green: '#c8e6c9',
      blue: '#bbdefb',
      orange: '#ffcc80',
      purple: '#d1c4e9',
    });
    expect(Object.isFrozen(STICKY_COLORS)).toBe(true);
    expect(STICKY_PADDING).toBe(12);
    expect(DEFAULT_STICKY_SIZE).toBe(200);
  });
});

describe('stickyTextColor', () => {
  it('é escura nas 6 cores da paleta, com contraste de pelo menos 8,9:1 (o AAA pede 7:1)', () => {
    for (const fill of Object.values(STICKY_COLORS)) {
      const text = stickyTextColor(fill);
      expect(text).toBe('#1f2937');
      expect(contrast(fill, text)).toBeGreaterThanOrEqual(8.9);
    }
  });

  it('é clara sobre fundos escuros e escura sobre fundos claros', () => {
    expect(stickyTextColor('#000000')).toBe('#ffffff');
    expect(stickyTextColor('#4c1d95')).toBe('#ffffff');
    expect(stickyTextColor('#1e3a8a')).toBe('#ffffff');
    expect(stickyTextColor('#ffffff')).toBe('#1f2937');
    expect(stickyTextColor('#fde68a')).toBe('#1f2937');
  });

  it('escolhe sempre a cor de maior contraste', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), (rgb) => {
        const fill = `#${rgb.toString(16).padStart(6, '0')}`;
        const chosen = stickyTextColor(fill);
        const other = chosen === '#ffffff' ? '#1f2937' : '#ffffff';
        expect(contrast(fill, chosen)).toBeGreaterThanOrEqual(contrast(fill, other) - 1e-9);
      }),
      { numRuns: 300 },
    );
  });

  it('ignora o alfa e usa a escura sem cor ou com cor inválida', () => {
    expect(stickyTextColor('#000000ff')).toBe('#ffffff');
    expect(stickyTextColor('#ffffff00')).toBe('#1f2937');
    expect(stickyTextColor(null)).toBe('#1f2937');
    expect(stickyTextColor('amarelo')).toBe('#1f2937');
    expect(stickyTextColor('#fff')).toBe('#1f2937');
  });
});

describe('dobra da nota', () => {
  it('a cor da dobra é o fundo 12% mais escuro', () => {
    // 255·0,88 = 224,4 → e0; 245·0,88 = 215,6 → d8; 157·0,88 = 138,2 → 8a.
    expect(stickyFoldColor('#fff59d')).toBe('#e0d88a');
    expect(stickyFoldColor('#ffffff')).toBe('#e0e0e0');
    expect(stickyFoldColor('#000000')).toBe('#000000');
    expect(stickyFoldColor('#ffffff80')).toBe('#e0e0e0');
    expect(stickyFoldColor('amarelo')).toBe('amarelo');
  });

  it('a dobra é de 24, ou um quarto do menor lado quando a nota é pequena', () => {
    expect(stickyFoldSize({ width: 200, height: 200 })).toBe(24);
    expect(stickyFoldSize({ width: 60, height: 200 })).toBe(15);
    expect(stickyFoldSize({ width: 200, height: 40 })).toBe(10);
    expect(stickyFoldSize({ width: 96, height: 96 })).toBe(24);
  });
});

describe('fitStickyFontSize', () => {
  it('devolve o maior tamanho da lista que cabe na área útil', () => {
    // Área útil 176 × 176. "Olá" tem 3 caracteres: 1,8·s de largura; 96 → 172,8; 120 → 216.
    expect(fitStickyFontSize(note())).toBe(96);
    // Vazio: uma linha de altura 1,25·s ≤ 176 cabe até o maior da lista.
    expect(fitStickyFontSize(note({ text: '' }))).toBe(120);
  });

  it('um texto longo numa nota pequena cai para o menor da lista', () => {
    const long = 'Uma frase comprida demais para uma nota tão pequena assim '.repeat(8);
    expect(fitStickyFontSize(note({ text: long, width: 80, height: 60 }))).toBe(12);
    expect(fitStickyFontSize(note({ width: 20, height: 20 }))).toBe(12);
    expect(fitStickyFontSize(note({ width: 24, height: 500 }))).toBe(12);
  });

  it('uma palavra mais larga que a nota não passa do que cabe em largura', () => {
    // 11 caracteres sem espaço: 6,6·s ≤ 176 → s ≤ 26,6 → 24.
    expect(fitStickyFontSize(note({ text: 'Supercalifr' }))).toBe(24);
  });

  it('o resultado é sempre um tamanho da lista e o texto cabe nele (ou é o menor)', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 120 }).filter((value) => !/[<>]/.test(value)),
        fc.integer({ min: 30, max: 600 }),
        fc.integer({ min: 30, max: 600 }),
        (text, width, height) => {
          const fitted = fitStickyFontSize(note({ text, width, height }));
          expect(FONT_SIZE_PRESETS).toContain(fitted);
          if (fitted > FONT_SIZE_PRESETS[0]) {
            const layout = layoutText(text, {
              fontSize: fitted,
              fontFamily: 'sans-serif',
              fontWeight: 'normal',
              lineHeight: 1.25,
              maxWidth: width - 2 * STICKY_PADDING,
            });
            expect(layout.height).toBeLessThanOrEqual(height - 2 * STICKY_PADDING + 1e-9);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('é monotônico: mais texto não aumenta a fonte e uma nota maior não a diminui', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 80 }).filter((value) => !/[<>]/.test(value)),
        fc.string({ maxLength: 40 }).filter((value) => !/[<>]/.test(value)),
        fc.integer({ min: 60, max: 400 }),
        fc.integer({ min: 60, max: 400 }),
        fc.integer({ min: 0, max: 200 }),
        (text, extra, width, height, grow) => {
          const base = fitStickyFontSize(note({ text, width, height }));
          expect(
            fitStickyFontSize(note({ text: text + extra, width, height })),
          ).toBeLessThanOrEqual(base);
          expect(
            fitStickyFontSize(note({ text, width: width + grow, height: height + grow })),
          ).toBeGreaterThanOrEqual(base);
        },
      ),
      { numRuns: 150 },
    );
  });
});
