import { describe, expect, it } from "vitest";
import { requireSetting, resolveApiBaseUrl } from "./config.js";

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

describe("requireSetting", () => {
  it("trims a value that is set", () => {
    expect(requireSetting("VITE_AUTH0_DOMAIN", " tenant.us.auth0.com ")).toBe(
      "tenant.us.auth0.com",
    );
  });

  it("names the missing setting", () => {
    expect(() => requireSetting("VITE_AUTH0_CLIENT_ID", undefined)).toThrow(
      /VITE_AUTH0_CLIENT_ID is not set/,
    );
  });
});
