import { describe, it, expect } from "vitest";
import { createReviewService } from "../src/core/reviews.js";
import { AgentPressError } from "../src/core/errors.js";
import { makeTestContext, insertNoteFixture } from "./helpers.js";
import type { AppContext } from "../src/core/context.js";

function captureError(fn: () => unknown): AgentPressError {
  try {
    fn();
  } catch (err) {
    return err as AgentPressError;
  }
  throw new Error("expected function to throw");
}

function proposalInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "note_v1",
    base_note_version: 1,
    proposed_body: "# 概要\n更新後の本文です。",
    reason: "古い記述を更新するため",
    source: [{ type: "url" as const, url: "https://example.com" }],
    ...overrides,
  };
}

function ctxAs(base: AppContext, actor: string): AppContext {
  return { ...base, actor };
}

describe("createProposal", () => {
  it("creates a pending_review proposal against a verified note with a diff and changed_fields", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v1", status: "verified", version: 1, body: "# 概要\n古い本文です。" });
    const reviews = createReviewService(ctx);

    const result = reviews.createProposal(proposalInput());

    expect(result.proposal.status).toBe("pending_review");
    expect(result.proposal.noteId).toBe("note_v1");
    expect(result.proposal.baseNoteVersion).toBe(1);
    expect(result.proposal.changedFields).toEqual(["body"]);
    expect(result.proposal.diff).toContain("note_v1");
  });

  it("rejects proposals against draft notes", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_d1", status: "draft" });
    const reviews = createReviewService(ctx);

    const err = captureError(() => reviews.createProposal(proposalInput({ id: "note_d1" })));
    expect(err.code).toBe("invalid_input");
  });

  it("rejects proposals against archived notes", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_a1", status: "archived", version: 1 });
    const reviews = createReviewService(ctx);

    const err = captureError(() => reviews.createProposal(proposalInput({ id: "note_a1", base_note_version: 1 })));
    expect(err.code).toBe("archived_target");
  });

  it("fails with version_conflict when base_note_version does not match, and creates no proposal", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v2", status: "verified", version: 3 });
    const reviews = createReviewService(ctx);

    const err = captureError(() => reviews.createProposal(proposalInput({ id: "note_v2", base_note_version: 1 })));
    expect(err.code).toBe("version_conflict");

    const items = reviews.listReviewItems({ kind: "proposal" });
    expect(items).toHaveLength(0);
  });

  it("fails with empty_change when nothing actually changes", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v3", status: "verified", version: 1, title: "同じタイトル" });
    const reviews = createReviewService(ctx);

    const err = captureError(() =>
      reviews.createProposal({
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

describe("approve - draft note", () => {
  it("verifies a draft note created by a different actor (no ownership restriction on review actions)", () => {
    const ctx = makeTestContext({ actor: "reviewer:human" });
    insertNoteFixture(ctx, { id: "note_d2", status: "draft", createdBy: "agent:codex", owner: "support-team", version: 1 });
    const reviews = createReviewService(ctx);

    const result = reviews.approve("note_d2", "looks good");

    expect(result.kind).toBe("note");
    expect(result.note.status).toBe("verified");
    expect(result.note.verifiedAt).not.toBeNull();
    expect(result.note.reviewDueAt).not.toBeNull();
  });

  it("includes a reviewer_separation warning (but still approves) when approver === author", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_d3", status: "draft", createdBy: "agent:codex", owner: "support-team" });
    const reviews = createReviewService(ctx);

    const result = reviews.approve("note_d3");
    expect(result.note.status).toBe("verified");
    expect(result.policyWarnings.map((w) => w.code)).toContain("reviewer_separation");
  });

  it("refuses to approve a note that is not a draft", () => {
    const ctx = makeTestContext({ actor: "reviewer:human" });
    insertNoteFixture(ctx, { id: "note_v4", status: "verified" });
    const reviews = createReviewService(ctx);

    expect(() => reviews.approve("note_v4")).toThrow(AgentPressError);
  });
});

describe("approve - proposal", () => {
  it("applies the proposal to the note, bumps version, and marks the proposal approved", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v5", status: "verified", version: 1, body: "# 概要\n古い本文" });
    const reviews = createReviewService(ctx);
    const { proposal } = reviews.createProposal(proposalInput({ id: "note_v5" }));

    const reviewerCtx = ctxAs(ctx, "reviewer:human");
    const reviewerReviews = createReviewService(reviewerCtx);
    const result = reviewerReviews.approve(proposal.id, "approved");

    expect(result.kind).toBe("proposal");
    expect(result.note.version).toBe(2);
    expect(result.note.body).toContain("更新後の本文");
    expect(result.proposal?.status).toBe("approved");
    expect(result.cascadedNeedsRebase).toEqual([]);
  });

  it("on version mismatch, commits the proposal to needs_rebase THEN throws version_conflict", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v6", status: "verified", version: 1 });
    const reviews = createReviewService(ctx);
    const { proposal } = reviews.createProposal(proposalInput({ id: "note_v6" }));

    // Someone else's proposal (or a direct edit) bumps the note's version before this one is approved.
    ctx.db.prepare("UPDATE notes SET version = 2 WHERE id = ?").run("note_v6");

    const err = captureError(() => reviews.approve(proposal.id));
    expect(err.code).toBe("version_conflict");

    // The needs_rebase transition must have survived even though approve() threw.
    const item = reviews.getReviewItem(proposal.id);
    expect(item.status).toBe("needs_rebase");
    expect(item.suggestedAction).toBe("fetch current note and resubmit");
    expect(item.baseNoteVersion).toBe(1);
    expect(item.currentNoteVersion).toBe(2);
  });

  it("cascades other pending proposals on the same note to needs_rebase on approval", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v7", status: "verified", version: 1 });
    const reviews = createReviewService(ctx);
    const first = reviews.createProposal(proposalInput({ id: "note_v7", proposed_body: "# 概要\n提案A" }));
    const second = reviews.createProposal(
      proposalInput({ id: "note_v7", proposed_summary: "提案Bによる新しい要約文章です。二十文字以上あります。" }),
    );

    const result = reviews.approve(first.proposal.id);
    expect(result.cascadedNeedsRebase).toEqual([second.proposal.id]);

    const secondItem = reviews.getReviewItem(second.proposal.id);
    expect(secondItem.status).toBe("needs_rebase");
  });

  it("refuses to approve a proposal that is already approved or rejected", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v8", status: "verified", version: 1 });
    const reviews = createReviewService(ctx);
    const { proposal } = reviews.createProposal(proposalInput({ id: "note_v8" }));
    reviews.approve(proposal.id);

    expect(() => reviews.approve(proposal.id)).toThrow(AgentPressError);
  });
});

