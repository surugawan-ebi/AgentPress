import { describe, it, expect } from "vitest";
import { updateDraftTool } from "../../src/mcp/tools/updateDraft.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

describe("update_draft tool", () => {
  it("updates a draft owned by the caller", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_d1", status: "draft", createdBy: "agent:codex", title: "旧タイトル" });

    const body = structured<{ id: string; status: string; resubmitted: boolean; message: string }>(
      updateDraftTool(ctx, { id: "note_d1", title: "新タイトル" }),
    );

    expect(body.status).toBe("draft");
    expect(body.resubmitted).toBe(false);
    expect(body.message).toBe("Draft updated.");
  });

  it("resubmits a rejected note back to draft and reports resubmitted:true", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_r1", status: "rejected", createdBy: "agent:codex" });

    const body = structured<{ status: string; resubmitted: boolean; message: string }>(
      updateDraftTool(ctx, { id: "note_r1", body: "# 概要\n修正しました" }),
    );

    expect(body.status).toBe("draft");
    expect(body.resubmitted).toBe(true);
    expect(body.message).toContain("resubmitted");
  });

  it("errors with not_draft_owner when editing someone else's draft", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_d2", status: "draft", createdBy: "agent:other" });

    const err = errorPayload(updateDraftTool(ctx, { id: "note_d2", title: "乗っ取り" }));
    expect(err.code).toBe("not_draft_owner");
  });

  it("errors with archived_target when trying to edit an archived note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_a1", status: "archived", createdBy: "agent:codex" });

    const err = errorPayload(updateDraftTool(ctx, { id: "note_a1", title: "編集不可" }));
    expect(err.code).toBe("archived_target");
  });
});
