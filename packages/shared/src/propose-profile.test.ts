import { describe, expect, it } from "vitest";
import {
  NAME_MAX_LENGTH,
  ProposeProfileSchema,
  toProfileProposalView,
} from "./propose-profile.js";
import { ProposalViewSchema } from "./proposal-view.js";

describe("ProposeProfileSchema", () => {
  it("trims the names", () => {
    expect(
      ProposeProfileSchema.parse({ firstName: " Mike ", lastName: " Hake " }),
    ).toEqual({ firstName: "Mike", lastName: "Hake" });
  });

  it("makes the last name optional", () => {
    expect(ProposeProfileSchema.parse({ firstName: "Mike" })).toEqual({
      firstName: "Mike",
    });
  });

  it("rejects empty, whitespace-only, and too-long first names", () => {
    for (const firstName of ["", "   ", "a".repeat(NAME_MAX_LENGTH + 1)]) {
      expect(ProposeProfileSchema.safeParse({ firstName }).success).toBe(false);
    }
    expect(
      ProposeProfileSchema.safeParse({ firstName: "a".repeat(NAME_MAX_LENGTH) })
        .success,
    ).toBe(true);
  });

  it("rejects a blank or too-long last name", () => {
    for (const lastName of ["  ", "a".repeat(NAME_MAX_LENGTH + 1)]) {
      expect(
        ProposeProfileSchema.safeParse({ firstName: "Mike", lastName }).success,
      ).toBe(false);
    }
  });

  it("requires a first name", () => {
    expect(ProposeProfileSchema.safeParse({ lastName: "Hake" }).success).toBe(
      false,
    );
  });
});

describe("toProfileProposalView", () => {
  it("builds a profile card that the card union accepts", () => {
    const view = toProfileProposalView("call-1", "pending", {
      firstName: "Mike",
    });
    expect(view).toEqual({
      kind: "profile",
      toolCallId: "call-1",
      status: "pending",
      firstName: "Mike",
    });
    expect(ProposalViewSchema.parse(view)).toEqual(view);
  });
});
