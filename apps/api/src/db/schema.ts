import {
  COMPANIONS,
  EFFORTS,
  MESSAGE_ROLES,
  SCORE_MAX,
  SCORE_MIN,
  SETTINGS,
  UNITS,
} from "@ai-wellness-coach/shared";
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
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
    firstName: text("first_name"),
    lastName: text("last_name"),
    ...timestamps,
  },
  (t) => [check("users_units_check", oneOf(t.units, UNITS))],
);

// One row per thing a person tells the coach, saved verbatim before any AI runs.
export const entry = pgTable(
  "entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // When it was entered, not when things happened.
    createdAt: timestamps.createdAt,
    rawText: text("raw_text").notNull(),
  },
  // Lets event and chat_messages reference an entry together with its owner.
  (t) => [unique("entry_id_user_id_unique").on(t.id, t.userId)],
);

// A null user id means a built-in type everyone sees; otherwise it is private.
export const eventType = pgTable(
  "event_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    // Fed to the extraction prompt so new types work without code changes.
    description: text("description").notNull(),
    createdAt: timestamps.createdAt,
  },
  // Nulls not distinct, so two built-ins can't share a name.
  (t) => [
    unique("event_type_user_id_name_unique")
      .on(t.userId, t.name)
      .nullsNotDistinct(),
  ],
);

// Anything health related parsed out of an entry. One entry can produce several.
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(),
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references(() => eventType.id, { onDelete: "restrict" }),
    // The day it happened in the user's timezone, as "YYYY-MM-DD".
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    // Only when a time is known ("at 6am").
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    summary: text("summary").notNull(),
    feelScore: smallint("feel_score"),
    feelWords: feelWords(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Anything else mentioned, in the user's units.
    details: jsonb("details"),
    // True once the user corrects it; skipped when re-parsing.
    edited: boolean("edited").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    // An event can never point at another user's entry.
    foreignKey({
      name: "event_entry_owner_fk",
      columns: [t.entryId, t.userId],
      foreignColumns: [entry.id, entry.userId],
    }).onDelete("cascade"),
    index("event_user_occurred_on_idx").on(t.userId, t.occurredOn),
    index("event_user_type_occurred_on_idx").on(
      t.userId,
      t.eventTypeId,
      t.occurredOn,
    ),
    check("event_feel_score_check", isScore(t.feelScore)),
  ],
);

// The conversation itself, so a chat picks up where it left off on any device.
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The entry a user message created, if any.
    entryId: uuid("entry_id"),
    role: text("role").notNull(),
    content: text("content").notNull(),
    // Tool calls and results, so a conversation can be replayed to the model.
    toolCalls: jsonb("tool_calls"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    // Keeps a message and its entry on the same user. The migration hand-edits
    // this to `on delete set null ("entry_id")`, because Drizzle can't list
    // columns and a plain set null would also clear the non-null user_id.
    foreignKey({
      name: "chat_messages_entry_owner_fk",
      columns: [t.entryId, t.userId],
      foreignColumns: [entry.id, entry.userId],
    }).onDelete("set null"),
    index("chat_messages_user_created_at_idx").on(t.userId, t.createdAt),
    check("chat_messages_role_check", oneOf(t.role, MESSAGE_ROLES)),
  ],
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
