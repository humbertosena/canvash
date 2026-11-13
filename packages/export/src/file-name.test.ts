import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boardExportFileName } from './file-name.js';

// Nome de arquivo seguro a partir do título do board (spec board-export, §4.5 e US-BE.6).

const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

describe('boardExportFileName: a tabela do §4.5', () => {
  const rows: Array<[string, string, 'png' | 'svg', string]> = [
    ['título comum', 'Fluxo de aprovação', 'png', 'Fluxo de aprovação.png'],
    ['barras viram hífen', 'Relatório 2026/10/31', 'svg', 'Relatório 2026-10-31.svg'],
    [
      'dois-pontos, asterisco e interrogação',
      'Q3: metas * revisão?',
      'png',
      'Q3-metas-revisão.png',
    ],
    ['só espaços', '   ', 'png', 'board.png'],
    ['só pontos', '...', 'png', 'board.png'],
    ['extensão repetida em maiúsculas', 'logo.SVG', 'png', 'logo.png'],
    ['extensão com espaço no fim', 'logo.png ', 'png', 'logo.png'],
    ['extensão com ponto no fim', 'logo.png.', 'png', 'logo.png'],
    ['radical reservado', 'con', 'svg', 'con_.svg'],
    ['radical reservado antes do ponto', 'con.v2', 'png', 'con_.v2.png'],
    ['CONIN$ reservado', 'CONIN$', 'png', 'CONIN$_.png'],
    ['override de direção', 'a\u061Cb', 'png', 'ab.png'],
    ['emoji preservado', 'Plano 🚀', 'png', 'Plano 🚀.png'],
    ['corte em 100 pontos de código', 'a'.repeat(150), 'png', `${'a'.repeat(100)}.png`],
    ['corte que deixa ponto no fim', `${'a'.repeat(99)}.svgx`, 'png', `${'a'.repeat(99)}.png`],
    ['emoji de família que não cabe', `${'a'.repeat(99)}${FAMILY}`, 'png', `${'a'.repeat(99)}.png`],
    ['NFD vira NFC', 'Café', 'png', 'Café.png'],
  ];

  it.each(rows)('%s', (_name, title, format, expected) => {
    expect(boardExportFileName(title, format)).toBe(expected);
  });

  it('o título de exemplo da US-BE.9 dá o nome esperado', () => {
    expect(boardExportFileName('Fluxo de aprovação: v2/final', 'png')).toBe(
      'Fluxo de aprovação-v2-final.png',
    );
    expect(boardExportFileName('Fluxo de aprovação: v2/final', 'svg')).toBe(
      'Fluxo de aprovação-v2-final.svg',
    );
  });
});

describe('boardExportFileName: detalhes', () => {
  it('o emoji de família cabe quando há espaço, com os ZWJ', () => {
    expect(boardExportFileName(`a${FAMILY}`, 'png')).toBe(`a${FAMILY}.png`);
  });

  it('caracteres de controle viram espaço e os invisíveis saem', () => {
    expect(boardExportFileName('a\u0000b\u007Fc\u200Bd\uFEFFe\u202Ef', 'png')).toBe('a b cdef.png');
  });

  it('nomes reservados valem em qualquer caixa e com número', () => {
    expect(boardExportFileName('Com1', 'png')).toBe('Com1_.png');
    expect(boardExportFileName('lpt9.txt', 'png')).toBe('lpt9_.txt.png');
    expect(boardExportFileName('NUL', 'svg')).toBe('NUL_.svg');
    expect(boardExportFileName('console', 'png')).toBe('console.png');
  });

  it('um ZWJ solto no fim sai, e um no meio de emoji fica', () => {
    expect(boardExportFileName('a\u200D', 'png')).toBe('a.png');
    expect(boardExportFileName('\u200D.', 'png')).toBe('board.png');
  });

  it('o fallback passa pela mesma sanitização, e um fallback vazio cai em board', () => {
    expect(boardExportFileName('   ', 'png', { fallback: 'Sem/título' })).toBe('Sem-título.png');
    expect(boardExportFileName('   ', 'png', { fallback: 'con' })).toBe('con_.png');
    expect(boardExportFileName('   ', 'svg', { fallback: '  ..  ' })).toBe('board.svg');
    expect(boardExportFileName('x', 'svg', { fallback: 'fallback' })).toBe('x.svg');
  });

  it('é pura: a mesma entrada dá a mesma saída', () => {
    expect(boardExportFileName('Plano: A/B', 'png')).toBe(boardExportFileName('Plano: A/B', 'png'));
  });
});

describe('boardExportFileName: propriedades (US-BE.6)', () => {
  const pieces = fc.constantFrom(
    'a',
    'Z',
    '9',
    'é',
    ' ',
    '  ',
    '.',
    '-',
    '_',
    '<',
    '>',
    ':',
    '"',
    '/',
    '\\',
    '|',
    '?',
    '*',
    '\u0000',
    '\u001F',
    '\u007F',
    '\u0085',
    '\u061C',
    '\u200B',
    '\u200E',
    '\u202E',
    '\u2066',
    '\uFEFF',
    '\u200D',
    '🚀',
    FAMILY,
    '.png',
    '.svg',
    '.PNG',
    'con',
    'CON',
    'aux.',
    'nul',
    'COM1',
    'lpt3',
    'CONIN$',
    'CONOUT$',
    'prn',
  );
  const titles = fc.array(pieces, { minLength: 0, maxLength: 60 }).map((list) => list.join(''));

  const FORBIDDEN = /[<>:"/\\|?*]/;
  const hasUnsafe = (name: string): boolean =>
    [...name].some((char) => {
      const code = char.codePointAt(0)!;
      return (
        code <= 0x1f ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x61c ||
        code === 0x200b ||
        (code >= 0x200e && code <= 0x200f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069) ||
        code === 0xfeff
      );
    });
  const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])$/i;

  it.each(['png', 'svg'] as const)('o nome %s é sempre seguro', (format) => {
    fc.assert(
      fc.property(titles, (title) => {
        const name = boardExportFileName(title, format);
        const body = name.slice(0, -(format.length + 1));

        expect(name.endsWith(`.${format}`)).toBe(true);
        expect(FORBIDDEN.test(name)).toBe(false);
        expect(hasUnsafe(name)).toBe(false);
        expect([...name].length).toBeLessThanOrEqual(105);
        expect(/\.(png|svg)$/i.test(body)).toBe(false);
        expect(body.endsWith('\u200D')).toBe(false);
        expect(body.length).toBeGreaterThan(0);
        expect(/^[ .-]|[ .-]$/.test(body)).toBe(false);
        expect(RESERVED.test(body.split('.')[0]!)).toBe(false);
      }),
      { numRuns: 500, seed: 20261031 },
    );
  });

  it('é determinística', () => {
    fc.assert(
      fc.property(titles, (title) => {
        expect(boardExportFileName(title, 'png')).toBe(boardExportFileName(title, 'png'));
      }),
      { numRuns: 100, seed: 7 },
    );
  });
});
