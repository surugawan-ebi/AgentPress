import { describe, it, expect } from "vitest";
import { getRegistryOverviewTool } from "../../src/mcp/tools/getRegistryOverview.js";
import { makeTestContext, insertNoteFixture } from "../helpers.js";
import { structured } from "./toolTestHelpers.js";

describe("get_registry_overview tool", () => {
  it("returns schema_version/server_version/usage_policy and scope stats in snake_case", () => {
    const ctx = makeTestContext({
      config: { scopes: { support: { description: "CS knowledge", owners: ["cs-team"], reviewers: ["alice"] } } },
    });
    insertNoteFixture(ctx, { id: "note_1", status: "verified", scope: "support", tags: ["faq"] });

    const result = getRegistryOverviewTool(ctx, {});
    const body = structured<{
      schema_version: string;
      server_version: string;
      strict_stale_filter: boolean;
      scopes: Array<{ scope: string; verified_count: number; stale_count: number; top_tags: string[]; owner: string | null }>;
      usage_policy: string;
      recommended_first_steps: string[];
    }>(result);

    expect(body.schema_version).toBe("1");
    expect(body.strict_stale_filter).toBe(false);
    expect(body.scopes).toEqual([
      { scope: "support", description: "CS knowledge", owner: "cs-team", verified_count: 1, stale_count: 0, top_tags: ["faq"], reviewers: ["alice"] },
    ]);
    expect(body.usage_policy).toContain("verified");
    expect(body.recommended_first_steps.length).toBeGreaterThan(0);
  });

  it("filters to a single scope when scope is passed", () => {
    const ctx = makeTestContext({
      config: {
        scopes: {
          support: { description: "", owners: [], reviewers: [] },
          eng: { description: "", owners: [], reviewers: [] },
        },
      },
    });

    const body = structured<{ scopes: Array<{ scope: string }> }>(getRegistryOverviewTool(ctx, { scope: "eng" }));
    expect(body.scopes.map((s) => s.scope)).toEqual(["eng"]);
  });

  it("defaults scope to all when input is empty/omitted", () => {
    const ctx = makeTestContext({ config: { scopes: { a: { description: "", owners: [], reviewers: [] } } } });
    const body = structured<{ scopes: Array<{ scope: string }> }>(getRegistryOverviewTool(ctx, {}));
    expect(body.scopes.map((s) => s.scope)).toEqual(["a"]);
  });

  it("includes context_packs with name/description/note_count", () => {
    const ctx = makeTestContext({
      config: {
        context_packs: {
          support_core: { description: "Core support knowledge", scopes: ["support"], tags: [], note_ids: [] },
        },
      },
    });
    insertNoteFixture(ctx, { id: "note_1", status: "verified", scope: "support" });

    const body = structured<{ context_packs: Array<{ name: string; description: string; note_count: number }> }>(
      getRegistryOverviewTool(ctx, {}),
    );
    expect(body.context_packs).toEqual([{ name: "support_core", description: "Core support knowledge", note_count: 1 }]);
  });
});
