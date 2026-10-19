import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

// The settings every environment must provide.
const required = {
  AUTH0_DOMAIN: "dev-abc123.us.auth0.com",
  AUTH0_AUDIENCE: "https://api.ai-wellness-coach",
  DATABASE_URL: "postgresql://user:pass@localhost/db",
};

describe("loadEnv", () => {
  it("uses local defaults for optional settings", () => {
    expect(loadEnv(required)).toEqual({
      PORT: 3000,
      CORS_ORIGIN: "http://localhost:5173",
      ...required,
    });
  });

  it("treats blank values as unset", () => {
    expect(loadEnv({ ...required, PORT: "", CORS_ORIGIN: "" })).toMatchObject({
      PORT: 3000,
      CORS_ORIGIN: "http://localhost:5173",
    });
  });

  it("normalizes CORS_ORIGIN to a bare origin", () => {
    expect(
      loadEnv({ ...required, CORS_ORIGIN: "https://app.example.com/" })
        .CORS_ORIGIN,
    ).toBe("https://app.example.com");
  });

  it("rejects a CORS_ORIGIN that is not a URL", () => {
    expect(() => loadEnv({ ...required, CORS_ORIGIN: "not a url" })).toThrow();
  });

  it("accepts an optional preview host suffix and rejects malformed ones", () => {
    expect(loadEnv(required).CORS_PREVIEW_HOST_SUFFIX).toBeUndefined();
    expect(
      loadEnv({
        ...required,
        CORS_PREVIEW_HOST_SUFFIX: ".ai-wellness-coach.pages.dev",
      }).CORS_PREVIEW_HOST_SUFFIX,
    ).toBe(".ai-wellness-coach.pages.dev");
    for (const bad of [
      "ai-wellness-coach.pages.dev",
      ".pages",
      "*.pages.dev",
      ".a.dev/",
    ]) {
      expect(
        () => loadEnv({ ...required, CORS_PREVIEW_HOST_SUFFIX: bad }),
        bad,
      ).toThrow(/CORS_PREVIEW_HOST_SUFFIX/);
    }
  });

  it("requires CORS_ORIGIN in production", () => {
    expect(() => loadEnv({ ...required, NODE_ENV: "production" })).toThrow(
      /CORS_ORIGIN is required/,
    );
    expect(
      loadEnv({
        ...required,
        NODE_ENV: "production",
        CORS_ORIGIN: "https://app.example.com",
      }).CORS_ORIGIN,
    ).toBe("https://app.example.com");
  });

  it("requires the Auth0 and database settings", () => {
    for (const key of Object.keys(required)) {
      const missing = Object.fromEntries(
        Object.entries(required).filter(([name]) => name !== key),
      );
      expect(() => loadEnv(missing), key).toThrow(new RegExp(key));
    }
  });

  it("rejects an Auth0 domain with a scheme and a non-postgres database URL", () => {
    expect(() =>
      loadEnv({ ...required, AUTH0_DOMAIN: "https://dev-abc123.us.auth0.com" }),
    ).toThrow(/bare host name/);
    expect(() =>
      loadEnv({ ...required, DATABASE_URL: "mysql://localhost/db" }),
    ).toThrow(/postgres/);
  });
});
