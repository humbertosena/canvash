import { createCanvasSection, validateDocument, type CanvasDocument } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initYjsDocument } from './crdt-schema.js';
import { projectYDocToCanvasDocument } from './projection.js';
import { YjsCollaborationProvider } from './provider.js';
import { encodeCanvasDocumentAsYjsState, projectYjsStateToCanvasDocument } from './seed.js';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { YjsCollaborationSession } from './session.js';
import { DeterministicTransportHub } from './transport.js';

async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

/** Um documento salvo, como o host o teria no banco: duas camadas, `id` próprio. */
function savedDocument(): CanvasDocument {
  const section = createCanvasSection();
  for (const [index, id] of ['r1', 'r2', 'r3'].entries()) {
    const created = section.dispatch({
      type: 'shape.create',
      shape: {
        id,
        type: 'rectangle',
        x: index * 20,
        y: 5,
        width: 10,
        height: 10,
        rotation: 0,
      },
    });
    if (!created.ok) throw new Error(`não criou ${id}`);
  }
  const base = section.getSnapshot().document;
  const layer = base.layers[0];
  if (layer === undefined) throw new Error('documento sem camada');
  const document: CanvasDocument = {
    ...base,
    id: 'desenho-42',
    layers: [
      { ...layer, id: 'camada-fundo', name: 'Fundo', childIds: ['r1', 'r2'] },
      { ...layer, id: 'camada-frente', name: 'Frente', childIds: ['r3'] },
    ],
  };
  const checked = validateDocument(document);
  if (!checked.ok) throw new Error('o documento de teste não é válido');
  return document;
}

