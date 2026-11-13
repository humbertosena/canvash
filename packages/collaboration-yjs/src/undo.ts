import * as Y from 'yjs';
import { getDocumentCollections } from './crdt-schema.js';

export interface CollaborativeUndoManager {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  stopCapturing(): void;
  destroy(): void;
}

export function createCollaborativeUndoManager(
  ydoc: Y.Doc,
  localOrigin: symbol,
  onChanged?: () => void,
): CollaborativeUndoManager {
  const { shapes, layers, groups } = getDocumentCollections(ydoc);

  const undoManager = new Y.UndoManager([shapes, layers, groups], {
    trackedOrigins: new Set([localOrigin]),
    captureTimeout: 0,
  });

  return {
    undo() {
      const res = undoManager.undo();
      if (res !== null) {
        onChanged?.();
      }
      return res !== null;
    },
    redo() {
      const res = undoManager.redo();
      if (res !== null) {
        onChanged?.();
      }
      return res !== null;
    },
    canUndo() {
      return undoManager.undoStack.length > 0;
    },
    canRedo() {
      return undoManager.redoStack.length > 0;
    },
    stopCapturing() {
      undoManager.stopCapturing();
    },
    destroy() {
      undoManager.destroy();
    },
  };
}
