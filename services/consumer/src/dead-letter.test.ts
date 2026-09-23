import { randomUUID } from 'node:crypto';
import {
  Admin,
  Consumer,
  compatibilityPartitioner,
  Producer,
  stringDeserializers,
  stringSerializers,
} from '@platformatic/kafka';
import { DeadLetterEvent, redisKeys } from '@tally/contracts';
import { sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVoteConsumer } from './consumer.js';
import { CONTEST_ID, createTestStores, voteEvent } from './test-support.js';

// F6 done-when, end to end through Redpanda: a vote for a nonexistent code lands in the
// dead-letter topic with a reason, and does not affect any total.

const brokersEnv = process.env.KAFKA_BROKERS;
if (!brokersEnv) throw new Error('KAFKA_BROKERS must be set (see .env.example)');
const brokers = brokersEnv.split(',');
const topic = `test.votes.${randomUUID().slice(0, 8)}`;
const deadTopic = `${topic}.dead`;

let stores: Awaited<ReturnType<typeof createTestStores>>;
const admin = new Admin({ clientId: 'dead-letter-test-admin', bootstrapBrokers: brokers });

const valid = [voteEvent('C1'), voteEvent('C2'), voteEvent('C2')];
const unknownCode = voteEvent('ZZ9');
const unknownContest = voteEvent('C1', { contest_id: '00000000-0000-4000-8000-000000000000' });
const malformed = '{"code":"C1"}';

async function readDeadTopic(expected: number) {
  const consumer = new Consumer({
    clientId: 'dead-letter-test-reader',
    groupId: `test-${randomUUID()}`,
    bootstrapBrokers: brokers,
    deserializers: stringDeserializers,
  });
  const stream = await consumer.consume({
    topics: [deadTopic],
    mode: 'earliest',
    autocommit: false,
  });
  const out: { key: string | undefined; event: DeadLetterEvent }[] = [];
  const timeout = setTimeout(
    () => stream.destroy(new Error('timed out reading votes.dead')),
    20_000,
  );
  try {
    for await (const m of stream) {
      out.push({ key: m.key || undefined, event: DeadLetterEvent.parse(JSON.parse(m.value)) });
      if (out.length === expected) break;
    }
  } finally {
    clearTimeout(timeout);
    await stream.close();
    await consumer.close(true);
  }
  return out;
}

beforeAll(async () => {
  stores = await createTestStores();
  await admin.createTopics({ topics: [topic, deadTopic], partitions: 6, replicas: 1 });
  const producer = new Producer({
    clientId: 'dead-letter-test-producer',
    bootstrapBrokers: brokers,
    serializers: stringSerializers,
    partitioner: compatibilityPartitioner,
  });
  await producer.send({
    messages: [
      ...[...valid, unknownCode, unknownContest].map((e) => ({
        topic,
        key: e.code,
        value: JSON.stringify(e),
      })),
      { topic, key: 'C1', value: malformed },
    ],
  });
  await producer.close();
}, 60_000);

afterAll(async () => {
  await admin.deleteTopics({ topics: [topic, deadTopic] });
  await admin.close();
  await stores?.cleanup();
});

describe('dead letters (votes.raw → votes.dead + dead_letters)', () => {
  it('a vote for a nonexistent code lands on votes.dead with a reason and changes no total', async () => {
    const consumer = createVoteConsumer({
      brokers,
      topic,
      deadTopic,
      groupId: `test-${randomUUID()}`,
      db: stores.db,
      redis: stores.redis,
      log: pino({ level: 'silent' }),
    });
    await consumer.start();
    const dead = await readDeadTopic(3).finally(() => consumer.stop());

    const byKey = new Map(dead.map((d) => [d.event.idempotency_key, d]));
    expect(byKey.get(unknownCode.idempotency_key)).toMatchObject({
      key: 'ZZ9',
      event: { reason: 'unknown_code', original: unknownCode },
    });
    expect(byKey.get(unknownContest.idempotency_key)?.event.reason).toBe('unknown_code');
    const bad = dead.find((d) => d.event.reason === 'malformed');
    expect(bad?.event.original).toEqual(JSON.parse(malformed));

    // Mirrored in the table, and only the three valid votes were counted.
    const { rows } = await stores.db.execute<{ dead: number; total: number }>(sql`
      select (select count(*)::int from dead_letters) as dead,
             (select coalesce(sum(total), 0)::int from vote_totals) as total`);
    expect(rows[0]).toEqual({ dead: 3, total: 3 });
    const redis = await stores.redis.hvals(redisKeys.totals(CONTEST_ID));
    expect(redis.reduce((s, v) => s + Number(v), 0)).toBe(3);
  }, 60_000);
});
