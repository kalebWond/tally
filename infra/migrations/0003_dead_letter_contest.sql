ALTER TABLE "dead_letters" ADD COLUMN "contest_id" uuid;--> statement-breakpoint
-- Backfill (hand-written): rows written before F15 carry the contest only in the payload. Malformed
-- payloads can hold anything, so only a well-formed UUID is taken.
UPDATE "dead_letters" SET "contest_id" = ("payload"->>'contest_id')::uuid
  WHERE "payload"->>'contest_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';--> statement-breakpoint
CREATE INDEX "dead_letters_contest_id_idx" ON "dead_letters" USING btree ("contest_id","id");--> statement-breakpoint
CREATE INDEX "dead_letters_reason_id_idx" ON "dead_letters" USING btree ("reason","id");--> statement-breakpoint
CREATE INDEX "dead_letters_contest_reason_id_idx" ON "dead_letters" USING btree ("contest_id","reason","id");