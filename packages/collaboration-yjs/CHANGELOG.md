# Changelog

## 0.2.0-alpha.1 — 2026-11-17

- `createWebSocketTransport`: transporte de rede sobre o `WebSocket` nativo, com handshake, reconexão com backoff e jitter, `resync` na volta, erros que param ou tentam de novo por código e presença com backpressure.
- A sessão e o provider falam por `CollaborationTransport` (de `@canvash/collaboration`) em vez do hub em memória; `YjsProviderOptions` ganha `createTransport`. **Mudança do construtor da sessão:** `new YjsCollaborationSession(transport, options, sessionId, initial?, createTransport?)`. O primeiro argumento, que era o `DeterministicTransportHub`, agora é um `CollaborationTransport` (o hub antigo continua aceito, por um adaptador); o quarto, que era só o estado inicial em bytes, também aceita o `TransportWelcome` do handshake; o quinto, novo, é a fábrica que a sessão usa para reconectar. `handleTransportMessage` fica `@deprecated`. Quem só usa `YjsCollaborationProvider` não muda nada.
- A sessão reenvia pendências com o mesmo `commitId` e backoff, reconcilia o backlog depois de uma queda longa, expõe `getPending()` e `onPendingChange()`, trata `access: 'read'` e erros por código, carimba a presença com `from` e mede a expiração pela chegada, com o relógio do servidor.
- `encodeCanvasDocumentAsYjsState` e `projectYjsStateToCanvasDocument`: semeadura de uma sala a partir do documento salvo e projeção de volta, com o `id` do documento.
- Entrada `@canvash/collaboration-yjs/testing` com `transportContractCases`, a suíte de contrato do transporte.
- O transporte em memória (`createMemoryTransport`) e o emulador de servidor acompanham a interface nova, com queda e volta do enlace, falha de gravação e reordenação de mensagens simuladas.

## 0.1.0-alpha.1 — 2026-11-15

- Sem mudanças: a versão acompanha os demais pacotes.

## 0.1.0-alpha — 2026-11-13

Primeira versão alpha de @canvash/collaboration-yjs.

- Provider de colaboração com Yjs: convergência por unidade de conflito, histórico por origem e presença por Awareness.
- O transporte desta versão é um servidor emulado em memória, para testes e demonstrações. Não há transporte de rede.
