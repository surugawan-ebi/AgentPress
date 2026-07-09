import { ulid } from "ulid";

export type IdPrefix = "note" | "proposal" | "hist" | "src" | "batch";

/** Generates a prefixed ULID, e.g. newId("note") -> "note_01HZY...". */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
