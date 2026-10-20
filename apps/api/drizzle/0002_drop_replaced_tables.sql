ALTER TABLE "activities" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_details" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkins" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rest_logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "activities" CASCADE;--> statement-breakpoint
DROP TABLE "activity_details" CASCADE;--> statement-breakpoint
DROP TABLE "checkins" CASCADE;--> statement-breakpoint
DROP TABLE "rest_logs" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_units_check";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "units";