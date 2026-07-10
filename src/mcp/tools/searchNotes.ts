import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { createSearchEngine } from "../../core/search.js";
import { NoteStatus, Confidence } from "../../types/common.js";
import { CitationSchema } from "../schemas.js";
import { ARCHIVED_USAGE_WARNING } from "./getNote.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";

export const SearchNotesInput = z.object({
  query: z.string().default("").describe("検索クエリ。空文字はverifiedノートの一覧表示として扱う。"),
  tags: z.array(z.string()).optional().describe("すべて一致する必要があるタグのAND絞り込み。"),
  scope: z.string().nullish().describe("指定した場合はこのscopeのnoteのみ検索する。"),
  include_archived: z.boolean().optional().describe("trueの場合、archivedノートも結果に含める(デフォルトはverifiedのみ)。"),
  limit: z.number().int().positive().max(100).optional(),
});
export type SearchNotesInput = z.infer<typeof SearchNotesInput>;

const SearchResultItemOutput = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  status: NoteStatus,
  confidence: Confidence,
  scope: z.string().nullable(),
  owner: z.string().nullable(),
  updated_at: z.string(),
  review_due_at: z.string().nullable(),
  stale: z.boolean(),
  tags: z.array(z.string()),
  matched_fields: z.array(z.string()),
  snippet: z.string(),
  citation: CitationSchema,
  usage_warning: z.string().optional(),
  score: z.number().nullable().optional().describe(
    "queryローカルな相対値(bm25由来、大きいほど良い)。LIKEでマッチした結果はnull。confidenceとは無関係で、クエリをまたいだ比較や信頼度の指標として使わないこと。",
  ),
});

export const SearchNotesOutput = z.object({
  results: z.array(SearchResultItemOutput),
  no_results: z.boolean().optional(),
  query: z.string().optional(),
  scope: z.string().nullable().optional(),
  searched_statuses: z.array(NoteStatus).optional(),
  guidance: z.string().optional(),
  suggested_next_tools: z.array(z.string()).optional(),
});

export function searchNotesTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(SearchNotesInput, rawInput ?? {});
    const engine = createSearchEngine(ctx);
    const result = engine.search({
      query: input.query,
      tags: input.tags,
      scope: input.scope ?? undefined,
      include_archived: input.include_archived,
      limit: input.limit,
    });

    if (result.noResults) {
      return okResult({
        results: [],
        no_results: true,
        query: result.query,
        scope: result.scope ?? null,
        searched_statuses: result.searchedStatuses,
        guidance: result.guidance,
        suggested_next_tools: result.suggestedNextTools,
      });
    }

    return okResult({
      results: result.results.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        status: r.status,
        confidence: r.confidence,
        scope: r.scope,
        owner: r.owner,
        updated_at: r.updatedAt,
        review_due_at: r.reviewDueAt,
        stale: r.stale,
        tags: r.tags,
        matched_fields: r.matchedFields,
        snippet: r.snippet,
        citation: r.citation,
        usage_warning: r.status === "archived" ? ARCHIVED_USAGE_WARNING : undefined,
        score: r.score,
      })),
    });
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[verified plane] 知識ノートを検索する。対象は常にverified(必要ならinclude_archived:trueでarchivedも含む)。draft/rejectedは対象外で、承認待ちの確認にはlist_review_items/get_review_itemを使うこと。
結果が0件の場合はno_results:trueとguidanceを返す。このとき一般知識や学習済みの知識を組織の正式ポリシーであるかのように提示しないこと。確度の高い知識を提供できるなら、create_note_draftで新規知識案として提案すること。
各結果のcitationにはnote_id/version/updated_at/review_due_at/staleを含む。回答の根拠として引用する際は必ずこのcitationを使うこと。stale: trueのnoteは正式根拠として使ってよいが、要再確認である旨を回答に明示すること。strict_stale_filter設定が有効な場合、stale noteは結果から除外される。
statusがarchivedの結果にはusage_warningが付く。archivedは現行根拠として非推奨であり、詳細を確認したい場合はget_noteで(同じ)警告つきの全文を取得すること。
各結果のscoreはqueryローカルな相対値であり、confidenceとは無関係。他のqueryの結果と比較したり、信頼度の指標として使わないこと。LIKEでマッチした結果はnullになる。並び順の主な手がかりはmatched_fields/snippet/citationであり、scoreは補助情報。`;

export function registerSearchNotesTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description: DESCRIPTION,
      inputSchema: SearchNotesInput.shape,
      outputSchema: SearchNotesOutput.shape,
    },
    async (args) => searchNotesTool(ctx, args),
  );
}
