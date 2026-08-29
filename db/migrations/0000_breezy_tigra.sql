CREATE TYPE "public"."hydration_state" AS ENUM('pending', 'ok', 'failed', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."library_status" AS ENUM('backlog', 'playing', 'finished', 'abandoned', 'wishlist');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('screenshot', 'movie');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" integer PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game" (
	"appid" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"short_description" text,
	"about_html" text,
	"detailed_html" text,
	"header_image" text,
	"capsule_image" text,
	"background_raw" text,
	"release_date_text" text,
	"release_coming_soon" boolean DEFAULT false NOT NULL,
	"release_date" timestamp with time zone,
	"developers" text[],
	"publishers" text[],
	"platforms" jsonb,
	"metacritic_score" smallint,
	"metacritic_url" text,
	"recommendations_total" integer,
	"achievements_total" integer,
	"supported_languages_raw" text,
	"content_descriptor_ids" integer[],
	"content_descriptor_notes" text,
	"dlc_appids" integer[],
	"pc_requirements" jsonb,
	"mac_requirements" jsonb,
	"linux_requirements" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_category" (
	"appid" integer NOT NULL,
	"category_id" integer NOT NULL,
	CONSTRAINT "game_category_appid_category_id_pk" PRIMARY KEY("appid","category_id")
);
--> statement-breakpoint
CREATE TABLE "game_genre" (
	"appid" integer NOT NULL,
	"genre_id" text NOT NULL,
	CONSTRAINT "game_genre_appid_genre_id_pk" PRIMARY KEY("appid","genre_id")
);
--> statement-breakpoint
CREATE TABLE "game_media" (
	"id" text PRIMARY KEY NOT NULL,
	"appid" integer NOT NULL,
	"kind" "media_kind" NOT NULL,
	"position" integer NOT NULL,
	"steam_media_id" integer,
	"name" text,
	"thumbnail_url" text,
	"full_url" text,
	"hls_url" text,
	"dash_h264_url" text,
	"dash_av1_url" text,
	"highlight" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genre" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"appid" integer NOT NULL,
	"status" "library_status" NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_seen_minor" integer,
	"price_seen_currency" text
);
--> statement-breakpoint
CREATE TABLE "library_status_event" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"status" "library_status" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price" (
	"appid" integer NOT NULL,
	"cc" text NOT NULL,
	"currency" text NOT NULL,
	"initial_minor" integer NOT NULL,
	"final_minor" integer NOT NULL,
	"discount_percent" smallint DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_appid_cc_pk" PRIMARY KEY("appid","cc")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" text PRIMARY KEY NOT NULL,
	"appid" integer NOT NULL,
	"cc" text NOT NULL,
	"currency" text NOT NULL,
	"initial_minor" integer NOT NULL,
	"final_minor" integer NOT NULL,
	"discount_percent" smallint DEFAULT 0 NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_summary" (
	"appid" integer PRIMARY KEY NOT NULL,
	"review_score" smallint,
	"review_score_desc" text,
	"total_positive" integer,
	"total_negative" integer,
	"total_reviews" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steam_app" (
	"appid" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_type" text,
	"last_seen_in_list_at" timestamp with time zone,
	"hydration_state" "hydration_state" DEFAULT 'pending' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_appid_steam_app_appid_fk" FOREIGN KEY ("appid") REFERENCES "public"."steam_app"("appid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_category" ADD CONSTRAINT "game_category_appid_game_appid_fk" FOREIGN KEY ("appid") REFERENCES "public"."game"("appid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_category" ADD CONSTRAINT "game_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_genre" ADD CONSTRAINT "game_genre_appid_game_appid_fk" FOREIGN KEY ("appid") REFERENCES "public"."game"("appid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_genre" ADD CONSTRAINT "game_genre_genre_id_genre_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_media" ADD CONSTRAINT "game_media_appid_game_appid_fk" FOREIGN KEY ("appid") REFERENCES "public"."game"("appid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entry" ADD CONSTRAINT "library_entry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_status_event" ADD CONSTRAINT "library_status_event_entry_id_library_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."library_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price" ADD CONSTRAINT "price_appid_game_appid_fk" FOREIGN KEY ("appid") REFERENCES "public"."game"("appid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_summary" ADD CONSTRAINT "review_summary_appid_game_appid_fk" FOREIGN KEY ("appid") REFERENCES "public"."game"("appid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_type_idx" ON "game" USING btree ("type");--> statement-breakpoint
CREATE INDEX "game_release_date_idx" ON "game" USING btree ("release_date");--> statement-breakpoint
CREATE INDEX "game_name_idx" ON "game" USING btree ("name");--> statement-breakpoint
CREATE INDEX "game_category_category_idx" ON "game_category" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "game_genre_genre_idx" ON "game_genre" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "game_media_appid_idx" ON "game_media" USING btree ("appid","kind","position");--> statement-breakpoint
CREATE UNIQUE INDEX "library_entry_user_app_idx" ON "library_entry" USING btree ("user_id","appid");--> statement-breakpoint
CREATE INDEX "library_entry_status_idx" ON "library_entry" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "library_status_event_entry_idx" ON "library_status_event" USING btree ("entry_id","at");--> statement-breakpoint
CREATE INDEX "price_discount_idx" ON "price" USING btree ("cc","discount_percent");--> statement-breakpoint
CREATE INDEX "price_final_idx" ON "price" USING btree ("cc","final_minor");--> statement-breakpoint
CREATE INDEX "price_history_appid_idx" ON "price_history" USING btree ("appid","cc","observed_at");--> statement-breakpoint
CREATE INDEX "steam_app_queue_idx" ON "steam_app" USING btree ("hydration_state","next_attempt_at");