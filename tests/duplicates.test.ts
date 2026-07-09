import { describe, it, expect } from "vitest";
import { findPossibleDuplicates, normalizeForSearch } from "../src/core/duplicates.js";
import { makeTestContext } from "./helpers.js";
import { buildSearchText } from "../src/core/searchText.js";

function insertNote(ctx: ReturnType<typeof makeTestContext>, opts: {
  id: string;
  title: string;
  summary: string;
  status?: string;
}) {
  const now = new Date().toISOString();
  const body = "# 概要\nダミー本文";
  ctx.db
    .prepare(
      `INSERT INTO notes
         (id, slug, title, summary, body, status, confidence, scope, owner, version,
          created_by, reviewed_by, created_at, updated_at, verified_at, archived_at,
          review_due_at, rejection_reason, draft_reason, search_text, metadata_json)
       VALUES
         (@id, @slug, @title, @summary, @body, @status, 'medium', NULL, NULL, 1,
          'tester', NULL, @now, @now, NULL, NULL, NULL, NULL, NULL, @search_text, '{}')`,
    )
    .run({
      id: opts.id,
      slug: opts.id,
      title: opts.title,
      summary: opts.summary,
      body,
      status: opts.status ?? "verified",
      now,
      search_text: buildSearchText(opts.title, opts.summary, body, []),
    });
}

describe("normalizeForSearch", () => {
  it("applies NFKC normalization and lowercases", () => {
    expect(normalizeForSearch("ＡＢＣ")).toBe("abc");
  });
});

describe("findPossibleDuplicates", () => {
  it("returns [] when there is nothing to compare against", () => {
    const ctx = makeTestContext();
    expect(findPossibleDuplicates(ctx, "返金ポリシーについて", "返金の条件をまとめた要約です")).toEqual([]);
  });

  it("finds a verified note with an overlapping Japanese title", () => {
    const ctx = makeTestContext();
    insertNote(ctx, {
      id: "note_existing1",
      title: "返金ポリシー",
      summary: "返金の条件について説明します",
      status: "verified",
    });

    const results = findPossibleDuplicates(ctx, "返金ポリシーの詳細", "返金の条件をまとめた要約です");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("note_existing1");
    expect(results[0].status).toBe("verified");
    expect(results[0].suggestedTool).toBe("get_note");
  });

  it("finds duplicates across verified and draft notes but not archived/rejected", () => {
    const ctx = makeTestContext();
    insertNote(ctx, { id: "note_draft1", title: "エスカレーション基準", summary: "対応が難しい場合の基準です", status: "draft" });
    insertNote(ctx, { id: "note_archived1", title: "エスカレーション基準旧版", summary: "旧版の基準です", status: "archived" });
    insertNote(ctx, { id: "note_rejected1", title: "エスカレーション基準却下版", summary: "却下された基準です", status: "rejected" });

    const results = findPossibleDuplicates(ctx, "エスカレーション基準", "対応が難しい場合の基準の要約です");
    const ids = results.map((r) => r.id);
    expect(ids).toContain("note_draft1");
    expect(ids).not.toContain("note_archived1");
    expect(ids).not.toContain("note_rejected1");
  });

  it("caps results at 5 and ranks by number of matched fields", () => {
    const ctx = makeTestContext();
    for (let i = 0; i < 8; i++) {
      insertNote(ctx, { id: `note_bulk${i}`, title: `料金FAQ ${i}`, summary: "料金に関するよくある質問です", status: "verified" });
    }
    const results = findPossibleDuplicates(ctx, "料金FAQ", "料金に関するよくある質問をまとめました");
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
