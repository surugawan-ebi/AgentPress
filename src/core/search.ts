import type { AppContext } from "./context.js";
import { getTags, isStale, type NoteRow } from "./noteRows.js";
import { normalizeForSearch } from "./searchText.js";
import { buildCitation, type Citation } from "./citation.js";
import type { Confidence, NoteStatus } from "../types/common.js";

const SNIPPET_RADIUS = 60;
const DEFAULT_LIMIT = 10;

export interface SearchInput {
  query: string;
  tags?: string[];
  /** Not in spec.md's minimal search_notes example, but the 0-results example echoes a "scope" field back;
   *  treated here as an optional filter that doubles as that echo value. */
  scope?: string | null;
  include_archived?: boolean;
  limit?: number;
}

export interface SearchResultItem {
  id: string;
  title: string;
  summary: string;
  status: NoteStatus;
  confidence: Confidence;
  scope: string | null;
  owner: string | null;
  updatedAt: string;
  reviewDueAt: string | null;
  stale: boolean;
  tags: string[];
  matchedFields: string[];
  snippet: string;
  citation: Citation;
}

export interface SearchResult {
  results: SearchResultItem[];
  noResults?: boolean;
  query?: string;
  scope?: string | null;
  searchedStatuses?: NoteStatus[];
  guidance?: string;
  suggestedNextTools?: string[];
}

export interface SearchEngine {
  search(input: SearchInput): SearchResult;
}

function splitTerms(query: string): string[] {
  const normalized = normalizeForSearch(query ?? "");
  return normalized.split(/[\s　]+/).filter((t) => t.length > 0);
}

function buildSnippet(originalText: string, normalizedTerm: string): string {
  const normalizedText = normalizeForSearch(originalText);
  const idx = normalizedText.indexOf(normalizedTerm);
  if (idx === -1) {
    return originalText.length > 120 ? `${originalText.slice(0, 120)}...` : originalText;
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(originalText.length, idx + normalizedTerm.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < originalText.length ? "..." : "";
  return `${prefix}${originalText.slice(start, end)}${suffix}`;
}

/**
 * SQL LIKE on notes.search_text narrows candidates cheaply (works for both space-
 * separated and CJK queries since search_text is already NFKC+lowercased); JS then
 * re-matches per field (title/summary/body/tags) for matched_fields, a snippet, and
 * ranking by number of matched terms. FTS5(trigram) is a Phase 2+ SearchEngine swap.
 */
export function createLikeSearchEngine(ctx: AppContext): SearchEngine {
  const { db, config } = ctx;

  return {
    search(input: SearchInput): SearchResult {
      const limit = input.limit ?? DEFAULT_LIMIT;
      const includeArchived = input.include_archived ?? false;
      const statuses: NoteStatus[] = includeArchived ? ["verified", "archived"] : ["verified"];
      const terms = splitTerms(input.query);

      const clauses = [`status IN (${statuses.map(() => "?").join(",")})`];
      const params: unknown[] = [...statuses];

      if (input.scope) {
        clauses.push("scope = ?");
        params.push(input.scope);
      }

      if (terms.length > 0) {
        clauses.push(`(${terms.map(() => "search_text LIKE ?").join(" OR ")})`);
        params.push(...terms.map((t) => `%${t}%`));
      }

      if (input.tags && input.tags.length > 0) {
        for (const tag of input.tags) {
          clauses.push("EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = notes.id AND nt.tag = ?)");
          params.push(tag);
        }
      }

      const rows = db
        .prepare(`SELECT * FROM notes WHERE ${clauses.join(" AND ")}`)
        .all(...params) as NoteRow[];

      const scored = rows.map((row) => {
        const tags = getTags(db, row.id);
        const fieldTexts: Array<[string, string]> = [
          ["title", row.title],
          ["summary", row.summary],
          ["body", row.body],
          ["tags", tags.join(" ")],
        ];

        const matchedFields: string[] = [];
        let matchedTermCount = 0;
        let snippetSource: { field: string; text: string; term: string } | null = null;

        for (const term of terms) {
          let termMatched = false;
          for (const [field, text] of fieldTexts) {
            if (normalizeForSearch(text).includes(term)) {
              if (!matchedFields.includes(field)) matchedFields.push(field);
              termMatched = true;
              if (!snippetSource || field === "body" || field === "summary") {
                snippetSource = { field, text, term };
              }
            }
          }
          if (termMatched) matchedTermCount += 1;
        }

        return { row, tags, matchedFields, matchedTermCount, snippetSource };
      });

      // terms.length === 0 (browse-all) keeps every row; otherwise require >=1 matched term.
      const relevant = terms.length === 0 ? scored : scored.filter((s) => s.matchedTermCount > 0);

      const withStale = relevant.map((s) => {
        const note = s.row;
        const stale = isStale({ status: note.status as NoteStatus, reviewDueAt: note.review_due_at });
        return { ...s, stale };
      });

      const filtered = config.strict_stale_filter ? withStale.filter((s) => !s.stale) : withStale;

      filtered.sort((a, b) => {
        if (b.matchedTermCount !== a.matchedTermCount) return b.matchedTermCount - a.matchedTermCount;
        return b.row.updated_at.localeCompare(a.row.updated_at);
      });

      const top = filtered.slice(0, limit);

      const results: SearchResultItem[] = top.map((s) => {
        const note = s.row;
        const snippet = s.snippetSource
          ? buildSnippet(s.snippetSource.text, s.snippetSource.term)
          : note.summary;
        return {
          id: note.id,
          title: note.title,
          summary: note.summary,
          status: note.status as NoteStatus,
          confidence: note.confidence as Confidence,
          scope: note.scope,
          owner: note.owner,
          updatedAt: note.updated_at,
          reviewDueAt: note.review_due_at,
          stale: s.stale,
          tags: s.tags,
          matchedFields: s.matchedFields,
          snippet,
          citation: buildCitation({
            id: note.id,
            title: note.title,
            version: note.version,
            updatedAt: note.updated_at,
            reviewDueAt: note.review_due_at,
            stale: s.stale,
            confidence: note.confidence as Confidence,
            status: note.status as NoteStatus,
            scope: note.scope,
          }),
        };
      });

      if (results.length === 0) {
        return {
          results: [],
          noResults: true,
          query: input.query,
          scope: input.scope ?? null,
          searchedStatuses: statuses,
          guidance:
            "No verified knowledge found for this query. Do not present external or general knowledge as organizational policy. If you have reliable knowledge to contribute, use create_note_draft.",
          suggestedNextTools: ["create_note_draft"],
        };
      }

      return { results };
    },
  };
}
