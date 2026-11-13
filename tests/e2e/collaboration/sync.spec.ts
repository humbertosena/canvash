import { expect, test, type Page } from '@playwright/test';

interface Point {
  x: number;
  y: number;
}

interface RemotePresenceLike {
  sessionId: string;
  userId: string;
  userName: string;
  color: string;
  cursor: Point | null;
  selection: string[];
}

interface CollabTransportMsg {
  type: string;
  commitId?: string;
  payload?: Uint8Array | null;
  senderSessionId: string;
}

interface CanvashWindow {
  __CANVASH_CORE__: {
    createCanvasSection: () => {
      dispatch: (cmd: unknown) => unknown;
      getSnapshot: () => {
        document: {
          nodes: Record<
            string,
            { id: string; type: string; x?: number; y?: number; style?: { fill?: string } }
          >;
        };
      };
    };
  };
  __CANVASH_COLLABORATION_YJS__: {
    CollaborativeServerEmulator: new (roomEpoch?: string) => {
      commitUpdate: (commitId: string, update: Uint8Array, roomEpoch: string) => unknown;
      getSnapshot: () => Uint8Array;
    };
    DeterministicTransportHub: new (server: unknown) => {
      registerClient: (id: string, fn: (msg: CollabTransportMsg) => void) => void;
      setNetworkOptions: (options: { dropMessages?: boolean }) => void;
    };
    YjsCollaborationSession: new (
      transport: unknown,
      options: unknown,
      sessionId: string,
      initialSnapshot?: Uint8Array,
    ) => {
      updatePresence: (update: unknown) => void;
      onPresenceChange: (listener: (presences: RemotePresenceLike[]) => void) => void;
      destroy: () => void;
      reconnect: () => Promise<unknown>;
      handleTransportMessage: (msg: CollabTransportMsg) => void;
    };
  };
  __CANVASH_TEST_COLLAB__?: {
    server: {
      commitUpdate: (commitId: string, update: Uint8Array, roomEpoch: string) => unknown;
      getSnapshot: () => Uint8Array;
    };
    transport: {
      registerClient: (id: string, fn: (msg: CollabTransportMsg) => void) => void;
      setNetworkOptions: (options: { dropMessages?: boolean }) => void;
    };
    session: {
      updatePresence: (update: unknown) => void;
      onPresenceChange: (listener: (presences: RemotePresenceLike[]) => void) => void;
      destroy: () => void;
      reconnect: () => Promise<unknown>;
      handleTransportMessage: (msg: CollabTransportMsg) => void;
    };
    section: {
      dispatch: (cmd: unknown) => unknown;
      getSnapshot: () => {
        document: {
          nodes: Record<
            string,
            { id: string; type: string; x?: number; y?: number; style?: { fill?: string } }
          >;
        };
      };
    };
    presences: RemotePresenceLike[];
    channel: BroadcastChannel;
  };
}

async function waitForGlobals(page: Page) {
  await page.waitForFunction(() => {
    const win = window as unknown as Partial<CanvashWindow>;
    return win.__CANVASH_CORE__ !== undefined && win.__CANVASH_COLLABORATION_YJS__ !== undefined;
  });
}

