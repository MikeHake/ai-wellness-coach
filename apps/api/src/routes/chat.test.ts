import {
  ChatHistoryResponseSchema,
  type EventsProposalView,
  type ProfileProposalView,
} from "@ai-wellness-coach/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMockModel,
  MOCK_REPLY,
  type MockScript,
} from "../ai/mock-model.js";
import {
  chatMessages,
  entry,
  eventType,
  proposal,
  users,
} from "../db/schema.js";
import { createTestApp } from "../test-support.js";
import {
  CHAT_CONTEXT_MESSAGES,
  CHAT_HISTORY_MESSAGES,
  CHAT_MAX_OUTPUT_TOKENS,
} from "./chat.js";

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(users);
  t.useModel(createMockModel());
});

async function addUser(subject: string) {
  const [user] = await t.db
    .insert(users)
    .values({ authSubject: subject, timezone: "America/Denver" })
    .returning();
  if (!user) throw new Error("user was not created");
  return user;
}

async function send(
  subject: string,
  body: Record<string, unknown>,
  options: { token?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token =
    options.token === undefined
      ? await t.issueToken({ subject })
      : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const res = await t.app.request("/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  // Read the whole stream, then wait for the reply to be saved.
  const text = await res.text();
  await t.settle();
  return { status: res.status, text };
}

/** The data events in a UI message stream response. */
function streamEvents(
  body: string,
): { type: string; [key: string]: unknown }[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as { type: string });
}

/** The saved conversation, as GET /chat/messages returns it. */
async function chatHistory(subject: string) {
  const res = await t.app.request("/chat/messages", {
    headers: { Authorization: `Bearer ${await t.issueToken({ subject })}` },
  });
  return ChatHistoryResponseSchema.parse(await res.json()).messages;
}

async function decide(subject: string, toolCallId: string, decision: string) {
  return t.app.request(`/proposals/${toolCallId}/${decision}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await t.issueToken({ subject })}` },
  });
}

const rowsFor = (userId: string) =>
  t.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(chatMessages.createdAt);

