import { HealthResponseSchema } from "@ai-wellness-coach/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createTestApp } from "./test-support.js";

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

describe("GET /health", () => {
  it("returns ok without a token", async () => {
    const res = await t.app.request("/health");

    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({
      status: "ok",
    });
  });

  it("allows the configured web origin", async () => {
    const res = await t.app.request("/health", {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
  });

  it("allows pull request preview sites and refuses look-alikes", async () => {
    const withPreviews = createApp({
      env: {
        CORS_ORIGIN: "https://ai-wellness-coach.pages.dev",
        CORS_PREVIEW_HOST_SUFFIX: ".ai-wellness-coach.pages.dev",
      },
      db: t.db,
      verifyToken: t.verifyToken,
      model: t.model,
    });
    const allowOrigin = async (origin: string) =>
      (
        await withPreviews.request("/health", { headers: { Origin: origin } })
      ).headers.get("access-control-allow-origin");

    expect(
      await allowOrigin("https://5-deploy.ai-wellness-coach.pages.dev"),
    ).toBe("https://5-deploy.ai-wellness-coach.pages.dev");
    expect(await allowOrigin("https://ai-wellness-coach.pages.dev")).toBe(
      "https://ai-wellness-coach.pages.dev",
    );
    expect(
      await allowOrigin("https://ai-wellness-coach.pages.dev.evil.com"),
    ).toBeNull();
    expect(await allowOrigin("https://evil.com")).toBeNull();
  });

  it("refuses origins other than the configured one", async () => {
    const res = await t.app.request("/health", {
      headers: { Origin: "https://evil.com" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
