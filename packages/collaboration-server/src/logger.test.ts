import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleLogger } from './logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consoleLogger (padrão do servidor)', () => {
  it('escreve warn e error no console, com os campos, e não escreve info', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    consoleLogger.warn('aviso', { documentId: 'doc-1' });
    consoleLogger.error('erro', { code: 'X', size: 3 });
    consoleLogger.info?.('detalhe', { documentId: 'doc-1' });

    expect(warn).toHaveBeenCalledWith('[canvash-collab] aviso', { documentId: 'doc-1' });
    expect(error).toHaveBeenCalledWith('[canvash-collab] erro', { code: 'X', size: 3 });
    expect(info).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('sem campos, escreve só a mensagem', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    consoleLogger.warn('só a mensagem');

    expect(warn).toHaveBeenCalledWith('[canvash-collab] só a mensagem');
  });
});
