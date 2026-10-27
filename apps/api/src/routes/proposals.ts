import {
  type ProposalDecisionResponse,
  type ProposalStatus,
  ProposeEventsSchema,
  ProposeProfileSchema,
  resolveEventWhen,
} from "@ai-wellness-coach/shared";
import { and, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { requireAuth, requireUser, type User } from "../auth/middleware.js";
import type { VerifyToken } from "../auth/verify-token.js";
import type { Db } from "../db/client.js";
import { event, proposal, users } from "../db/schema.js";
import { visibleEventTypeIds } from "../event-types.js";

export interface ProposalDeps {
  db: Db;
  verifyToken: VerifyToken;
  /** The current time; a parameter so tests can fix it. */
  now?: () => Date;
}

type Decision = Exclude<ProposalStatus, "pending">;

/** Thrown inside the save transaction to roll back a draft that no longer applies. */
class InvalidProposal extends Error {}

type ProposalRow = typeof proposal.$inferSelect;

/** Where the user's proposal stands, or null when they have none with this id. */
async function currentStatus(
  db: Db,
  userId: string,
  toolCallId: string,
): Promise<ProposalStatus | null> {
  const [row] = await db
    .select({ status: proposal.status })
    .from(proposal)
    .where(
      and(eq(proposal.userId, userId), eq(proposal.toolCallId, toolCallId)),
    )
    .limit(1);
  return (row?.status as ProposalStatus | undefined) ?? null;
}

/**
 * Moves the user's pending proposal to `decision` and returns it, or returns
 * undefined when there is nothing pending to claim. The `status = 'pending'`
 * condition is the claim: a second Save (even at the same moment) waits on the
 * row lock, then finds nothing pending.
 */
async function claim(
  db: Db,
  userId: string,
  toolCallId: string,
  decision: Decision,
): Promise<ProposalRow | undefined> {
  const [row] = await db
    .update(proposal)
    .set({ status: decision, decidedAt: sql`now()` })
    .where(
      and(
        eq(proposal.userId, userId),
        eq(proposal.toolCallId, toolCallId),
        eq(proposal.status, "pending"),
      ),
    )
    .returning();
  return row;
}

/**
 * The event rows a claimed `events` proposal saves. Validates the draft again
 * with the shared schema, checks each type is visible to the user, and
 * resolves each day now. Throws InvalidProposal when any of that fails.
 */
async function eventsToSave(
  db: Db,
  user: User,
  claimed: ProposalRow,
  now: Date,
): Promise<(typeof event.$inferInsert)[]> {
  const parsed = ProposeEventsSchema.safeParse(claimed.draft);
  if (claimed.entryId === null || !parsed.success) {
    throw new InvalidProposal();
  }
  const { entryId } = claimed;
  const typeIds = await visibleEventTypeIds(
    db,
    user.id,
    parsed.data.events.map((e) => e.type),
  );

  return parsed.data.events.map((proposed) => {
    const eventTypeId = typeIds.get(proposed.type);
    const when = resolveEventWhen(proposed.when, user.timezone, now);
    if (eventTypeId === undefined || !when.ok) throw new InvalidProposal();
    return {
      userId: user.id,
      entryId,
      eventTypeId,
      occurredOn: when.occurredOn,
      occurredAt: when.occurredAt,
      summary: proposed.summary,
      feelScore: proposed.feelScore ?? null,
      feelWords: proposed.feelWords,
      tags: proposed.tags,
      details: proposed.details ?? null,
    };
  });
}

/**
 * The name change a claimed `profile` proposal saves, after validating the
 * draft again with the shared schema. A draft without a last name leaves the
 * stored one as it is. Throws InvalidProposal when the draft fails.
 */
function profileToSave(
  claimed: ProposalRow,
): Partial<typeof users.$inferInsert> {
  const parsed = ProposeProfileSchema.safeParse(claimed.draft);
  if (!parsed.success) throw new InvalidProposal();
  const { firstName, lastName } = parsed.data;
  return lastName === undefined ? { firstName } : { firstName, lastName };
}

/** Applies a claimed proposal by its kind. Throws InvalidProposal when it can't. */
async function apply(db: Db, user: User, claimed: ProposalRow, now: Date) {
  switch (claimed.kind) {
    case "events":
      await db.insert(event).values(await eventsToSave(db, user, claimed, now));
      return;
    case "profile":
      await db
        .update(users)
        .set(profileToSave(claimed))
        .where(eq(users.id, user.id));
      return;
    default:
      throw new InvalidProposal();
  }
}

/**
 * Claims the proposal and applies it in one transaction. A draft that
 * fails validation rolls back, so the proposal stays pending. Returns the
 * status it ends with, "invalid", or null when the user has no such proposal.
 */
async function saveProposal(
  db: Db,
  user: User,
  toolCallId: string,
  now: Date,
): Promise<ProposalStatus | "invalid" | null> {
  try {
    return await db.transaction(async (tx) => {
      const claimed = await claim(tx, user.id, toolCallId, "saved");
      if (!claimed) return currentStatus(tx, user.id, toolCallId);
      await apply(tx, user, claimed, now);
      return "saved";
    });
  } catch (error) {
    if (error instanceof InvalidProposal) return "invalid";
    throw error;
  }
}

async function discardProposal(
  db: Db,
  user: User,
  toolCallId: string,
): Promise<ProposalStatus | null> {
  const claimed = await claim(db, user.id, toolCallId, "discarded");
  if (claimed) return "discarded";
  return currentStatus(db, user.id, toolCallId);
}

export function proposalRoutes(deps: ProposalDeps) {
  const { db, verifyToken } = deps;
  const now = deps.now ?? (() => new Date());
  const routes = new Hono();

  // Both look the proposal up by the signed-in user and the tool call id, so
  // another user's id gets the same 404 as an unknown one. A repeat of the
  // same decision is a 200; the opposite decision is a 409 with the status.
  function respond(
    c: Context,
    status: ProposalStatus | null,
    wanted: Decision,
  ) {
    if (status === null) return c.json({ error: "not_found" }, 404);
    const body = { status } satisfies ProposalDecisionResponse;
    return c.json(body, status === wanted ? 200 : 409);
  }

  routes.post(
    "/:toolCallId/save",
    requireAuth(verifyToken),
    requireUser(db),
    async (c) => {
      const status = await saveProposal(
        db,
        c.var.user,
        c.req.param("toolCallId"),
        now(),
      );
      if (status === "invalid") {
        return c.json({ error: "invalid_proposal" }, 422);
      }
      return respond(c, status, "saved");
    },
  );

  routes.post(
    "/:toolCallId/discard",
    requireAuth(verifyToken),
    requireUser(db),
    async (c) =>
      respond(
        c,
        await discardProposal(db, c.var.user, c.req.param("toolCallId")),
        "discarded",
      ),
  );

  return routes;
}
