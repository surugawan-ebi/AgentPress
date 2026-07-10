import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/context.js";
import { parseOrThrow } from "../../core/errors.js";
import { getRegistryOverview } from "../../core/registry.js";
import { okResult, errorResult, type ToolResult } from "../toolResponse.js";

export const GetRegistryOverviewInput = z.object({
  scope: z.string().nullish().describe("指定した場合はそのscopeだけを返す。省略時は全scope。"),
});
export type GetRegistryOverviewInput = z.infer<typeof GetRegistryOverviewInput>;

const ScopeOverviewOutput = z.object({
  scope: z.string(),
  description: z.string(),
  owner: z.string().nullable(),
  verified_count: z.number().int(),
  stale_count: z.number().int(),
  top_tags: z.array(z.string()),
  reviewers: z.array(z.string()),
});

const ContextPackOverviewOutput = z.object({
  name: z.string(),
  description: z.string(),
  note_count: z.number().int(),
});

export const GetRegistryOverviewOutput = z.object({
  schema_version: z.string(),
  server_version: z.string(),
  strict_stale_filter: z.boolean(),
  scopes: z.array(ScopeOverviewOutput),
  context_packs: z.array(ContextPackOverviewOutput),
  usage_policy: z.string(),
  recommended_first_steps: z.array(z.string()),
});

export function getRegistryOverviewTool(ctx: AppContext, rawInput: unknown): ToolResult {
  try {
    const input = parseOrThrow(GetRegistryOverviewInput, rawInput ?? {});
    const overview = getRegistryOverview(ctx, input.scope ?? undefined);
    return okResult({
      schema_version: overview.schemaVersion,
      server_version: overview.serverVersion,
      strict_stale_filter: overview.strictStaleFilter,
      scopes: overview.scopes.map((s) => ({
        scope: s.scope,
        description: s.description,
        owner: s.owner,
        verified_count: s.verifiedCount,
        stale_count: s.staleCount,
        top_tags: s.topTags,
        reviewers: s.reviewers,
      })),
      context_packs: overview.contextPacks.map((p) => ({
        name: p.name,
        description: p.description,
        note_count: p.noteCount,
      })),
      usage_policy: overview.usagePolicy,
      recommended_first_steps: overview.recommendedFirstSteps,
    });
  } catch (err) {
    return errorResult(err);
  }
}

const DESCRIPTION = `[verified plane] 接続直後のAIクライアントが最初に呼ぶべき入口ツール。scope構成、context_packs構成、note件数、利用ルール(usage_policy)を一度に把握できる。
何も知らない状態でsearch_notesを手探りで叩く前に、必ず最初にこのツールを呼ぶこと。
返されるusage_policyの通り、正式根拠として使ってよいのはverifiedのnoteのみ。stale: trueのnoteは要再確認として扱い、回答時にその旨を明示すること。
context_packs[]には利用可能なpack名・説明・現在の該当note件数が入る。目的に近いpackがあれば、search_notesで個別に探す前にget_context_packで一括取得すると効率的。
関連するverified noteが見つからない場合は、search_notesで探したうえでcreate_note_draftで新規知識案を提案すること。`;

export function registerGetRegistryOverviewTool(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "get_registry_overview",
    {
      title: "Get registry overview",
      description: DESCRIPTION,
      inputSchema: GetRegistryOverviewInput.shape,
      outputSchema: GetRegistryOverviewOutput.shape,
    },
    async (args) => getRegistryOverviewTool(ctx, args),
  );
}
