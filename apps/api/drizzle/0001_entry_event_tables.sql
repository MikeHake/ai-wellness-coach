CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" in ('user', 'assistant', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_text" text NOT NULL,
	CONSTRAINT "entry_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"summary" text NOT NULL,
	"feel_score" smallint,
	"feel_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"details" jsonb,
	"edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_feel_score_check" CHECK ("event"."feel_score" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "event_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type_user_id_name_unique" UNIQUE NULLS NOT DISTINCT("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-edited: Drizzle can't list columns for set null. Clearing only entry_id keeps
-- the message (and its non-null user_id) when its entry is deleted.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_entry_owner_fk" FOREIGN KEY ("entry_id","user_id") REFERENCES "public"."entry"("id","user_id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_entry_owner_fk" FOREIGN KEY ("entry_id","user_id") REFERENCES "public"."entry"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type" ADD CONSTRAINT "event_type_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_user_created_at_idx" ON "chat_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "event_user_occurred_on_idx" ON "event" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "event_user_type_occurred_on_idx" ON "event" USING btree ("user_id","event_type_id","occurred_on");--> statement-breakpoint
-- Hand-written: seed the built-in event types from BUILT_IN_EVENT_TYPES in packages/shared; a null user_id means built-in.
INSERT INTO "event_type" ("name", "description") VALUES
	('meal', 'Breakfast, lunch, or dinner. Tags describe the food or setting, such as home_cooked, eating_out, heavy, late, or fried.'),
	('snack', 'Anything eaten between meals. Tags describe what it was, such as sweets or salty.'),
	('drink', 'Alcohol, caffeine, or another notable drink. Tags describe it, such as alcohol, coffee, or beer.'),
	('activity', 'Any movement, such as a hike, run, ride, lifting, class, or walk. Tags describe the kind and setting, such as hike, run, bike, weights, outdoor, indoor, with_friends, or solo.'),
	('sleep', 'A night''s sleep or a nap, dated by the day the person woke up. Tags add detail, such as nap or woke_up_often.'),
	('stress', 'A stressful event or period. Tags name the source, such as work, family, or travel.'),
	('feeling', 'How the person feels, when it is not tied to another event. Tags name the aspect, such as energy, mood, sore, or sick.');
