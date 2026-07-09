import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { createNoteService } from "../../core/notes.js";
import { UpdateDraftInput } from "../../types/note.js";
import { PolicyWarningSchema } from "../schemas.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";
import { withIdempotency } from "../idempotency.js";

export const UpdateDraftMcpInput = UpdateDraftInput.extend({
  idempotency_key: z.string().min(1).nullish().describe("同一keyの再実行は新しい副作用を起こさず既存結果を返す。"),
});
export type UpdateDraftMcpInput = z.infer<typeof UpdateDraftMcpInput>;

export const UpdateDraftOutput = z.object({
  id: z.string(),
  status: z.literal("draft"),
  resubmitted: z.boolean(),
  policy_warnings: z.array(PolicyWarningSchema),
  message: z.string(),
});

export function updateDraftTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(UpdateDraftMcpInput, rawInput ?? {});
    const { idempotency_key, ...coreInput } = input;
    const notes = createNoteService(ctx);

    const output = withIdempotency(ctx, "update_draft", idempotency_key, coreInput, () => {
      const result = notes.updateDraft(coreInput);
      return {
        id: result.note.id,
        status: result.note.status as "draft",
        resubmitted: result.resubmitted,
        policy_warnings: result.policyWarnings,
        message: result.resubmitted ? "Draft resubmitted for review." : "Draft updated.",
      };
    });

    return okResult(output);
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[contribution plane] draftまたはrejectedのnoteを編集する。編集後もdraftのままであり、正式根拠(verified)ではない。
編集できるのは自分(このMCPサーバのactor)がcreated_byであるdraft/rejectedのみ。他人のdraftはnot_draft_ownerエラーになる。verifiedのnoteはpropose_note_updateを使うこと。
対象がrejectedだった場合はdraftへ再提出され、resubmitted: trueが返る。
policy_warnings[]は承認時に指摘されうる不備の事前警告で、更新はブロックしない。idempotency_keyを指定すると、同一keyの再実行は新しい副作用を起こさず既存結果を返す。`;

export function registerUpdateDraftTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "update_draft",
    {
      title: "Update draft",
      description: DESCRIPTION,
      inputSchema: UpdateDraftMcpInput.shape,
      outputSchema: UpdateDraftOutput.shape,
    },
    async (args) => updateDraftTool(ctx, args),
  );
}
