import { createHash } from "node:crypto";
import type { AppContext } from "../core/context.js";
import { AgentPressError } from "../core/errors.js";

interface IdempotencyRow {
  key: string;
  tool: string;
  request_hash: string;
  status: "in_progress" | "completed";
  result_json: string | null;
  created_at: string;
}

/** Deterministic JSON serialization (object keys sorted) so hashing doesn't depend on key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** SHA-256 of a mutation's input, used to detect an idempotency_key being reused with different input. */
export function hashRequest(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

/**
 * Wraps a mutating MCP tool (create_note_draft / update_draft / propose_note_update) so replaying
 * the same (tool, idempotency_key) with the same input is safe to retry: it returns the original
 * result instead of re-running the mutation. See detailed-design.md "MCP server 設計" and spec.md
 * "共通仕様".
 *
 * When `idempotencyKey` is absent, `mutate` just runs directly (no idempotency bookkeeping).
 * Otherwise the bookkeeping row and `mutate()` run inside one better-sqlite3 transaction (a
 * transaction started while already inside one becomes a SAVEPOINT), so if `mutate` throws, the
 * whole thing --including the "in_progress" row-- rolls back atomically. That also means an
 * "in_progress" row can only ever be observed if the process was killed mid-write; it's handled
 * here defensively rather than because normal synchronous execution can produce it.
 */
export function withIdempotency<T>(
  ctx: AppContext,
  tool: string,
  idempotencyKey: string | null | undefined,
  input: unknown,
  mutate: () => T,
): T {
  if (!idempotencyKey) return mutate();

  const { db } = ctx;
  const hash = hashRequest(input);

  const run = db.transaction((): T => {
    const existing = db
      .prepare("SELECT * FROM idempotency_keys WHERE key = ? AND tool = ?")
      .get(idempotencyKey, tool) as IdempotencyRow | undefined;

    if (existing) {
      if (existing.request_hash !== hash) {
        throw new AgentPressError(
          "invalid_input",
          `idempotency_key ${idempotencyKey} was already used with different input for ${tool}`,
          {
            details: { idempotency_key: idempotencyKey, tool },
            suggested_action: "use a new idempotency_key for different input, or resend the exact original request",
          },
        );
      }
      if (existing.status === "completed") {
        return JSON.parse(existing.result_json as string) as T;
      }
      throw new AgentPressError(
        "in_progress",
        `a request with idempotency_key ${idempotencyKey} is already in progress for ${tool}`,
        {
          details: { idempotency_key: idempotencyKey, tool },
          retryable: true,
          suggested_action: "wait and retry, or check list_review_items/get_note for the likely result",
        },
      );
    }

    db.prepare(
      `INSERT INTO idempotency_keys (key, tool, request_hash, status, result_json, created_at)
       VALUES (@key, @tool, @request_hash, 'in_progress', NULL, @created_at)`,
    ).run({ key: idempotencyKey, tool, request_hash: hash, created_at: new Date().toISOString() });

    const result = mutate();

    db.prepare(
      "UPDATE idempotency_keys SET status = 'completed', result_json = @result_json WHERE key = @key AND tool = @tool",
    ).run({ result_json: JSON.stringify(result), key: idempotencyKey, tool });

    return result;
  });

  return run();
}
