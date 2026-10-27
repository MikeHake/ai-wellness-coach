import {
  type ChatHistoryMessage,
  ChatMessageRequestSchema,
  type ProposalStatus,
  type ProposalView,
  ProposeEventsSchema,
  ProposeProfileSchema,
  toEventsProposalView,
  toProfileProposalView,
} from "@ai-wellness-coach/shared";
import {
  createUIMessageStreamResponse,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessageChunk,
} from "ai";
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { buildCoachSystemPrompt } from "../ai/coach-prompt.js";
import { CLAUDE_PROVIDER_OPTIONS } from "../ai/model.js";
import { coachTools, isProposeTool, PROPOSE_TOOLS } from "../ai/tools.js";
import { requireAuth, requireUser, type User } from "../auth/middleware.js";
import type { VerifyToken } from "../auth/verify-token.js";
import type { Background } from "../background.js";
import type { Db } from "../db/client.js";
import { chatMessages, entry, proposal } from "../db/schema.js";
import { listVisibleEventTypes } from "../event-types.js";

/** How many recent messages the model sees as context. */
export const CHAT_CONTEXT_MESSAGES = 20;
/** How many recent messages GET /chat/messages returns. */
export const CHAT_HISTORY_MESSAGES = 50;
/**
 * A cap on each model call. It covers the model's thinking as well as the
 * reply, so it is far above what a two-to-four sentence reply needs; it
 * mainly bounds the cost of a runaway call. Reply length comes from the prompt.
 */
export const CHAT_MAX_OUTPUT_TOKENS = 4000;
/**
 * The most model calls in one turn. A logging turn takes two (propose, then
 * reply); the rest leave room to fix one tool error.
 */
export const CHAT_MAX_STEPS = 4;

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

/**
 * A successful propose_* call, kept in `chat_messages.tool_calls` on the
 * reply that made it. Its card's status lives in `proposal`.
 */
const StoredToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.enum(PROPOSE_TOOLS),
  input: z.unknown(),
  output: z.unknown(),
});
type StoredToolCall = z.infer<typeof StoredToolCallSchema>;

/** The stored tool calls on a row; anything unreadable is skipped. */
function storedToolCalls(value: unknown): StoredToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = StoredToolCallSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The user's proposals with these tool call ids, keyed by tool call id. */
async function loadProposals(
  db: Db,
  userId: string,
  rows: { toolCalls: unknown }[],
) {
  const ids = rows.flatMap((row) =>
    storedToolCalls(row.toolCalls).map((call) => call.toolCallId),
  );
  if (ids.length === 0) return new Map<string, typeof proposal.$inferSelect>();
  const found = await db
    .select()
    .from(proposal)
    .where(and(eq(proposal.userId, userId), inArray(proposal.toolCallId, ids)));
  return new Map(found.map((row) => [row.toolCallId, row]));
}

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

/**
 * A past reply as the model sees it. Each draft it proposed is replayed as
 * the tool call and a result giving the card's current status, so the coach
 * knows what the person saved or discarded.
 */
function replayReply(
  content: string,
  calls: StoredToolCall[],
  proposals: Map<string, typeof proposal.$inferSelect>,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  if (calls.length > 0) {
    messages.push(
      {
        role: "assistant",
        content: calls.map((call) => ({
          type: "tool-call",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
      },
      {
        role: "tool",
        content: calls.map((call) => ({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: {
            type: "json",
            value: {
              status: proposals.get(call.toolCallId)?.status ?? "pending",
            },
          },
        })),
      },
    );
  }
  if (content !== "") messages.push({ role: "assistant", content });
  return messages;
}

/** The user's last messages up to and including `message`, oldest first. */
async function loadContext(db: Db, message: ChatRow): Promise<ModelMessage[]> {
  const rows = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      toolCalls: chatMessages.toolCalls,
    })
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
  const proposals = await loadProposals(db, message.userId, rows);
  const messages: ModelMessage[] = [];
  let unanswered: string[] = [];
  for (const row of rows.reverse()) {
    if (row.role === "assistant") {
      if (unanswered.length > 0) {
        messages.push({ role: "user", content: userTurn(unanswered) });
        unanswered = [];
      }
      messages.push(
        ...replayReply(row.content, storedToolCalls(row.toolCalls), proposals),
      );
    } else {
      unanswered.push(row.content);
    }
  }
  if (unanswered.length > 0) {
    messages.push({ role: "user", content: userTurn(unanswered) });
  }
  return messages;
}

/**
 * One user turn from messages sent back to back. Only the last was answered
 * (or is being answered now); the earlier ones never got a reply, usually
 * because a reply failed. The API would merge them into one turn anyway, so
 * they are labeled, or the model would draft events from all of them and
 * attach them to the latest message's entry.
 */
function userTurn(texts: string[]): string {
  const latest = texts.at(-1) ?? "";
  if (texts.length === 1) return latest;
  const earlier = texts
    .slice(0, -1)
    .map((text) => `- ${text}`)
    .join("\n");
  return `Earlier messages that never got a reply. They are context only: don't draft events from them, and don't mention this note.\n${earlier}\n\nLatest message:\n${latest}`;
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
  reply: { text: string; toolCalls: StoredToolCall[] },
) {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.id, message.id))
      .for("update");
    const [existing] = await tx
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
    if (existing) return;
    await tx.insert(chatMessages).values({
      id: replyId,
      userId: message.userId,
      role: "assistant",
      content: reply.text,
      toolCalls: reply.toolCalls.length > 0 ? reply.toolCalls : null,
    });
  });
}

/**
 * The card for a stored proposal, with its current status, or null when its
 * draft no longer parses (after a schema change).
 */
