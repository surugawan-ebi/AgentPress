import type { AppContext } from "./context.js";
import type { DuplicateCandidate } from "../types/note.js";
import type { NoteStatus } from "../types/common.js";
import { normalizeForSearch } from "./searchText.js";

const MAX_RESULTS = 5;
const NGRAM_SIZE = 2;
// Dice coefficient cutoff for "this field looks like it's about the same thing".
const MATCH_THRESHOLD = 0.3;

/**
 * Character n-grams (not word tokens): Japanese/Chinese text has no spaces,
 * so whitespace/punctuation-based tokenization collapses a whole sentence
 * into a single useless token. Sliding-window character bigrams let LIKE and
 * the Dice-coefficient scoring below catch partial overlaps in any language.
 */
function ngrams(text: string): Set<string> {
  const chars = [...normalizeForSearch(text)].filter((c) => !/\s/.test(c));
  if (chars.length < NGRAM_SIZE) return new Set(chars.length ? [chars.join("")] : []);
  const grams = new Set<string>();
  for (let i = 0; i <= chars.length - NGRAM_SIZE; i++) {
    grams.add(chars.slice(i, i + NGRAM_SIZE).join(""));
  }
  return grams;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

interface CandidateRow {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: NoteStatus;
  tags: string;
}

/**
 * Finds possible duplicates for a new note by title/summary, searching across
 * verified + draft notes. SQL LIKE on search_text (using shared n-grams) narrows
 * candidates cheaply; matched_fields and ranking are then computed precisely in
 * JS via Dice-coefficient overlap per field. Top 5, ranked by matched field count.
 */
export function findPossibleDuplicates(ctx: AppContext, title: string, summary: string): DuplicateCandidate[] {
  const titleGrams = ngrams(title);
  const summaryGrams = ngrams(summary);
  const queryGrams = new Set([...titleGrams, ...summaryGrams]);
  if (queryGrams.size === 0) return [];

  const gramList = [...queryGrams];
  const conditions = gramList.map(() => "search_text LIKE ?").join(" OR ");
  const params = gramList.map((g) => `%${g}%`);

  const rows = ctx.db
    .prepare(
      `SELECT n.id, n.title, n.summary, n.body, n.status,
              COALESCE((SELECT group_concat(tag, ' ') FROM note_tags WHERE note_id = n.id), '') AS tags
         FROM notes n
        WHERE n.status IN ('verified', 'draft') AND (${conditions})`,
    )
    .all(...params) as CandidateRow[];

  const scored = rows.map((row) => {
    const matchedFields: string[] = [];
    if (diceCoefficient(titleGrams, ngrams(row.title)) >= MATCH_THRESHOLD) matchedFields.push("title");
    if (diceCoefficient(summaryGrams, ngrams(row.summary)) >= MATCH_THRESHOLD) matchedFields.push("summary");
    if (diceCoefficient(queryGrams, ngrams(row.body)) >= MATCH_THRESHOLD) matchedFields.push("body");
    if (row.tags && diceCoefficient(queryGrams, ngrams(row.tags)) >= MATCH_THRESHOLD) matchedFields.push("tags");
    return { row, matchedFields };
  });

  return scored
    .filter((s) => s.matchedFields.length > 0)
    .sort((a, b) => b.matchedFields.length - a.matchedFields.length)
    .slice(0, MAX_RESULTS)
    .map(({ row, matchedFields }) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      matchedFields,
      suggestedAction:
        row.status === "verified"
          ? "review this verified note before creating a new one"
          : "review this pending draft before creating a new one",
      suggestedTool: row.status === "verified" ? "get_note" : "get_review_item",
    }));
}

export { normalizeForSearch };
