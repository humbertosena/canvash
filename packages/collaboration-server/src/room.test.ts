import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Room } from './room.js';

function roomWith(label: string): Room {
  const doc = new Y.Doc();
  doc.getMap('meta').set(`marca:${label}`, label);
  return new Room('doc-1', 'epoch-1', doc, new Map());
}

describe('Room: cópia de validação (ACK dentro do gatilho, SPEC-collab-server decisão 1)', () => {
  it('nasce igual ao documento da sala e é reaproveitada: a cópia do estado inteiro acontece uma vez', () => {
    const room = roomWith('a');

    const first = room.validationDoc();
    const second = room.validationDoc();

    expect(second).toBe(first);
    expect(first).not.toBe(room.doc);
    expect(first.getMap('meta').get('marca:a')).toBe('a');
  });

  it('o que se aplica na cópia não aparece na sala, e a cópia descartada volta a nascer da sala', () => {
    const room = roomWith('a');
    const stale = room.validationDoc();
    stale.getMap('meta').set('so-na-copia', true);

    room.discardValidationDoc();
    const fresh = room.validationDoc();

    expect(room.doc.getMap('meta').has('so-na-copia')).toBe(false);
    expect(fresh).not.toBe(stale);
    expect(fresh.getMap('meta').has('so-na-copia')).toBe(false);
    expect(fresh.getMap('meta').get('marca:a')).toBe('a');
  });

  it('descartar sem cópia é inofensivo, e a cópia nova acompanha o estado atual da sala', () => {
    const room = roomWith('a');
    room.discardValidationDoc();
    room.doc.getMap('meta').set('depois', 'sim');

    const copy = room.validationDoc();

    expect(copy.getMap('meta').get('depois')).toBe('sim');
  });

  it('destroy solta o documento da sala e a cópia', () => {
    const room = roomWith('a');
    const copy = room.validationDoc();
    let destroyed = 0;
    room.doc.on('destroy', () => {
      destroyed += 1;
    });
    copy.on('destroy', () => {
      destroyed += 1;
    });

    room.destroy();
    room.destroy();

    expect(destroyed).toBe(2);
  });

  it('destroy sem cópia solta só o documento da sala', () => {
    const room = roomWith('a');
    let destroyed = 0;
    room.doc.on('destroy', () => {
      destroyed += 1;
    });

    room.destroy();

    expect(destroyed).toBe(1);
  });
});
