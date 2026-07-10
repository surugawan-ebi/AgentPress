import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { createReviewService } from "../../core/reviews.js";
import { ProposeUpdateInput } from "../../types/proposal.js";
import { PolicyWarningSchema } from "../schemas.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";
import { withIdempotency } from "../idempotency.js";

export const ProposeNoteUpdateInput = ProposeUpdateInput.extend({
  idempotency_key: z.string().min(1).nullish().describe("同一keyの再実行は新しい副作用を起こさず既存結果を返す。"),
});
export type ProposeNoteUpdateInput = z.infer<typeof ProposeNoteUpdateInput>;

export const ProposeNoteUpdateOutput = z.object({
  proposal_id: z.string(),
  note_id: z.string(),
  proposal_type: z.literal("update"),
  status: z.literal("pending_review"),
  base_note_version: z.number().int(),
  diff: z.string(),
  changed_fields: z.array(z.string()),
  policy_warnings: z.array(PolicyWarningSchema),
  message: z.string(),
});

export function proposeNoteUpdateTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(ProposeNoteUpdateInput, rawInput ?? {});
    const { idempotency_key, ...coreInput } = input;
    const reviews = createReviewService(ctx);

    const output = withIdempotency(ctx, "propose_note_update", idempotency_key, coreInput, () => {
      const result = reviews.createProposal(coreInput);
      return {
        proposal_id: result.proposal.id,
        note_id: result.proposal.noteId,
        proposal_type: result.proposal.proposalType as "update",
        status: result.proposal.status as "pending_review",
        base_note_version: result.proposal.baseNoteVersion,
        diff: result.proposal.diff,
        changed_fields: result.proposal.changedFields,
        policy_warnings: result.policyWarnings,
        message: "Update proposal created. Human approval is required before the verified note changes.",
      };
    });

    return okResult(output);
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[contribution plane] verified noteへの更新案(proposal)を作成する。既存のverified noteを直接上書きすることはできない。この提案自体は人間が承認するまで正式根拠にならない。
対象はverifiedのnote限定。draftへの提案は作れず(update_draftを使う)、archivedはarchived_targetエラーになる。
base_note_versionは必須で、get_note/search_notesのcitation.versionをそのまま渡すこと。現在のnote.versionと一致しない場合はversion_conflictエラーになり、提案は作られない(古いget_note結果を基にした提案を作成時点で検出するため)。version_conflictが出た場合はget_noteで最新を取得し、base_note_versionを更新して再提案すること。
すべてのproposed_*フィールドはoptionalで、指定したフィールドだけが変更対象になる。全フィールド無変更(空diff)はempty_changeエラーになる。
古くなった知識をarchiveすべきだと考える場合は、このツールではなくrecommend_archiveを使うこと。idempotency_keyを指定すると、同一keyの再実行は新しい副作用を起こさず既存結果を返す。`;

export function registerProposeNoteUpdateTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "propose_note_update",
    {
      title: "Propose note update",
      description: DESCRIPTION,
      inputSchema: ProposeNoteUpdateInput.shape,
      outputSchema: ProposeNoteUpdateOutput.shape,
    },
    async (args) => proposeNoteUpdateTool(ctx, args),
  );
}
