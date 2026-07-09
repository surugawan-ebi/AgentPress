import { createTwoFilesPatch } from "diff";

/** Unified diff text (jsdiff) between two full-document renderings of a note. */
export function buildUnifiedDiff(before: string, after: string, label: string): string {
  return createTwoFilesPatch(label, label, before ?? "", after ?? "", "before", "after");
}

export interface ChangeCandidate {
  title?: string | null;
  summary?: string | null;
  body?: string | null;
  tags?: string[] | null;
  scope?: string | null;
  confidence?: string | null;
}

export interface ChangeBaseline {
  title: string;
  summary: string;
  body: string;
  tags: string[];
  scope: string | null;
  confidence: string;
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((tag, i) => tag === sortedB[i]);
}

/**
 * Returns the field names that differ between a "desired values" input (where
 * null/undefined means "no change requested", per propose_note_update's
 * partial-update contract) and the current note.
 */
export function changedFields(input: ChangeCandidate, note: ChangeBaseline): string[] {
  const fields: string[] = [];
  if (input.title != null && input.title !== note.title) fields.push("title");
  if (input.summary != null && input.summary !== note.summary) fields.push("summary");
  if (input.body != null && input.body !== note.body) fields.push("body");
  if (input.tags != null && !tagsEqual(input.tags, note.tags)) fields.push("tags");
  if (input.scope != null && input.scope !== note.scope) fields.push("scope");
  if (input.confidence != null && input.confidence !== note.confidence) fields.push("confidence");
  return fields;
}