test.describe('Colaboração em Tempo Real E2E (COLLAB-01 a COLLAB-15)', () => {
  test('sincroniza criação, movimentação e presença de cursores entre abas simultâneas', async ({
    context,
  }) => {
    const channelName = `canvash-collab-sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto('/?layout=classic');
    await page2.goto('/?layout=classic');

    await waitForGlobals(page1);
    await waitForGlobals(page2);

    // Inicializa sessão colaborativa na Aba 1
    await page1.evaluate((name) => {
      const win = window as unknown as CanvashWindow;
      const { createCanvasSection } = win.__CANVASH_CORE__;
      const { CollaborativeServerEmulator, DeterministicTransportHub, YjsCollaborationSession } =
        win.__CANVASH_COLLABORATION_YJS__;

      const section = createCanvasSection();
      const server = new CollaborativeServerEmulator('epoch-e2e');
      const transport = new DeterministicTransportHub(server);

      const channel = new BroadcastChannel(name);
      const presences: RemotePresenceLike[] = [];

      const session = new YjsCollaborationSession(
        transport,
        {
          documentId: 'doc-e2e',
          section: section,
          roomEpoch: 'epoch-e2e',
          user: { id: 'user-p1', name: 'User Page 1', color: '#ff0000' },
        },
        'sess-p1',
        server.getSnapshot(),
      );

      session.onPresenceChange((newPresences: RemotePresenceLike[]) => {
        presences.length = 0;
        presences.push(...newPresences);
      });

      transport.registerClient('p1-broadcast-relayer', (msg: CollabTransportMsg) => {
        channel.postMessage(msg);
      });

      channel.onmessage = (event: MessageEvent<CollabTransportMsg>) => {
        const msg = event.data;
        if (msg.senderSessionId !== 'sess-p1') {
          if (msg.type === 'update' && msg.payload && msg.commitId) {
            server.commitUpdate(msg.commitId, msg.payload, 'epoch-e2e');
          }
          session.handleTransportMessage(msg);
        }
      };

      win.__CANVASH_TEST_COLLAB__ = { server, transport, session, section, presences, channel };
    }, channelName);

    // Pega o snapshot inicial do servidor gerado pela Aba 1
    const serverSnapshot = await page1.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      return Array.from(win.__CANVASH_TEST_COLLAB__!.server.getSnapshot());
    });

    // Inicializa sessão colaborativa na Aba 2 conectada ao mesmo canal
    await page2.evaluate(
      ({ name, snapshotArr }) => {
        const win = window as unknown as CanvashWindow;
        const { createCanvasSection } = win.__CANVASH_CORE__;
        const { CollaborativeServerEmulator, DeterministicTransportHub, YjsCollaborationSession } =
          win.__CANVASH_COLLABORATION_YJS__;

        const section = createCanvasSection();
        const server = new CollaborativeServerEmulator('epoch-e2e');
        const transport = new DeterministicTransportHub(server);
        const channel = new BroadcastChannel(name);
        const presences: RemotePresenceLike[] = [];

        const initialSnapshot = new Uint8Array(snapshotArr);
        const session = new YjsCollaborationSession(
          transport,
          {
            documentId: 'doc-e2e',
            section: section,
            roomEpoch: 'epoch-e2e',
            user: { id: 'user-p2', name: 'User Page 2', color: '#00ff00' },
          },
          'sess-p2',
          initialSnapshot,
        );

        session.onPresenceChange((newPresences: RemotePresenceLike[]) => {
          presences.length = 0;
          presences.push(...newPresences);
        });

        transport.registerClient('p2-broadcast-relayer', (msg: CollabTransportMsg) => {
          channel.postMessage(msg);
        });

        channel.onmessage = (event: MessageEvent<CollabTransportMsg>) => {
          const msg = event.data;
          if (msg.senderSessionId !== 'sess-p2') {
            if (msg.type === 'update' && msg.payload && msg.commitId) {
              server.commitUpdate(msg.commitId, msg.payload, 'epoch-e2e');
            }
            session.handleTransportMessage(msg);
          }
        };

        win.__CANVASH_TEST_COLLAB__ = { server, transport, session, section, presences, channel };
      },
      { name: channelName, snapshotArr: serverSnapshot },
    );

    // 1. Aba 1 cria forma geométrica no canvas
    await page1.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      const section = win.__CANVASH_TEST_COLLAB__!.section;
      section.dispatch({
        type: 'shape.create',
        shape: {
          id: 'shared-box',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 150,
          height: 100,
          rotation: 0,
          style: { fill: '#2563eb', stroke: '#1d4ed8', strokeWidth: 2, opacity: 1 },
        },
      });
    });

    // Aguarda propagação em tempo real para a Aba 2
    await page2.waitForFunction(() => {
      const win = window as unknown as CanvashWindow;
      const doc = win.__CANVASH_TEST_COLLAB__?.section.getSnapshot().document;
      return doc?.nodes['shared-box'] !== undefined;
    });

    const nodeOnPage2 = await page2.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      return win.__CANVASH_TEST_COLLAB__!.section.getSnapshot().document.nodes['shared-box'];
    });
    expect(nodeOnPage2).toBeDefined();
    expect(nodeOnPage2?.x).toBe(100);
    expect(nodeOnPage2?.style?.fill).toBe('#2563eb');

    // 2. Aba 2 move a forma e altera sua cor
    await page2.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      const section = win.__CANVASH_TEST_COLLAB__!.section;
      section.dispatch({
        type: 'shape.update',
        id: 'shared-box',
        patch: {
          x: 320,
          y: 240,
          style: { fill: '#16a34a' },
        },
      });
    });

    // Aba 1 observa as alterações refletidas do outro usuário
    await page1.waitForFunction(() => {
      const win = window as unknown as CanvashWindow;
      const node = win.__CANVASH_TEST_COLLAB__?.section.getSnapshot().document.nodes['shared-box'];
      return node?.x === 320 && node?.style?.fill === '#16a34a';
    });

    const updatedOnPage1 = await page1.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      return win.__CANVASH_TEST_COLLAB__!.section.getSnapshot().document.nodes['shared-box'];
    });
    expect(updatedOnPage1?.x).toBe(320);
    expect(updatedOnPage1?.y).toBe(240);
    expect(updatedOnPage1?.style?.fill).toBe('#16a34a');

    // 3. Atualização de presença e cursor remoto (COLLAB-05)
    await page1.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      win.__CANVASH_TEST_COLLAB__!.session.updatePresence({
        cursor: { x: 450, y: 350 },
        selection: ['shared-box'],
      });
    });

    // Aba 2 deve receber a presença remota de Aba 1 com throttle e dados do usuário
    await page2.waitForFunction(() => {
      const win = window as unknown as CanvashWindow;
      const presences = win.__CANVASH_TEST_COLLAB__?.presences ?? [];
      return presences.some((p) => p.userId === 'user-p1' && p.cursor?.x === 450);
    });

    const p1PresenceReceived = await page2.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      return win.__CANVASH_TEST_COLLAB__!.presences.find((p) => p.userId === 'user-p1');
    });

    expect(p1PresenceReceived).toBeDefined();
    expect(p1PresenceReceived?.userName).toBe('User Page 1');
    expect(p1PresenceReceived?.cursor).toEqual({ x: 450, y: 350 });
    expect(p1PresenceReceived?.selection).toEqual(['shared-box']);

    // Limpeza
    await page1.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      win.__CANVASH_TEST_COLLAB__?.session.destroy();
      win.__CANVASH_TEST_COLLAB__?.channel.close();
    });
    await page2.evaluate(() => {
      const win = window as unknown as CanvashWindow;
      win.__CANVASH_TEST_COLLAB__?.session.destroy();
      win.__CANVASH_TEST_COLLAB__?.channel.close();
    });
  });
});
