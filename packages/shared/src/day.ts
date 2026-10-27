import { z } from "zod";
import { SCORE_MAX, SCORE_MIN } from "./values.js";
import { DateSchema } from "./zoned-time.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One event on the day view. */
export const DayEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  feelScore: z.number().int().min(SCORE_MIN).max(SCORE_MAX).optional(),
  feelWords: z.array(z.string()),
  tags: z.array(z.string()),
  /** Only when a time is known, as HH:MM in the person's timezone. */
  localTime: z.string().regex(TIME_PATTERN).optional(),
});
export type DayEvent = z.infer<typeof DayEventSchema>;

/**
 * One thing the person told the coach, in their own words, with the events
 * from it that happened on this day. `createdOn` and `createdTime` say when it
 * was told, in the person's timezone, so a page can note "yesterday I hiked"
 * was told on another day.
 */
export const DayEntrySchema = z.object({
  id: z.string(),
  text: z.string(),
  createdOn: DateSchema,
  createdTime: z.string().regex(TIME_PATTERN),
  events: z.array(DayEventSchema),
});
export type DayEntry = z.infer<typeof DayEntrySchema>;

/** The body of GET /days/:date. */
export const DayResponseSchema = z.object({
  date: DateSchema,
  entries: z.array(DayEntrySchema),
});
export type DayResponse = z.infer<typeof DayResponseSchema>;
