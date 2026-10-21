import {
  type ChatHistoryMessage,
  ChatMessageRequestSchema,
} from "@ai-wellness-coach/shared";
import {
  createUIMessageStreamResponse,
  type LanguageModel,
  type ModelMessage,
  streamText,
  toUIMessageStream,
} from "ai";
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { buildCoachSystemPrompt } from "../ai/coach-prompt.js";
import { requireAuth, requireUser, type User } from "../auth/middleware.js";
import type { VerifyToken } from "../auth/verify-token.js";
import type { Background } from "../background.js";
import type { Db } from "../db/client.js";
import { chatMessages, entry } from "../db/schema.js";

/** How many recent messages the model sees as context. */
export const CHAT_CONTEXT_MESSAGES = 20;
/** How many recent messages GET /chat/messages returns. */
export const CHAT_HISTORY_MESSAGES = 50;
/**
 * A cap on each reply. Replies are two to four sentences, so this is generous;
 * it also bounds the cost of a runaway reply.
 */
export const CHAT_MAX_OUTPUT_TOKENS = 500;

const REPLY_FAILED_MESSAGE =
  "I couldn't reply just now. Your message is saved, so you can try again.";

const CONVERSATION_ROLES = ["user", "assistant"] as const;

export interface ChatDeps {
  db: Db;
  verifyToken: VerifyToken;
  model: LanguageModel;
  background: Background;
  /** The current time; a parameter so tests can fix it. */
  now?: () => Date;
}

type ChatRow = typeof chatMessages.$inferSelect;

/** Thrown inside the save transaction to roll back when the id is taken. */
class MessageIdTaken extends Error {}

async function findMessage(db: Db, id: string): Promise<ChatRow | undefined> {
  const [row] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, id))
    .limit(1);
  return row;
}

/**
 * Saves the message as an entry and a chat message, in one transaction, before
 * any model call. A repeat of an id already saved for this user reuses the
 * saved row, including when two sends of the same id race. Returns null when
 * the id belongs to someone else.
 */
async function saveUserMessage(
  db: Db,
  user: User,
  id: string,
  text: string,
): Promise<ChatRow | null> {
  const ownOrNull = (row: ChatRow | undefined) =>
    row?.userId === user.id ? row : null;

  const existing = await findMessage(db, id);
  if (existing) return ownOrNull(existing);

  try {
    return await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(entry)
        .values({ userId: user.id, rawText: text })
        .returning({ id: entry.id });
      if (!saved) throw new Error("entry was not created");
      const [message] = await tx
        .insert(chatMessages)
        .values({
          id,
          userId: user.id,
          entryId: saved.id,
          role: "user",
          content: text,
        })
        .onConflictDoNothing({ target: chatMessages.id })
        .returning();
      // Another request saved this id first: roll back this entry and reuse it.
      if (!message) throw new MessageIdTaken();
      return message;
    });
  } catch (error) {
    if (error instanceof MessageIdTaken) {
      return ownOrNull(await findMessage(db, id));
    }
    throw error;
  }
}

/**
 * A message's created_at as Postgres stores it, for ordering comparisons.
 * Postgres keeps microseconds but a JavaScript Date only milliseconds, so
 * comparing against `message.createdAt` would round the message itself out of
 * "messages up to this one". The comparison stays inside SQL instead.
 */
function storedCreatedAt(id: string) {
  return sql`(select ${chatMessages.createdAt} from ${chatMessages} where ${chatMessages.id} = ${id})`;
}

/** Whether the coach has already replied to (or after) this message. */
async function isAnswered(db: Db, message: ChatRow): Promise<boolean> {
  const [reply] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, message.userId),
        eq(chatMessages.role, "assistant"),
        gt(chatMessages.createdAt, storedCreatedAt(message.id)),
      ),
    )
    .limit(1);
  return reply !== undefined;
}

/** The user's last messages up to and including `message`, oldest first. */
async function loadContext(db: Db, message: ChatRow): Promise<ModelMessage[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, message.userId),
        inArray(chatMessages.role, CONVERSATION_ROLES),
        lte(chatMessages.createdAt, storedCreatedAt(message.id)),
      ),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(CHAT_CONTEXT_MESSAGES);
  return rows
    .reverse()
    .map((row) =>
      row.role === "assistant"
        ? { role: "assistant", content: row.content }
        : { role: "user", content: row.content },
    );
}

/**
 * Saves the coach's reply unless one already exists after the message. The
 * user message row is locked first, so two replies racing for the same
 * message save at most one.
 */
async function saveReply(
  db: Db,
  message: ChatRow,
  replyId: string,
  text: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.id, message.id))
      .for("update");
    const [reply] = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, message.userId),
          eq(chatMessages.role, "assistant"),
          gt(chatMessages.createdAt, storedCreatedAt(message.id)),
        ),
      )
      .limit(1);
    if (reply) return;
    await tx.insert(chatMessages).values({
      id: replyId,
      userId: message.userId,
      role: "assistant",
      content: text,
    });
  });
}

function toHistoryMessage(row: ChatRow): ChatHistoryMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    text: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

export function chatRoutes(deps: ChatDeps) {
  const { db, verifyToken, model, background } = deps;
  const now = deps.now ?? (() => new Date());
  const routes = new Hono();

  routes.post("/", requireAuth(verifyToken), requireUser(db), async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = ChatMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          message: "Send a message id and 1 to 2,000 characters of text.",
        },
        400,
      );
    }

    const user = c.var.user;
    const message = await saveUserMessage(
      db,
      user,
      parsed.data.id,
      parsed.data.text,
    );
    if (!message) return c.json({ error: "not_found" }, 404);
    if (await isAnswered(db, message)) {
      return c.json({ error: "already_answered" }, 409);
    }

    const replyId = crypto.randomUUID();
    let outcome: { text: string; finishReason: string } | undefined;
    const result = streamText({
      model,
      system: buildCoachSystemPrompt({ now: now(), timeZone: user.timezone }),
      messages: await loadContext(db, message),
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      onFinish: (event) => {
        outcome = { text: event.text, finishReason: event.finishReason };
      },
      onError: ({ error }) => {
        console.error("Coach reply failed", error);
      },
    });

    // Registered before returning, so the Worker keeps the database open
    // until the reply is saved, even if the browser disconnects mid-stream.
    background(
      (async () => {
        await result.consumeStream();
        // A failed or cut-off stream ends with "error": drop the partial text.
        const final = outcome;
        if (
          final !== undefined &&
          (final.finishReason === "stop" || final.finishReason === "length") &&
          final.text.trim() !== ""
        ) {
          await saveReply(db, message, replyId, final.text);
        }
      })(),
    );

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        generateMessageId: () => replyId,
        onError: () => REPLY_FAILED_MESSAGE,
      }),
    });
  });

  routes.get(
    "/messages",
    requireAuth(verifyToken),
    requireUser(db),
    async (c) => {
      const rows = await db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.userId, c.var.user.id),
            inArray(chatMessages.role, CONVERSATION_ROLES),
          ),
        )
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(CHAT_HISTORY_MESSAGES);
      return c.json({ messages: rows.reverse().map(toHistoryMessage) });
    },
  );

  return routes;
}
