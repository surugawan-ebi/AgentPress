import { describe, it, expect } from "vitest";
import { createNoteDraftTool } from "../../src/mcp/tools/createNoteDraft.js";
import { slugify } from "../../src/core/noteRows.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "GA4にユーザーセグメントを連携する方法",
    summary: "GA4のユーザーセグメントをBigQuery経由でGCSへ連携する手順の要約です。",
    body: "# 概要\n手順の詳細\n\n# 正本回答\nここに書く",
    tags: ["GA4", "BigQuery"],
    source: [{ type: "url", url: "https://example.com/docs" }],
    confidence: "medium",
    scope: "analytics",
    ...overrides,
  };
}

describe("create_note_draft tool", () => {
  it("creates a draft note and returns final_slug/policy_warnings/possible_duplicates", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });

    const body = structured<{
      id: string;
      status: string;
      final_slug: string;
      slug_adjusted: boolean;
      possible_duplicates: unknown[];
      policy_warnings: unknown[];
      message: string;
    }>(createNoteDraftTool(ctx, draftInput()));

    expect(body.status).toBe("draft");
    expect(body.id).toMatch(/^note_/);
    expect(body.final_slug).toBe(slugify("GA4にユーザーセグメントを連携する方法"));
    expect(body.slug_adjusted).toBe(false);
    expect(body.possible_duplicates).toEqual([]);
    expect(body.policy_warnings).toEqual([]);
    expect(body.message).toContain("Human approval is required");
  });

  it("auto-suffixes final_slug on collision and reports slug_adjusted:true", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    createNoteDraftTool(ctx, draftInput());

    const body = structured<{ final_slug: string; slug_adjusted: boolean }>(
      createNoteDraftTool(ctx, draftInput({ tags: ["GA4"] })),
    );
    expect(body.slug_adjusted).toBe(true);
    expect(body.final_slug).toMatch(/-2$/);
  });

  it("errors invalid_input when neither source nor reason is provided", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const err = errorPayload(createNoteDraftTool(ctx, draftInput({ source: [], reason: null })));
    expect(err.code).toBe("invalid_input");
  });

  it("surfaces policy_warnings (e.g. tags_too_sparse, summary_too_short) without blocking creation", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const body = structured<{ status: string; policy_warnings: Array<{ code: string }> }>(
      createNoteDraftTool(
        ctx,
        draftInput({ tags: [], summary: "短い", body: "見出しなし本文" }),
      ),
    );
    expect(body.status).toBe("draft");
    const codes = body.policy_warnings.map((w) => w.code);
    expect(codes).toContain("tags_too_sparse");
    expect(codes).toContain("summary_too_short");
    expect(codes).toContain("missing_headings");
  });

  it("returns possible_duplicates when a similar verified note already exists", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, {
      id: "note_existing",
      status: "verified",
      title: "GA4にユーザーセグメントを連携する方法",
      summary: "GA4のユーザーセグメントをBigQuery経由でGCSへ連携する手順の要約です。",
    });

    const body = structured<{ possible_duplicates: Array<{ id: string; matched_fields: string[]; suggested_tool: string }> }>(
      createNoteDraftTool(ctx, draftInput()),
    );

    expect(body.possible_duplicates.length).toBeGreaterThan(0);
    const dup = body.possible_duplicates.find((d) => d.id === "note_existing");
    expect(dup).toBeDefined();
    expect(dup?.matched_fields.length).toBeGreaterThan(0);
    expect(dup?.suggested_tool).toBe("get_note");
  });
});
