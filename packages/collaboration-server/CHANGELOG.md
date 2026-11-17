# Changelog

## Não lançado (pré-release 0.2.0-alpha.1)

- `createCollaborationServer`: núcleo do servidor sobre `ServerConnection`, independente do meio, com handshake, salas carregadas sob demanda, commits em lote validados por projeção e gravados antes do `ack`, presença com identidade imposta, `compact`, `rotateEpoch`, `disconnect` e `close`.
- `RoomStorage` em lote, com `createMemoryRoomStorage` e `createFileRoomStorage`, e a suíte de contrato `roomStorageContractCases` em `@canvash/collaboration-server/testing`.
- Adaptador `ws` em `@canvash/collaboration-server/ws` (`listenWebSocket`, `attachWebSocketServer`) e CLI `canvash-collab-server`.

## 0.1.0-alpha.1 — 2026-11-17

- Pacote novo, em desenvolvimento para a pré-release `0.2.0-alpha.1`. Nesta versão ele não foi
  publicado: o número acompanha os demais pacotes.

## 0.1.0-alpha — 2026-11-13

- O pacote ainda não existia nesta versão. A seção fica só para acompanhar o histórico dos demais
  pacotes.
