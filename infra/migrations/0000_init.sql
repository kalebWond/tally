CREATE TYPE "public"."contest_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dead_letter_reason" AS ENUM('unknown_code', 'contest_closed', 'malformed');--> statement-breakpoint
CREATE TYPE "public"."vote_source" AS ENUM('sms', 'web', 'generator');--> statement-breakpoint
CREATE TABLE "contestants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"image_url" text,
	"accent_from" text,
	"accent_to" text,
	"country_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contestants_contest_code_unique" UNIQUE("contest_id","code")
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "contest_status" DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dead_letters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" "dead_letter_reason" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote_buckets" (
	"contestant_id" uuid NOT NULL,
	"bucket_minute" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "vote_buckets_contestant_id_bucket_minute_pk" PRIMARY KEY("contestant_id","bucket_minute")
);
--> statement-breakpoint
CREATE TABLE "vote_totals" (
	"contestant_id" uuid PRIMARY KEY NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contest_id" uuid NOT NULL,
	"contestant_id" uuid,
	"code_submitted" text NOT NULL,
	"voter_hash" text NOT NULL,
	"source" "vote_source" NOT NULL,
	"idempotency_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "contestants" ADD CONSTRAINT "contestants_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_buckets" ADD CONSTRAINT "vote_buckets_contestant_id_contestants_id_fk" FOREIGN KEY ("contestant_id") REFERENCES "public"."contestants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_totals" ADD CONSTRAINT "vote_totals_contestant_id_contestants_id_fk" FOREIGN KEY ("contestant_id") REFERENCES "public"."contestants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_contestant_id_contestants_id_fk" FOREIGN KEY ("contestant_id") REFERENCES "public"."contestants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "votes_contest_received_idx" ON "votes" USING btree ("contest_id","received_at");