import { z } from "zod";
import { NoteStatus, Confidence, SourceType, RelationType } from "../types/common.js";
import type { DuplicateCandidate } from "../types/note.js";

/**
 * Shared output shapes reused across tools. Field names are already snake_case here (matching
 * the JSON the MCP client sees) so they can be embedded directly in each tool's outputSchema.
 */

// Matches core/citation.ts's Citation shape field-for-field (it's already snake_case), so a
// Citation value can be passed straight through as structuredContent without remapping.
export const CitationSchema = z.object({
  label: z.string(),
  note_id: z.string(),
  version: z.number().int(),
  updated_at: z.string(),
  review_due_at: z.string().nullable(),
  stale: z.boolean(),
  confidence: Confidence,
  status: NoteStatus,
  scope: z.string().nullable(),
});

// Matches types/policy.ts's PolicyWarning shape field-for-field.
export const PolicyWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  suggested_action: z.string(),
});

export const DuplicateCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: NoteStatus,
  matched_fields: z.array(z.string()),
  suggested_action: z.string(),
  suggested_tool: z.string(),
});

/** DuplicateCandidate (core/duplicates.ts) is camelCase; map it to the snake_case wire shape. */
export function mapDuplicateCandidate(candidate: DuplicateCandidate): z.infer<typeof DuplicateCandidateSchema> {
  return {
    id: candidate.id,
    title: candidate.title,
    status: candidate.status,
    matched_fields: candidate.matchedFields,
    suggested_action: candidate.suggestedAction,
    suggested_tool: candidate.suggestedTool,
  };
}

export const SourceOutputSchema = z.object({
  id: z.string(),
  type: SourceType,
  title: z.string().nullable(),
  url: z.string().nullable(),
  path: z.string().nullable(),
  commit_sha: z.string().nullable(),
  retrieved_at: z.string().nullable(),
});

export const RelationOutputSchema = z.object({
  related_note_id: z.string(),
  relation_type: RelationType,
});
