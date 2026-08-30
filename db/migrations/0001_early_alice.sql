DROP INDEX "steam_app_queue_idx";--> statement-breakpoint
ALTER TABLE "steam_app" ADD COLUMN "steam_last_modified" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "steam_app" ADD COLUMN "price_change_number" integer;--> statement-breakpoint
CREATE INDEX "steam_app_queue_idx" ON "steam_app" USING btree ("hydration_state","next_attempt_at","app_type","steam_last_modified" desc);