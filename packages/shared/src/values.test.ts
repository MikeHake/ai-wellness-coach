import { describe, expect, it } from "vitest";
import {
  COMPANIONS,
  EFFORTS,
  SCORE_MAX,
  SCORE_MIN,
  SETTINGS,
  UNITS,
} from "./values.js";

describe("shared values", () => {
  it("lists effort levels from easiest to hardest", () => {
    expect(EFFORTS).toEqual(["easy", "moderate", "hard"]);
  });

  it("lists the other fixed value sets", () => {
    expect(SETTINGS).toEqual(["indoor", "outdoor"]);
    expect(COMPANIONS).toEqual(["solo", "with_others", "group"]);
    expect(UNITS).toEqual(["imperial", "metric"]);
  });

  it("scores feelings from 1 to 5", () => {
    expect([SCORE_MIN, SCORE_MAX]).toEqual([1, 5]);
  });
});
