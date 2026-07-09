import { describe, it, expect } from "vitest";
import { createPolicyService, computeReviewDueAt } from "../src/core/policy.js";
import { makeTestContext } from "./helpers.js";

const goodBody = "# 概要\n本文です。\n\n# 正本回答\nこれが正本回答です。";

function codes(warnings: { code: string }[]): string[] {
  return warnings.map((w) => w.code);
}

describe("checkDraft", () => {
  it("returns no warnings for a well-formed note", () => {
    const policy = createPolicyService(makeTestContext());
    const warnings = policy.checkDraft({
      summary: "これは十分な長さのある要約文です。二十文字を超えています。",
      body: goodBody,
      tags: ["support"],
      confidence: "medium",
      sources: [{ type: "url" }],
    });
    expect(warnings).toEqual([]);
  });

  it("flags missing_source when no sources are given", () => {
    const policy = createPolicyService(makeTestContext());
    const warnings = policy.checkDraft({
      summary: "これは十分な長さのある要約文です。二十文字を超えています。",
      body: goodBody,
      tags: ["support"],
      confidence: "medium",
      sources: [],
    });
    expect(codes(warnings)).toContain("missing_source");
  });

  it("flags body_too_long past the configured max", () => {
    const policy = createPolicyService(makeTestContext({ config: { note_body_max_chars: 10 } }));
    const warnings = policy.checkDraft({
      summary: "これは十分な長さのある要約文です。二十文字を超えています。",
      body: goodBody,
      tags: ["support"],
      confidence: "medium",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).toContain("body_too_long");
  });

  it("flags missing_headings when the body has no heading structure", () => {
    const policy = createPolicyService(makeTestContext());
    const warnings = policy.checkDraft({
      summary: "これは十分な長さのある要約文です。二十文字を超えています。",
      body: "見出しのない本文です。ただの文章が続きます。",
      tags: ["support"],
      confidence: "medium",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).toContain("missing_headings");
  });

  it("flags summary_too_short under 20 characters", () => {
    const policy = createPolicyService(makeTestContext());
    const warnings = policy.checkDraft({
      summary: "短い要約",
      body: goodBody,
      tags: ["support"],
      confidence: "medium",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).toContain("summary_too_short");
  });

  it("flags tags_too_sparse when no tags are set", () => {
    const policy = createPolicyService(makeTestContext());
    const warnings = policy.checkDraft({
      summary: "これは十分な長さのある要約文です。二十文字を超えています。",
      body: goodBody,
      tags: [],
      confidence: "medium",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).toContain("tags_too_sparse");
  });

  it("flags weak_source_for_high_confidence when only manual sources back a high-confidence note", () => {
    const policy = createPolicyService(makeTestContext());
    const warnings = policy.checkDraft({
      summary: "これは十分な長さのある要約文です。二十文字を超えています。",
      body: goodBody,
      tags: ["support"],
      confidence: "high",
      sources: [{ type: "manual" }],
    });
    expect(codes(warnings)).toContain("weak_source_for_high_confidence");
  });

  it("does not flag weak_source_for_high_confidence when a non-manual source backs it", () => {
    const policy = createPolicyService(makeTestContext());
    const warnings = policy.checkDraft({
      summary: "これは十分な長さのある要約文です。二十文字を超えています。",
      body: goodBody,
      tags: ["support"],
      confidence: "high",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).not.toContain("weak_source_for_high_confidence");
  });
});

describe("checkApprove", () => {
  it("returns no warnings for a well-formed draft note approval", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: "support-team",
      sources: [{ type: "url" }],
    });
    expect(warnings).toEqual([]);
  });

  it("flags missing_source when required_fields_for_verify includes source and none are given", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: "support-team",
      sources: [],
    });
    expect(codes(warnings)).toContain("missing_source");
  });

  it("flags missing_owner when required_fields_for_verify includes owner and it is not set", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: null,
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).toContain("missing_owner");
  });

  it("does not check owner/source when they are removed from required_fields_for_verify", () => {
    const policy = createPolicyService(
      makeTestContext({ actor: "reviewer:human", config: { required_fields_for_verify: ["confidence"] } }),
    );
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: null,
      sources: [],
    });
    expect(codes(warnings)).not.toContain("missing_owner");
    expect(codes(warnings)).not.toContain("missing_source");
  });

  it("flags reviewer_separation when the approving actor is also the author", () => {
    const policy = createPolicyService(makeTestContext({ actor: "agent:codex" }));
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: "support-team",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).toContain("reviewer_separation");
  });

  it("does not flag reviewer_separation when the approver differs from the author", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: "support-team",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).not.toContain("reviewer_separation");
  });

  it("flags weak_source_for_high_confidence at approve time too", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "high",
      owner: "support-team",
      sources: [{ type: "manual" }],
    });
    expect(codes(warnings)).toContain("weak_source_for_high_confidence");
  });

  it("flags stale_note for a proposal whose target note is already past review_due_at", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const warnings = policy.checkApprove({
      kind: "proposal",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: "support-team",
      sources: [{ type: "url" }],
      noteReviewDueAt: past,
    });
    expect(codes(warnings)).toContain("stale_note");
  });

  it("does not flag stale_note when the note is not yet due for review", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const warnings = policy.checkApprove({
      kind: "proposal",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: "support-team",
      sources: [{ type: "url" }],
      noteReviewDueAt: future,
    });
    expect(codes(warnings)).not.toContain("stale_note");
  });

  it("does not flag stale_note for a draft note approval (no review_due_at yet)", () => {
    const policy = createPolicyService(makeTestContext({ actor: "reviewer:human" }));
    const warnings = policy.checkApprove({
      kind: "note",
      authorActor: "agent:codex",
      confidence: "medium",
      owner: "support-team",
      sources: [{ type: "url" }],
    });
    expect(codes(warnings)).not.toContain("stale_note");
  });
});

describe("computeReviewDueAt", () => {
  it("adds the configured interval in days", () => {
    const due = computeReviewDueAt("2026-01-01T00:00:00.000Z", 90);
    expect(due).toBe("2026-04-01T00:00:00.000Z");
  });
});
