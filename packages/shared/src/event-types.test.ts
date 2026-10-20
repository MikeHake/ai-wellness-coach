import { describe, expect, it } from "vitest";
import { BUILT_IN_EVENT_TYPES } from "./event-types.js";

describe("built-in event types", () => {
  it("lists the seven coarse types", () => {
    expect(BUILT_IN_EVENT_TYPES.map((t) => t.name)).toEqual([
      "meal",
      "snack",
      "drink",
      "activity",
      "sleep",
      "stress",
      "feeling",
    ]);
  });

  it("describes every type", () => {
    for (const type of BUILT_IN_EVENT_TYPES) {
      expect(type.description.length).toBeGreaterThan(0);
    }
  });
});