describe("POST /chat", () => {
  it("saves the message as an entry, streams the reply, then saves it", async () => {
    const user = await addUser("auth0|a");
    const id = crypto.randomUUID();

    const res = await send("auth0|a", {
      id,
      text: "  Hiked 5 miles, felt great ",
    });

    expect(res.status).toBe(200);
    const events = streamEvents(res.text);
    const streamed = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta)
      .join("");
    expect(streamed).toBe(MOCK_REPLY);

    const [saved] = await t.db.select().from(entry);
    expect(saved?.rawText).toBe("Hiked 5 miles, felt great");
    const rows = await rowsFor(user.id);
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ["user", "Hiked 5 miles, felt great"],
      ["assistant", MOCK_REPLY],
    ]);
    expect(rows[0]).toMatchObject({ id, entryId: saved?.id });
    // The reply id the browser sees is the saved row's id.
    const start = events.find((e) => e.type === "start");
    expect(start?.messageId).toBe(rows[1]?.id);
  });

  it("keeps the entry and message when the model fails, and saves no reply", async () => {
    const user = await addUser("auth0|a");
    t.useModel(createMockModel({ failAtStart: true }));

    const res = await send("auth0|a", {
      id: crypto.randomUUID(),
      text: "Slept badly",
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Your message is saved, so you can try again");
    expect(await t.db.select().from(entry)).toHaveLength(1);
    expect((await rowsFor(user.id)).map((r) => r.role)).toEqual(["user"]);
  });

  it("drops a reply that fails partway through", async () => {
    const user = await addUser("auth0|a");
    t.useModel(createMockModel({ text: "That sounds ", failMidStream: true }));

    const res = await send("auth0|a", { id: crypto.randomUUID(), text: "Hi" });

    expect(res.text).toContain("Your message is saved, so you can try again");
    expect((await rowsFor(user.id)).map((r) => r.role)).toEqual(["user"]);
  });

  it("regenerates the reply for a repeat of a failed message, without a second entry", async () => {
    const user = await addUser("auth0|a");
    const id = crypto.randomUUID();
    t.useModel(createMockModel({ failAtStart: true }));
    await send("auth0|a", { id, text: "Rode with Sam" });

    t.useModel(createMockModel({ text: "A ride with a friend, nice." }));
    const retry = await send("auth0|a", { id, text: "Rode with Sam" });

    expect(retry.status).toBe(200);
    expect(await t.db.select().from(entry)).toHaveLength(1);
    expect((await rowsFor(user.id)).map((r) => [r.role, r.content])).toEqual([
      ["user", "Rode with Sam"],
      ["assistant", "A ride with a friend, nice."],
    ]);
  });

  it("answers a repeat of an answered message with 409 and no second reply", async () => {
    const user = await addUser("auth0|a");
    const id = crypto.randomUUID();
    await send("auth0|a", { id, text: "Hi" });

    const repeat = await send("auth0|a", { id, text: "Hi" });

    expect(repeat.status).toBe(409);
    expect(JSON.parse(repeat.text)).toEqual({ error: "already_answered" });
    expect(await rowsFor(user.id)).toHaveLength(2);
  });

  it("saves one entry and one reply when the same message is sent twice at once", async () => {
    const user = await addUser("auth0|a");
    const id = crypto.randomUUID();

    const results = await Promise.all([
      send("auth0|a", { id, text: "Hi" }),
      send("auth0|a", { id, text: "Hi" }),
    ]);

    for (const result of results) expect([200, 409]).toContain(result.status);
    expect(await t.db.select().from(entry)).toHaveLength(1);
    expect((await rowsFor(user.id)).map((r) => r.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("builds the model's context from the database, never from the request", async () => {
    const user = await addUser("auth0|a");
    const base = Date.parse("2026-10-20T12:00:00Z");
    await t.db.insert(chatMessages).values(
      // Alternating, ending with a reply, so each message is its own turn.
      Array.from({ length: 25 }, (_, i) => ({
        userId: user.id,
        role: i % 2 === 0 ? "assistant" : "user",
        content: `old message ${String(i)}`,
        createdAt: new Date(base + i * 1000),
      })),
    );

    await send("auth0|a", {
      id: crypto.randomUUID(),
      text: "Newest message",
      userId: "00000000-0000-0000-0000-000000000000",
      messages: [{ role: "user", content: "Injected history" }],
    });

    const call = t.model.doStreamCalls[0];
    const roles = call?.prompt.map((m) => m.role);
    expect(roles?.[0]).toBe("system");
    expect(call?.prompt.slice(1)).toHaveLength(CHAT_CONTEXT_MESSAGES);
    const texts = JSON.stringify(call?.prompt);
    expect(texts).toContain("Newest message");
    expect(texts).toContain("old message 24");
    expect(texts).not.toContain("old message 4");
    expect(texts).not.toContain("Injected history");
    expect(call?.maxOutputTokens).toBe(CHAT_MAX_OUTPUT_TOKENS);
    // Low effort keeps thinking short, so the reply fits under the cap.
    expect(call?.providerOptions?.anthropic).toMatchObject({ effort: "low" });
    // The system prompt carries the person's own time zone.
    expect(JSON.stringify(call?.prompt[0])).toContain("America/Denver");
    // The message was saved for the signed-in user, not the id in the body.
    const [saved] = await t.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.content, "Newest message"));
    expect(saved?.userId).toBe(user.id);
  });

  // Postgres (Neon) stores microseconds, a JavaScript Date only milliseconds.
  // PGlite's clock ticks in whole milliseconds, so set the timestamps by hand.
  async function insertAt(
    userId: string,
    role: "user" | "assistant",
    content: string,
    createdAt: string,
    id = crypto.randomUUID(),
  ) {
    // Like the app, give each user message its own entry.
    let entryId: string | null = null;
    if (role === "user") {
      const [saved] = await t.db
        .insert(entry)
        .values({ userId, rawText: content })
        .returning();
      entryId = saved?.id ?? null;
    }
    await t.db.execute(
      sql`insert into chat_messages (id, user_id, entry_id, role, content, created_at) values (${id}, ${userId}, ${entryId}, ${role}, ${content}, ${createdAt}::timestamptz)`,
    );
    return id;
  }

  it("includes the message itself in the context when its timestamp has microseconds", async () => {
    const user = await addUser("auth0|a");
    const id = await insertAt(
      user.id,
      "user",
      "Slept badly",
      "2026-10-21T15:58:47.440422Z",
    );

    const res = await send("auth0|a", { id, text: "Slept badly" });

    expect(res.status).toBe(200);
    expect(JSON.stringify(t.model.doStreamCalls[0]?.prompt)).toContain(
      "Slept badly",
    );
    expect((await rowsFor(user.id)).map((r) => r.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("doesn't mistake a reply from earlier in the same millisecond for an answer", async () => {
    const user = await addUser("auth0|a");
    await insertAt(
      user.id,
      "assistant",
      "Earlier reply",
      "2026-10-21T15:58:47.440100Z",
    );
    const id = await insertAt(
      user.id,
      "user",
      "New message",
      "2026-10-21T15:58:47.440422Z",
    );

    const res = await send("auth0|a", { id, text: "New message" });

    expect(res.status).toBe(200);
    expect((await rowsFor(user.id)).map((r) => r.content)).toEqual([
      "Earlier reply",
      "New message",
      MOCK_REPLY,
    ]);
  });

  it("shows the friendly error, not silence, when the model ends with nothing to show", async () => {
    const user = await addUser("auth0|a");
    t.useModel(createMockModel({ text: "" }));

    const res = await send("auth0|a", { id: crypto.randomUUID(), text: "Hi" });

    expect(res.status).toBe(200);
    const error = streamEvents(res.text).find((e) => e.type === "error");
    expect(error?.errorText).toBe(
      "I couldn't reply just now. Your message is saved, so you can try again.",
    );
    expect((await rowsFor(user.id)).map((r) => r.role)).toEqual(["user"]);
  });

  it("labels earlier messages that never got a reply, so the model only drafts from the latest", async () => {
    const user = await addUser("auth0|a");
    await insertAt(user.id, "user", "Hi", "2026-10-21T15:00:00Z");
    await insertAt(user.id, "assistant", "Hello!", "2026-10-21T15:00:01Z");
    await insertAt(user.id, "user", "Slept well", "2026-10-21T16:00:00Z");
    await insertAt(user.id, "user", "Had eggs", "2026-10-21T16:05:00Z");

    await send("auth0|a", {
      id: crypto.randomUUID(),
      text: "Lunch was chicken",
    });

    const prompt = t.model.doStreamCalls[0]?.prompt ?? [];
    expect(prompt.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    const latest = JSON.stringify(prompt.at(-1));
    expect(latest).toContain(
      "Earlier messages that never got a reply. They are context only: don't draft events from them, and don't mention this note.",
    );
    expect(latest).toContain("- Slept well\\n- Had eggs");
    expect(latest).toContain("Latest message:\\nLunch was chicken");
    // A message that got a reply is replayed as it was.
    expect(JSON.stringify(prompt[1])).toContain('"text":"Hi"');
  });

  it("rejects a blank message, a too-long one, and a non-UUID id", async () => {
    await addUser("auth0|a");
    const id = crypto.randomUUID();

    for (const body of [
      { id, text: "   " },
      { id, text: "a".repeat(2001) },
      { id: "msg-1", text: "hi" },
      { text: "hi" },
    ]) {
      expect((await send("auth0|a", body)).status).toBe(400);
    }
    expect(await t.db.select().from(entry)).toHaveLength(0);
  });

  it("refuses an id that belongs to another user, without changing anything", async () => {
    const a = await addUser("auth0|a");
    await addUser("auth0|b");
    const id = crypto.randomUUID();
    await send("auth0|a", { id, text: "Mine" });

    const res = await send("auth0|b", { id, text: "Not yours" });

    expect(res.status).toBe(404);
    expect(await t.db.select().from(entry)).toHaveLength(1);
    expect((await rowsFor(a.id)).map((r) => r.content)).toEqual([
      "Mine",
      MOCK_REPLY,
    ]);
  });

  it("requires a token and a profile", async () => {
    const body = { id: crypto.randomUUID(), text: "hi" };
    expect((await send("auth0|a", body, { token: null })).status).toBe(401);
    expect((await send("auth0|nobody", body)).status).toBe(403);
  });
});

describe("GET /chat/messages", () => {
  async function history(subject: string) {
    const res = await t.app.request("/chat/messages", {
      headers: { Authorization: `Bearer ${await t.issueToken({ subject })}` },
    });
    return { status: res.status, body: await res.json() };
  }

  it("returns the user's last 50 messages, oldest first, and only theirs", async () => {
    const a = await addUser("auth0|a");
    const b = await addUser("auth0|b");
    const base = Date.parse("2026-10-20T12:00:00Z");
    await t.db.insert(chatMessages).values([
      ...Array.from({ length: 60 }, (_, i) => ({
        userId: a.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `a${String(i)}`,
        createdAt: new Date(base + i * 1000),
      })),
      {
        userId: a.id,
        role: "tool",
        content: "tool output",
        createdAt: new Date(base + 61_000),
      },
      { userId: b.id, role: "user", content: "b's secret" },
    ]);

    const res = await history("auth0|a");

    expect(res.status).toBe(200);
    const { messages } = ChatHistoryResponseSchema.parse(res.body);
    expect(messages).toHaveLength(CHAT_HISTORY_MESSAGES);
    expect(messages[0]?.text).toBe("a10");
    expect(messages.at(-1)?.text).toBe("a59");
    expect(messages.map((m) => m.text)).not.toContain("b's secret");
    expect(messages.map((m) => m.text)).not.toContain("tool output");
  });

  it("returns an empty list for a new user", async () => {
    await addUser("auth0|a");
    expect((await history("auth0|a")).body).toEqual({ messages: [] });
  });

  it("requires a token and a profile", async () => {
    expect((await t.app.request("/chat/messages")).status).toBe(401);
    expect((await history("auth0|nobody")).status).toBe(403);
  });
});

describe("chat and entries", () => {
  it("links each saved user message to its entry, and replies to none", async () => {
    const user = await addUser("auth0|a");
    await send("auth0|a", { id: crypto.randomUUID(), text: "Lunch was great" });

    const [userRow] = await t.db
      .select()
      .from(chatMessages)
      .where(
        and(eq(chatMessages.userId, user.id), eq(chatMessages.role, "user")),
      );
    const [reply] = await t.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, user.id),
          eq(chatMessages.role, "assistant"),
        ),
      );
    expect(userRow?.entryId).not.toBeNull();
    expect(reply?.entryId).toBeNull();
  });
});

describe("logging with propose_events", () => {
  const hike = {
    type: "activity",
    when: { dayOffset: -1 },
    summary: "5-mile hike",
    feelScore: 5,
    feelWords: ["great"],
    tags: ["hike", "outdoor"],
    details: { miles: 5 },
  };

  /** The model proposes these events, then replies with `reply`. */
  function proposing(
    events: unknown[],
    reply = "Here's what I caught.",
    toolCallId = "call-1",
  ): MockScript[] {
    return [
      {
        toolCalls: [
          { toolName: "propose_events", toolCallId, input: { events } },
        ],
      },
      { text: reply },
    ];
  }

  /** The text of the tool result or error the model saw on its second call. */
  function toolResultSeen(callIndex = 1) {
    return JSON.stringify(t.model.doStreamCalls[callIndex]?.prompt.at(-1));
  }

  it("stores a pending proposal for the entry, streams its card, and saves the reply", async () => {
    const user = await addUser("auth0|a");
    t.useModel(createMockModel(proposing([hike])));

    const res = await send("auth0|a", {
      id: crypto.randomUUID(),
      text: "Hiked 5 miles yesterday, felt great",
    });

    expect(res.status).toBe(200);
    const [saved] = await t.db.select().from(entry);
    const [row] = await t.db.select().from(proposal);
    expect(row).toMatchObject({
      userId: user.id,
      entryId: saved?.id,
      toolCallId: "call-1",
      kind: "events",
      status: "pending",
      draft: { events: [hike] },
    });

    const output = streamEvents(res.text).find(
      (e) => e.type === "tool-output-available",
    );
    const card = output?.output as EventsProposalView;
    expect(card.toolCallId).toBe("call-1");
    expect(card.status).toBe("pending");
    expect(card.events[0]).toMatchObject({
      type: "activity",
      summary: "5-mile hike",
    });
    expect(card.events[0]?.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const rows = await rowsFor(user.id);
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ["user", "Hiked 5 miles yesterday, felt great"],
      ["assistant", "Here's what I caught."],
    ]);
    expect(rows[1]?.toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        toolName: "propose_events",
        input: { events: [hike] },
      }),
    ]);
  });

  it("ends the turn when the reply came with the draft, so it isn't written twice", async () => {
    const user = await addUser("auth0|a");
    t.useModel(
      createMockModel([
        {
          text: "Here's your hike to check.",
          toolCalls: [
            {
              toolName: "propose_events",
              toolCallId: "call-1",
              input: { events: [hike] },
            },
          ],
        },
        { text: "Here's your hike to check." },
      ]),
    );

    await send("auth0|a", { id: crypto.randomUUID(), text: "Hiked" });

    expect(t.model.doStreamCalls).toHaveLength(1);
    const [, reply] = await rowsFor(user.id);
    expect(reply?.content).toBe("Here's your hike to check.");
    expect(reply?.toolCalls).toHaveLength(1);
  });

  it("gives the model the event types and tools, capped in steps", async () => {
    const user = await addUser("auth0|a");
    await t.db.insert(eventType).values({
      userId: user.id,
      name: "migraine",
      description: "A migraine headache.",
    });
    const other = await addUser("auth0|b");
    await t.db.insert(eventType).values({
      userId: other.id,
      name: "allergy",
      description: "B's allergy.",
    });

    await send("auth0|a", { id: crypto.randomUUID(), text: "Hi" });

    const call = t.model.doStreamCalls[0];
    const system = JSON.stringify(call?.prompt[0]);
    expect(system).toContain("- activity: Any movement");
    expect(system).toContain("- migraine: A migraine headache.");
    expect(system).not.toContain("allergy");
    expect(call?.tools?.map((tool) => tool.name).sort()).toEqual([
      "list_event_types",
      "propose_events",
      "propose_profile",
    ]);
  });

  it("lists the user's event types through list_event_types", async () => {
    await addUser("auth0|a");
    t.useModel(
      createMockModel([
        { toolCalls: [{ toolName: "list_event_types", input: {} }] },
        { text: "Got them." },
      ]),
    );

    await send("auth0|a", { id: crypto.randomUUID(), text: "What can I log?" });

    const seen = toolResultSeen();
    expect(seen).toContain("tool-result");
    expect(seen).toContain("sleep");
    expect(seen).toContain("dated by the day the person woke up");
  });

  it("sends a future date back to the model as an error it can fix, then stores the fix", async () => {
    const user = await addUser("auth0|a");
    t.useModel(
      createMockModel([
        {
          toolCalls: [
            {
              toolName: "propose_events",
              toolCallId: "call-bad",
              input: {
                events: [hike, { ...hike, when: { date: "2099-01-01" } }],
              },
            },
          ],
        },
        ...proposing([hike], "Here's the hike.", "call-good"),
      ]),
    );

    const res = await send("auth0|a", {
      id: crypto.randomUUID(),
      text: "Hiked yesterday, and I'm hiking again on New Year's 2099",
    });

    expect(res.status).toBe(200);
    expect(toolResultSeen()).toContain("That date is in the future");
    expect(toolResultSeen()).toContain('Event 2 (\\"5-mile hike\\")');
    const rows = await t.db.select().from(proposal);
    expect(rows.map((r) => r.toolCallId)).toEqual(["call-good"]);
    const [reply] = (await rowsFor(user.id)).filter(
      (r) => r.role === "assistant",
    );
    expect(reply?.toolCalls).toEqual([
      expect.objectContaining({ toolCallId: "call-good" }),
    ]);
  });

  it("sends a bad score back to the model as an error, not a 500", async () => {
    await addUser("auth0|a");
    t.useModel(
      createMockModel([
        ...proposing([{ ...hike, feelScore: 9 }]).slice(0, 1),
        { text: "Let me fix that." },
      ]),
    );

    const res = await send("auth0|a", { id: crypto.randomUUID(), text: "Hi" });

    expect(res.status).toBe(200);
    expect(toolResultSeen()).toMatch(/error/i);
    expect(await t.db.select().from(proposal)).toHaveLength(0);
  });

  it("ends the turn without calling the model again when a tool fails unexpectedly", async () => {
    const user = await addUser("auth0|a");
    // A proposal already using this tool call id makes the insert fail, as a
    // database outage would.
    const [old] = await t.db
      .insert(entry)
      .values({ userId: user.id, rawText: "Earlier" })
      .returning();
    await t.db.insert(proposal).values({
      userId: user.id,
      entryId: old?.id,
      toolCallId: "call-1",
      kind: "events",
      draft: { events: [hike] },
    });
    t.useModel(createMockModel(proposing([hike])));

    const res = await send("auth0|a", {
      id: crypto.randomUUID(),
      text: "Hiked 5 miles yesterday",
    });

    expect(res.status).toBe(200);
    expect(t.model.doStreamCalls).toHaveLength(1);
    const error = streamEvents(res.text).find((e) => e.type === "error");
    expect(error?.errorText).toBe(
      "I couldn't reply just now. Your message is saved, so you can try again.",
    );
    expect((await rowsFor(user.id)).map((r) => r.role)).toEqual(["user"]);
    expect(await t.db.select().from(proposal)).toHaveLength(1);
  });

  it("answers another user's private type exactly like an unknown type", async () => {
    await addUser("auth0|a");
    const b = await addUser("auth0|b");
    await t.db.insert(eventType).values({
      userId: b.id,
      name: "migraine",
      description: "B's type.",
    });

    const errorFor = async (type: string) => {
      t.useModel(
        createMockModel([
          ...proposing([{ ...hike, type, summary: "headache" }]).slice(0, 1),
          { text: "Sorry." },
        ]),
      );
      await send("auth0|a", { id: crypto.randomUUID(), text: "Headache" });
      return toolResultSeen().replace(/"toolCallId":"[^"]*"/g, "");
    };

    const borrowed = await errorFor("migraine");
    const unknown = await errorFor("nonsense");

    expect(borrowed).toContain('there is no event type named \\"migraine\\"');
    expect(borrowed.replace("migraine", "nonsense")).toBe(unknown);
    expect(await t.db.select().from(proposal)).toHaveLength(0);
  });

  it("gives an entry with no events no proposal", async () => {
    const user = await addUser("auth0|a");

    await send("auth0|a", { id: crypto.randomUUID(), text: "Hello!" });

    expect(await t.db.select().from(proposal)).toHaveLength(0);
    const rows = await rowsFor(user.id);
    expect(rows[1]?.toolCalls).toBeNull();
    const messages = await chatHistory("auth0|a");
    expect(messages[1]?.proposals).toBeUndefined();
  });

  it("returns each card with its current status after a reload", async () => {
    await addUser("auth0|a");
    t.useModel(createMockModel(proposing([hike], "One.", "call-1")));
    await send("auth0|a", { id: crypto.randomUUID(), text: "Hiked" });
    t.useModel(createMockModel(proposing([hike], "Two.", "call-2")));
    await send("auth0|a", { id: crypto.randomUUID(), text: "Hiked again" });
    t.useModel(createMockModel(proposing([hike], "Three.", "call-3")));
    await send("auth0|a", { id: crypto.randomUUID(), text: "And again" });

    await decide("auth0|a", "call-1", "save");
    await decide("auth0|a", "call-2", "discard");

    const replies = (await chatHistory("auth0|a")).filter(
      (m) => m.role === "assistant",
    );
    expect(
      replies.map((m) => [m.text, m.proposals?.map((p) => p.status)]),
    ).toEqual([
      ["One.", ["saved"]],
      ["Two.", ["discarded"]],
      ["Three.", ["pending"]],
    ]);
    expect(replies[0]?.proposals?.[0]).toMatchObject({
      kind: "events",
      events: [
        {
          type: "activity",
          summary: "5-mile hike",
          feelScore: 5,
          feelWords: ["great"],
          tags: ["hike", "outdoor"],
        },
      ],
    });
  });

  it("replays past drafts to the model with their current status", async () => {
    await addUser("auth0|a");
    t.useModel(createMockModel(proposing([hike])));
    await send("auth0|a", { id: crypto.randomUUID(), text: "Hiked" });
    await decide("auth0|a", "call-1", "save");

    t.useModel(createMockModel());
    await send("auth0|a", { id: crypto.randomUUID(), text: "Thanks" });

    const prompt = t.model.doStreamCalls[0]?.prompt ?? [];
    expect(prompt.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    const replayed = JSON.stringify(prompt);
    expect(replayed).toContain('"toolName":"propose_events"');
    expect(replayed).toContain('{"status":"saved"}');
    expect(replayed).not.toContain('list_event_types","input');
  });
});

describe("learning the person's name with propose_profile", () => {
  /** The model proposes this profile, then replies with `reply`. */
  function proposingName(
    input: unknown,
    reply = "Nice to meet you!",
    toolCallId = "call-1",
  ): MockScript[] {
    return [
      { toolCalls: [{ toolName: "propose_profile", toolCallId, input }] },
      { text: reply },
    ];
  }

  it("stores a pending profile proposal, streams its card, and saves the reply", async () => {
    const user = await addUser("auth0|a");
    t.useModel(createMockModel(proposingName({ firstName: " Mike " })));

    const res = await send("auth0|a", {
      id: crypto.randomUUID(),
      text: "I'm Mike",
    });

    expect(res.status).toBe(200);
    const [saved] = await t.db.select().from(entry);
    const [row] = await t.db.select().from(proposal);
    expect(row).toMatchObject({
      userId: user.id,
      entryId: saved?.id,
      toolCallId: "call-1",
      kind: "profile",
      status: "pending",
      draft: { firstName: "Mike" },
    });

    const output = streamEvents(res.text).find(
      (e) => e.type === "tool-output-available",
    );
    expect(output?.output as ProfileProposalView).toEqual({
      kind: "profile",
      toolCallId: "call-1",
      status: "pending",
      firstName: "Mike",
    });
    // The name isn't set until the person presses Save.
    const [unchanged] = await t.db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(unchanged?.firstName).toBeNull();

    const rows = await rowsFor(user.id);
    expect(rows[1]?.content).toBe("Nice to meet you!");
    expect(rows[1]?.toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        toolName: "propose_profile",
      }),
    ]);
  });

  it("gives the coach the signed-in user's saved name, and asks when there is none", async () => {
    const user = await addUser("auth0|a");
    await addUser("auth0|b");
    await t.db
      .update(users)
      .set({ firstName: "Mike" })
      .where(eq(users.id, user.id));

    await send("auth0|a", { id: crypto.randomUUID(), text: "Hi" });
    await send("auth0|b", { id: crypto.randomUUID(), text: "Hi" });

    const systems = t.model.doStreamCalls.map((call) =>
      JSON.stringify(call.prompt[0]),
    );
    expect(systems[0]).toContain('Their first name is \\"Mike\\".');
    expect(systems[1]).toContain("You don't know their name yet");
    expect(systems[1]).not.toContain("Mike");
  });

  it("sends a blank name back to the model as an error, storing nothing", async () => {
    await addUser("auth0|a");
    t.useModel(createMockModel(proposingName({ firstName: "   " })));

    await send("auth0|a", { id: crypto.randomUUID(), text: "I'm  " });

    expect(await t.db.select().from(proposal)).toEqual([]);
    expect(JSON.stringify(t.model.doStreamCalls[1]?.prompt.at(-1))).toContain(
      "error",
    );
  });

  it("returns the profile card with its current status after a reload, and replays it", async () => {
    await addUser("auth0|a");
    t.useModel(
      createMockModel(proposingName({ firstName: "Mike", lastName: "Hake" })),
    );
    await send("auth0|a", { id: crypto.randomUUID(), text: "Mike Hake" });
    await decide("auth0|a", "call-1", "discard");

    const [, reply] = await chatHistory("auth0|a");
    expect(reply?.proposals).toEqual([
      {
        kind: "profile",
        toolCallId: "call-1",
        status: "discarded",
        firstName: "Mike",
        lastName: "Hake",
      },
    ]);

    t.useModel(createMockModel());
    await send("auth0|a", { id: crypto.randomUUID(), text: "Thanks" });
    const replayed = JSON.stringify(t.model.doStreamCalls[0]?.prompt);
    expect(replayed).toContain('"toolName":"propose_profile"');
    expect(replayed).toContain('{"status":"discarded"}');
  });
});
