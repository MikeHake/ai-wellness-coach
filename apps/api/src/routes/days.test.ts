import { DayResponseSchema } from "@ai-wellness-coach/shared";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { entry, event, eventType, users } from "../db/schema.js";
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

async function addUser(subject: string, timezone = "America/Denver") {
  const [user] = await t.db
    .insert(users)
    .values({ authSubject: subject, timezone })
    .returning();
  if (!user) throw new Error("user was not created");
  return user;
}

async function addEntry(userId: string, rawText: string, createdAt: string) {
  const [saved] = await t.db
    .insert(entry)
    .values({ userId, rawText, createdAt: new Date(createdAt) })
    .returning();
  if (!saved) throw new Error("entry was not created");
  return saved;
}

async function addEvent(
  userId: string,
  entryId: string,
  values: {
    type?: string;
    occurredOn: string;
    occurredAt?: string;
    summary: string;
    feelScore?: number;
    feelWords?: string[];
    tags?: string[];
  },
) {
  const [type] = await t.db
    .select({ id: eventType.id })
    .from(eventType)
    .where(
      and(isNull(eventType.userId), eq(eventType.name, values.type ?? "meal")),
    );
  if (!type) throw new Error("event type not found");
  const [saved] = await t.db
    .insert(event)
    .values({
      userId,
      entryId,
      eventTypeId: type.id,
      occurredOn: values.occurredOn,
      occurredAt: values.occurredAt ? new Date(values.occurredAt) : null,
      summary: values.summary,
      feelScore: values.feelScore ?? null,
      feelWords: values.feelWords ?? [],
      tags: values.tags ?? [],
    })
    .returning();
  if (!saved) throw new Error("event was not created");
  return saved;
}

async function getDay(subject: string | null, date: string) {
  const headers: Record<string, string> = {};
  if (subject !== null) {
    headers.Authorization = `Bearer ${await t.issueToken({ subject })}`;
  }
  const res = await t.app.request(`/days/${date}`, { headers });
  return { status: res.status, body: await res.json() };
}

async function dayOf(subject: string, date: string) {
  const { status, body } = await getDay(subject, date);
  expect(status).toBe(200);
  return DayResponseSchema.parse(body);
}

