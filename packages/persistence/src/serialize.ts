import type { CanvasDocument, Result } from '@canvash/core';
import { err, ok, type PersistenceError } from './errors.js';

export interface SerializeOptions {
  /** Quantidade de espaços para indentação do JSON. Por padrão não indenta (compacto). */
  space?: number;
}

/**
 * Ordena recursivamente as chaves de um objeto em ordem lexicográfica,
 * preservando a ordem de elementos de arrays.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    const val = obj[key];
    if (val !== undefined) {
      result[key] = canonicalize(val);
    }
  }

  return result;
}

/**
 * Serializa um CanvasDocument para JSON determinístico e canônico (IO-01).
 *
 * Garante que documentos semanticamente idênticos produzam exatamente a mesma string
 * através da ordenação alfabética determinística de propriedades de objetos.
 * Nunca inclui informações de sessão, viewport, histórico ou seleção.
 */
export function serializeDocument(
  document: CanvasDocument,
  options: SerializeOptions = {},
): Result<string, PersistenceError> {
  if (!document || typeof document !== 'object') {
    return err(
      'INVALID_DOCUMENT',
      'Valor fornecido para serialização não é um objeto de documento.',
    );
  }

  // Sanitização e isolamento estrito: extrai apenas os campos documentais canônicos
  const cleanDocument = {
    schemaVersion: document.schemaVersion,
    id: document.id,
    nodes: document.nodes,
    layers: document.layers,
    ...(document.metadata !== undefined ? { metadata: document.metadata } : {}),
  };

  try {
    const canonical = canonicalize(cleanDocument);
    const json = JSON.stringify(canonical, null, options.space);
    return ok(json);
  } catch (error) {
    return err('INVALID_DOCUMENT', 'Falha ao serializar documento para JSON.', { details: error });
  }
}
