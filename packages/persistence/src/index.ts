export { PERSISTENCE_VERSION } from './version.js';
export { serializeDocument, type SerializeOptions } from './serialize.js';
export { parseDocument, MAX_DOCUMENT_BYTES } from './parse.js';
export { type PersistenceError, type PersistenceErrorCode } from './errors.js';
export {
  type StorageAdapter,
  type StorageRecord,
  type SaveOptions,
  type IndexedDbStorageOptions,
  IndexedDbStorageAdapter,
  MemoryStorageAdapter,
} from './storage.js';
export {
  createAutosaveManager,
  type AutosaveManager,
  type AutosaveOptions,
  type AutosaveStatus,
} from './autosave.js';
