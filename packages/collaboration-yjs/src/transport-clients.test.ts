import { describe, expect, it } from 'vitest';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';

describe('DeterministicTransportHub: clientes registrados', () => {
  const makeHub = () => new DeterministicTransportHub(new CollaborativeServerEmulator('epoch-1'));

  it('começa sem clientes e conta os registros', () => {
    const hub = makeHub();
    expect(hub.getClientCount()).toBe(0);

    hub.registerClient('a', () => {});
    hub.registerClient('b', () => {});

    expect(hub.getClientCount()).toBe(2);
  });

  it('registrar o mesmo id duas vezes conta uma vez', () => {
    const hub = makeHub();
    hub.registerClient('a', () => {});
    hub.registerClient('a', () => {});

    expect(hub.getClientCount()).toBe(1);
  });

  it('desregistrar volta a contagem e desregistrar de novo é inofensivo', () => {
    const hub = makeHub();
    hub.registerClient('a', () => {});

    hub.unregisterClient('a');
    hub.unregisterClient('a');

    expect(hub.getClientCount()).toBe(0);
  });

  it('destroy zera a contagem', () => {
    const hub = makeHub();
    hub.registerClient('a', () => {});
    hub.destroy();

    expect(hub.getClientCount()).toBe(0);
  });
});
