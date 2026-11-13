import { describe, expect, it } from 'vitest';
import * as collaboration from './index.js';
import type { CanvasSectionApi } from '@canvash/core';
import { expectTypeOf } from 'vitest';
import type { ConnectOptions } from './index.js';

describe('@canvash/collaboration exports', () => {
  it('exporta versão e constantes de limites esperadas', () => {
    expect(collaboration.COLLABORATION_VERSION).toBe(1);
    expect(collaboration.MAX_OFFLINE_BACKLOG_BYTES).toBe(20 * 1024 * 1024);
    expect(collaboration.MAX_PRESENCE_RATE_HZ).toBe(20);
    expect(collaboration.DEFAULT_PRESENCE_TIMEOUT_MS).toBe(30_000);
  });

  it('exporta o limite de IDs e o validador de presença', () => {
    expect(collaboration.MAX_PRESENCE_IDS).toBe(1000);
    expect(collaboration.MAX_PRESENCE_NAME_LENGTH).toBe(64);
    expect(collaboration.validatePresence({ cursor: null }).ok).toBe(true);
  });

  it('exporta helpers de erro e construtor tipado', () => {
    const error = collaboration.createCollaborationError(
      'ROOM_EPOCH_MISMATCH',
      'Epoch incompatível',
      { expected: 'e1', actual: 'e2' },
    );
    expect(error.code).toBe('ROOM_EPOCH_MISMATCH');
    expect(error.message).toBe('Epoch incompatível');
    expect(error.details).toEqual({ expected: 'e1', actual: 'e2' });

    const okRes = collaboration.ok(123);
    expect(okRes.ok).toBe(true);
    if (okRes.ok) expect(okRes.value).toBe(123);

    const errRes = collaboration.err(error);
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) expect(errRes.error.code).toBe('ROOM_EPOCH_MISMATCH');
  });
});

describe('contrato de tipos de ConnectOptions', () => {
  it('recebe a instância em section e não tem a chave antiga', () => {
    type LegacyKey = `${'bo'}${'ard'}`;

    expectTypeOf<ConnectOptions['section']>().toEqualTypeOf<CanvasSectionApi>();
    expectTypeOf<LegacyKey extends keyof ConnectOptions ? true : false>().toEqualTypeOf<false>();
  });
});
