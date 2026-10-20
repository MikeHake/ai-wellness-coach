import { ProfileSchema } from "@ai-wellness-coach/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../db/schema.js";
import { createTestApp } from "../test-support.js";

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(users);
});

async function call(method: "GET" | "POST", subject: string, body?: unknown) {
  const token = await t.issueToken({ subject });
  return t.app.request("/me", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /me", () => {
  it("creates the profile on first sign-in", async () => {
    const res = await call("POST", "auth0|user-a", {
      timezone: "America/Denver",
    });

    expect(res.status).toBe(201);
    const profile = ProfileSchema.parse(await res.json());
    expect(profile).toMatchObject({ timezone: "America/Denver" });

    const rows = await t.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.authSubject).toBe("auth0|user-a");
  });

  it("returns the existing profile and keeps its time zone", async () => {
    const first = ProfileSchema.parse(
      await (
        await call("POST", "auth0|user-a", { timezone: "America/Denver" })
      ).json(),
    );
    const res = await call("POST", "auth0|user-a", {
      timezone: "Europe/Berlin",
    });

    expect(res.status).toBe(200);
    expect(ProfileSchema.parse(await res.json())).toEqual(first);
    expect(await t.db.select().from(users)).toHaveLength(1);
  });

  it("never returns the auth subject", async () => {
    const res = await call("POST", "auth0|user-a", { timezone: "UTC" });
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["createdAt", "id", "timezone"]);
  });

  it("rejects an invalid or missing time zone", async () => {
    expect(
      (await call("POST", "auth0|user-a", { timezone: "Mars/Olympus" })).status,
    ).toBe(400);
    expect((await call("POST", "auth0|user-a", {})).status).toBe(400);
    expect((await call("POST", "auth0|user-a")).status).toBe(400);
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it("requires a token", async () => {
    const res = await t.app.request("/me", {
      method: "POST",
      body: JSON.stringify({ timezone: "UTC" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /me", () => {
  it("returns 403 until the profile exists", async () => {
    const res = await call("GET", "auth0|user-a");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "profile_not_found" });
  });

  it("returns only the caller's own profile", async () => {
    const a = ProfileSchema.parse(
      await (
        await call("POST", "auth0|user-a", { timezone: "America/Denver" })
      ).json(),
    );
    const b = ProfileSchema.parse(
      await (
        await call("POST", "auth0|user-b", { timezone: "Asia/Tokyo" })
      ).json(),
    );

    expect(
      ProfileSchema.parse(await (await call("GET", "auth0|user-a")).json()),
    ).toEqual(a);
    expect(
      ProfileSchema.parse(await (await call("GET", "auth0|user-b")).json()),
    ).toEqual(b);
    expect(a.id).not.toBe(b.id);
  });

  it("requires a token", async () => {
    expect((await t.app.request("/me")).status).toBe(401);
  });
});
