import { ChatHistoryResponseSchema } from "@ai-wellness-coach/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockModel, MOCK_REPLY } from "../ai/mock-model.js";
import { chatMessages, entry, users } from "../db/schema.js";
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
      Array.from({ length: 25 }, (_, i) => ({
        userId: user.id,
        role: i % 2 === 0 ? "user" : "assistant",
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
    // The system prompt carries the person's own time zone.
    expect(JSON.stringify(call?.prompt[0])).toContain("America/Denver");
    // The message was saved for the signed-in user, not the id in the body.
    const [saved] = await t.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.content, "Newest message"));
    expect(saved?.userId).toBe(user.id);
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
