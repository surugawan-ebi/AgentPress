import { describe, it, expect } from "vitest";
import { proposeNoteUpdateTool } from "../../src/mcp/tools/proposeNoteUpdate.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

function proposalInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "note_v1",
    base_note_version: 1,
    proposed_body: "# 概要\n更新後の本文です。",
    reason: "古い記述を更新するため",
    source: [{ type: "url", url: "https://example.com" }],
    ...overrides,
  };
}

describe("propose_note_update tool", () => {
  it("creates a pending_review proposal against a verified note with a diff and changed_fields", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v1", status: "verified", version: 1, body: "# 概要\n古い本文です。" });

    const body = structured<{
      proposal_id: string;
      note_id: string;
      proposal_type: string;
      status: string;
      base_note_version: number;
      diff: string;
      changed_fields: string[];
      message: string;
    }>(proposeNoteUpdateTool(ctx, proposalInput()));

    expect(body.proposal_id).toMatch(/^proposal_/);
    expect(body.note_id).toBe("note_v1");
    expect(body.proposal_type).toBe("update");
    expect(body.status).toBe("pending_review");
    expect(body.base_note_version).toBe(1);
    expect(body.changed_fields).toEqual(["body"]);
    expect(body.diff).toContain("note_v1");
    expect(body.message).toContain("Human approval is required");
  });

  it("errors with version_conflict (and creates no proposal) when base_note_version is stale", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v2", status: "verified", version: 3 });

    const err = errorPayload(proposeNoteUpdateTool(ctx, proposalInput({ id: "note_v2", base_note_version: 1 })));
    expect(err.code).toBe("version_conflict");
    expect(err.retryable).toBe(true);
    expect(err.details).toMatchObject({ base_note_version: 1, current_version: 3 });

    const row = ctx.db.prepare("SELECT COUNT(*) AS c FROM update_proposals WHERE note_id = ?").get("note_v2") as {
      c: number;
    };
    expect(row.c).toBe(0);
  });

  it("errors with archived_target for an archived note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_a1", status: "archived", version: 1 });

    const err = errorPayload(proposeNoteUpdateTool(ctx, proposalInput({ id: "note_a1", base_note_version: 1 })));
    expect(err.code).toBe("archived_target");
  });

  it("errors with invalid_input for a draft target (use update_draft instead)", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_d1", status: "draft", version: 1 });

    const err = errorPayload(proposeNoteUpdateTool(ctx, proposalInput({ id: "note_d1", base_note_version: 1 })));
    expect(err.code).toBe("invalid_input");
    expect(err.suggested_action).toBe("use update_draft for draft/rejected notes");
  });

  it("errors with empty_change when nothing is actually changed", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v3", status: "verified", version: 1, title: "同じタイトル" });

    const err = errorPayload(
      proposeNoteUpdateTool(ctx, {
        id: "note_v3",
        base_note_version: 1,
        proposed_title: "同じタイトル",
        reason: "no-op",
        source: [],
      }),
    );
    expect(err.code).toBe("empty_change");
  });
});
