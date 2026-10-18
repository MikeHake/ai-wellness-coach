import { z } from "zod";
import { UNITS } from "./values.js";

/**
 * Returns the canonical IANA name (for example "America/Denver") when `name`
 * is a real named time zone, otherwise undefined. Fixed offsets such as
 * "+02:00" are rejected because they ignore daylight saving time.
 */
export function canonicalTimeZone(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "" || /^[+-]/.test(trimmed)) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function isValidTimeZone(name: string): boolean {
  return canonicalTimeZone(name) !== undefined;
}

export const TimeZoneSchema = z
  .string()
  .refine(isValidTimeZone, {
    message: "Must be an IANA time zone name, like America/Denver",
  })
  .transform((name) => canonicalTimeZone(name) ?? name);

/** Body of POST /me, sent once after sign-in. */
export const CreateProfileRequestSchema = z.object({
  timezone: TimeZoneSchema,
});
export type CreateProfileRequest = z.input<typeof CreateProfileRequestSchema>;

/** The signed-in user's profile, as returned by POST /me and GET /me. */
export const ProfileSchema = z.object({
  id: z.uuid(),
  timezone: z.string(),
  units: z.enum(UNITS),
  createdAt: z.iso.datetime(),
});
export type Profile = z.infer<typeof ProfileSchema>;
