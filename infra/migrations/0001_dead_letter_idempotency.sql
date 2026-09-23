ALTER TABLE "dead_letters" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "dead_letters" ADD CONSTRAINT "dead_letters_idempotency_key_unique" UNIQUE("idempotency_key");