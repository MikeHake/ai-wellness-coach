import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./config.js";

describe("resolveApiBaseUrl", () => {
  it("returns the URL unchanged when it is clean", () => {
    expect(resolveApiBaseUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("removes trailing slashes", () => {
    expect(resolveApiBaseUrl("https://api.example.com//")).toBe(
      "https://api.example.com",
    );
  });

  it("explains how to fix a missing value", () => {
    expect(() => resolveApiBaseUrl(undefined)).toThrow(/\.env\.example/);
    expect(() => resolveApiBaseUrl("  ")).toThrow(/VITE_API_URL is not set/);
  });
});