describe("GET /days/:date", () => {
  it("returns an entry with its events, type, summary and feel", async () => {
    const user = await addUser("auth0|a");
    // 8:15 AM in Denver (MDT, UTC-6).
    const saved = await addEntry(
      user.id,
      "Oatmeal for breakfast, felt steady",
      "2026-10-21T14:15:00Z",
    );
    await addEvent(user.id, saved.id, {
      occurredOn: "2026-10-21",
      summary: "Oatmeal",
      feelScore: 4,
      feelWords: ["steady"],
      tags: ["breakfast"],
    });

    expect(await dayOf("auth0|a", "2026-10-21")).toEqual({
      date: "2026-10-21",
      entries: [
        {
          id: saved.id,
          text: "Oatmeal for breakfast, felt steady",
          createdOn: "2026-10-21",
          createdTime: "08:15",
          events: [
            {
              id: expect.any(String) as string,
              type: "meal",
              summary: "Oatmeal",
              feelScore: 4,
              feelWords: ["steady"],
              tags: ["breakfast"],
            },
          ],
        },
      ],
    });
  });

  it("puts 'yesterday I hiked' on yesterday, not on the day it was typed", async () => {
    const user = await addUser("auth0|a");
    const saved = await addEntry(
      user.id,
      "Yesterday I hiked 5 miles",
      "2026-10-22T15:00:00Z",
    );
    await addEvent(user.id, saved.id, {
      type: "activity",
      occurredOn: "2026-10-21",
      summary: "5-mile hike",
    });

    const yesterday = await dayOf("auth0|a", "2026-10-21");
    expect(yesterday.entries).toHaveLength(1);
    expect(yesterday.entries[0]).toMatchObject({
      text: "Yesterday I hiked 5 miles",
      createdOn: "2026-10-22",
      createdTime: "09:00",
    });
    expect((await dayOf("auth0|a", "2026-10-22")).entries).toEqual([]);
  });

  it("shows an entry on each day its events happened, with only that day's events", async () => {
    const user = await addUser("auth0|a");
    const saved = await addEntry(
      user.id,
      "Pasta last night, then pancakes this morning",
      "2026-10-22T15:00:00Z",
    );
    await addEvent(user.id, saved.id, {
      occurredOn: "2026-10-21",
      summary: "Pasta",
    });
    await addEvent(user.id, saved.id, {
      occurredOn: "2026-10-22",
      summary: "Pancakes",
    });

    const first = await dayOf("auth0|a", "2026-10-21");
    const second = await dayOf("auth0|a", "2026-10-22");
    expect(first.entries.map((e) => e.events.map((v) => v.summary))).toEqual([
      ["Pasta"],
    ]);
    expect(second.entries.map((e) => e.events.map((v) => v.summary))).toEqual([
      ["Pancakes"],
    ]);
  });

  it("keeps an entry with no events on the day it was typed", async () => {
    const user = await addUser("auth0|a");
    const saved = await addEntry(
      user.id,
      "Work was brutal today",
      "2026-10-21T22:00:00Z",
    );

    const day = await dayOf("auth0|a", "2026-10-21");
    expect(day.entries).toEqual([
      {
        id: saved.id,
        text: "Work was brutal today",
        createdOn: "2026-10-21",
        createdTime: "16:00",
        events: [],
      },
    ]);
    expect((await dayOf("auth0|a", "2026-10-22")).entries).toEqual([]);
  });

  it("orders entries as they were told and events by time, untimed last", async () => {
    const user = await addUser("auth0|a");
    const later = await addEntry(user.id, "Lunch", "2026-10-21T19:00:00Z");
    const earlier = await addEntry(
      user.id,
      "Breakfast and a snack",
      "2026-10-21T14:00:00Z",
    );
    await addEvent(user.id, earlier.id, {
      occurredOn: "2026-10-21",
      summary: "Snack",
    });
    await addEvent(user.id, earlier.id, {
      occurredOn: "2026-10-21",
      occurredAt: "2026-10-21T15:00:00Z",
      summary: "Late breakfast",
    });
    await addEvent(user.id, earlier.id, {
      occurredOn: "2026-10-21",
      occurredAt: "2026-10-21T13:00:00Z",
      summary: "Early breakfast",
    });
    await addEvent(user.id, later.id, {
      occurredOn: "2026-10-21",
      summary: "Salad",
    });

    const day = await dayOf("auth0|a", "2026-10-21");
    expect(day.entries.map((e) => e.text)).toEqual([
      "Breakfast and a snack",
      "Lunch",
    ]);
    expect(day.entries[0]?.events.map((e) => [e.summary, e.localTime])).toEqual(
      [
        ["Early breakfast", "07:00"],
        ["Late breakfast", "09:00"],
        ["Snack", undefined],
      ],
    );
  });

  it("uses the user's timezone for day boundaries", async () => {
    const user = await addUser("auth0|a");
    // 05:30 UTC on Oct 22 is 11:30 PM on Oct 21 in Denver.
    await addEntry(user.id, "Late night thought", "2026-10-22T05:30:00Z");

    expect((await dayOf("auth0|a", "2026-10-21")).entries).toHaveLength(1);
    expect((await dayOf("auth0|a", "2026-10-22")).entries).toEqual([]);
  });

  it("follows the clock change on a daylight saving day", async () => {
    const user = await addUser("auth0|a");
    // March 8, 2026 is 23 hours long in Denver: 07:00Z to 06:00Z next day.
    await addEntry(user.id, "Before", "2026-03-08T06:59:00Z");
    await addEntry(user.id, "Start", "2026-03-08T07:00:00Z");
    await addEntry(user.id, "End", "2026-03-09T05:59:00Z");
    await addEntry(user.id, "After", "2026-03-09T06:00:00Z");

    const day = await dayOf("auth0|a", "2026-03-08");
    expect(day.entries.map((e) => e.text)).toEqual(["Start", "End"]);
  });

  it("returns an empty day", async () => {
    await addUser("auth0|a");
    expect(await getDay("auth0|a", "2026-10-21")).toEqual({
      status: 200,
      body: { date: "2026-10-21", entries: [] },
    });
  });

  it("returns an empty day for a date in the future", async () => {
    await addUser("auth0|a");
    expect(await dayOf("auth0|a", "2030-01-01")).toEqual({
      date: "2030-01-01",
      entries: [],
    });
  });

  it.each(["tomorrow", "2026-2-8", "2026-02-30", "2026-13-01"])(
    "rejects %s as a date",
    async (date) => {
      await addUser("auth0|a");
      const { status, body } = await getDay("auth0|a", date);
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: "invalid_date" });
    },
  );
});

describe("day authorization", () => {
  it("never shows another user's entries or events", async () => {
    const a = await addUser("auth0|a");
    const b = await addUser("auth0|b");
    const secret = await addEntry(
      a.id,
      "A private thing about A",
      "2026-10-21T14:00:00Z",
    );
    await addEvent(a.id, secret.id, {
      occurredOn: "2026-10-21",
      summary: "A's breakfast",
    });
    await addEntry(a.id, "A journal line", "2026-10-21T15:00:00Z");
    const mine = await addEntry(b.id, "B's own words", "2026-10-21T16:00:00Z");

    const asB = await dayOf("auth0|b", "2026-10-21");
    expect(asB.entries.map((e) => e.id)).toEqual([mine.id]);
    expect(JSON.stringify(asB)).not.toContain("A's");
    expect(JSON.stringify(asB)).not.toContain("A private");
    expect(JSON.stringify(asB)).not.toContain("A journal");

    const asA = await dayOf("auth0|a", "2026-10-21");
    expect(asA.entries).toHaveLength(2);
  });

  it("requires a token and a profile", async () => {
    expect((await getDay(null, "2026-10-21")).status).toBe(401);
    expect((await getDay("auth0|nobody", "2026-10-21")).status).toBe(403);
  });
});
