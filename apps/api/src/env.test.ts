import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("uses local defaults when nothing is set", () => {
    expect(loadEnv({})).toEqual({
      PORT: 3000,
      CORS_ORIGIN: "http://localhost:5173",
    });
  });

  it("treats blank values as unset", () => {
    expect(loadEnv({ PORT: "", CORS_ORIGIN: "" })).toEqual({
      PORT: 3000,
      CORS_ORIGIN: "http://localhost:5173",
    });
  });

  it("normalizes CORS_ORIGIN to a bare origin", () => {
    expect(
      loadEnv({ CORS_ORIGIN: "https://app.example.com/" }).CORS_ORIGIN,
    ).toBe("https://app.example.com");
  });

  it("rejects a CORS_ORIGIN that is not a URL", () => {
    expect(() => loadEnv({ CORS_ORIGIN: "not a url" })).toThrow();
  });

  it("requires CORS_ORIGIN in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(
      /CORS_ORIGIN is required/,
    );
    expect(
      loadEnv({
        NODE_ENV: "production",
        CORS_ORIGIN: "https://app.example.com",
      }),
    ).toEqual({
      PORT: 3000,
      CORS_ORIGIN: "https://app.example.com",
    });
  });
});
