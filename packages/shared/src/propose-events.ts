import { z } from "zod";
import { eventDate, EventWhenSchema } from "./event-when.js";
import {
  PROPOSAL_STATUSES,
  type ProposalStatus,
  SCORE_MAX,
  SCORE_MIN,
} from "./values.js";

/** The most events one propose_events call can draft. */
export const EVENTS_PER_PROPOSAL_MAX = 10;
export const EVENT_SUMMARY_MAX_LENGTH = 80;
export const FEEL_WORDS_MAX = 5;
export const FEEL_WORD_MAX_LENGTH = 30;
export const TAGS_MAX = 8;
export const DETAILS_KEYS_MAX = 10;

/** Tags are lowercase snake_case, such as `run` or `with_friends`. */
export const TAG_PATTERN = /^[a-z][a-z0-9_]*$/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One event as the model drafts it. The descriptions become part of the
 * model's tool definition, so they are written for the model.
 */
export const ProposedEventSchema = z.object({
  type: z
    .string()
    .trim()
    .min(1)
    .describe("The name of one of the person's event types, such as activity."),
  when: EventWhenSchema,
  summary: z
    .string()
    .trim()
    .min(1)
    .max(EVENT_SUMMARY_MAX_LENGTH)
    .describe('A short label in plain words, such as "5-mile hike".'),
  feelScore: z
    .number()
    .int()
    .min(SCORE_MIN)
    .max(SCORE_MAX)
    .optional()
    .describe(
      "How the person felt, from 1 (awful) to 5 (great), inferred from their words. Leave it out if they didn't say.",
    ),
  feelWords: z
    .array(z.string().trim().min(1).max(FEEL_WORD_MAX_LENGTH))
    .max(FEEL_WORDS_MAX)
    .default([])
    .describe("The person's own feeling words, such as sluggish or great."),
  tags: z
    .array(
      z
        .string()
        .regex(TAG_PATTERN, "tags must be lowercase snake_case, such as run"),
    )
    .max(TAGS_MAX)
    .default([])
    .describe(
      "Lowercase snake_case tags, such as hike, outdoor, with_friends.",
    ),
  details: z
    .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
    .refine((details) => Object.keys(details).length <= DETAILS_KEYS_MAX, {
      message: `details can have at most ${String(DETAILS_KEYS_MAX)} keys`,
    })
    .optional()
    .describe(
      'Anything else mentioned, in the person\'s own units, such as {"miles": 5} or {"bedtime": "23:00"}.',
    ),
});
export type ProposedEvent = z.infer<typeof ProposedEventSchema>;

/**
 * The input of the propose_events tool, and the draft stored in `proposal`.
 * Save parses the stored draft with this same schema before applying it.
 */
export const ProposeEventsSchema = z.object({
  events: z.array(ProposedEventSchema).min(1).max(EVENTS_PER_PROPOSAL_MAX),
});
export type ProposeEvents = z.infer<typeof ProposeEventsSchema>;

/** One event on a confirmation card: the draft, with its day worked out. */
export const ProposedEventViewSchema = ProposedEventSchema.omit({
  when: true,
}).extend({
  occurredOn: z.string().regex(DATE_PATTERN),
  localTime: z.string().optional(),
});
export type ProposedEventView = z.infer<typeof ProposedEventViewSchema>;

/**
 * A confirmation card: what the propose_events tool returns while the reply
 * streams, and what GET /chat/messages returns after a reload.
 */
export const EventsProposalViewSchema = z.object({
  toolCallId: z.string(),
  status: z.enum(PROPOSAL_STATUSES),
  events: z.array(ProposedEventViewSchema),
});
export type EventsProposalView = z.infer<typeof EventsProposalViewSchema>;

/**
 * The card for a stored draft. Days are worked out from `now`, so a card for
 * "today" shows the day it is viewed; Save resolves the day again the same way.
 */
export function toEventsProposalView(
  toolCallId: string,
  status: ProposalStatus,
  draft: ProposeEvents,
  timeZone: string,
  now: Date,
): EventsProposalView {
  return {
    toolCallId,
    status,
    events: draft.events.map(({ when, ...event }) => ({
      ...event,
      occurredOn: eventDate(when, timeZone, now),
      ...(when.localTime === undefined ? {} : { localTime: when.localTime }),
    })),
  };
}

/** The body of a successful (200) or conflicting (409) Save or Discard. */
export const ProposalDecisionResponseSchema = z.object({
  status: z.enum(PROPOSAL_STATUSES),
});
export type ProposalDecisionResponse = z.infer<
  typeof ProposalDecisionResponseSchema
>;