function proposalView(
  row: typeof proposal.$inferSelect,
  user: User,
  now: Date,
): ProposalView | null {
  const status = row.status as ProposalStatus;
  if (row.kind === "events") {
    const draft = ProposeEventsSchema.safeParse(row.draft);
    if (!draft.success) return null;
    return toEventsProposalView(
      row.toolCallId,
      status,
      draft.data,
      user.timezone,
      now,
    );
  }
  if (row.kind === "profile") {
    const draft = ProposeProfileSchema.safeParse(row.draft);
    if (!draft.success) return null;
    return toProfileProposalView(row.toolCallId, status, draft.data);
  }
  return null;
}

/**
 * A saved message for the chat screen. A reply's cards come from `proposal`,
 * so each shows its current status. A draft that no longer parses has no card.
 */
function toHistoryMessage(
  row: ChatRow,
  proposals: Map<string, typeof proposal.$inferSelect>,
  user: User,
  now: Date,
): ChatHistoryMessage {
  const message: ChatHistoryMessage = {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    text: row.content,
    createdAt: row.createdAt.toISOString(),
  };
  const cards = storedToolCalls(row.toolCalls).flatMap((call) => {
    const found = proposals.get(call.toolCallId);
    const card = found ? proposalView(found, user, now) : null;
    return card ? [card] : [];
  });
  if (cards.length > 0) message.proposals = cards;
  return message;
}

/**
 * Ends the turn once a step has both drafted a proposal and replied. Without
 * this, the model is called again after the draft and often writes the
 * same reply a second time. A step that drafted without replying, or whose
 * draft failed, goes on to the next step as usual.
 */
function repliedWithDraft({
  steps,
}: {
  steps: { text: string; toolResults: { toolName: string }[] }[];
}): boolean {
  const last = steps.at(-1);
  return (
    last !== undefined &&
    last.text.trim() !== "" &&
    last.toolResults.some((result) => isProposeTool(result.toolName))
  );
}

/**
 * Makes sure a turn never ends in silence. An aborted turn, or one that
 * finishes with no text and no card (say, the model spent its whole output
 * cap thinking), gets the same error a failed reply gets, so the browser
 * shows the friendly message and Try again.
 */
function neverSilent() {
  const failed: UIMessageChunk = {
    type: "error",
    errorText: REPLY_FAILED_MESSAGE,
  };
  const proposeCalls = new Set<string>();
  let shown = false;
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === "abort") {
        controller.enqueue(failed);
        return;
      }
      if (
        chunk.type === "tool-input-available" &&
        isProposeTool(chunk.toolName)
      ) {
        proposeCalls.add(chunk.toolCallId);
      }
      if (
        (chunk.type === "text-delta" && chunk.delta.trim() !== "") ||
        (chunk.type === "tool-output-available" &&
          proposeCalls.has(chunk.toolCallId)) ||
        chunk.type === "error"
      ) {
        shown = true;
      }
      if (chunk.type === "finish" && !shown) controller.enqueue(failed);
      controller.enqueue(chunk);
    },
  });
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

    // Every user message is saved with its entry, so this never happens.
    if (message.entryId === null) throw new Error("message has no entry");

    const replyId = crypto.randomUUID();
    // A tool failing for a reason the model can't fix ends the turn: no more
    // model calls, nothing saved, and the browser offers Try again.
    const turn = new AbortController();
    let outcome:
      | { text: string; toolCalls: StoredToolCall[]; finishReason: string }
      | undefined;
    const result = streamText({
      model,
      system: buildCoachSystemPrompt({
        now: now(),
        timeZone: user.timezone,
        eventTypes: await listVisibleEventTypes(db, user.id),
      }),
      messages: await loadContext(db, message),
      tools: coachTools({
        db,
        user,
        entryId: message.entryId,
        now,
        onUnexpectedError: (error) => {
          console.error("Coach tool failed", error);
          turn.abort();
        },
      }),
      stopWhen: [stepCountIs(CHAT_MAX_STEPS), repliedWithDraft],
      abortSignal: turn.signal,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      providerOptions: CLAUDE_PROVIDER_OPTIONS,
      onFinish: (event) => {
        // The reply is every step's text; the drafts are the successful
        // propose_* calls (failed ones went back to the model).
        outcome = {
          text: event.steps
            .map((step) => step.text.trim())
            .filter((text) => text !== "")
            .join("\n\n"),
          toolCalls: event.steps.flatMap((step) =>
            step.toolResults.flatMap((result): StoredToolCall[] =>
              isProposeTool(result.toolName)
                ? [
                    {
                      toolCallId: result.toolCallId,
                      toolName: result.toolName,
                      input: result.input,
                      output: result.output,
                    },
                  ]
                : [],
            ),
          ),
          finishReason: event.finishReason,
        };
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
        // A failed or cut-off stream ends with "error": drop the partial
        // reply. A turn that hit the step cap ends with "tool-calls".
        const final = outcome;
        if (
          final !== undefined &&
          ["stop", "length", "tool-calls"].includes(final.finishReason) &&
          (final.text !== "" || final.toolCalls.length > 0)
        ) {
          await saveReply(db, message, replyId, final);
        } else if (final !== undefined) {
          console.warn(
            `Coach turn ended with nothing to save (finish reason: ${final.finishReason})`,
          );
        }
      })(),
    );

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        generateMessageId: () => replyId,
        onError: () => REPLY_FAILED_MESSAGE,
      }).pipeThrough(neverSilent()),
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
      const user = c.var.user;
      const proposals = await loadProposals(db, user.id, rows);
      const at = now();
      return c.json({
        messages: rows
          .reverse()
          .map((row) => toHistoryMessage(row, proposals, user, at)),
      });
    },
  );

  return routes;
}
