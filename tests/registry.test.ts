import { describe, it, expect } from "vitest";
import { getRegistryOverview } from "../src/core/registry.js";
import { makeTestContext, insertNoteFixture } from "./helpers.js";

describe("getRegistryOverview", () => {
  it("returns configured scopes with zero counts when there are no notes", () => {
    const ctx = makeTestContext({
      config: {
        scopes: { support: { description: "CS knowledge", owners: ["cs-team"], reviewers: ["alice"] } },
      },
    });

    const overview = getRegistryOverview(ctx);
    expect(overview.schemaVersion).toBe("1");
    expect(overview.strictStaleFilter).toBe(false);
    expect(overview.scopes).toEqual([
      {
        scope: "support",
        description: "CS knowledge",
        owner: "cs-team",
        verifiedCount: 0,
        staleCount: 0,
        topTags: [],
        reviewers: ["alice"],
      },
    ]);
    expect(overview.usagePolicy).toContain("verified");
    expect(overview.recommendedFirstSteps.length).toBeGreaterThan(0);
  });

  it("counts verified and stale notes per scope, and surfaces top tags", () => {
    const ctx = makeTestContext({
      config: { scopes: { support: { description: "", owners: [], reviewers: [] } } },
    });
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 100000).toISOString();
    insertNoteFixture(ctx, { id: "note_1", status: "verified", scope: "support", reviewDueAt: future, tags: ["faq", "policy"] });
    insertNoteFixture(ctx, { id: "note_2", status: "verified", scope: "support", reviewDueAt: past, tags: ["faq"] });
    insertNoteFixture(ctx, { id: "note_3", status: "draft", scope: "support" });

    const overview = getRegistryOverview(ctx);
    const support = overview.scopes.find((s) => s.scope === "support");
    expect(support?.verifiedCount).toBe(2);
    expect(support?.staleCount).toBe(1);
    expect(support?.topTags).toEqual(["faq", "policy"]);
  });

  it("includes scopes present in note data even if not explicitly configured", () => {
    const ctx = makeTestContext();
    insertNoteFixture(ctx, { id: "note_x", status: "verified", scope: "unconfigured-scope" });

    const overview = getRegistryOverview(ctx);
    expect(overview.scopes.map((s) => s.scope)).toContain("unconfigured-scope");
  });

  it("filters to a single scope when requested", () => {
    const ctx = makeTestContext({
      config: {
        scopes: {
          support: { description: "", owners: [], reviewers: [] },
          eng: { description: "", owners: [], reviewers: [] },
        },
      },
    });

    const overview = getRegistryOverview(ctx, "eng");
    expect(overview.scopes.map((s) => s.scope)).toEqual(["eng"]);
  });

  it("returns an empty scopes array for an unknown requested scope", () => {
    const ctx = makeTestContext();
    const overview = getRegistryOverview(ctx, "does-not-exist");
    expect(overview.scopes).toEqual([]);
  });
});
