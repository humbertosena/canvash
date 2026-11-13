# Changelog

## 0.1.0-alpha — 2026-11-13

Primeira versão alpha de @canvash/persistence.

- `serializeDocument` e `parseDocument`: JSON canônico e leitura segura, com limite de 20 MiB.
- `createAutosaveManager`: salvamento automático com debounce, escritas serializadas e controle de concorrência.
- Adaptadores `IndexedDbStorageAdapter` e `MemoryStorageAdapter`.
