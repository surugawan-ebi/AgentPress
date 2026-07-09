import { describe, it, expect } from "vitest";
import { getNoteTool } from "../../src/mcp/tools/getNote.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

describe("get_note tool", () => {
  it("returns full detail plus a citation for a verified note", () => {
    const ctx = makeTestContext();
    const future = new Date(Date.now() + 100000).toISOString();
    insertNoteFixture(ctx, {
      id: "note_v1",
      status: "verified",
      version: 2,
      title: "GA4連携ガイド",
      reviewDueAt: future,
      tags: ["GA4"],
    });

    const body = structured<{
      id: string;
      status: string;
      stale: boolean;
      tags: string[];
      usage_warning?: string;
      citation: Record<string, unknown>;
    }>(getNoteTool(ctx, { id: "note_v1" }));

    expect(body.id).toBe("note_v1");
    expect(body.status).toBe("verified");
    expect(body.stale).toBe(false);
    expect(body.tags).toEqual(["GA4"]);
    expect(body.usage_warning).toBeUndefined();
    expect(body.citation).toMatchObject({ note_id: "note_v1", version: 2, stale: false, review_due_at: future });
  });

  it("attaches a required usage_warning for archived notes", () => {
    const ctx = makeTestContext();
    insertNoteFixture(ctx, { id: "note_a1", status: "archived" });

    const body = structured<{ status: string; usage_warning: string }>(getNoteTool(ctx, { id: "note_a1" }));
    expect(body.status).toBe("archived");
    expect(body.usage_warning).toBe("This note is archived and no longer recommended as current guidance.");
  });

  it("errors with not_verified for a draft note", () => {
    const ctx = makeTestContext();
    insertNoteFixture(ctx, { id: "note_d1", status: "draft" });

    const err = errorPayload(getNoteTool(ctx, { id: "note_d1" }));
    expect(err.code).toBe("not_verified");
    expect(err.details).toMatchObject({ status: "draft" });
    expect(err.suggested_action).toBe("use get_review_item");
  });

  it("errors with not_verified for a rejected note", () => {
    const ctx = makeTestContext();
    insertNoteFixture(ctx, { id: "note_r1", status: "rejected" });

    const err = errorPayload(getNoteTool(ctx, { id: "note_r1" }));
    expect(err.code).toBe("not_verified");
  });

  it("errors with not_found for an unknown id", () => {
    const ctx = makeTestContext();
    const err = errorPayload(getNoteTool(ctx, { id: "note_does_not_exist" }));
    expect(err.code).toBe("not_found");
  });
});
