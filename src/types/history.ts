export const HISTORY_EVENT_TYPES = [
  "note_created",
  "note_updated",
  "note_verified",
  "note_rejected",
  "note_resubmitted",
  "note_archived",
  "proposal_created",
  "proposal_approved",
  "proposal_rejected",
  "proposal_needs_rebase",
  "note_imported",
  "note_exported",
] as const;

export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export type HistoryEntityType = "note" | "proposal" | "import" | "export";

export interface HistoryEvent {
  id: string;
  entityType: HistoryEntityType;
  entityId: string;
  eventType: HistoryEventType;
  actor: string;
  role: string;
  scope: string | null;
  reason: string | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecordEventInput {
  entityType: HistoryEntityType;
  entityId: string;
  eventType: HistoryEventType;
  actor: string;
  role: string;
  scope?: string | null;
  reason?: string | null;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}
