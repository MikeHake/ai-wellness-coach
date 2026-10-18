CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"activity_type" text NOT NULL,
	"duration_min" integer,
	"effort" text,
	"companions" text,
	"setting" text,
	"felt" smallint,
	"feel_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"raw_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_duration_check" CHECK ("activities"."duration_min" > 0),
	CONSTRAINT "activities_effort_check" CHECK ("activities"."effort" in ('easy', 'moderate', 'hard')),
	CONSTRAINT "activities_companions_check" CHECK ("activities"."companions" in ('solo', 'with_others', 'group')),
	CONSTRAINT "activities_setting_check" CHECK ("activities"."setting" in ('indoor', 'outdoor')),
	CONSTRAINT "activities_felt_check" CHECK ("activities"."felt" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "activity_details" (
	"activity_id" uuid PRIMARY KEY NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"energy" smallint,
	"mood" smallint,
	"stress" smallint,
	"body_feel" smallint,
	"feel_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"raw_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkins_energy_check" CHECK ("checkins"."energy" between 1 and 5),
	CONSTRAINT "checkins_mood_check" CHECK ("checkins"."mood" between 1 and 5),
	CONSTRAINT "checkins_stress_check" CHECK ("checkins"."stress" between 1 and 5),
	CONSTRAINT "checkins_body_feel_check" CHECK ("checkins"."body_feel" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "rest_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sleep_minutes" integer,
	"sleep_quality" smallint,
	"woke_feeling" text,
	"soreness" smallint,
	"raw_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rest_logs_user_date_unique" UNIQUE("user_id","date"),
	CONSTRAINT "rest_logs_sleep_minutes_check" CHECK ("rest_logs"."sleep_minutes" between 0 and 1440),
	CONSTRAINT "rest_logs_sleep_quality_check" CHECK ("rest_logs"."sleep_quality" between 1 and 5),
	CONSTRAINT "rest_logs_soreness_check" CHECK ("rest_logs"."soreness" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_subject" text NOT NULL,
	"timezone" text NOT NULL,
	"units" text DEFAULT 'imperial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_subject_unique" UNIQUE("auth_subject"),
	CONSTRAINT "users_units_check" CHECK ("users"."units" in ('imperial', 'metric'))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_details" ADD CONSTRAINT "activity_details_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rest_logs" ADD CONSTRAINT "rest_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_user_started_at_idx" ON "activities" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "checkins_user_at_idx" ON "checkins" USING btree ("user_id","at");