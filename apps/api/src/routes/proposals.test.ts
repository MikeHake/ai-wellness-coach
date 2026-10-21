import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { entry, event, eventType, proposal, users } from "../db/schema.js";
import { createTestApp } from "../test-support.js";

// Noon on Wednesday, October 21, 2026 in Denver.
const NOW = new Date("2026-10-21T18:00:00Z");

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  t = await createTestApp({ now: () => NOW });
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(users);
});

async function addUser(subject: string) {
  const [user] = await t.db
    .insert(users)
    .values({ authSubject: subject, timezone: "America/Denver" })
    .returning();
  if (!user) throw new Error("user was not created");
  return user;
}

const hike = {
  type: "activity",
  when: { dayOffset: -1, localTime: "07:30" },
  summary: "5-mile hike",
  feelScore: 5,
  feelWords: ["great"],
  tags: ["hike", "outdoor"],
  details: { miles: 5 },
};

/** A pending proposal for a new entry of the user's. */
async function addProposal(
  userId: string,
  toolCallId = "call-1",
  draft: unknown = { events: [hike] },
) {
  const [saved] = await t.db
    .insert(entry)
    .values({ userId, rawText: "Hiked 5 miles yesterday, felt great" })
    .returning();
  if (!saved) throw new Error("entry was not created");
  await t.db.insert(proposal).values({
    userId,
    entryId: saved.id,
    toolCallId,
    kind: "events",
    draft,
  });
  return saved;
}

async function decide(
  subject: string,
  toolCallId: string,
  decision: "save" | "discard",
  options: { token?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  const token =
    options.token === undefined
      ? await t.issueToken({ subject })
      : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const res = await t.app.request(
    `/proposals/${encodeURIComponent(toolCallId)}/${decision}`,
    { method: "POST", headers },
  );
  return { status: res.status, body: (await res.json()) };
}

async function statusOf(userId: string, toolCallId = "call-1") {
  const [row] = await t.db
    .select()
    .from(proposal)
    .where(
      and(eq(proposal.userId, userId), eq(proposal.toolCallId, toolCallId)),
    );
  return row?.status;
}

describe("POST /proposals/:toolCallId/save", () => {
  it("saves the drafted events, with days resolved in the user's timezone", async () => {
    const user = await addUser("auth0|a");
    const saved = await addProposal(user.id);

    const res = await decide("auth0|a", "call-1", "save");

    expect(res).toEqual({ status: 200, body: { status: "saved" } });
    const [activity] = await t.db
      .select()
      .from(eventType)
      .where(and(isNull(eventType.userId), eq(eventType.name, "activity")));
    const rows = await t.db.select().from(event);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      entryId: saved.id,
      eventTypeId: activity?.id,
      occurredOn: "2026-10-20",
      occurredAt: new Date("2026-10-20T13:30:00Z"),
      summary: "5-mile hike",
      feelScore: 5,
      feelWords: ["great"],
      tags: ["hike", "outdoor"],
      details: { miles: 5 },
      edited: false,
    });
    const [row] = await t.db.select().from(proposal);
    expect(row?.status).toBe("saved");
    expect(row?.decidedAt).toBeInstanceOf(Date);
  });

  it("saves every event in the draft", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id, "call-1", {
      events: [
        { type: "sleep", when: { dayOffset: 0 }, summary: "slept badly" },
        { ...hike, when: { date: "2026-10-01" } },
      ],
    });

    await decide("auth0|a", "call-1", "save");

    const rows = await t.db.select().from(event);
    expect(rows.map((r) => [r.summary, r.occurredOn, r.occurredAt])).toEqual(
      expect.arrayContaining([
        ["slept badly", "2026-10-21", null],
        ["5-mile hike", "2026-10-01", null],
      ]),
    );
  });

  it("saves once when Save is pressed twice", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id);

    const first = await decide("auth0|a", "call-1", "save");
    const second = await decide("auth0|a", "call-1", "save");

    expect(first.status).toBe(200);
    expect(second).toEqual({ status: 200, body: { status: "saved" } });
    expect(await t.db.select().from(event)).toHaveLength(1);
  });

  // PGlite has one connection, so these two requests run one after the other
  // here; on Postgres the second waits on the row lock. Either way the second
  // finds nothing pending to claim, which is what keeps the save single.
  it("saves once when two Saves arrive at the same moment", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id);

    const results = await Promise.all([
      decide("auth0|a", "call-1", "save"),
      decide("auth0|a", "call-1", "save"),
    ]);

    for (const result of results) {
      expect(result).toEqual({ status: 200, body: { status: "saved" } });
    }
    expect(await t.db.select().from(event)).toHaveLength(1);
  });

  it("saves nothing after Discard", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id);
    await decide("auth0|a", "call-1", "discard");

    const res = await decide("auth0|a", "call-1", "save");

    expect(res).toEqual({ status: 409, body: { status: "discarded" } });
    expect(await t.db.select().from(event)).toHaveLength(0);
    expect(await statusOf(user.id)).toBe("discarded");
  });

  it("leaves the proposal pending when the draft fails validation, every time", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id, "call-1", {
      events: [{ ...hike, feelScore: 9 }],
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await decide("auth0|a", "call-1", "save");
      expect(res).toEqual({
        status: 422,
        body: { error: "invalid_proposal" },
      });
    }
    expect(await statusOf(user.id)).toBe("pending");
    expect(await t.db.select().from(event)).toHaveLength(0);
  });

  it("saves nothing when any one event fails, such as a date now too old", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id, "call-1", {
      events: [hike, { ...hike, when: { date: "2025-01-01" } }],
    });

    const res = await decide("auth0|a", "call-1", "save");

    expect(res.status).toBe(422);
    expect(await t.db.select().from(event)).toHaveLength(0);
    expect(await statusOf(user.id)).toBe("pending");
  });

  it("accepts the user's own private type", async () => {
    const user = await addUser("auth0|a");
    await t.db
      .insert(eventType)
      .values({ userId: user.id, name: "migraine", description: "A migraine" });
    await addProposal(user.id, "call-1", {
      events: [{ ...hike, type: "migraine", summary: "migraine" }],
    });

    expect((await decide("auth0|a", "call-1", "save")).status).toBe(200);
    expect(await t.db.select().from(event)).toHaveLength(1);
  });

  it("treats another user's private type like an unknown one", async () => {
    const a = await addUser("auth0|a");
    const b = await addUser("auth0|b");
    await t.db
      .insert(eventType)
      .values({ userId: b.id, name: "migraine", description: "B's type" });
    await addProposal(a.id, "call-b-type", {
      events: [{ ...hike, type: "migraine" }],
    });
    await addProposal(a.id, "call-unknown", {
      events: [{ ...hike, type: "nonsense" }],
    });

    const borrowed = await decide("auth0|a", "call-b-type", "save");
    const unknown = await decide("auth0|a", "call-unknown", "save");

    expect(borrowed).toEqual(unknown);
    expect(borrowed.status).toBe(422);
    expect(await t.db.select().from(event)).toHaveLength(0);
  });
});

