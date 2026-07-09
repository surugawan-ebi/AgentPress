import { z } from "zod";
import { Confidence, ProposalStatus, ProposalType, SourceInput } from "./common.js";
import type { PolicyWarning } from "./policy.js";

export interface Proposal {
  id: string;
  noteId: string;
  status: ProposalStatus;
  proposalType: ProposalType;
  baseNoteVersion: number;
  proposedTitle: string | null;
  proposedSummary: string | null;
  proposedBody: string | null;
  proposedTags: string[] | null;
  proposedScope: string | null;
  proposedConfidence: Confidence | null;
  diff: string;
  changedFields: string[];
  reason: string;
  source: unknown[];
  proposedBy: string;
  reviewedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export const ProposeUpdateInput = z.object({
  id: z.string().min(1),
  base_note_version: z.number().int().positive(),
  proposed_title: z.string().min(1).nullish(),
  proposed_summary: z.string().min(1).nullish(),
  proposed_body: z.string().min(1).nullish(),
  proposed_tags: z.array(z.string()).nullish(),
  proposed_scope: z.string().nullish(),
  proposed_confidence: Confidence.nullish(),
  reason: z.string().min(1),
  source: z.array(SourceInput).default([]),
});
export type ProposeUpdateInput = z.infer<typeof ProposeUpdateInput>;

export interface CreateProposalResult {
  proposal: Proposal;
  policyWarnings: PolicyWarning[];
}

export interface ApproveResult {
  kind: "note" | "proposal";
  note: import("./note.js").Note;
  proposal?: Proposal;
  cascadedNeedsRebase: string[];
  /** checkApprove warnings; advisory only in MVP, never blocks approval (see policy.ts). */
  policyWarnings: PolicyWarning[];
}

export interface RejectResult {
  kind: "note" | "proposal";
  id: string;
  status: string;
  rejectionReason: string;
  note?: import("./note.js").Note;
  proposal?: Proposal;
}

export interface ReviewItem {
  id: string;
  kind: "draft" | "proposal";
  status: string;
  scope: string | null;
  createdBy: string;
  createdAt: string;
  title: string;
  hasWarnings: boolean;
  hasDuplicates: boolean;
}

export interface ReviewItemFilter {
  kind?: "draft" | "proposal";
  scope?: string;
  /** Pass "self" to resolve to AppContext.actor at call time. */
  createdBy?: string;
  status?: string;
  limit?: number;
  cursor?: string | null;
  sort?: "created_at";
}

export interface ReviewItemDetail {
  id: string;
  kind: "note" | "proposal";
  status: string;
  usableAsContext: false;
  rejectionReason: string | null;
  draftReason?: string | null;
  policyWarnings: PolicyWarning[];
  targetNoteId?: string;
  baseNoteVersion?: number;
  currentNoteVersion?: number;
  suggestedAction?: string;
  body: string;
  diff?: string;
  /** proposal-only: why it was proposed, its own evidence, who proposed it, and which fields it touches. */
  reason?: string;
  source?: unknown[];
  proposedBy?: string;
  changedFields?: string[];
}
