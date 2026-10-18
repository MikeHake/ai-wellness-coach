import {
  COMPANIONS,
  EFFORTS,
  SCORE_MAX,
  SCORE_MIN,
  SETTINGS,
  UNITS,
} from "@ai-wellness-coach/shared";
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// CHECK (column IN ('a', 'b', ...)) built from a shared value list.
// The values are our own constants, so inlining them as literals is safe.
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => sql.raw(`'${value}'`));
  return sql`${column} in (${sql.join(literals, sql`, `)})`;
}

// CHECK (column BETWEEN 1 AND 5) for feeling scores.
function isScore(column: AnyPgColumn): SQL {
  return sql`${column} between ${sql.raw(String(SCORE_MIN))} and ${sql.raw(String(SCORE_MAX))}`;
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const feelWords = () =>
  text("feel_words")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The Auth0 `sub` claim, for example "auth0|65f...".
    authSubject: text("auth_subject").notNull().unique(),
    // IANA timezone name, such as "America/Denver".
    timezone: text("timezone").notNull(),
    units: text("units").notNull().default("imperial"),
    ...timestamps,
  },
  (t) => [check("users_units_check", oneOf(t.units, UNITS))],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    // Free text on purpose: the agent produces open-ended types like "mountain_bike".
    activityType: text("activity_type").notNull(),
    durationMin: integer("duration_min"),
    effort: text("effort"),
    companions: text("companions"),
    setting: text("setting"),
    felt: smallint("felt"),
    feelWords: feelWords(),
    rawText: text("raw_text"),
    ...timestamps,
  },
  (t) => [
    index("activities_user_started_at_idx").on(t.userId, t.startedAt),
    check("activities_duration_check", sql`${t.durationMin} > 0`),
    check("activities_effort_check", oneOf(t.effort, EFFORTS)),
    check("activities_companions_check", oneOf(t.companions, COMPANIONS)),
    check("activities_setting_check", oneOf(t.setting, SETTINGS)),
    check("activities_felt_check", isScore(t.felt)),
  ],
);

// Optional specifics (distance, sets, reps, weight), only when mentioned.
// Access always goes through the parent activity, which carries the user id.
export const activityDetails = pgTable("activity_details", {
  activityId: uuid("activity_id")
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  details: jsonb("details").notNull(),
  ...timestamps,
});

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    energy: smallint("energy"),
    mood: smallint("mood"),
    stress: smallint("stress"),
    bodyFeel: smallint("body_feel"),
    feelWords: feelWords(),
    rawText: text("raw_text"),
    ...timestamps,
  },
  (t) => [
    index("checkins_user_at_idx").on(t.userId, t.at),
    check("checkins_energy_check", isScore(t.energy)),
    check("checkins_mood_check", isScore(t.mood)),
    check("checkins_stress_check", isScore(t.stress)),
    check("checkins_body_feel_check", isScore(t.bodyFeel)),
  ],
);

export const restLogs = pgTable(
  "rest_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The wake-up date in the user's timezone, as "YYYY-MM-DD".
    date: date("date", { mode: "string" }).notNull(),
    sleepMinutes: integer("sleep_minutes"),
    sleepQuality: smallint("sleep_quality"),
    // Free text on purpose: how the user described waking up, in their own words.
    wokeFeeling: text("woke_feeling"),
    soreness: smallint("soreness"),
    rawText: text("raw_text"),
    ...timestamps,
  },
  (t) => [
    // One entry per user per day; also serves day and range lookups.
    unique("rest_logs_user_date_unique").on(t.userId, t.date),
    check(
      "rest_logs_sleep_minutes_check",
      sql`${t.sleepMinutes} between 0 and 1440`,
    ),
    check("rest_logs_sleep_quality_check", isScore(t.sleepQuality)),
    check("rest_logs_soreness_check", isScore(t.soreness)),
  ],
);
