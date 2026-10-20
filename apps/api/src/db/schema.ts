import { MESSAGE_ROLES, SCORE_MAX, SCORE_MIN } from "@ai-wellness-coach/shared";
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The Auth0 `sub` claim, for example "auth0|65f...".
  authSubject: text("auth_subject").notNull().unique(),
  // IANA timezone name, such as "America/Denver".
  timezone: text("timezone").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  ...timestamps,
});

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
