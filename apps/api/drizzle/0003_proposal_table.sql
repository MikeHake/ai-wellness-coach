CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid,
	"tool_call_id" text NOT NULL,
	"kind" text NOT NULL,
	"draft" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "proposal_user_id_tool_call_id_unique" UNIQUE("user_id","tool_call_id"),
	CONSTRAINT "proposal_kind_check" CHECK ("proposal"."kind" in ('events', 'profile')),
	CONSTRAINT "proposal_status_check" CHECK ("proposal"."status" in ('pending', 'saved', 'discarded'))
);
--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_entry_owner_fk" FOREIGN KEY ("entry_id","user_id") REFERENCES "public"."entry"("id","user_id") ON DELETE cascade ON UPDATE no action;