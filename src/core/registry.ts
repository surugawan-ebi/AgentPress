import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppContext } from "./context.js";
import { createContextPackService } from "./contextPacks.js";

const SCHEMA_VERSION = "1";
const TOP_TAGS_LIMIT = 5;

// Fixed MVP copy, matching spec.md's get_registry_overview example verbatim.
const USAGE_POLICY =
  "verified のみ正式根拠として使う。stale: true のnoteは要再確認として扱い、回答時にその旨を明示する。関連するverified noteが見つからない場合はcreate_note_draftで新規知識案を提案する。古くなった/もう使うべきでないverified noteを見つけた場合は、recommend_archiveで人間にarchiveを提案する(内容修正の提案ではなくこちらを使う)。context_packsに使いたい用途に近いpackがあれば、get_context_packで厳選済みのnote集合を一括取得できる。";
const RECOMMENDED_FIRST_STEPS = [
  "get_registry_overview でscope構成とusage_policyを把握する",
  "context_packsに関連するpackがあればget_context_packで一括取得する",
  "search_notes で関連知識を検索する",
  "見つからなければcreate_note_draftで提案する",
  "古い知識を見つけたらrecommend_archiveでarchiveを提案する",
];

export interface RegistryScopeOverview {
  scope: string;
  description: string;
  owner: string | null;
  verifiedCount: number;
  staleCount: number;
  topTags: string[];
  reviewers: string[];
}

export interface RegistryContextPackOverview {
  name: string;
  description: string;
  noteCount: number;
}

export interface RegistryOverview {
  schemaVersion: string;
  serverVersion: string;
  strictStaleFilter: boolean;
  scopes: RegistryScopeOverview[];
  contextPacks: RegistryContextPackOverview[];
  usagePolicy: string;
  recommendedFirstSteps: string[];
}

function readServerVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/core/registry.js -> ../../package.json resolves to the repo root either way.
    const pkgPath = path.join(here, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Entry-point overview for MCP clients: scope stats, usage policy, and a suggested first path. */
export function getRegistryOverview(ctx: AppContext, scope?: string | null): RegistryOverview {
  const { db, config } = ctx;

  const configuredScopeNames = Object.keys(config.scopes);
  const dbScopeRows = db
    .prepare("SELECT DISTINCT scope FROM notes WHERE scope IS NOT NULL")
    .all() as { scope: string }[];
  const allScopeNames = new Set([...configuredScopeNames, ...dbScopeRows.map((r) => r.scope)]);

  const scopeNames = scope ? (allScopeNames.has(scope) ? [scope] : []) : [...allScopeNames].sort();

  const now = new Date().toISOString();
  const scopes: RegistryScopeOverview[] = scopeNames.map((name) => {
    const scopeConfig = config.scopes[name] ?? { description: "", owners: [], reviewers: [] };
    const verifiedCount = (
      db.prepare("SELECT COUNT(*) AS c FROM notes WHERE status = 'verified' AND scope = ?").get(name) as {
        c: number;
      }
    ).c;
    const staleCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM notes WHERE status = 'verified' AND scope = ? AND review_due_at IS NOT NULL AND review_due_at < ?",
        )
        .get(name, now) as { c: number }
    ).c;
    const topTagRows = db
      .prepare(
        `SELECT nt.tag AS tag, COUNT(*) AS c
           FROM note_tags nt JOIN notes n ON n.id = nt.note_id
          WHERE n.status = 'verified' AND n.scope = ?
          GROUP BY nt.tag ORDER BY c DESC, nt.tag ASC LIMIT ?`,
      )
      .all(name, TOP_TAGS_LIMIT) as { tag: string; c: number }[];

    return {
      scope: name,
      description: scopeConfig.description,
      owner: scopeConfig.owners.length > 0 ? scopeConfig.owners.join(", ") : null,
      verifiedCount,
      staleCount,
      topTags: topTagRows.map((r) => r.tag),
      reviewers: scopeConfig.reviewers,
    };
  });

  const contextPacks = createContextPackService(ctx)
    .listPacks()
    .map((p) => ({ name: p.name, description: p.description, noteCount: p.noteCount }));

  return {
    schemaVersion: SCHEMA_VERSION,
    serverVersion: readServerVersion(),
    strictStaleFilter: config.strict_stale_filter,
    scopes,
    contextPacks,
    usagePolicy: USAGE_POLICY,
    recommendedFirstSteps: RECOMMENDED_FIRST_STEPS,
  };
}
