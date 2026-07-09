import type { AgentPressDb } from "../db/client.js";
import { newId } from "./ids.js";
import type { Note } from "../types/note.js";
import type { Source, Relation, SourceInput } from "../types/common.js";

// Shared low-level row shapes + CRUD helpers for the notes table and its
// child tables (tags/sources/relations). notes.ts, reviews.ts and markdown.ts
// all need direct row access (not just the actor-owner-gated NoteService API),
// so this module is the single place that maps DB rows <-> domain types.

export interface NoteRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: string;
  confidence: string;
  scope: string | null;
  owner: string | null;
  version: number;
  created_by: string;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  archived_at: string | null;
  review_due_at: string | null;
  rejection_reason: string | null;
  draft_reason: string | null;
  search_text: string;
  metadata_json: string;
}

export interface SourceRow {
  id: string;
  note_id: string;
  type: string;
  title: string | null;
  url: string | null;
  path: string | null;
  commit_sha: string | null;
  retrieved_at: string | null;
  metadata_json: string;
}

export interface RelationRow {
  note_id: string;
  related_note_id: string;
  relation_type: string;
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    status: row.status as Note["status"],
    confidence: row.confidence as Note["confidence"],
    scope: row.scope,
    owner: row.owner,
    version: row.version,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at,
    archivedAt: row.archived_at,
    reviewDueAt: row.review_due_at,
    rejectionReason: row.rejection_reason,
    draftReason: row.draft_reason,
    searchText: row.search_text,
    metadata: JSON.parse(row.metadata_json),
  };
}

export function rowToSource(row: SourceRow): Source {
  return {
    id: row.id,
    noteId: row.note_id,
    type: row.type as Source["type"],
    title: row.title,
    url: row.url,
    path: row.path,
    commitSha: row.commit_sha,
    retrievedAt: row.retrieved_at,
    metadata: JSON.parse(row.metadata_json),
  };
}

export function rowToRelation(row: RelationRow): Relation {
  return {
    noteId: row.note_id,
    relatedNoteId: row.related_note_id,
    relationType: row.relation_type as Relation["relationType"],
  };
}

/** review_due_at is only meaningful (and only ever past-due) for verified notes. */
export function isStale(note: Pick<Note, "status" | "reviewDueAt">): boolean {
  if (note.status !== "verified" || !note.reviewDueAt) return false;
  return note.reviewDueAt < new Date().toISOString();
}

export function getNoteRow(db: AgentPressDb, id: string): NoteRow | undefined {
  return db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | undefined;
}

export function getTags(db: AgentPressDb, noteId: string): string[] {
  const rows = db.prepare("SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag").all(noteId) as {
    tag: string;
  }[];
  return rows.map((r) => r.tag);
}

export function getSources(db: AgentPressDb, noteId: string): Source[] {
  const rows = db.prepare("SELECT * FROM note_sources WHERE note_id = ?").all(noteId) as SourceRow[];
  return rows.map(rowToSource);
}

export function getRelations(db: AgentPressDb, noteId: string): Relation[] {
  const rows = db
    .prepare("SELECT * FROM note_relations WHERE note_id = ? OR related_note_id = ?")
    .all(noteId, noteId) as RelationRow[];
  return rows.map(rowToRelation);
}

export function toDetail(db: AgentPressDb, note: Note): import("../types/note.js").NoteWithDetail {
  return {
    ...note,
    tags: getTags(db, note.id),
    sources: getSources(db, note.id),
    relations: getRelations(db, note.id),
    stale: isStale(note),
  };
}

export function replaceTags(db: AgentPressDb, noteId: string, tags: string[]): void {
  db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(noteId);
  const insert = db.prepare("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)");
  for (const tag of new Set(tags)) {
    insert.run(noteId, tag);
  }
}

export function replaceSources(db: AgentPressDb, noteId: string, sources: SourceInput[]): void {
  db.prepare("DELETE FROM note_sources WHERE note_id = ?").run(noteId);
  const insert = db.prepare(
    `INSERT INTO note_sources (id, note_id, type, title, url, path, commit_sha, retrieved_at, metadata_json)
     VALUES (@id, @note_id, @type, @title, @url, @path, @commit_sha, @retrieved_at, @metadata_json)`,
  );
  for (const source of sources) {
    insert.run({
      id: newId("src"),
      note_id: noteId,
      type: source.type,
      title: source.title ?? null,
      url: source.url ?? null,
      path: source.path ?? null,
      commit_sha: source.commit_sha ?? null,
      retrieved_at: source.retrieved_at ?? null,
      metadata_json: "{}",
    });
  }
}

export function slugify(title: string): string {
  const base = title
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base || "note";
}

/** Auto-suffixes (-2, -3, ...) until the slug is free. Used by both createDraft and markdown import. */
export function resolveUniqueSlug(db: AgentPressDb, base: string): { slug: string; adjusted: boolean } {
  const exists = db.prepare("SELECT 1 FROM notes WHERE slug = ?");
  let candidate = base;
  let suffix = 2;
  let adjusted = false;
  while (exists.get(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
    adjusted = true;
  }
  return { slug: candidate, adjusted };
}
