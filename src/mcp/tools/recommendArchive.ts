import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { createReviewService } from "../../core/reviews.js";
import { RecommendArchiveInput } from "../../types/proposal.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";
import { withIdempotency } from "../idempotency.js";

export const RecommendArchiveToolInput = RecommendArchiveInput.extend({
  idempotency_key: z.string().min(1).nullish().describe("同一keyの再実行は新しい副作用を起こさず既存結果を返す。"),
});
export type RecommendArchiveToolInput = z.infer<typeof RecommendArchiveToolInput>;

export const RecommendArchiveOutput = z.object({
  proposal_id: z.string(),
  note_id: z.string(),
  proposal_type: z.literal("archive_recommendation"),
  status: z.literal("pending_review"),
  reason: z.string(),
  message: z.string(),
});

export function recommendArchiveTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(RecommendArchiveToolInput, rawInput ?? {});
    const { idempotency_key, ...coreInput } = input;
    const reviews = createReviewService(ctx);

    const output = withIdempotency(ctx, "recommend_archive", idempotency_key, coreInput, () => {
      const result = reviews.createArchiveRecommendation(coreInput);
      return {
        proposal_id: result.proposal.id,
        note_id: result.proposal.noteId,
        proposal_type: result.proposal.proposalType as "archive_recommendation",
        status: result.proposal.status as "pending_review",
        reason: result.proposal.reason,
        message: "Archive recommendation created. A human must approve it (via approve) before the note is archived.",
      };
    });

    return okResult(output);
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[contribution plane] verified noteをarchiveするよう人間に提案する。古くなった/もう使うべきでない知識を見つけた場合に、本文修正の提案(propose_note_update)ではなくこちらを使うこと。
このツール自体はnoteをarchiveしない。承認(人間によるapprove)されて初めてnoteがarchivedになる。reasonにはarchiveを推奨する理由を書くこと(何が古くなったか、代わりに何を参照すべきか等)。
対象はverifiedのnote限定。draft/rejectedはnot_verifiedエラー、archivedは既にarchived_targetエラーになる。
list_review_items/get_review_itemではこの提案はproposal_type:"archive_recommendation"として区別でき、diffは常に空(内容変更を伴わないため)。承認されると、そのnoteに対する他のpending proposalは(内容更新の提案も含め)すべてneeds_rebaseになる。idempotency_keyを指定すると、同一keyの再実行は新しい副作用を起こさず既存結果を返す。`;

export function registerRecommendArchiveTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "recommend_archive",
    {
      title: "Recommend archiving a note",
      description: DESCRIPTION,
      inputSchema: RecommendArchiveToolInput.shape,
      outputSchema: RecommendArchiveOutput.shape,
    },
    async (args) => recommendArchiveTool(ctx, args),
  );
}
