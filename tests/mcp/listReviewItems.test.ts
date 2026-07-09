import { describe, it, expect } from "vitest";
import { listReviewItemsTool } from "../../src/mcp/tools/listReviewItems.js";
import { proposeNoteUpdateTool } from "../../src/mcp/tools/proposeNoteUpdate.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured } from "./toolTestHelpers.js";

describe("list_review_items tool", () => {
  it("lists drafts and proposals together", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_l1", status: "draft", scope: "support" });
    insertNoteFixture(ctx, { id: "note_l2", status: "verified", version: 1, scope: "support" });
    proposeNoteUpdateTool(ctx, {
      id: "note_l2",
      base_note_version: 1,
      proposed_body: "# 概要\n更新",
      reason: "更新のため",
      source: [],
    });

    const body = structured<{ items: Array<{ kind: string }> }>(listReviewItemsTool(ctx, {}));
    expect(body.items.map((i) => i.kind).sort()).toEqual(["draft", "proposal"]);
  });

  it("filters to the caller's own items with created_by:'self'", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_l3", status: "draft", createdBy: "agent:codex", scope: "support" });
    insertNoteFixture(ctx, { id: "note_l4", status: "draft", createdBy: "agent:other", scope: "support" });

    const body = structured<{ items: Array<{ id: string; created_by: string }> }>(
      listReviewItemsTool(ctx, { kind: "draft", created_by: "self" }),
    );
    expect(body.items.map((i) => i.id)).toEqual(["note_l3"]);
    expect(body.items[0].created_by).toBe("agent:codex");
  });

  it("filters by an explicit created_by actor name (not just the 'self' alias)", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_l5", status: "draft", createdBy: "agent:codex", scope: "support" });
    insertNoteFixture(ctx, { id: "note_l6", status: "draft", createdBy: "agent:other", scope: "support" });

    const body = structured<{ items: Array<{ id: string }> }>(
      listReviewItemsTool(ctx, { kind: "draft", created_by: "agent:other" }),
    );
    expect(body.items.map((i) => i.id)).toEqual(["note_l6"]);
  });

  it("respects limit and reports has_warnings/has_duplicates", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_l7", status: "draft" });
    insertNoteFixture(ctx, { id: "note_l8", status: "draft" });

    const body = structured<{ items: Array<{ has_warnings: boolean; has_duplicates: boolean }> }>(
      listReviewItemsTool(ctx, { kind: "draft", limit: 1 }),
    );
    expect(body.items).toHaveLength(1);
    expect(typeof body.items[0].has_warnings).toBe("boolean");
    expect(typeof body.items[0].has_duplicates).toBe("boolean");
  });
});
