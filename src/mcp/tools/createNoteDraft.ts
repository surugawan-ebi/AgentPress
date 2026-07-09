import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { createNoteService } from "../../core/notes.js";
import { CreateDraftInput } from "../../types/note.js";
import { DuplicateCandidateSchema, PolicyWarningSchema, mapDuplicateCandidate } from "../schemas.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";
import { withIdempotency } from "../idempotency.js";

export const CreateNoteDraftInput = CreateDraftInput.extend({
  idempotency_key: z.string().min(1).nullish().describe("同一keyの再実行は新しい副作用を起こさず既存結果を返す。"),
});
export type CreateNoteDraftInput = z.infer<typeof CreateNoteDraftInput>;

export const CreateNoteDraftOutput = z.object({
  id: z.string(),
  status: z.literal("draft"),
  final_slug: z.string(),
  slug_adjusted: z.boolean(),
  possible_duplicates: z.array(DuplicateCandidateSchema),
  policy_warnings: z.array(PolicyWarningSchema),
  message: z.string(),
});

export function createNoteDraftTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(CreateNoteDraftInput, rawInput ?? {});
    const { idempotency_key, ...coreInput } = input;
    const notes = createNoteService(ctx);

    const output = withIdempotency(ctx, "create_note_draft", idempotency_key, coreInput, () => {
      const result = notes.createDraft(coreInput);
      return {
        id: result.note.id,
        status: result.note.status as "draft",
        final_slug: result.note.slug,
        slug_adjusted: result.slugAdjusted,
        possible_duplicates: result.possibleDuplicates.map(mapDuplicateCandidate),
        policy_warnings: result.policyWarnings,
        message: "Draft note created. Human approval is required before it becomes verified.",
      };
    });

    return okResult(output);
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[contribution plane] AIが新しい知識案(draft)を作成する。作成直後はdraftであり、正式根拠(verified)ではない。人間の承認が完了するまでこの内容を回答の正式根拠として使わないこと。
必須はtitle/summary/body、およびsource[]かreasonのどちらか一方以上。
slugが既存と衝突する場合はエラーにせず自動でsuffixを付け、final_slugとslug_adjustedを返す。
possible_duplicates[]には類似する既存note(verified/draft横断)が返る。0件でなければ、新規作成前にそちらの確認や更新提案(propose_note_update)を検討すること。
policy_warnings[]は将来の承認時に指摘されうる不備の事前警告(body_too_long/missing_headings/summary_too_short/tags_too_sparse/weak_source_for_high_confidence等)で、作成はブロックしない。
このツールはsearch_notesで関連するverified noteが見つからなかった場合の提案手段として使うことを想定している。idempotency_keyを指定すると、同一keyの再実行は新しいdraftを作らず既存結果を返す。`;

export function registerCreateNoteDraftTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "create_note_draft",
    {
      title: "Create note draft",
      description: DESCRIPTION,
      inputSchema: CreateNoteDraftInput.shape,
      outputSchema: CreateNoteDraftOutput.shape,
    },
    async (args) => createNoteDraftTool(ctx, args),
  );
}
