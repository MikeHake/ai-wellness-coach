import { BUILT_IN_EVENT_TYPES } from "@ai-wellness-coach/shared";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatMessages, entry, event, eventType, users } from "./schema.js";
import { createTestDb } from "./test-db.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  // Cascades clear every log table and private event type too; built-ins stay.
  await testDb.db.delete(users);
});

async function addUser(authSubject = "auth0|user-a") {
  const [user] = await testDb.db
    .insert(users)
    .values({ authSubject, timezone: "America/Denver" })
    .returning();
  if (!user) throw new Error("user was not created");
  return user;
}

// Drizzle wraps driver errors, so look for the constraint name in the cause.
async function expectViolation(promise: Promise<unknown>, constraint: string) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error).cause;
  const message =
    cause instanceof Error ? cause.message : (error as Error).message;
  expect(message).toContain(constraint);
}

async function addEntry(userId: string, rawText = "Hiked 5 miles, felt great") {
  const [row] = await testDb.db
    .insert(entry)
    .values({ userId, rawText })
    .returning();
  if (!row) throw new Error("entry was not created");
  return row;
}

async function builtInTypeId(name: string) {
  const [row] = await testDb.db
    .select()
    .from(eventType)
    .where(and(isNull(eventType.userId), eq(eventType.name, name)));
  if (!row) throw new Error(`built-in type ${name} is missing`);
  return row.id;
}

async function eventValues(userId: string, entryId: string) {
  return {
    userId,
    entryId,
    eventTypeId: await builtInTypeId("activity"),
    occurredOn: "2026-10-19",
    summary: "5-mile hike",
  };
}

describe("users", () => {
  it("fills in ids, timestamps, and empty names", async () => {
    const user = await addUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(user.firstName).toBeNull();
    expect(user.lastName).toBeNull();
  });

  it("rejects a duplicate auth subject", async () => {
    await addUser("auth0|same");
    await expectViolation(addUser("auth0|same"), "users_auth_subject_unique");
  });
});

describe("timestamps", () => {
  it("round-trips an event time as the same instant", async () => {
    const user = await addUser();
    const { id } = await addEntry(user.id);
    const instant = new Date("2026-03-08T01:30:00-07:00");
    const [row] = await testDb.db
      .insert(event)
      .values({ ...(await eventValues(user.id, id)), occurredAt: instant })
      .returning();
    expect(row?.occurredAt?.getTime()).toBe(instant.getTime());
  });
});

describe("built-in event types", () => {
  it("seeds the shared built-ins with no owner", async () => {
    const rows = await testDb.db
      .select({ name: eventType.name, description: eventType.description })
      .from(eventType)
      .where(isNull(eventType.userId))
      .orderBy(eventType.name);
    const expected = BUILT_IN_EVENT_TYPES.map(({ name, description }) => ({
      name,
      description,
    })).sort((a, b) => a.name.localeCompare(b.name));
    expect(rows).toEqual(expected);
  });

  it("rejects a second built-in with the same name", async () => {
    await expectViolation(
      testDb.db
        .insert(eventType)
        .values({ name: "meal", description: "Another meal" }),
      "event_type_user_id_name_unique",
    );
  });

  it("lets each user have their own private type of the same name", async () => {
    const a = await addUser("auth0|a");
    const b = await addUser("auth0|b");
    const migraine = { name: "migraine", description: "A migraine" };

    await testDb.db.insert(eventType).values({ ...migraine, userId: a.id });
    await testDb.db.insert(eventType).values({ ...migraine, userId: b.id });
    await expectViolation(
      testDb.db.insert(eventType).values({ ...migraine, userId: a.id }),
      "event_type_user_id_name_unique",
    );
  });
});

describe("events", () => {
  it("fills in empty arrays, edited, and nullable fields", async () => {
    const user = await addUser();
    const { id } = await addEntry(user.id);
    const [row] = await testDb.db
      .insert(event)
      .values(await eventValues(user.id, id))
      .returning();
    expect(row?.feelWords).toEqual([]);
    expect(row?.tags).toEqual([]);
    expect(row?.edited).toBe(false);
    expect(row?.feelScore).toBeNull();
    expect(row?.occurredAt).toBeNull();
    expect(row?.occurredOn).toBe("2026-10-19");
  });

  it("rejects feel scores outside 1 to 5 and accepts the edges", async () => {
    const user = await addUser();
    const { id } = await addEntry(user.id);
    const base = await eventValues(user.id, id);

    await expectViolation(
      testDb.db.insert(event).values({ ...base, feelScore: 0 }),
      "event_feel_score_check",
    );
    await expectViolation(
      testDb.db.insert(event).values({ ...base, feelScore: 6 }),
      "event_feel_score_check",
    );
    await testDb.db.insert(event).values({ ...base, feelScore: 1 });
    await testDb.db.insert(event).values({ ...base, feelScore: 5 });
  });
});

