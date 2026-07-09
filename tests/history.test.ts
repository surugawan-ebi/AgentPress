import { describe, it, expect } from "vitest";
import { createHistoryService } from "../src/core/history.js";
import { makeTestContext } from "./helpers.js";

describe("history service", () => {
  it("records an event and reads it back by entity id", () => {
    const ctx = makeTestContext();
    const history = createHistoryService(ctx);

    const event = history.record({
      entityType: "note",
      entityId: "note_abc",
      eventType: "note_created",
      actor: "agent:codex",
      role: "contributor",
      scope: "support",
      reason: "initial draft",
      afterSnapshot: { title: "hello" },
    });

    expect(event.id).toMatch(/^hist_/);

    const events = history.listByEntity("note_abc");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "note",
      entityId: "note_abc",
      eventType: "note_created",
      actor: "agent:codex",
      role: "contributor",
      scope: "support",
      reason: "initial draft",
      afterSnapshot: { title: "hello" },
      beforeSnapshot: null,
    });
  });

  it("returns events for an entity in creation order", () => {
    const ctx = makeTestContext();
    const history = createHistoryService(ctx);

    history.record({ entityType: "note", entityId: "note_xyz", eventType: "note_created", actor: "a", role: "contributor" });
    history.record({ entityType: "note", entityId: "note_xyz", eventType: "note_updated", actor: "a", role: "contributor" });
    history.record({ entityType: "note", entityId: "note_other", eventType: "note_created", actor: "a", role: "contributor" });

    const events = history.listByEntity("note_xyz");
    expect(events.map((e) => e.eventType)).toEqual(["note_created", "note_updated"]);
  });
});
