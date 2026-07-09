import { describe, it, expect } from "vitest";
import { getReviewItemTool } from "../../src/mcp/tools/getReviewItem.js";
import { proposeNoteUpdateTool } from "../../src/mcp/tools/proposeNoteUpdate.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

describe("get_review_item tool", () => {
  it("always sets usable_as_context:false for a draft note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_g1", status: "draft" });

    const body = structured<{ usable_as_context: boolean; kind: string; body: string }>(
      getReviewItemTool(ctx, { id: "note_g1" }),
    );
    expect(body.usable_as_context).toBe(false);
    expect(body.kind).toBe("note");
  });

  it("includes draft_reason and rejection_reason for a note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_g2", status: "rejected" });
    ctx.db
      .prepare("UPDATE notes SET rejection_reason = 'too vague', draft_reason = 'no formal source' WHERE id = ?")
      .run("note_g2");

    const body = structured<{ rejection_reason: string; draft_reason: string }>(
      getReviewItemTool(ctx, { id: "note_g2" }),
    );
    expect(body.rejection_reason).toBe("too vague");
    expect(body.draft_reason).toBe("no formal source");
  });

  it("returns needs_rebase recovery info (base/current version, target_note_id, suggested_action) for a proposal", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v1", status: "verified", version: 1 });
    const created = proposeNoteUpdateTool(ctx, {
      id: "note_v1",
      base_note_version: 1,
      proposed_body: "# 概要\n更新後",
      reason: "更新のため",
      source: [],
    });
    const proposalId = (created.structuredContent as { proposal_id: string }).proposal_id;

    // Someone else bumps the note's version before this proposal is approved.
    ctx.db.prepare("UPDATE notes SET version = 2 WHERE id = ?").run("note_v1");
    ctx.db.prepare("UPDATE update_proposals SET status = 'needs_rebase' WHERE id = ?").run(proposalId);

    const body = structured<{
      kind: string;
      status: string;
      usable_as_context: boolean;
      target_note_id: string;
      base_note_version: number;
      current_note_version: number;
      suggested_action: string;
      diff: string;
    }>(getReviewItemTool(ctx, { id: proposalId }));

    expect(body.kind).toBe("proposal");
    expect(body.status).toBe("needs_rebase");
    expect(body.usable_as_context).toBe(false);
    expect(body.target_note_id).toBe("note_v1");
    expect(body.base_note_version).toBe(1);
    expect(body.current_note_version).toBe(2);
    expect(body.suggested_action).toBe("fetch current note and resubmit");
    expect(body.diff).toContain("note_v1");
  });

  it("errors with not_found for an unknown id", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const err = errorPayload(getReviewItemTool(ctx, { id: "note_does_not_exist" }));
    expect(err.code).toBe("not_found");
  });

  it("includes reason/source/proposed_by/changed_fields for a proposal", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v2", status: "verified", version: 1 });
    const created = proposeNoteUpdateTool(ctx, {
      id: "note_v2",
      base_note_version: 1,
      proposed_body: "# 概要\n更新後",
      reason: "古い記述を更新するため",
      source: [{ type: "manual", title: "seed" }],
    });
    const proposalId = (created.structuredContent as { proposal_id: string }).proposal_id;

    const body = structured<{
      reason: string;
      proposed_by: string;
      changed_fields: string[];
      source: Array<{ type: string; title?: string }>;
    }>(getReviewItemTool(ctx, { id: proposalId }));

    expect(body.reason).toBe("古い記述を更新するため");
    expect(body.proposed_by).toBe("agent:codex");
    expect(body.changed_fields).toEqual(["body"]);
    expect(body.source).toEqual([{ type: "manual", title: "seed" }]);
  });
});
