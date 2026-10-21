import { BUILT_IN_EVENT_TYPES } from "@ai-wellness-coach/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventType, users } from "./db/schema.js";
import { createTestDb } from "./db/test-db.js";
import { listVisibleEventTypes, visibleEventTypeIds } from "./event-types.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  await testDb.db.delete(users);
});

async function addUserWithType(subject: string, typeName: string) {
  const [user] = await testDb.db
    .insert(users)
    .values({ authSubject: subject, timezone: "America/Denver" })
    .returning();
  if (!user) throw new Error("user was not created");
  await testDb.db.insert(eventType).values({
    userId: user.id,
    name: typeName,
    description: `A ${typeName}`,
  });
  return user;
}

describe("listVisibleEventTypes", () => {
  it("lists the built-ins, then the user's own types, and nobody else's", async () => {
    const a = await addUserWithType("auth0|a", "migraine");
    await addUserWithType("auth0|b", "allergy");

    const types = await listVisibleEventTypes(testDb.db, a.id);

    expect(types.map((t) => t.name)).toEqual([
      ...BUILT_IN_EVENT_TYPES.map((t) => t.name).sort(),
      "migraine",
    ]);
    expect(types.find((t) => t.name === "migraine")?.description).toBe(
      "A migraine",
    );
  });
});

describe("visibleEventTypeIds", () => {
  it("finds built-in and own types, and treats another user's type as unknown", async () => {
    const a = await addUserWithType("auth0|a", "migraine");
    await addUserWithType("auth0|b", "allergy");

    const ids = await visibleEventTypeIds(testDb.db, a.id, [
      "meal",
      "migraine",
      "allergy",
      "nonsense",
    ]);

    expect([...ids.keys()].sort()).toEqual(["meal", "migraine"]);
  });

  it("returns nothing for no names", async () => {
    const a = await addUserWithType("auth0|a", "migraine");
    expect((await visibleEventTypeIds(testDb.db, a.id, [])).size).toBe(0);
  });
});
