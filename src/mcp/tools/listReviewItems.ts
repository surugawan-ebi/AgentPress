import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { createReviewService } from "../../core/reviews.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";

export const ListReviewItemsInput = z.object({
  kind: z.enum(["draft", "proposal"]).nullish().describe("draftまたはproposalに絞り込む。省略時は両方。"),
  scope: z.string().nullish(),
  created_by: z.string().nullish().describe('"self"を指定すると、このMCPサーバのactorが作成したものだけに絞り込む。'),
  status: z
    .string()
    .nullish()
    .describe(
      "pending_review/needs_rebase/rejected等のレビュー系statusで絞り込む。draft noteはstatus:\"pending_review\"として扱われる(needs_rebaseはproposalのみ)。",
    ),
  limit: z.number().int().positive().max(200).nullish().describe("省略時は20件。"),
  cursor: z.string().nullish().describe("前回のnext_cursorを渡すとその続きから返す。"),
  sort: z.literal("created_at").nullish(),
});
export type ListReviewItemsInput = z.infer<typeof ListReviewItemsInput>;

const ReviewItemOutput = z.object({
  id: z.string(),
  kind: z.enum(["draft", "proposal"]),
  status: z.string(),
  note_status: z.string().optional(),
  scope: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  title: z.string(),
  has_warnings: z.boolean(),
  has_duplicates: z.boolean(),
});

export const ListReviewItemsOutput = z.object({
  items: z.array(ReviewItemOutput),
  next_cursor: z.string().nullable(),
});

export function listReviewItemsTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(ListReviewItemsInput, rawInput ?? {});
    const reviews = createReviewService(ctx);
    const { items, nextCursor } = reviews.listReviewItems({
      kind: input.kind ?? undefined,
      scope: input.scope ?? undefined,
      createdBy: input.created_by ?? undefined,
      status: input.status ?? undefined,
      limit: input.limit ?? undefined,
      cursor: input.cursor ?? null,
      sort: input.sort ?? undefined,
    });

    return okResult({
      items: items.map((i) => ({
        id: i.id,
        kind: i.kind,
        status: i.status,
        note_status: i.noteStatus,
        scope: i.scope,
        created_by: i.createdBy,
        created_at: i.createdAt,
        title: i.title,
        has_warnings: i.hasWarnings,
        has_duplicates: i.hasDuplicates,
      })),
      next_cursor: nextCursor,
    });
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[review plane] draft/proposal横断のレビュー一覧を返す。ここに出てくる項目は未承認であり、正式根拠として使わないこと。
created_by:"self"を指定すると、このMCPサーバのactor自身が作成したdraft/proposalだけに絞り込める。
statusはレビュー系語彙(pending_review/needs_rebase/rejected等)に正規化されている: draft noteはstatus:"pending_review"として返り、元のnote自体のstatusはkind:"draft"の項目にのみ付くnote_status(例: "draft")で確認できる。needs_rebaseはproposal限定。
省略時のlimitは20件。結果がlimit件ちょうどのときnext_cursorに最後のitemのidが入るので、次回呼び出しのcursorに渡すと続きが取れる(nullなら以降なし)。
各項目のhas_warnings/has_duplicatesは、詳細を見るべきかの目安。詳細はget_review_itemで取得する。`;

export function registerListReviewItemsTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "list_review_items",
    {
      title: "List review items",
      description: DESCRIPTION,
      inputSchema: ListReviewItemsInput.shape,
      outputSchema: ListReviewItemsOutput.shape,
    },
    async (args) => listReviewItemsTool(ctx, args),
  );
}
