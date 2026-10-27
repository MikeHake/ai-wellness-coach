import {
  type EventsProposalView,
  type ProfileProposalView,
  type ProposeEvents,
  ProposeEventsSchema,
  type ProposeProfile,
  ProposeProfileSchema,
  resolveEventWhen,
  toEventsProposalView,
  toProfileProposalView,
} from "@ai-wellness-coach/shared";
import { tool } from "ai";
import { z } from "zod";
import type { User } from "../auth/middleware.js";
import type { Db } from "../db/client.js";
import { proposal } from "../db/schema.js";
import { listVisibleEventTypes, visibleEventTypeIds } from "../event-types.js";

export const LIST_EVENT_TYPES = "list_event_types";
export const PROPOSE_EVENTS = "propose_events";
export const PROPOSE_PROFILE = "propose_profile";

/** The tools that draft a proposal and show a confirmation card. */
export const PROPOSE_TOOLS = [PROPOSE_EVENTS, PROPOSE_PROFILE] as const;
export type ProposeToolName = (typeof PROPOSE_TOOLS)[number];

export function isProposeTool(name: string): name is ProposeToolName {
  return (PROPOSE_TOOLS as readonly string[]).includes(name);
}

export interface CoachToolsContext {
  db: Db;
  user: User;
  /** The entry for the message being answered; proposals are linked to it. */
  entryId: string;
  now: () => Date;
  /**
   * Called when a tool fails for a reason the model can't fix, such as the
   * database being down. The caller ends the turn instead of letting the
   * model retry.
   */
  onUnexpectedError: (error: unknown) => void;
}

/**
 * A mistake in a tool call that the model can fix, such as an unknown type or
 * a future date. Its message is written for the model. Any other error ends
 * the turn, so internal details never reach the model.
 */
export class ToolProblem extends Error {}

/** Runs a tool, reporting any error other than a ToolProblem before rethrowing it. */
function guarded<Args extends unknown[], Result>(
  execute: (...args: Args) => Promise<Result>,
  onUnexpectedError: (error: unknown) => void,
) {
  return async (...args: Args): Promise<Result> => {
    try {
      return await execute(...args);
    } catch (error) {
      if (!(error instanceof ToolProblem)) onUnexpectedError(error);
      throw error;
    }
  };
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
 * sees a user id or writes to the database directly. The propose_* tools
 * only store a draft: nothing is saved until the person presses Save.
 */
export function coachTools(context: CoachToolsContext) {
  const { db, user, entryId, now, onUnexpectedError } = context;
  return {
    [LIST_EVENT_TYPES]: tool({
      description:
        "Lists the event types this person can log: the built-in types and any of their own, with what each covers.",
      inputSchema: z.object({}),
      execute: guarded(
        async () => ({ eventTypes: await listVisibleEventTypes(db, user.id) }),
        onUnexpectedError,
      ),
    }),
    [PROPOSE_EVENTS]: tool({
      description:
        "Drafts the events in the person's latest message for them to check. The person sees a card and saves it with one tap; nothing is saved until then. Call it at most once per message, with every event in it.",
      inputSchema: ProposeEventsSchema,
      execute: guarded(
        async (
          input: ProposeEvents,
          { toolCallId }: { toolCallId: string },
        ): Promise<EventsProposalView> => {
          const problems = await proposalProblems(context, input);
          // Goes back to the model as a tool error it can fix.
          if (problems.length > 0) throw new ToolProblem(problems.join("\n"));
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
        onUnexpectedError,
      ),
    }),
    [PROPOSE_PROFILE]: tool({
      description:
        "Drafts the name the person wants to be called, when they tell you their name or a new one. The person sees a card and saves it with one tap; nothing is saved until then.",
      inputSchema: ProposeProfileSchema,
      execute: guarded(
        async (
          input: ProposeProfile,
          { toolCallId }: { toolCallId: string },
        ): Promise<ProfileProposalView> => {
          await db.insert(proposal).values({
            userId: user.id,
            entryId,
            toolCallId,
            kind: "profile",
            draft: input,
          });
          return toProfileProposalView(toolCallId, "pending", input);
        },
        onUnexpectedError,
      ),
    }),
  };
}

export type CoachTools = ReturnType<typeof coachTools>;
