/** NFKC + lowercase normalization shared by notes.search_text and duplicate/search matching. */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** notes.search_text = NFKC+lowercase(title + summary + body + tags), used as a LIKE shadow column. */
export function buildSearchText(title: string, summary: string, body: string, tags: string[]): string {
  return normalizeForSearch([title, summary, body, tags.join(" ")].join(" "));
}