function addRect(section: ReturnType<typeof createCanvasSection>, id: string): void {
  const result = section.dispatch({
    type: 'shape.create',
    shape: { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  });
  if (!result.ok) throw new Error(`não criou ${id}`);
}

describe('semeadura e projeção por função pública (US-P.14, R11)', () => {
  it('JSON → estado → JSON preserva id, camadas e nós, sem camada a mais', () => {
    const document = savedDocument();

    const state = encodeCanvasDocumentAsYjsState(document);
    if (!state.ok) throw new Error(state.error.code);
    const projected = projectYjsStateToCanvasDocument(state.value);

    if (!projected.ok) throw new Error(projected.error.code);
    expect(projected.value.id).toBe('desenho-42');
    expect(projected.value.layers.map((layer) => layer.id)).toEqual([
      'camada-fundo',
      'camada-frente',
    ]);
    expect(projected.value.layers).toEqual(document.layers);
    expect(projected.value.nodes).toEqual(document.nodes);
    expect(projected.value).toEqual(document);
  });

  it('o estado é um Uint8Array que qualquer Y.Doc aplica, e cada chamada gera um estado novo', () => {
    const document = savedDocument();

    const first = encodeCanvasDocumentAsYjsState(document);
    const second = encodeCanvasDocumentAsYjsState(document);

    if (!first.ok || !second.ok) throw new Error('semeadura recusada');
    expect(first.value).toBeInstanceOf(Uint8Array);
    expect(second.value).not.toEqual(first.value);
    const room = new Y.Doc();
    Y.applyUpdate(room, first.value);
    expect(projectYDocToCanvasDocument(room).nodes).toEqual(document.nodes);
  });

  it('documento inválido volta como INVALID_DOCUMENT, sem lançar', () => {
    const broken = { schemaVersion: 1, id: 'x', layers: 'nenhuma', nodes: {} };

    const result = encodeCanvasDocumentAsYjsState(broken as unknown as CanvasDocument);
    const nothing = encodeCanvasDocumentAsYjsState(null as unknown as CanvasDocument);

    expect(!result.ok && result.error.code).toBe('INVALID_DOCUMENT');
    expect(!nothing.ok && nothing.error.code).toBe('INVALID_DOCUMENT');
  });

  it('bytes que não são estado Yjs, e estado que não projeta em documento, voltam como INVALID_DOCUMENT', () => {
    const garbage = projectYjsStateToCanvasDocument(new Uint8Array([255, 254, 253]));
    const malformed = new Y.Doc();
    malformed.getMap('shapes').set('r1', 'isto não é um registro');

    const unprojectable = projectYjsStateToCanvasDocument(Y.encodeStateAsUpdate(malformed));

    expect(!garbage.ok && garbage.error.code).toBe('INVALID_DOCUMENT');
    expect(!unprojectable.ok && unprojectable.error.code).toBe('INVALID_DOCUMENT');
  });

  it('sala criada pela sessão, sem id guardado, continua projetando collab-doc', () => {
    const room = new Y.Doc();
    initYjsDocument(room, 'epoch-1');

    expect(projectYDocToCanvasDocument(room).id).toBe('collab-doc');
    const projected = projectYjsStateToCanvasDocument(Y.encodeStateAsUpdate(room));
    expect(projected.ok && projected.value.id).toBe('collab-doc');
  });

  it('sala semeada pelo servidor: o cliente recebe o documento e as edições mantêm o id', async () => {
    const document = savedDocument();
    const state = encodeCanvasDocumentAsYjsState(document);
    if (!state.ok) throw new Error(state.error.code);
    const roomDoc = new Y.Doc();
    Y.applyUpdate(roomDoc, state.value);
    const server = new CollaborativeServerEmulator('e1', roomDoc);
    const provider = new YjsCollaborationProvider({
      server,
      transport: new DeterministicTransportHub(server),
    });
    const section = createCanvasSection();

    const connected = await provider.connect({
      documentId: 'desenho-42',
      section,
      seedEmptyRoom: false,
    });
    if (!connected.ok) throw new Error(connected.error.code);
    expect(Object.keys(section.getSnapshot().document.nodes).sort()).toEqual(['r1', 'r2', 'r3']);
    addRect(section, 'r4');
    await flush();

    const after = projectYjsStateToCanvasDocument(server.getSnapshot());
    if (!after.ok) throw new Error(after.error.code);
    expect(after.value.id).toBe('desenho-42');
    expect(Object.keys(after.value.nodes).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(after.value.layers.map((layer) => layer.id)).toEqual(['camada-fundo', 'camada-frente']);
    connected.value.destroy();
  });
});

describe('seedEmptyRoom (P3)', () => {
  async function connectWithLocalNode(seedEmptyRoom: boolean | undefined) {
    const server = new CollaborativeServerEmulator();
    const provider = new YjsCollaborationProvider({
      server,
      transport: new DeterministicTransportHub(server),
    });
    const section = createCanvasSection();
    addRect(section, 'local');
    const connected = await provider.connect({
      documentId: 'doc',
      section,
      ...(seedEmptyRoom === undefined ? {} : { seedEmptyRoom }),
    });
    if (!connected.ok) throw new Error(connected.error.code);
    await flush();
    return { server, section, session: connected.value };
  }

  it('desligado: a sessão não envia nada e fica com a sala vazia', async () => {
    const { server, section, session } = await connectWithLocalNode(false);

    expect(server.getLog()).toEqual([]);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
    expect(session.getPending()).toEqual({ count: 0, bytes: 0 });
    expect((await session.leave()).ok).toBe(true);
  });

  it('por padrão, e ligado, a sessão leva o documento local para a sala vazia, como antes', async () => {
    for (const option of [undefined, true]) {
      const { server, section, session } = await connectWithLocalNode(option);

      expect(server.getLog()).toHaveLength(1);
      expect(Object.keys(section.getSnapshot().document.nodes)).toEqual(['local']);
      session.destroy();
    }
  });

  it('sessão construída direto com o hub, sem snapshot: desligado, também não semeia', async () => {
    const server = new CollaborativeServerEmulator('epoch-legado');
    const hub = new DeterministicTransportHub(server);
    const section = createCanvasSection();
    addRect(section, 'local');

    const session = new YjsCollaborationSession(
      hub,
      { documentId: 'doc', section, roomEpoch: 'epoch-legado', seedEmptyRoom: false },
      'sess-1',
    );
    await flush();

    expect(server.getLog()).toEqual([]);
    expect(Object.keys(section.getSnapshot().document.nodes)).toEqual([]);
    session.destroy();
  });
});
