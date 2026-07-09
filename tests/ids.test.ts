import { describe, it, expect } from "vitest";
import { newId } from "../src/core/ids.js";

describe("newId", () => {
  it("prefixes the ULID with the given entity name", () => {
    const id = newId("note");
    expect(id).toMatch(/^note_[0-9A-Z]{26}$/);
  });

  it("generates unique ids across calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newId("proposal")));
    expect(ids.size).toBe(20);
  });
});
