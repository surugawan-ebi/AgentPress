import { describe, it, expect } from "vitest";
import { searchNotesTool } from "../../src/mcp/tools/searchNotes.js";
import { makeTestContext } from "../helpers.js";
import { structured } from "./toolTestHelpers.js";
import { buildSearchText } from "../../src/core/searchText.js";
import type { AppContext } from "../../src/core/context.js";

function insertNote(
  ctx: AppContext,
  opts: { id: string; title: string; summary: string; body?: string; status?: string; reviewDueAt?: string | null },
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
         (@id, @slug, @title, @summary, @body, @status, 'high', 'analytics', NULL, 3,
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
      search_text: buildSearchText(opts.title, opts.summary, body, []),
    });
}

describe("search_notes tool", () => {
  it("returns results with a citation carrying version/review_due_at/stale", () => {
    const ctx = makeTestContext();
    const future = new Date(Date.now() + 100000).toISOString();
    insertNote(ctx, { id: "note_1", title: "GA4連携ガイド", summary: "GA4のセットアップ手順です。", reviewDueAt: future });

    const body = structured<{ results: Array<{ id: string; citation: Record<string, unknown> }> }>(
      searchNotesTool(ctx, { query: "GA4" }),
    );

    expect(body.results).toHaveLength(1);
    expect(body.results[0].citation).toMatchObject({
      note_id: "note_1",
      version: 3,
      stale: false,
      review_due_at: future,
    });
  });

  it("flags stale:true on both the result and its citation past review_due_at", () => {
    const ctx = makeTestContext();
    const past = new Date(Date.now() - 1000).toISOString();
    insertNote(ctx, { id: "note_2", title: "古いSOP", summary: "古くなった手順です。", reviewDueAt: past });

    const body = structured<{ results: Array<{ stale: boolean; citation: { stale: boolean } }> }>(
      searchNotesTool(ctx, { query: "古いSOP" }),
    );
    expect(body.results[0].stale).toBe(true);
    expect(body.results[0].citation.stale).toBe(true);
  });

  it("returns the no_results shape with guidance and suggested_next_tools when nothing matches", () => {
    const ctx = makeTestContext();

    const body = structured<{
      results: unknown[];
      no_results: boolean;
      query: string;
      searched_statuses: string[];
      guidance: string;
      suggested_next_tools: string[];
    }>(searchNotesTool(ctx, { query: "存在しないキーワード" }));

    expect(body.results).toEqual([]);
    expect(body.no_results).toBe(true);
    expect(body.query).toBe("存在しないキーワード");
    expect(body.searched_statuses).toEqual(["verified"]);
    expect(body.suggested_next_tools).toEqual(["create_note_draft"]);
    expect(body.guidance).toContain("create_note_draft");
  });

  it("excludes archived notes by default, includes them with include_archived:true", () => {
    const ctx = makeTestContext();
    insertNote(ctx, { id: "note_a", title: "料金FAQ旧版", summary: "旧料金プランのFAQです。", status: "archived" });

    const without = structured<{ results: unknown[] }>(searchNotesTool(ctx, { query: "料金FAQ旧版" }));
    expect(without.results).toEqual([]);

    const withArchived = structured<{ results: Array<{ id: string; status: string }> }>(
      searchNotesTool(ctx, { query: "料金FAQ旧版", include_archived: true }),
    );
    expect(withArchived.results.map((r) => r.id)).toContain("note_a");
    expect(withArchived.results[0].status).toBe("archived");
  });
});
