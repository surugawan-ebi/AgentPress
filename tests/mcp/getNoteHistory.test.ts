import { describe, it, expect } from "vitest";
import { getNoteHistoryTool } from "../../src/mcp/tools/getNoteHistory.js";
import { createNoteService } from "../../src/core/notes.js";
import { createReviewService } from "../../src/core/reviews.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

describe("get_note_history tool", () => {
  it("returns events (newest first) for a note, without snapshots", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const notes = createNoteService(ctx);
    const draft = notes.createDraft({
      title: "履歴テストノート",
      summary: "get_note_historyの動作確認用の要約文章です。",
      body: "# 概要\n本文",
      source: [{ type: "manual" }],
    });
    const reviewerCtx = { ...ctx, actor: "reviewer:human" };
    const reviews = createReviewService(reviewerCtx);
    reviews.approve(draft.note.id, "looks good");

    const body = structured<{
      id: string;
      events: Array<{ event_type: string; actor: string; role: string; scope: string | null; reason: string | null; created_at: string }>;
    }>(getNoteHistoryTool(ctx, { id: draft.note.id }));

    expect(body.id).toBe(draft.note.id);
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    // newest first: note_verified (from approve) should come before note_created.
    expect(body.events[0].event_type).toBe("note_verified");
    expect(body.events.map((e) => e.event_type)).toContain("note_created");
    // No snapshot fields leak through.
    for (const e of body.events) {
      expect((e as Record<string, unknown>).before_snapshot).toBeUndefined();
      expect((e as Record<string, unknown>).beforeSnapshot).toBeUndefined();
      expect((e as Record<string, unknown>).after_snapshot).toBeUndefined();
    }
  });

  it("works for a proposal_ id too", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_p1", status: "verified", version: 1 });
    const reviews = createReviewService(ctx);
    const { proposal } = reviews.createProposal({
      id: "note_p1",
      base_note_version: 1,
      proposed_body: "# 概要\n更新後の本文です。",
      reason: "更新のため",
      source: [],
    });

    const body = structured<{ events: Array<{ event_type: string }> }>(getNoteHistoryTool(ctx, { id: proposal.id }));
    expect(body.events.map((e) => e.event_type)).toEqual(["proposal_created"]);
  });

  it("respects limit, keeping only the most recent N events", () => {
    const ctx = makeTestContext({ actor: "reviewer:human" });
    insertNoteFixture(ctx, { id: "note_l1", status: "verified", version: 1 });
    const reviews = createReviewService(ctx);
    let version = 1;
    for (let i = 0; i < 5; i++) {
      const { proposal } = reviews.createProposal({
        id: "note_l1",
        base_note_version: version,
        proposed_summary: `更新要約その${i}、二十文字以上になるよう埋めています。`,
        reason: `reason ${i}`,
        source: [],
      });
      reviews.approve(proposal.id);
      version += 1;
    }
    // 5 approved proposals each record one note_updated event on note_l1's own history.

    const full = structured<{ events: Array<{ created_at: string }> }>(getNoteHistoryTool(ctx, { id: "note_l1" }));
    expect(full.events.length).toBeGreaterThanOrEqual(5);

    const limited = structured<{ events: Array<{ created_at: string }> }>(getNoteHistoryTool(ctx, { id: "note_l1", limit: 2 }));
    expect(limited.events).toHaveLength(2);
    // The limited page is the two most recent events (matches the head of the full list).
    expect(limited.events).toEqual(full.events.slice(0, 2));
  });

  it("errors not_found for an id that doesn't correspond to any note or proposal", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const err = errorPayload(getNoteHistoryTool(ctx, { id: "note_does_not_exist" }));
    expect(err.code).toBe("not_found");
  });

  it("errors not_found for a non note_/proposal_ prefixed id", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const err = errorPayload(getNoteHistoryTool(ctx, { id: "something_else_123" }));
    expect(err.code).toBe("not_found");
  });

  it("defaults to 20 events when limit is omitted", () => {
    const ctx = makeTestContext({ actor: "reviewer:human" });
    insertNoteFixture(ctx, { id: "note_d1", status: "verified", version: 1 });
    const reviews = createReviewService(ctx);
    let version = 1;
    for (let i = 0; i < 25; i++) {
      const { proposal } = reviews.createProposal({
        id: "note_d1",
        base_note_version: version,
        proposed_summary: `更新要約その${i}、二十文字以上になるよう埋めています。`,
        reason: `reason ${i}`,
        source: [],
      });
      reviews.approve(proposal.id);
      version += 1;
    }

    const body = structured<{ events: unknown[] }>(getNoteHistoryTool(ctx, { id: "note_d1" }));
    expect(body.events).toHaveLength(20);
  });
});
