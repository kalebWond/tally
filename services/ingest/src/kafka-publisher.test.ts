import { randomUUID } from 'node:crypto';
import { Admin, Consumer, stringDeserializers } from '@platformatic/kafka';
import type { VoteEvent } from '@tally/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKafkaPublisher, PUBLISH_DEADLINE_MS } from './kafka-publisher.js';

// F4 done-when: a published vote lands on the topic. F35: votes are keyed by idempotency key, so a
// runaway leader's votes spread over every partition, and a retry lands where the first try did.
// Runs against the local Redpanda (KAFKA_BROKERS).

const brokersEnv = process.env.KAFKA_BROKERS;
if (!brokersEnv) throw new Error('KAFKA_BROKERS must be set (see .env.example)');
const brokers = brokersEnv.split(',');

const topic = `test.votes.${randomUUID().slice(0, 8)}`;
const PARTITIONS = 6;
const codes = Array.from({ length: 10 }, (_, i) => `C${i + 1}`);
// A lopsided contest: C1 gets 120 votes, the others 20 each. With 6 partitions, the chance that
// 120 evenly hashed votes miss one is about 1 in 400 million.
const LEADER_VOTES = 120;
const PER_CODE = 20;
const TOTAL = LEADER_VOTES + (codes.length - 1) * PER_CODE;

const admin = new Admin({ clientId: 'ingest-test-admin', bootstrapBrokers: brokers });

const event = (code: string): VoteEvent => ({
  v: 1,
  event_id: randomUUID(),
  contest_id: '0192f3a0-7c1e-7000-8000-00000000c0de',
  code,
  voter_hash: 'a'.repeat(64),
  source: 'generator',
  sent_at: new Date().toISOString(),
  idempotency_key: randomUUID(),
});

async function consumeAll(expected: number) {
  const consumer = new Consumer({
    clientId: 'ingest-test-consumer',
    groupId: `test-${randomUUID()}`,
    bootstrapBrokers: brokers,
    deserializers: stringDeserializers,
  });
  const stream = await consumer.consume({ topics: [topic], mode: 'earliest', autocommit: false });
  const received: { key: string; value: string; partition: number }[] = [];
  const timeout = setTimeout(
    () => stream.destroy(new Error('timed out waiting for messages')),
    20_000,
  );
  try {
    for await (const m of stream) {
      received.push({ key: m.key, value: m.value, partition: m.partition });
      if (received.length === expected) break;
    }
  } finally {
    clearTimeout(timeout);
    await stream.close();
    await consumer.close(true);
  }
  return received;
}

beforeAll(async () => {
  await admin.createTopics({ topics: [topic], partitions: PARTITIONS, replicas: 1 });
});

afterAll(async () => {
  await admin.deleteTopics({ topics: [topic] });
  await admin.close();
});

describe('Kafka publisher', () => {
  it('lands every vote on the topic, keyed by its idempotency key, the leader on every partition', async () => {
    const publisher = createKafkaPublisher({ brokers, topic });
    // Interleave codes and fire concurrently, the way real traffic arrives.
    const events = [
      ...Array.from({ length: LEADER_VOTES }, () => event('C1')),
      ...Array.from({ length: PER_CODE }, () => codes.slice(1).map(event)).flat(),
    ];
    try {
      await Promise.all(events.map((e) => publisher.publish(e)));
    } finally {
      await publisher.close();
    }

    const received = await consumeAll(events.length);

    expect(received).toHaveLength(events.length);
    const sentIds = new Set(events.map((e) => e.event_id));
    for (const m of received) {
      const value = JSON.parse(m.value) as VoteEvent;
      expect(m.key).toBe(value.idempotency_key);
      expect(sentIds.delete(value.event_id)).toBe(true);
    }
    expect(sentIds.size).toBe(0);

    const leader = received.filter((m) => (JSON.parse(m.value) as VoteEvent).code === 'C1');
    expect(new Set(leader.map((m) => m.partition)).size).toBe(PARTITIONS);
  });

  it('a retry with the same idempotency key lands on the same partition, from another instance', async () => {
    const before = await consumeAll(TOTAL);
    const retried = before.slice(0, 30).map((m) => JSON.parse(m.value) as VoteEvent);

    const publisher = createKafkaPublisher({ brokers, topic });
    try {
      await Promise.all(retried.map((e) => publisher.publish({ ...e, event_id: randomUUID() })));
    } finally {
      await publisher.close();
    }

    const after = await consumeAll(TOTAL + retried.length);
    const partitionsByKey = new Map<string, Set<number>>();
    for (const m of after) {
      const set = partitionsByKey.get(m.key) ?? new Set();
      set.add(m.partition);
      partitionsByKey.set(m.key, set);
    }
    for (const e of retried) {
      expect(partitionsByKey.get(e.idempotency_key)?.size, e.idempotency_key).toBe(1);
    }
  });

  // Refused fails fast on its own; a stopped container or blackholed host never answers, and
  // without a deadline each retry waits out a connect timeout (seen live: 61 s before the 503).
  it.each([
    ['refuses connections', '127.0.0.1:1'],
    ['never answers', '10.255.255.1:9092'],
  ])(
    'rejects within the publish deadline when the broker %s',
    async (_name, broker) => {
      const publisher = createKafkaPublisher({ brokers: [broker], topic });
      const started = Date.now();
      try {
        await expect(publisher.publish(event('C1'))).rejects.toThrow();
      } finally {
        await publisher.close();
      }
      expect(Date.now() - started).toBeLessThan(PUBLISH_DEADLINE_MS + 1000);
    },
    15_000,
  );
});
