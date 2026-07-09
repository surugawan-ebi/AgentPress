import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { createNoteService } from "../../core/notes.js";
import { buildCitation } from "../../core/citation.js";
import { Confidence } from "../../types/common.js";
import { CitationSchema, SourceOutputSchema, RelationOutputSchema } from "../schemas.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";

export const GetNoteInput = z.object({
  id: z.string().min(1),
});
export type GetNoteInput = z.infer<typeof GetNoteInput>;

export const GetNoteOutput = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["verified", "archived"]),
  confidence: Confidence,
  summary: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  source: z.array(SourceOutputSchema),
  relations: z.array(RelationOutputSchema),
  created_at: z.string(),
  updated_at: z.string(),
  review_due_at: z.string().nullable(),
  stale: z.boolean(),
  citation: CitationSchema,
  usage_warning: z.string().optional(),
});

const ARCHIVED_USAGE_WARNING = "This note is archived and no longer recommended as current guidance.";

export function getNoteTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(GetNoteInput, rawInput ?? {});
    const notes = createNoteService(ctx);
    const note = notes.getVerifiedNote(input.id);

    const citation = buildCitation({
      id: note.id,
      title: note.title,
      version: note.version,
      updatedAt: note.updatedAt,
      reviewDueAt: note.reviewDueAt,
      stale: note.stale,
      confidence: note.confidence,
      status: note.status,
      scope: note.scope,
    });

    const output: Record<string, unknown> = {
      id: note.id,
      title: note.title,
      status: note.status,
      confidence: note.confidence,
      summary: note.summary,
      body: note.body,
      tags: note.tags,
      source: note.sources.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        url: s.url,
        path: s.path,
        commit_sha: s.commitSha,
        retrieved_at: s.retrievedAt,
      })),
      // note_relations rows can list this note on either side; report the *other* note's id.
      relations: note.relations.map((r) => ({
        related_note_id: r.noteId === note.id ? r.relatedNoteId : r.noteId,
        relation_type: r.relationType,
      })),
      created_at: note.createdAt,
      updated_at: note.updatedAt,
      review_due_at: note.reviewDueAt,
      stale: note.stale,
      citation,
    };

    if (note.status === "archived") {
      output.usage_warning = ARCHIVED_USAGE_WARNING;
    }

    return okResult(output);
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[verified plane] 知識ノートの詳細を取得する。verifiedとarchivedのnoteのみ返す。
draftまたはrejectedのidを渡すとnot_verifiedエラーになる(承認待ち/却下状況を見たい場合はget_review_itemを使う)。
statusがarchivedの場合はusage_warningが付き、正式根拠として非推奨であることを示す。archivedのnoteを回答の根拠に使う場合はその旨を明示すること。
staleがtrueの場合は正式根拠として使ってよいが、review_due_atを過ぎているため要再確認であることを回答で明示すること。
回答でこのnoteを引用する際は、返されるcitation(note_id/version/updated_at等)をそのまま使うこと。`;

export function registerGetNoteTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description: DESCRIPTION,
      inputSchema: GetNoteInput.shape,
      outputSchema: GetNoteOutput.shape,
    },
    async (args) => getNoteTool(ctx, args),
  );
}
