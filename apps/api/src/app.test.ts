import { HealthResponseSchema } from "@ai-wellness-coach/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
