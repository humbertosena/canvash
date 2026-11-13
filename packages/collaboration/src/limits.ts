/**
 * Limite máximo configurável de payloads binários pendentes de confirmação durável (20 MiB)
 * conforme os limites e o ciclo de vida offline da colaboração.
 */
export const MAX_OFFLINE_BACKLOG_BYTES = 20 * 1024 * 1024;

/**
 * Taxa máxima default de emissão de presença por participante (20 atualizações/segundo)
 * conforme os requisitos de convergência.
 */
export const MAX_PRESENCE_RATE_HZ = 20;

/**
 * Tempo limite padrão para expiração de presença efêmera sem atualizações (30 segundos).
 */
export const DEFAULT_PRESENCE_TIMEOUT_MS = 30_000;

/**
 * Quantidade máxima de IDs que uma presença pode levar em `selection` e em `drag.ids`.
 */
export const MAX_PRESENCE_IDS = 1000;

/** Tamanho máximo, em caracteres, do nome mostrado de um participante. */
export const MAX_PRESENCE_NAME_LENGTH = 64;
