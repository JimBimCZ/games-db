CREATE TYPE "public"."steam_list_kind" AS ENUM('top_sellers', 'specials', 'coming_soon', 'new_releases');--> statement-breakpoint
CREATE TABLE "steam_list" (
	"kind" "steam_list_kind" NOT NULL,
	"appid" integer NOT NULL,
	"rank" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_list_kind_appid_pk" PRIMARY KEY("kind","appid")
);
--> statement-breakpoint
ALTER TABLE "steam_list" ADD CONSTRAINT "steam_list_appid_steam_app_appid_fk" FOREIGN KEY ("appid") REFERENCES "public"."steam_app"("appid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "steam_list_rank_idx" ON "steam_list" USING btree ("kind","rank");