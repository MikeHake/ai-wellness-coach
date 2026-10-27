import { z } from "zod";
import { isValidTimeZone } from "./profile.js";
import {
  addDays,
  DateSchema,
  localToday,
  zonedTimeToInstant,
} from "./zoned-time.js";

/** Events can be logged for today and up to this many days back. */
export const EVENT_MAX_DAYS_BACK = 365;

/** A time slightly ahead of now is allowed, to absorb rounding like "just now". */
export const EVENT_FUTURE_ALLOWANCE_MINUTES = 15;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * When an event happened, as the model reports it. The model never does date
 * math or timezone conversion: `resolveEventWhen` turns this into dates.
 * The descriptions below become part of the model's tool definition.
 */
export const EventWhenSchema = z
  .object({
    dayOffset: z
      .number()
      .int()
      .min(-EVENT_MAX_DAYS_BACK)
      .max(0)
      .optional()
      .describe(
        "Days before today: 0 is today, -1 is yesterday. Sleep uses the day the person woke up, so 'last night' is 0. Give this or date, not both.",
      ),
    date: DateSchema.optional().describe(
      "The calendar date (YYYY-MM-DD) when the person gave one. Give this or dayOffset, not both.",
    ),
    localTime: z
      .string()
      .regex(TIME_PATTERN, "localTime must look like HH:MM in 24-hour time")
      .optional()
      .describe(
        "The local time (HH:MM, 24-hour) only when the person said or clearly implied one. For a sleep event this is the time they woke up, never bedtime: put bedtime in details instead.",
      ),
  })
  .refine(
    (when) => (when.dayOffset === undefined) !== (when.date === undefined),
    { message: "Give exactly one of dayOffset or date." },
  );
export type EventWhen = z.infer<typeof EventWhenSchema>;

export type ResolvedEventWhen =
  | { ok: true; occurredOn: string; occurredAt: Date | null }
  | { ok: false; reason: "future" | "too_old"; message: string };

/**
 * The day (YYYY-MM-DD) a `when` falls on in the person's timezone, without
 * checking it. A confirmation card uses this to show a draft's date; saving
 * goes through `resolveEventWhen`, which also rejects future and old dates.
 */
export function eventDate(
  when: EventWhen,
  timeZone: string,
  now: Date,
): string {
  if (when.date !== undefined) return when.date;
  if (when.dayOffset !== undefined) {
    return addDays(localToday(timeZone, now), when.dayOffset);
  }
  throw new Error("EventWhen needs exactly one of dayOffset or date");
}

/**
 * Turns the model's `when` into the event's `occurred_on` (a date in the
 * person's timezone) and `occurred_at` (only when a time was given).
 *
 * Events must already have happened: a day after today, a time more than
 * EVENT_FUTURE_ALLOWANCE_MINUTES ahead of `now`, or a day more than
 * EVENT_MAX_DAYS_BACK ago comes back as `{ ok: false }` with a message
 * written for the model, so it can be returned as a fixable tool error.
 * An invalid timezone throws, because stored timezones are validated.
 */
export function resolveEventWhen(
  when: EventWhen,
  timeZone: string,
  now: Date,
): ResolvedEventWhen {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid time zone: ${timeZone}`);
  }

  const today = localToday(timeZone, now);
  const occurredOn = eventDate(when, timeZone, now);

  if (occurredOn > today) {
    return {
      ok: false,
      reason: "future",
      message:
        "That date is in the future. Only log things that have already happened, and do not propose an event for it.",
    };
  }
  if (occurredOn < addDays(today, -EVENT_MAX_DAYS_BACK)) {
    return {
      ok: false,
      reason: "too_old",
      message: `That date is more than ${String(EVENT_MAX_DAYS_BACK)} days ago, which is too far back to log. Check the date with the person.`,
    };
  }

  if (when.localTime === undefined) {
    return { ok: true, occurredOn, occurredAt: null };
  }

  const occurredAt = zonedTimeToInstant(occurredOn, when.localTime, timeZone);
  const latest = now.getTime() + EVENT_FUTURE_ALLOWANCE_MINUTES * 60 * 1000;
  if (occurredAt.getTime() > latest) {
    return {
      ok: false,
      reason: "future",
      message:
        "That time has not happened yet. Only log things that have already happened, and do not propose an event for it.",
    };
  }
  return { ok: true, occurredOn, occurredAt };
}
