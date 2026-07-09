import { describe, it, expect } from "vitest";
import { buildUnifiedDiff, changedFields } from "../src/core/diff.js";

describe("buildUnifiedDiff", () => {
  it("produces a unified diff with the given label", () => {
    const diff = buildUnifiedDiff("line one\nline two\n", "line one\nline three\n", "my-note");
    expect(diff).toContain("my-note");
    expect(diff).toContain("-line two");
    expect(diff).toContain("+line three");
  });

  it("handles empty before/after without throwing", () => {
    expect(() => buildUnifiedDiff("", "new content", "note")).not.toThrow();
    expect(() => buildUnifiedDiff("old content", "", "note")).not.toThrow();
  });
});

describe("changedFields", () => {
  const baseline = {
    title: "返金ポリシー",
    summary: "返金の条件について",
    body: "# 概要\n本文",
    tags: ["support", "faq"],
    scope: "support",
    confidence: "medium",
  };

  it("returns [] when nothing in the input differs from the baseline", () => {
    expect(changedFields({}, baseline)).toEqual([]);
    expect(changedFields({ title: null, summary: undefined }, baseline)).toEqual([]);
  });

  it("detects a changed title", () => {
    expect(changedFields({ title: "新しい返金ポリシー" }, baseline)).toEqual(["title"]);
  });

  it("detects multiple changed fields", () => {
    const result = changedFields({ body: "# 概要\n更新済み", confidence: "high" }, baseline);
    expect(result).toEqual(expect.arrayContaining(["body", "confidence"]));
    expect(result).toHaveLength(2);
  });

  it("treats tags as an order-independent set", () => {
    expect(changedFields({ tags: ["faq", "support"] }, baseline)).toEqual([]);
    expect(changedFields({ tags: ["support"] }, baseline)).toEqual(["tags"]);
  });

  it("ignores fields explicitly left null (no-op per propose_note_update's partial-update contract)", () => {
    expect(changedFields({ scope: null, title: "変更後タイトル" }, baseline)).toEqual(["title"]);
  });
});
