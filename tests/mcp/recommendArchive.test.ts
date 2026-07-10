import { describe, it, expect } from "vitest";
import { recommendArchiveTool } from "../../src/mcp/tools/recommendArchive.js";
import { getReviewItemTool } from "../../src/mcp/tools/getReviewItem.js";
import { listReviewItemsTool } from "../../src/mcp/tools/listReviewItems.js";
import { createReviewService } from "../../src/core/reviews.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

describe("recommend_archive tool", () => {
  it("creates a pending_review archive_recommendation proposal", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_1", status: "verified", version: 2, title: "旧料金FAQ" });

    const body = structured<{
      proposal_id: string;
      note_id: string;
      proposal_type: string;
      status: string;
      reason: string;
      message: string;
    }>(recommendArchiveTool(ctx, { note_id: "note_1", reason: "2026年の料金改定で内容が古くなったため" }));

    expect(body.proposal_id).toMatch(/^proposal_/);
    expect(body.note_id).toBe("note_1");
    expect(body.proposal_type).toBe("archive_recommendation");
    expect(body.status).toBe("pending_review");
    expect(body.reason).toBe("2026年の料金改定で内容が古くなったため");
    expect(body.message).toContain("human");
  });

  it("errors with not_verified for a draft note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_d1", status: "draft" });

    const err = errorPayload(recommendArchiveTool(ctx, { note_id: "note_d1", reason: "obsolete" }));
    expect(err.code).toBe("not_verified");
  });

  it("errors with archived_target for an already-archived note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_a1", status: "archived", version: 1 });

    const err = errorPayload(recommendArchiveTool(ctx, { note_id: "note_a1", reason: "obsolete" }));
    expect(err.code).toBe("archived_target");
  });

  it("errors not_found for a nonexistent note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const err = errorPayload(recommendArchiveTool(ctx, { note_id: "note_does_not_exist", reason: "obsolete" }));
    expect(err.code).toBe("not_found");
  });

  it("idempotency_key replay returns the same result and creates no second proposal", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_i1", status: "verified", version: 1 });

    const args = { note_id: "note_i1", reason: "obsolete", idempotency_key: "arch-1" };
    const first = structured<{ proposal_id: string }>(recommendArchiveTool(ctx, args));
    const second = structured<{ proposal_id: string }>(recommendArchiveTool(ctx, args));
    expect(second).toEqual(first);

    const count = ctx.db.prepare("SELECT COUNT(*) AS c FROM update_proposals WHERE note_id = ?").get("note_i1") as { c: number };
    expect(count.c).toBe(1);
  });

  it("approving via the core review service archives the note; get_review_item and list_review_items reflect proposal_type", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_e1", status: "verified", version: 1, title: "旧FAQ" });
    const created = structured<{ proposal_id: string }>(
      recommendArchiveTool(ctx, { note_id: "note_e1", reason: "obsolete" }),
    );

    const listBody = structured<{ items: Array<{ id: string; proposal_type: string; title: string }> }>(
      listReviewItemsTool(ctx, { kind: "proposal" }),
    );
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0].proposal_type).toBe("archive_recommendation");
    expect(listBody.items[0].title).toContain("Archive recommendation");

    const detailBody = structured<{ proposal_type: string; reason: string; diff: string }>(
      getReviewItemTool(ctx, { id: created.proposal_id }),
    );
    expect(detailBody.proposal_type).toBe("archive_recommendation");
    expect(detailBody.reason).toBe("obsolete");
    expect(detailBody.diff).toBe("");

    const reviewerReviews = createReviewService({ ...ctx, actor: "reviewer:human" });
    const approveResult = reviewerReviews.approve(created.proposal_id, "confirmed");
    expect(approveResult.note.status).toBe("archived");
  });
});
