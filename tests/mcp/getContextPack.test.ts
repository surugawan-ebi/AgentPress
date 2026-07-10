import { describe, it, expect } from "vitest";
import { getContextPackTool } from "../../src/mcp/tools/getContextPack.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

describe("get_context_pack tool", () => {
  it("returns notes with citation, scoped/tagged by the pack definition", () => {
    const ctx = makeTestContext({
      config: {
        context_packs: {
          support_core: { description: "Core support knowledge", scopes: ["support"], tags: [], note_ids: [] },
        },
      },
    });
    insertNoteFixture(ctx, { id: "note_1", status: "verified", scope: "support", title: "返金ポリシー" });
    insertNoteFixture(ctx, { id: "note_2", status: "verified", scope: "eng" });

    const body = structured<{
      name: string;
      description: string;
      notes: Array<{ id: string; title: string; citation: { note_id: string }; body?: string }>;
      excluded: unknown[];
      truncated: boolean;
      next_cursor: string | null;
      warnings: string[];
    }>(getContextPackTool(ctx, { name: "support_core" }));

    expect(body.name).toBe("support_core");
    expect(body.description).toBe("Core support knowledge");
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].id).toBe("note_1");
    expect(body.notes[0].citation.note_id).toBe("note_1");
    expect(body.notes[0].body).toBeUndefined();
    expect(body.excluded).toEqual([]);
    expect(body.truncated).toBe(false);
    expect(body.next_cursor).toBeNull();
  });

  it("include_body:true returns bodies with body_truncated flags", () => {
    const ctx = makeTestContext({
      config: {
        context_packs: { p1: { description: "", scopes: ["support"], tags: [], note_ids: [] } },
        max_body_chars: 10,
      },
    });
    insertNoteFixture(ctx, { id: "note_1", status: "verified", scope: "support", body: "x".repeat(50) });

    const body = structured<{ notes: Array<{ body: string; body_truncated: boolean }> }>(
      getContextPackTool(ctx, { name: "p1", include_body: true }),
    );
    expect(body.notes[0].body).toHaveLength(10);
    expect(body.notes[0].body_truncated).toBe(true);
  });

  it("reports excluded entries with reasons", () => {
    const ctx = makeTestContext({
      config: {
        context_packs: { p1: { description: "", scopes: [], tags: [], note_ids: ["note_archived", "note_missing"] } },
      },
    });
    insertNoteFixture(ctx, { id: "note_archived", status: "archived", scope: "support" });

    const body = structured<{ excluded: Array<{ id: string; reason: string }> }>(getContextPackTool(ctx, { name: "p1" }));
    expect(body.excluded).toEqual([
      { id: "note_archived", reason: "archived" },
      { id: "note_missing", reason: "not_found" },
    ]);
  });

  it("errors not_found for an unknown pack name with available packs in suggested_action", () => {
    const ctx = makeTestContext({
      config: { context_packs: { existing: { description: "", scopes: [], tags: [], note_ids: [] } } },
    });

    const err = errorPayload(getContextPackTool(ctx, { name: "nope" }));
    expect(err.code).toBe("not_found");
    expect(err.suggested_action).toContain("existing");
  });

  it("respects limit/cursor pagination", () => {
    const ctx = makeTestContext({
      config: { context_packs: { p1: { description: "", scopes: ["support"], tags: [], note_ids: [] } } },
    });
    for (let i = 0; i < 5; i++) {
      insertNoteFixture(ctx, { id: `note_${i}`, status: "verified", scope: "support" });
    }

    const first = structured<{ notes: Array<{ id: string }>; truncated: boolean; next_cursor: string | null }>(
      getContextPackTool(ctx, { name: "p1", limit: 2 }),
    );
    expect(first.notes).toHaveLength(2);
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).not.toBeNull();

    const second = structured<{ notes: Array<{ id: string }> }>(
      getContextPackTool(ctx, { name: "p1", limit: 2, cursor: first.next_cursor }),
    );
    expect(second.notes).toHaveLength(2);
  });

  it("includes a pack-level warning when stale notes are included (strict_stale_filter:false)", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const ctx = makeTestContext({
      config: { context_packs: { p1: { description: "", scopes: ["support"], tags: [], note_ids: [] } }, strict_stale_filter: false },
    });
    insertNoteFixture(ctx, { id: "note_stale", status: "verified", scope: "support", reviewDueAt: past });

    const body = structured<{ notes: Array<{ stale: boolean }>; warnings: string[] }>(getContextPackTool(ctx, { name: "p1" }));
    expect(body.notes[0].stale).toBe(true);
    expect(body.warnings.length).toBe(1);
  });
});
