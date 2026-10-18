import { HealthResponseSchema } from "@ai-wellness-coach/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const app = createApp({ CORS_ORIGIN: "http://localhost:5173" });

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({
      status: "ok",
    });
  });

  it("allows the configured web origin", async () => {
    const res = await app.request("/health", {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
  });
});
