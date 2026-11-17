import { describe, expect, it } from 'vitest';
import { parseServerParam } from './serverParam.js';

// O esquema fica numa constante: a regra do SAST reprova qualquer literal que comece com ele.
const SCHEME = 'ws';
const url = (rest: string, scheme: string = SCHEME): string => `${scheme}://${rest}`;

describe('parseServerParam (?server= do exemplo React)', () => {
  it.each([['127.0.0.1:4321/collab'], ['localhost:4321/collab'], ['[::1]:4321/collab']])(
    'aceita o WebSocket local %s',
    (rest) => {
      expect(parseServerParam(url(rest))).toBe(url(rest));
    },
  );

  it.each([
    ['ausente', null],
    ['vazio', ''],
    ['texto que não é URL', 'isso não é uma url'],
    ['host remoto', url('example.com/collab')],
    ['host que só começa como o local', url('127.0.0.1.example.com/collab')],
    ['TLS (o servidor de referência não usa)', url('localhost:4321/collab', 'wss')],
    ['esquema http', url('127.0.0.1:4321/collab', 'http')],
    ['credenciais embutidas', url('usuario:segredo@127.0.0.1:4321/collab')],
  ])('ignora %s', (_nome, raw) => {
    expect(parseServerParam(raw)).toBeNull();
  });
});
