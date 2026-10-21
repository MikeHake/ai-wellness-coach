import {
  type EventsProposalView,
  type ProposeEvents,
  ProposeEventsSchema,
  resolveEventWhen,
  toEventsProposalView,
} from "@ai-wellness-coach/shared";
import { tool } from "ai";
import { z } from "zod";
import type { User } from "../auth/middleware.js";
import type { Db } from "../db/client.js";
import { proposal } from "../db/schema.js";
import { listVisibleEventTypes, visibleEventTypeIds } from "../event-types.js";

export const LIST_EVENT_TYPES = "list_event_types";
export const PROPOSE_EVENTS = "propose_events";

export interface CoachToolsContext {
  db: Db;
  user: User;
  /** The entry for the message being answered; proposals draft events for it. */
  entryId: string;
  now: () => Date;
}

/**
 * Why a propose_events call can't be stored, written for the model so it can
 * fix the call, or an empty list when every event is fine. Unknown types and
 * another user's private types get the same message.
 */
async function proposalProblems(
  { db, user, now }: CoachToolsContext,
  input: ProposeEvents,
): Promise<string[]> {
  const typeIds = await visibleEventTypeIds(
    db,
    user.id,
    input.events.map((e) => e.type),
  );
  const problems: string[] = [];
  input.events.forEach((proposed, i) => {
    const label = `Event ${String(i + 1)} ("${proposed.summary}")`;
    if (!typeIds.has(proposed.type)) {
      problems.push(
        `${label}: there is no event type named "${proposed.type}". Use one of the person's event types.`,
      );
    }
    const when = resolveEventWhen(proposed.when, user.timezone, now());
    if (!when.ok) problems.push(`${label}: ${when.message}`);
  });
  return problems;
}

/**
 * The coach's tools. Every tool runs as the signed-in user; the model never
 * sees a user id or writes to the database directly. propose_events only
 * stores a draft: nothing is saved until the person presses Save.
 */
export function coachTools(context: CoachToolsContext) {
  const { db, user, entryId, now } = context;
  return {
    [LIST_EVENT_TYPES]: tool({
      description:
        "Lists the event types this person can log: the built-in types and any of their own, with what each covers.",
      inputSchema: z.object({}),
      execute: async () => ({
        eventTypes: await listVisibleEventTypes(db, user.id),
      }),
    }),
    [PROPOSE_EVENTS]: tool({
      description:
        "Drafts the events in the person's latest message for them to check. The person sees a card and saves it with one tap; nothing is saved until then. Call it at most once per message, with every event in it.",
      inputSchema: ProposeEventsSchema,
      execute: async (input, { toolCallId }): Promise<EventsProposalView> => {
        const problems = await proposalProblems(context, input);
        // Thrown errors go back to the model as a tool error it can fix.
        if (problems.length > 0) throw new Error(problems.join("\n"));
        await db.insert(proposal).values({
          userId: user.id,
          entryId,
          toolCallId,
          kind: "events",
          draft: input,
        });
        return toEventsProposalView(
          toolCallId,
          "pending",
          input,
          user.timezone,
          now(),
        );
      },
    }),
  };
}

export type CoachTools = ReturnType<typeof coachTools>;
