-- F17: per-minute buckets from the vote log, for votes counted before the consumer wrote buckets.
-- Recounts rather than adds, so it is exact and safe to re-run. The minute is when ingest
-- accepted the vote (received_at), as the consumer files it. Run with the consumer stopped
-- (the compose `migrate` job always does): a batch committing mid-recount could be overwritten.
INSERT INTO "vote_buckets" ("contestant_id", "bucket_minute", "count")
SELECT "contestant_id", date_trunc('minute', "received_at"), count(*)::int
FROM "votes"
WHERE "contestant_id" IS NOT NULL
GROUP BY 1, 2
ON CONFLICT ("contestant_id", "bucket_minute") DO UPDATE SET "count" = excluded."count";
