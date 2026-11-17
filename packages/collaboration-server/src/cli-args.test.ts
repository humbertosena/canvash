import { describe, expect, it } from 'vitest';
import { HELP_TEXT, parseCliArgs } from './cli-args.js';

describe('parseCliArgs', () => {
  it('sem argumentos, usa os padrões: 127.0.0.1:4321, pasta ./canvash-rooms e qualquer origem', () => {
    expect(parseCliArgs([])).toEqual({
      ok: true,
      value: {
        help: false,
        port: 4321,
        host: '127.0.0.1',
        data: './canvash-rooms',
        origins: undefined,
      },
    });
  });

  it('lê porta, host, pasta e origens, nas formas "--flag valor" e "--flag=valor"', () => {
    const parsed = parseCliArgs([
      '--port',
      '0',
      '--host=0.0.0.0',
      '--data',
      './salas',
      '--origin',
      'http://localhost:5173',
      '--origin=https://app.exemplo.test',
    ]);

    expect(parsed).toEqual({
      ok: true,
      value: {
        help: false,
        port: 0,
        host: '0.0.0.0',
        data: './salas',
        origins: ['http://localhost:5173', 'https://app.exemplo.test'],
      },
    });
  });

  it('--origin aceita uma lista separada por vírgula, sem espaços sobrando', () => {
    const parsed = parseCliArgs(['--origin', 'http://a.test, http://b.test ,,']);

    expect(parsed.ok && parsed.value.origins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('--help vale sozinho e ignora o resto', () => {
    expect(parseCliArgs(['--help'])).toMatchObject({ ok: true, value: { help: true } });
    expect(parseCliArgs(['--port', 'xx', '--help'])).toMatchObject({
      ok: true,
      value: { help: true },
    });
  });

  it.each([
    [['--port', '70000'], '--port'],
    [['--port', '-1'], '--port'],
    [['--port', 'abc'], '--port'],
    [['--port', '1.5'], '--port'],
    [['--port'], '--port'],
    [['--host'], '--host'],
    [['--data', ''], '--data'],
    [['--origin', ' , '], '--origin'],
    [['--nao-existe'], '--nao-existe'],
    [['solto'], 'solto'],
  ])('recusa %j citando %s', (args, mention) => {
    const parsed = parseCliArgs(args);

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toContain(mention);
  });

  it('o texto de ajuda diz que é para desenvolvimento e lista as opções', () => {
    expect(HELP_TEXT).toContain('DESENVOLVIMENTO');
    for (const flag of ['--port', '--host', '--data', '--origin', '--help']) {
      expect(HELP_TEXT).toContain(flag);
    }
  });
});