describe("POST /proposals/:toolCallId/discard", () => {
  it("discards a pending proposal, and a repeat is harmless", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id);

    const first = await decide("auth0|a", "call-1", "discard");
    const second = await decide("auth0|a", "call-1", "discard");

    expect(first).toEqual({ status: 200, body: { status: "discarded" } });
    expect(second).toEqual(first);
    const [row] = await t.db.select().from(proposal);
    expect(row?.status).toBe("discarded");
    expect(row?.decidedAt).toBeInstanceOf(Date);
  });

  it("changes nothing after Save", async () => {
    const user = await addUser("auth0|a");
    await addProposal(user.id);
    await decide("auth0|a", "call-1", "save");

    const res = await decide("auth0|a", "call-1", "discard");

    expect(res).toEqual({ status: 409, body: { status: "saved" } });
    expect(await statusOf(user.id)).toBe("saved");
    expect(await t.db.select().from(event)).toHaveLength(1);
  });
});

describe("proposal authorization", () => {
  it("can't save or discard another user's proposal", async () => {
    const a = await addUser("auth0|a");
    await addUser("auth0|b");
    await addProposal(a.id);

    for (const decision of ["save", "discard"] as const) {
      const res = await decide("auth0|b", "call-1", decision);
      expect(res).toEqual({ status: 404, body: { error: "not_found" } });
    }
    expect(await statusOf(a.id)).toBe("pending");
    expect(await t.db.select().from(event)).toHaveLength(0);
  });

  it("acts only on the signed-in user's proposal when two share a tool call id", async () => {
    const a = await addUser("auth0|a");
    const b = await addUser("auth0|b");
    await addProposal(a.id);
    await addProposal(b.id);

    await decide("auth0|b", "call-1", "discard");

    expect(await statusOf(a.id)).toBe("pending");
    expect(await statusOf(b.id)).toBe("discarded");
  });

  it("answers an unknown id with 404", async () => {
    await addUser("auth0|a");
    for (const decision of ["save", "discard"] as const) {
      expect((await decide("auth0|a", "nope", decision)).status).toBe(404);
    }
  });

  it("requires a token and a profile", async () => {
    for (const decision of ["save", "discard"] as const) {
      const anonymous = await decide("auth0|a", "call-1", decision, {
        token: null,
      });
      expect(anonymous.status).toBe(401);
      expect((await decide("auth0|nobody", "call-1", decision)).status).toBe(
        403,
      );
    }
  });
});
