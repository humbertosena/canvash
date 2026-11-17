export { COLLABORATION_YJS_VERSION } from './version.js';
export {
  getDocumentCollections,
  initYjsDocument,
  type YjsEndpoints,
  type YjsGeometry,
  type YjsGroupRecord,
  type YjsLayerRecord,
  type YjsPlacement,
  type YjsShapeRecord,
} from './crdt-schema.js';
export { projectYDocToCanvasDocument, RECOVERY_LAYER_ID } from './projection.js';
export { AwarenessManager, type LocalAwarenessState } from './awareness.js';
export { createCollaborativeUndoManager, type CollaborativeUndoManager } from './undo.js';
export {
  CollaborativeServerEmulator,
  type LogEntry,
  type ServerEmulatorOptions,
} from './server-emulator.js';
export { createMemoryTransport } from './memory-transport.js';
export type { LegacyTransportHub } from './legacy-hub-transport.js';
export {
  DeterministicTransportHub,
  type MemoryLink,
  type TransportMessage,
  type TransportNetworkOptions,
} from './transport.js';
export { YjsCollaborationSession, type PendingCommit } from './session.js';
export { YjsCollaborationProvider, type YjsProviderOptions } from './provider.js';
