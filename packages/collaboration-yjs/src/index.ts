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
export { CollaborativeServerEmulator, type LogEntry } from './server-emulator.js';
export {
  DeterministicTransportHub,
  type TransportMessage,
  type TransportNetworkOptions,
} from './transport.js';
export { YjsCollaborationSession, type PendingCommit } from './session.js';
export { YjsCollaborationProvider, type YjsProviderOptions } from './provider.js';
