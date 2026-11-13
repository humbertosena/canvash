import type { RemotePresence } from '@canvash/collaboration';
import { createCanvasSection } from '@canvash/core';
import { describe, expect, it } from 'vitest';
import { CollaborativeServerEmulator } from './server-emulator.js';
import { DeterministicTransportHub } from './transport.js';
import { YjsCollaborationProvider } from './provider.js';

describe('Presença Efêmera e Isolamento de Documento (COLLAB-05)', () => {
  it('presença é atualizada em tempo real, expira ao desconectar e nunca polui o documento ou histórico', async () => {
    const server = new CollaborativeServerEmulator();
    const transport = new DeterministicTransportHub(server);
    const provider = new YjsCollaborationProvider({ server, transport });

    const section1 = createCanvasSection();
    const section2 = createCanvasSection();

    const conn1 = await provider.connect({
      documentId: 'doc-p',
      section: section1,
      user: { id: 'u1', name: 'Alice', color: '#ff0000' },
    });
    const conn2 = await provider.connect({
      documentId: 'doc-p',
      section: section2,
      user: { id: 'u2', name: 'Bob', color: '#0000ff' },
    });

    expect(conn1.ok && conn2.ok).toBe(true);
    if (!conn1.ok || !conn2.ok) return;

    const session1 = conn1.value;
    const session2 = conn2.value;

    let presencesSeenBy2: readonly RemotePresence[] = [];
    session2.onPresenceChange((presences) => {
      presencesSeenBy2 = [...presences];
    });

    // 1. Usuário 1 atualiza cursor e seleção
    session1.updatePresence({
      cursor: { x: 120, y: 340 },
      selection: ['item-1'],
    });

    // Aguarda propagação
    await new Promise((r) => setTimeout(r, 20));

    expect(presencesSeenBy2.length).toBe(1);
    expect(presencesSeenBy2[0]?.userName).toBe('Alice');
    expect(presencesSeenBy2[0]?.cursor).toEqual({ x: 120, y: 340 });
    expect(presencesSeenBy2[0]?.selection).toEqual(['item-1']);

    // 2. Verifica que o documento do canvas 2 NÃO contém dados de presença
    const doc2 = section2.getSnapshot().document;
    const jsonString = JSON.stringify(doc2);
    expect(jsonString.includes('Alice')).toBe(false);
    expect(jsonString.includes('120')).toBe(false);

    // 3. Verifica que o histórico local do canvas 2 não foi poluído
    expect(session2.getUndoManager().canUndo()).toBe(false);

    // 4. Usuário 1 desconecta -> presença desaparece em sessão 2
    session1.disconnect();
    await new Promise((r) => setTimeout(r, 20));

    expect(session2.getPresences().length).toBe(0);

    session1.destroy();
    session2.destroy();
    server.destroy();
  });
});
