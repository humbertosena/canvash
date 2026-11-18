# Changelog

## 0.2.0-alpha.1 — 2026-11-17

- Protocolo de rede do Canvash: mensagens `hello`, `commit`, `sync`, `presence` e `bye` (cliente) e `welcome`, `ack`, `synced`, `update`, `presence` e `error` (servidor), com o codec binário `encodeClientMessage`, `decodeClientMessage`, `encodeServerMessage` e `decodeServerMessage` (nunca lançam: o que não serve volta `PROTOCOL_ERROR`) e `PROTOCOL_VERSION`.
- Codificação do quadro em texto (`encodeFrameAsText`, `decodeFrameFromText`, base64 padrão), para meios que não carregam binário.
- Interface `CollaborationTransport` e tipos (`TransportHello`, `TransportWelcome`, `TransportInbound`, `TransportState`, `CreateTransport`): o contrato que a sessão conhece da rede; o `welcome` da reconexão chega como `resync`.
- Novos códigos de erro `PROTOCOL_ERROR` e `NOT_FOUND` na união `CollaborationErrorCode`.
- `CollaborationSession` ganha `access`, `serverTimeOffsetMs`, `getPending()` e `onPendingChange()`; `ConnectOptions` ganha `onStatusChange`, `seedEmptyRoom` e `receiptHistoryLimit`; `RemotePresence` ganha `receivedAt` e a expiração da presença passa a valer pela chegada.

## 0.1.0-alpha.1 — 2026-11-15

- Sem mudanças: a versão acompanha os demais pacotes.

## 0.1.0-alpha — 2026-11-13

Primeira versão alpha de @canvash/collaboration.

- Contratos `CollaborationProvider` e `CollaborationSession`, tipos de presença e limites.
- `bindCanvasPresence`, `toShellParticipants` e indexação fracionária (`generateOrderKey`, `compareOrderKeys`).
