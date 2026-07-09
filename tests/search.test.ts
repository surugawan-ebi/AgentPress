import { describe, it, expect } from "vitest";
import { createLikeSearchEngine } from "../src/core/search.js";
import { buildSearchText } from "../src/core/searchText.js";
import { makeTestContext } from "./helpers.js";
import type { AppContext } from "../src/core/context.js";

function insertNote(
  ctx: AppContext,
  opts: {
    id: string;
    title: string;
    summary: string;
    body?: string;
    status?: string;
    tags?: string[];
    reviewDueAt?: string | null;
  },
) {
  const now = new Date().toISOString();
  const body = opts.body ?? "# 概要\nダミー本文";
  ctx.db
    .prepare(
      `INSERT INTO notes
         (id, slug, title, summary, body, status, confidence, scope, owner, version,
          created_by, reviewed_by, created_at, updated_at, verified_at, archived_at,
          review_due_at, rejection_reason, draft_reason, search_text, metadata_json)
       VALUES
         (@id, @slug, @title, @summary, @body, @status, 'medium', NULL, NULL, 1,
          'tester', NULL, @now, @now, @now, NULL, @review_due_at, NULL, NULL, @search_text, '{}')`,
    )
    .run({
      id: opts.id,
      slug: opts.id,
      title: opts.title,
      summary: opts.summary,
      body,
      status: opts.status ?? "verified",
      now,
      review_due_at: opts.reviewDueAt ?? null,
      search_text: buildSearchText(opts.title, opts.summary, body, opts.tags ?? []),
    });
  for (const tag of opts.tags ?? []) {
    ctx.db.prepare("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)").run(opts.id, tag);
  }
}

describe("LikeSearchEngine", () => {
  it("finds a verified note by a Japanese substring in the body", () => {
    const ctx = makeTestContext();
    insertNote(ctx, {
      id: "note_1",
      title: "返金ポリシー",
      summary: "返金の条件についての要約です。",
      body: "# 概要\nBigQueryへのセグメント連携について説明します。",
    });
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "BigQuery" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("note_1");
    expect(result.results[0].matchedFields).toContain("body");
    expect(result.results[0].snippet).toContain("BigQuery");
  });

  it("normalizes full-width query characters (NFKC) before matching", () => {
    const ctx = makeTestContext();
    insertNote(ctx, { id: "note_2", title: "ＧＡ４連携ガイド", summary: "GA4のセットアップ手順です。" });
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "GA4" });
    expect(result.results.map((r) => r.id)).toContain("note_2");
  });

  it("only searches verified notes by default and excludes archived", () => {
    const ctx = makeTestContext();
    insertNote(ctx, { id: "note_v", title: "エスカレーション基準", summary: "対応が難しい場合の基準です。", status: "verified" });
    insertNote(ctx, { id: "note_a", title: "エスカレーション基準旧版", summary: "旧版の基準です。", status: "archived" });
    insertNote(ctx, { id: "note_d", title: "エスカレーション基準ドラフト", summary: "ドラフト中の基準です。", status: "draft" });
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "エスカレーション" });
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain("note_v");
    expect(ids).not.toContain("note_a");
    expect(ids).not.toContain("note_d");
  });

  it("includes archived notes when include_archived is true", () => {
    const ctx = makeTestContext();
    insertNote(ctx, { id: "note_a2", title: "料金FAQ旧版", summary: "旧料金プランのFAQです。", status: "archived" });
    const engine = createLikeSearchEngine(ctx);

    const withoutArchived = engine.search({ query: "料金FAQ旧版" });
    expect(withoutArchived.results.map((r) => r.id)).not.toContain("note_a2");

    const withArchived = engine.search({ query: "料金FAQ旧版", include_archived: true });
    expect(withArchived.results.map((r) => r.id)).toContain("note_a2");
  });

  it("flags stale: true for verified notes past review_due_at", () => {
    const ctx = makeTestContext();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    insertNote(ctx, { id: "note_stale", title: "古いSOP", summary: "古くなった対応手順です。", reviewDueAt: past });
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "古いSOP" });
    expect(result.results[0].stale).toBe(true);
    expect(result.results[0].citation.stale).toBe(true);
  });

  it("excludes stale notes entirely when strict_stale_filter is true", () => {
    const ctx = makeTestContext({ config: { strict_stale_filter: true } });
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    insertNote(ctx, { id: "note_stale2", title: "古いSOP2", summary: "古くなった対応手順です。", reviewDueAt: past });
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "古いSOP2" });
    expect(result.noResults).toBe(true);
  });

  it("returns the no_results shape when nothing matches", () => {
    const ctx = makeTestContext();
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "存在しないキーワード", scope: "support" });
    expect(result.results).toEqual([]);
    expect(result.noResults).toBe(true);
    expect(result.query).toBe("存在しないキーワード");
    expect(result.scope).toBe("support");
    expect(result.searchedStatuses).toEqual(["verified"]);
    expect(result.suggestedNextTools).toEqual(["create_note_draft"]);
    expect(result.guidance).toBeTruthy();
  });

  it("respects the limit", () => {
    const ctx = makeTestContext();
    for (let i = 0; i < 5; i++) {
      insertNote(ctx, { id: `note_bulk${i}`, title: `共通キーワード${i}`, summary: "共通キーワードを含む要約です。" });
    }
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "共通キーワード", limit: 2 });
    expect(result.results).toHaveLength(2);
  });

  it("filters by tags", () => {
    const ctx = makeTestContext();
    insertNote(ctx, { id: "note_tagged", title: "タグ付きノート", summary: "タグでの絞り込みテスト用です。", tags: ["support", "faq"] });
    insertNote(ctx, { id: "note_untagged", title: "タグ付きノート2", summary: "タグでの絞り込みテスト用です。", tags: ["eng"] });
    const engine = createLikeSearchEngine(ctx);

    const result = engine.search({ query: "タグ付きノート", tags: ["support"] });
    expect(result.results.map((r) => r.id)).toEqual(["note_tagged"]);
  });
});
