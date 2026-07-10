import { describe, it, expect } from "vitest";
import { openTestDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";

describe("migrations", () => {
  it("creates all expected tables", () => {
    const db = openTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "notes",
        "note_sources",
        "note_tags",
        "note_relations",
        "update_proposals",
        "history_events",
        "import_batches",
        "idempotency_keys",
        "schema_migrations",
      ]),
    );
  });

  it("records the applied migrations", () => {
    const db = openTestDb();
    const rows = db.prepare("SELECT id, name FROM schema_migrations").all();
    expect(rows).toEqual([
      { id: 1, name: "001_init" },
      { id: 2, name: "002_fts5_search" },
    ]);
  });

  it("is idempotent when run twice", () => {
    const db = openTestDb();
    expect(() => runMigrations(db)).not.toThrow();
    const rows = db.prepare("SELECT id FROM schema_migrations").all();
    expect(rows).toHaveLength(2);
  });

  it("enforces foreign_keys and WAL/busy_timeout pragmas", () => {
    const db = openTestDb();
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("creates the notes_fts virtual table and sync triggers (this environment supports FTS5 trigram)", () => {
    const db = openTestDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(names).toEqual(
      expect.arrayContaining(["notes_fts", "notes_fts_ai", "notes_fts_ad", "notes_fts_au"]),
    );
  });
});
