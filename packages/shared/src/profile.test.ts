import { describe, expect, it } from "vitest";
import {
  CreateProfileRequestSchema,
  isValidTimeZone,
  ProfileSchema,
} from "./profile.js";

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone("America/Denver")).toBe(true);
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects unknown names, blanks, and fixed offsets", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
    expect(isValidTimeZone("+02:00")).toBe(false);
  });
});

describe("CreateProfileRequestSchema", () => {
  it("normalizes the time zone name", () => {
    expect(
      CreateProfileRequestSchema.parse({ timezone: " america/denver " }),
    ).toEqual({
      timezone: "America/Denver",
    });
  });

  it("rejects an invalid time zone", () => {
    expect(
      CreateProfileRequestSchema.safeParse({ timezone: "Mars/Olympus" })
        .success,
    ).toBe(false);
    expect(CreateProfileRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("ProfileSchema", () => {
  it("accepts a profile from the API", () => {
    const profile = {
      id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
      timezone: "America/Denver",
      units: "imperial",
      createdAt: "2026-10-18T17:00:00.000Z",
    };
    expect(ProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects unknown units", () => {
    expect(
      ProfileSchema.safeParse({
        id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
        timezone: "UTC",
        units: "cubits",
        createdAt: "2026-10-18T17:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