describe("reject", () => {
  it("rejects a draft note and records the reason", () => {
    const ctx = makeTestContext({ actor: "reviewer:human" });
    insertNoteFixture(ctx, { id: "note_d4", status: "draft", createdBy: "agent:codex" });
    const reviews = createReviewService(ctx);

    const result = reviews.reject("note_d4", "insufficient evidence");
    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toBe("insufficient evidence");
    expect(result.note?.status).toBe("rejected");
  });

  it("rejects a pending proposal and records the reason", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_v9", status: "verified", version: 1 });
    const reviews = createReviewService(ctx);
    const { proposal } = reviews.createProposal(proposalInput({ id: "note_v9" }));

    const result = reviews.reject(proposal.id, "not needed");
    expect(result.status).toBe("rejected");
    expect(result.proposal?.status).toBe("rejected");
  });

  it("requires a reason", () => {
    const ctx = makeTestContext({ actor: "reviewer:human" });
    insertNoteFixture(ctx, { id: "note_d5", status: "draft" });
    const reviews = createReviewService(ctx);

    expect(() => reviews.reject("note_d5", "")).toThrow(AgentPressError);
  });

  it("refuses to reject a note that is not a draft", () => {
    const ctx = makeTestContext({ actor: "reviewer:human" });
    insertNoteFixture(ctx, { id: "note_v10", status: "verified" });
    const reviews = createReviewService(ctx);

    expect(() => reviews.reject("note_v10", "no")).toThrow(AgentPressError);
  });
});

describe("listReviewItems", () => {
  it("lists drafts and proposals together, oldest first by default", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_l1", status: "draft", scope: "support" });
    insertNoteFixture(ctx, { id: "note_l2", status: "verified", version: 1, scope: "support" });
    const reviews = createReviewService(ctx);
    reviews.createProposal(proposalInput({ id: "note_l2" }));

    const items = reviews.listReviewItems({});
    expect(items.map((i) => i.kind).sort()).toEqual(["draft", "proposal"]);
  });

  it("filters by kind, scope, and createdBy=self", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_l3", status: "draft", createdBy: "agent:codex", scope: "support" });
    insertNoteFixture(ctx, { id: "note_l4", status: "draft", createdBy: "agent:other", scope: "support" });
    insertNoteFixture(ctx, { id: "note_l5", status: "draft", createdBy: "agent:codex", scope: "eng" });
    const reviews = createReviewService(ctx);

    const mine = reviews.listReviewItems({ kind: "draft", scope: "support", createdBy: "self" });
    expect(mine.map((i) => i.id)).toEqual(["note_l3"]);
  });

  it("respects limit", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_l6", status: "draft" });
    insertNoteFixture(ctx, { id: "note_l7", status: "draft" });
    const reviews = createReviewService(ctx);

    expect(reviews.listReviewItems({ kind: "draft", limit: 1 })).toHaveLength(1);
  });
});

describe("getReviewItem", () => {
  it("always sets usable_as_context to false", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_g1", status: "draft" });
    const reviews = createReviewService(ctx);

    expect(reviews.getReviewItem("note_g1").usableAsContext).toBe(false);
  });

  it("includes draft_reason and rejection_reason for a note", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_g2", status: "rejected" });
    ctx.db.prepare("UPDATE notes SET rejection_reason = 'too vague', draft_reason = 'no formal source' WHERE id = ?").run(
      "note_g2",
    );
    const reviews = createReviewService(ctx);

    const item = reviews.getReviewItem("note_g2");
    expect(item.rejectionReason).toBe("too vague");
    expect(item.draftReason).toBe("no formal source");
  });

  it("includes reason/source/proposedBy/changedFields for a proposal", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_g3", status: "verified", version: 1, body: "# 概要\n古い本文" });
    const reviews = createReviewService(ctx);
    const { proposal } = reviews.createProposal(proposalInput({ id: "note_g3" }));

    const item = reviews.getReviewItem(proposal.id);
    expect(item.reason).toBe("古い記述を更新するため");
    expect(item.proposedBy).toBe("agent:codex");
    expect(item.changedFields).toEqual(["body"]);
    expect(item.source).toEqual([{ type: "url", url: "https://example.com" }]);
  });
});