describe("chat messages", () => {
  it("rejects an unknown role", async () => {
    const user = await addUser();
    await expectViolation(
      testDb.db
        .insert(chatMessages)
        .values({ userId: user.id, role: "system", content: "Hi" }),
      "chat_messages_role_check",
    );
  });

  it("allows a message with no entry", async () => {
    const user = await addUser();
    const [row] = await testDb.db
      .insert(chatMessages)
      .values({
        userId: user.id,
        role: "assistant",
        content: "How did you sleep?",
      })
      .returning();
    expect(row?.entryId).toBeNull();
  });
});

describe("entry ownership", () => {
  it("rejects an event pointing at another user's entry", async () => {
    const a = await addUser("auth0|a");
    const b = await addUser("auth0|b");
    const bEntry = await addEntry(b.id);

    await expectViolation(
      testDb.db.insert(event).values(await eventValues(a.id, bEntry.id)),
      "event_entry_owner_fk",
    );
  });

  it("rejects a message pointing at another user's entry", async () => {
    const a = await addUser("auth0|a");
    const b = await addUser("auth0|b");
    const bEntry = await addEntry(b.id);

    await expectViolation(
      testDb.db.insert(chatMessages).values({
        userId: a.id,
        entryId: bEntry.id,
        role: "user",
        content: "Hiked 5 miles",
      }),
      "chat_messages_entry_owner_fk",
    );
  });
});

describe("delete rules", () => {
  it("deleting an entry removes its events and clears only the message link", async () => {
    const user = await addUser();
    const doomed = await addEntry(user.id);
    const kept = await addEntry(user.id, "Slept badly");
    await testDb.db.insert(event).values(await eventValues(user.id, doomed.id));
    await testDb.db.insert(event).values(await eventValues(user.id, kept.id));
    const [message] = await testDb.db
      .insert(chatMessages)
      .values({
        userId: user.id,
        entryId: doomed.id,
        role: "user",
        content: doomed.rawText,
      })
      .returning();
    if (!message) throw new Error("message was not created");

    await testDb.db.delete(entry).where(eq(entry.id, doomed.id));

    const events = await testDb.db.select().from(event);
    expect(events.map((e) => e.entryId)).toEqual([kept.id]);
    const [after] = await testDb.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, message.id));
    expect(after?.entryId).toBeNull();
    expect(after?.userId).toBe(user.id);
    expect(after?.content).toBe(doomed.rawText);
  });

  it("blocks deleting an event type that events use", async () => {
    const user = await addUser();
    const [migraine] = await testDb.db
      .insert(eventType)
      .values({ userId: user.id, name: "migraine", description: "A migraine" })
      .returning();
    if (!migraine) throw new Error("type was not created");
    const { id } = await addEntry(user.id);
    await testDb.db.insert(event).values({
      ...(await eventValues(user.id, id)),
      eventTypeId: migraine.id,
    });

    await expectViolation(
      testDb.db.delete(eventType).where(eq(eventType.id, migraine.id)),
      "event_event_type_id_event_type_id_fk",
    );
  });

  it("deleting a user removes their entries, events, types, and messages only", async () => {
    const gone = await addUser("auth0|gone");
    const kept = await addUser("auth0|kept");

    for (const user of [gone, kept]) {
      const { id } = await addEntry(user.id);
      await testDb.db.insert(event).values(await eventValues(user.id, id));
      await testDb.db.insert(eventType).values({
        userId: user.id,
        name: "migraine",
        description: "A migraine",
      });
      await testDb.db
        .insert(chatMessages)
        .values({ userId: user.id, entryId: id, role: "user", content: "Hi" });
    }

    await testDb.db.delete(users).where(eq(users.id, gone.id));

    for (const table of [entry, event, chatMessages]) {
      const rows = await testDb.db.select().from(table);
      expect(rows.map((r) => r.userId)).toEqual([kept.id]);
    }
    const types = await testDb.db.select().from(eventType);
    expect(types.filter((t) => t.userId !== null).map((t) => t.userId)).toEqual(
      [kept.id],
    );
    expect(types.filter((t) => t.userId === null)).toHaveLength(
      BUILT_IN_EVENT_TYPES.length,
    );
  });
});
