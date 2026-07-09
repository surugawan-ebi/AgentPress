import { z } from "zod";
import { Confidence, NoteStatus, SourceInput, type Source, type Relation } from "./common.js";
import type { PolicyWarning } from "./policy.js";

export interface Note {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: NoteStatus;
  confidence: Confidence;
  scope: string | null;
  owner: string | null;
  version: number;
  createdBy: string;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  archivedAt: string | null;
  reviewDueAt: string | null;
  rejectionReason: string | null;
  draftReason: string | null;
  searchText: string;
  metadata: Record<string, unknown>;
}

export interface NoteWithDetail extends Note {
  tags: string[];
  sources: Source[];
  relations: Relation[];
  stale: boolean;
}

export interface NoteSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: NoteStatus;
  confidence: Confidence;
  scope: string | null;
  owner: string | null;
  tags: string[];
  updatedAt: string;
  reviewDueAt: string | null;
  stale: boolean;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  status: NoteStatus;
  matchedFields: string[];
  suggestedAction: string;
  suggestedTool: string;
}

// actor is intentionally not a field here: it comes from AppContext (CLI --actor
// resolution or the MCP server's startup actor), never from tool/CLI input payloads.
export const CreateDraftInput = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
  source: z.array(SourceInput).default([]),
  reason: z.string().nullish(),
  confidence: Confidence.default("medium"),
  scope: z.string().nullish(),
  owner: z.string().nullish(),
});
export type CreateDraftInput = z.infer<typeof CreateDraftInput>;

export const UpdateDraftInput = z.object({
  id: z.string().min(1),
  title: z.string().min(1).nullish(),
  summary: z.string().min(1).nullish(),
  body: z.string().min(1).nullish(),
  tags: z.array(z.string()).nullish(),
  source: z.array(SourceInput).nullish(),
  reason: z.string().nullish(),
  confidence: Confidence.nullish(),
  scope: z.string().nullish(),
  owner: z.string().nullish(),
});
export type UpdateDraftInput = z.infer<typeof UpdateDraftInput>;

export interface NoteListFilter {
  status?: NoteStatus;
  scope?: string;
  createdBy?: string;
  limit?: number;
}

export interface CreateDraftResult {
  note: Note;
  policyWarnings: PolicyWarning[];
  possibleDuplicates: DuplicateCandidate[];
  slugAdjusted: boolean;
}

export interface UpdateDraftResult {
  note: Note;
  resubmitted: boolean;
  policyWarnings: PolicyWarning[];
}
