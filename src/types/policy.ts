export const POLICY_WARNING_CODES = [
  "missing_source",
  "weak_source_for_high_confidence",
  "body_too_long",
  "missing_headings",
  "summary_too_short",
  "tags_too_sparse",
  "reviewer_separation",
  "stale_note",
  // Not in detailed-design.md's fixed 8-code list; added for checkApprove's
  // required_fields_for_verify("owner") check, which has no existing code to
  // reuse (unlike "source" -> missing_source). See Phase 2 handoff notes.
  "missing_owner",
  // scope_reviewers check (warn mode, or enforce mode + maintainer bypass): the approving
  // actor isn't listed in scopes.<scope>.reviewers (or none are configured for this scope).
  "not_scope_reviewer",
] as const;

export type PolicyWarningCode = (typeof POLICY_WARNING_CODES)[number];

export interface PolicyWarning {
  code: PolicyWarningCode;
  message: string;
  suggested_action: string;
}
