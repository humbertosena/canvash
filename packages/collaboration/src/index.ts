export { COLLABORATION_VERSION } from './version.js';
export {
  COLLABORATION_ERROR_CODES,
  type CollaborationError,
  type CollaborationErrorCode,
  type Result,
  createCollaborationError,
  err,
  ok,
} from './errors.js';
export {
  DEFAULT_MAX_FRAME_BYTES,
  MAX_FRAME_HEADER_BYTES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';
export {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  type DecodeOptions,
} from './codec.js';
export {
  DEFAULT_PRESENCE_TIMEOUT_MS,
  MAX_OFFLINE_BACKLOG_BYTES,
  MAX_PRESENCE_IDS,
  MAX_PRESENCE_NAME_LENGTH,
  MAX_PRESENCE_RATE_HZ,
} from './limits.js';
export { compareOrderKeys, generateOrderKey } from './fractional-index.js';
export {
  bindCanvasPresence,
  type BindCanvasPresenceOptions,
  type CanvasPresenceBinding,
  type CanvasPresenceSession,
  type FollowChangeReason,
  type PointerTargetLike,
} from './bind-canvas-presence.js';
export {
  toShellParticipants,
  type LocalParticipant,
  type ShellParticipantLike,
} from './to-shell-participants.js';
export { createPresenceThrottler, isPresenceExpired, type PresenceThrottler } from './presence.js';
export {
  validatePresence,
  type ValidatePresenceOptions,
  type ValidatedPresence,
} from './validate-presence.js';
export type {
  CollaborationTransport,
  CreateTransport,
  RoomAccess,
  TransportHello,
  TransportInbound,
  TransportState,
  TransportWelcome,
} from './transport.js';
export type {
  CollaborationCredentials,
  CollaborationProvider,
  CollaborationSession,
  CommitReceipt,
  ConnectOptions,
  PendingSummary,
  PresenceDrag,
  PresencePoint,
  PresenceUpdate,
  PresenceUser,
  PresenceView,
  PresenceViolation,
  PresenceViolationReason,
  RemotePresence,
  SessionStatus,
} from './types.js';
