import { randomUUID } from 'node:crypto';
import { Admin, compatibilityPartitioner, Producer, stringSerializers } from '@platformatic/kafka';
import { redisKeys } from '@tally/contracts';
import { sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVoteConsumer } from './consumer.js';
import { CODES, CONTEST_ID, createTestStores, voteEvent } from './test-support.js';

// F5 done-when, end to end through Redpanda: 1,000 votes produce a total of exactly 1,000,
// and replaying the same messages (a fresh consumer group from offset zero) doesn't change it.

const brokersEnv = process.env.KAFKA_BROKERS;
if (!brokersEnv) throw new Error('KAFKA_BROKERS must be set (see .env.example)');
const brokers = brokersEnv.split(',');
const topic = `test.votes.${randomUUID().slice(0, 8)}`;
const log = pino({ level: 'silent' });

let stores: Awaited<ReturnType<typeof createTestStores>>;
const admin = new Admin({ clientId: 'consumer-test-admin', bootstrapBrokers: brokers });

async function pgTotal() {
  const { rows } = await stores.db.execute<{ total: number }>(
    sql`select coalesce(sum(total), 0)::int as total from vote_totals`,
  );
  return rows[0]?.total ?? 0;
}

async function redisTotal() {
  const values = await stores.redis.hvals(redisKeys.totals(CONTEST_ID));
  return values.reduce((s, v) => s + Number(v), 0);
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  stores = await createTestStores();
  await admin.createTopics({ topics: [topic], partitions: 6, replicas: 1 });

  const producer = new Producer({
    clientId: 'consumer-test-producer',
    bootstrapBrokers: brokers,
    serializers: stringSerializers,
    partitioner: compatibilityPartitioner,
  });
  const events = Array.from({ length: 1000 }, (_, i) => voteEvent(CODES[i % CODES.length] ?? 'C1'));
  for (let i = 0; i < events.length; i += 200) {
    await producer.send({
      messages: events
        .slice(i, i + 200)
        .map((e) => ({ topic, key: e.code, value: JSON.stringify(e) })),
    });
  }
  await producer.close();
}, 60_000);

afterAll(async () => {
  await admin.deleteTopics({ topics: [topic] });
  await admin.close();
  await stores?.cleanup();
});

const start = (groupId: string) =>
  createVoteConsumer({
    brokers,
    topic,
    groupId,
    db: stores.db,
    redis: stores.redis,
    log,
  });

describe('vote consumer (Redpanda → Postgres + Redis)', () => {
  it('1,000 votes on the topic produce a total of exactly 1,000', async () => {
    const consumer = start(`test-${randomUUID()}`);
    await consumer.start();
    try {
      await until(async () => (await pgTotal()) >= 1000);
      await until(() => consumer.stats().processed >= 1000);
    } finally {
      await consumer.stop();
    }

    expect(await pgTotal()).toBe(1000);
    expect(await redisTotal()).toBe(1000);
  }, 60_000);

  it('replaying the whole topic through a fresh consumer group leaves the total at 1,000', async () => {
    const replay = start(`test-replay-${randomUUID()}`);
    await replay.start();
    try {
      await until(() => replay.stats().processed >= 1000);
    } finally {
      await replay.stop();
    }

    expect(replay.stats()).toMatchObject({ processed: 1000, counted: 0, duplicates: 1000 });
    expect(await pgTotal()).toBe(1000);
    expect(await redisTotal()).toBe(1000);
  }, 60_000);
});
