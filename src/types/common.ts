import { z } from "zod";

export const NoteStatus = z.enum(["draft", "verified", "archived", "rejected"]);
export type NoteStatus = z.infer<typeof NoteStatus>;

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export const Role = z.enum(["contributor", "reviewer", "maintainer"]);
export type Role = z.infer<typeof Role>;

export const SourceType = z.enum(["manual", "url", "file", "openwiki", "github", "other"]);
export type SourceType = z.infer<typeof SourceType>;

export const RelationType = z.enum(["related", "supersedes", "conflicts_with", "references"]);
export type RelationType = z.infer<typeof RelationType>;

export const ProposalStatus = z.enum(["pending_review", "approved", "rejected", "needs_rebase"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const ProposalType = z.enum(["update", "archive_recommendation"]);
export type ProposalType = z.infer<typeof ProposalType>;

export const SourceInput = z.object({
  type: SourceType,
  title: z.string().nullish(),
  url: z.string().nullish(),
  path: z.string().nullish(),
  commit_sha: z.string().nullish(),
  retrieved_at: z.string().nullish(),
});
export type SourceInput = z.infer<typeof SourceInput>;

export interface Source {
  id: string;
  noteId: string;
  type: SourceType;
  title: string | null;
  url: string | null;
  path: string | null;
  commitSha: string | null;
  retrievedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface Relation {
  noteId: string;
  relatedNoteId: string;
  relationType: RelationType;
}
