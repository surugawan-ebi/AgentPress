import type { Confidence, NoteStatus } from "../types/common.js";

export interface Citation {
  label: string;
  note_id: string;
  version: number;
  updated_at: string;
  review_due_at: string | null;
  stale: boolean;
  confidence: Confidence;
  status: NoteStatus;
  scope: string | null;
}

export interface CitableNote {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  reviewDueAt: string | null;
  stale: boolean;
  confidence: Confidence;
  status: NoteStatus;
  scope: string | null;
}

/** Shared citation shape for search_notes / get_note / review responses, per spec.md. */
export function buildCitation(note: CitableNote): Citation {
  return {
    label: note.title,
    note_id: note.id,
    version: note.version,
    updated_at: note.updatedAt,
    review_due_at: note.reviewDueAt,
    stale: note.stale,
    confidence: note.confidence,
    status: note.status,
    scope: note.scope,
  };
}
