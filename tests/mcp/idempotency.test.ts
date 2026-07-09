import { describe, it, expect } from "vitest";
import { createNoteDraftTool, CreateNoteDraftInput } from "../../src/mcp/tools/createNoteDraft.js";
import { updateDraftTool } from "../../src/mcp/tools/updateDraft.js";
import { hashRequest } from "../../src/mcp/idempotency.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured, errorPayload } from "./toolTestHelpers.js";

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "アイデンポテンシーテスト用ノート",
    summary: "同一リクエストの再実行が安全であることを確認するためのテストノートです。",
    body: "# 概要\n本文\n\n# 正本回答\n本文",
    tags: ["test"],
    source: [{ type: "manual" }],
    confidence: "medium",
    idempotency_key: "key-1",
    ...overrides,
  };
}

describe("idempotency (mutating MCP tools)", () => {
  it("replaying the same idempotency_key with identical input returns the same result and causes no new side effect", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });

    const first = structured<{ id: string; final_slug: string }>(createNoteDraftTool(ctx, draftInput()));
    const second = structured<{ id: string; final_slug: string }>(createNoteDraftTool(ctx, draftInput()));

    expect(second).toEqual(first);
    const noteCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(noteCount.c).toBe(1);
    const historyCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM history_events").get() as { c: number };
    expect(historyCount.c).toBe(1);
  });

  it("errors invalid_input when the same key is reused with different input, and creates nothing new", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    createNoteDraftTool(ctx, draftInput());

    const err = errorPayload(createNoteDraftTool(ctx, draftInput({ title: "別のタイトルに変更しました" })));
    expect(err.code).toBe("invalid_input");
    expect(err.details).toMatchObject({ idempotency_key: "key-1", tool: "create_note_draft" });

    const noteCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(noteCount.c).toBe(1);
  });

  it("errors retryable:true when a request with the same key is already in_progress", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    const rawInput = draftInput({ idempotency_key: "key-in-progress" });
    // Simulate a prior request that inserted its bookkeeping row but never finished
    // (e.g. the process was killed mid-write) by inserting the row directly.
    const { idempotency_key, ...coreInput } = CreateNoteDraftInput.parse(rawInput);
    ctx.db
      .prepare(
        `INSERT INTO idempotency_keys (key, tool, request_hash, status, result_json, created_at)
         VALUES (@key, @tool, @request_hash, 'in_progress', NULL, @created_at)`,
      )
      .run({
        key: idempotency_key,
        tool: "create_note_draft",
        request_hash: hashRequest(coreInput),
        created_at: new Date().toISOString(),
      });

    const err = errorPayload(createNoteDraftTool(ctx, rawInput));
    expect(err.code).toBe("in_progress");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("already in progress");

    const noteCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(noteCount.c).toBe(0);
  });

  it("also protects update_draft: replaying the key does not bump the note's version twice", () => {
    const ctx = makeTestContext({ actor: "agent:codex" });
    insertNoteFixture(ctx, { id: "note_u1", status: "draft", createdBy: "agent:codex", version: 1 });

    const args = { id: "note_u1", title: "更新後タイトル", idempotency_key: "u-1" };
    const first = structured<{ id: string; status: string }>(updateDraftTool(ctx, args));
    const second = structured<{ id: string; status: string }>(updateDraftTool(ctx, args));
    expect(second).toEqual(first);

    const row = ctx.db.prepare("SELECT version FROM notes WHERE id = ?").get("note_u1") as { version: number };
    expect(row.version).toBe(2);
  });
});
