import { describe, expect, it } from "vitest";
import {
  MESSAGE_ROLES,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  SCORE_MAX,
  SCORE_MIN,
} from "./values.js";

describe("shared values", () => {
  it("lists who can write a chat message", () => {
    expect(MESSAGE_ROLES).toEqual(["user", "assistant", "tool"]);
  });

  it("scores feelings from 1 to 5", () => {
    expect([SCORE_MIN, SCORE_MAX]).toEqual([1, 5]);
  });

  it("lists the proposal kinds and statuses", () => {
    expect(PROPOSAL_KINDS).toEqual(["events", "profile"]);
    expect(PROPOSAL_STATUSES).toEqual(["pending", "saved", "discarded"]);
  });
});
