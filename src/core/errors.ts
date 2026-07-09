import type { ZodType } from "zod";

export const ERROR_CODES = [
  "not_found",
  "not_verified",
  "invalid_input",
  "empty_change",
  "version_conflict",
  "archived_target",
  "rejected_target",
  "not_draft_owner",
  "slug_conflict",
  "io_error",
  // A request with this idempotency_key is still mid-write (see mcp/idempotency.ts).
  // Distinct from version_conflict (an optimistic-lock mismatch on note content).
  "in_progress",
] as const;

export type AgentPressErrorCode = (typeof ERROR_CODES)[number];

export interface AgentPressErrorOptions {
  details?: Record<string, unknown>;
  retryable?: boolean;
  suggested_action?: string;
  cause?: unknown;
}

/** Uniform error shape surfaced verbatim by MCP tools and formatted for CLI output. */
export class AgentPressError extends Error {
  readonly code: AgentPressErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
  readonly suggested_action?: string;

  constructor(code: AgentPressErrorCode, message: string, options: AgentPressErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AgentPressError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.suggested_action = options.suggested_action;
  }

  toJSON(): { code: AgentPressErrorCode; message: string; details?: Record<string, unknown>; retryable: boolean; suggested_action?: string } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      suggested_action: this.suggested_action,
    };
  }
}

/**
 * Parses input against a zod schema, converting ZodError into the uniform AgentPressError
 * shape. Constrained as ZodType<Output, any, any> (not ZodSchema<T>, which pins Input = Output)
 * so schemas with `.default()`/`.nullish()` fields infer the post-parse Output type correctly.
 */
export function parseOrThrow<Output>(schema: ZodType<Output, any, any>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new AgentPressError("invalid_input", message, { details: { issues: result.error.issues } });
  }
  return result.data;
}
