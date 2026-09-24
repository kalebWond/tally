import { randomUUID } from 'node:crypto';
import {
  Consumer,
  type Message,
  type MessagesStream,
  stringDeserializers,
} from '@platformatic/kafka';
import type { Db } from '@tally/db';
import { createMetrics, type Metrics } from '@tally/metrics';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createBacklogReporter } from './backlog.js';
import { createDeadLetterPublisher } from './dead-letter-publisher.js';
import { processBatch } from './process.js';
import { createResolver } from './resolver.js';
import { createTotalsStore } from './totals-store.js';

interface VoteConsumerOptions {
  brokers: string[];
  topic: string;
  /** Where unresolvable votes are published (votes.dead). */
  deadTopic: string;
  groupId: string;
  db: Db;
  redis: Redis;
  log: Logger;
  /** Defaults to a fresh registry (tests); the service passes the one it serves. */
  metrics?: Metrics;
  /** Process as soon as this many messages are buffered… */
  maxBatch?: number;
  /** …or this long after the last flush, whichever comes first. */
  maxWaitMs?: number;
}

type VoteMessage = Message<string, string, string, string>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * At-least-once: offsets are committed only after a batch is in Postgres, its dead letters are on
 * votes.dead, and Redis is updated. A batch that fails is retried, never skipped; a failed commit
 * only means redelivery, which processBatch absorbs because it is idempotent.
 */
export function createVoteConsumer(opts: VoteConsumerOptions) {
  const { topic, db, redis, log, maxBatch = 500, maxWaitMs = 100 } = opts;
  const consumer = new Consumer({
    clientId: 'tally-consumer',
    groupId: opts.groupId,
    bootstrapBrokers: opts.brokers,
    deserializers: stringDeserializers,
    connectTimeout: 1000,
  });
  const deadLetters = createDeadLetterPublisher({ brokers: opts.brokers, topic: opts.deadTopic });
  const deps = {
    db,
    resolver: createResolver(db),
    totals: createTotalsStore(redis),
    deadLetters,
  };

  const metrics = opts.metrics ?? createMetrics('consumer');
  const stats = { processed: 0, counted: 0, duplicates: 0, dead: 0, batches: 0 };
  const messages = metrics.counter('tally_consumer_messages_total', 'Votes processed, by outcome', [
    'outcome',
  ]);
  const batchSeconds = metrics.histogram(
    'tally_consumer_batch_duration_seconds',
    'One batch: Postgres transaction, dead-letter publish and Redis update',
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  );
  const batchSize = metrics.histogram(
    'tally_consumer_batch_size',
    'Messages per batch',
    [1, 10, 50, 100, 250, 500],
  );
  const failures = metrics.counter(
    'tally_consumer_batch_failures_total',
    'Batches that failed and were retried',
  );
  let buffer: VoteMessage[] = [];
  let queue = Promise.resolve();
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let stream: MessagesStream<string, string, string, string>;
  let loop: Promise<void> | undefined;

  // F29: how many votes are waiting, published to Redis every second for the panel and results.
  const backlog = createBacklogReporter({
    getLag: async () => (await consumer.getLag({ topics: [topic] })).get(topic) ?? [],
    processed: () => stats.processed,
    redis,
    instanceId: randomUUID(),
    log,
  });

  async function processWithRetry(batch: VoteMessage[]) {
    const inbound = batch.map((m) => ({
      topic: m.topic,
      partition: m.partition,
      offset: m.offset,
      value: m.value,
    }));
    for (let attempt = 1; ; attempt++) {
      try {
        return await processBatch(inbound, deps);
      } catch (err) {
        failures.inc();
        // Postgres, Redis or the broker unavailable: hold position and retry. Moving on would let a later
        // commit skip these votes.
        log.error({ err, attempt, size: batch.length }, 'batch failed, retrying');
        if (stopping) return undefined;
        await sleep(Math.min(250 * 2 ** (attempt - 1), 10_000));
      }
    }
  }

  async function commit(batch: VoteMessage[]) {
    const last = new Map<number, VoteMessage>();
    for (const m of batch) {
      const seen = last.get(m.partition);
      if (!seen || m.offset > seen.offset) last.set(m.partition, m);
    }
    try {
      await consumer.commit({
        offsets: [...last.values()].map((m) => ({
          topic: m.topic,
          partition: m.partition,
          offset: m.offset + 1n, // Kafka commits the next offset to read
          leaderEpoch: m.leaderEpoch,
        })),
      });
    } catch (err) {
      log.warn({ err }, 'offset commit failed; batch will be redelivered and deduped');
    }
  }

  /** Serialised: batches are processed and committed strictly in order. */
  function flush() {
    queue = queue.then(async () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      const stopTimer = batchSeconds.startTimer();
      const result = await processWithRetry(batch);
      if (!result) return; // stopping mid-retry: leave uncommitted for redelivery
      stopTimer();
      batchSize.observe(batch.length);
      messages.inc({ outcome: 'counted' }, result.counted);
      messages.inc({ outcome: 'duplicate' }, result.duplicates);
      messages.inc({ outcome: 'dead_letter' }, result.dead);
      await commit(batch);
      stats.processed += batch.length;
      stats.counted += result.counted;
      stats.duplicates += result.duplicates;
      stats.dead += result.dead;
      stats.batches++;
      log.debug({ size: batch.length, ...result }, 'batch processed');
    });
    return queue;
  }

  return {
    async start() {
      stream = await consumer.consume({
        topics: [topic],
        mode: 'committed',
        fallbackMode: 'earliest', // a new group starts from the beginning: nothing is skipped
        autocommit: false,
        maxWaitTime: maxWaitMs,
      });
      timer = setInterval(() => void flush(), maxWaitMs);
      backlog.start();
      loop = (async () => {
        for await (const m of stream) {
          buffer.push(m);
          if (buffer.length >= maxBatch) await flush(); // backpressure: stop reading while writing
        }
      })().catch((err) => {
        if (!stopping) log.error({ err }, 'consume loop failed');
      });
    },

    /** Stop reading, finish and commit what is buffered, then disconnect. */
    async stop() {
      stopping = true;
      clearInterval(timer);
      backlog.stop();
      await stream?.close();
      await loop;
      await flush();
      await consumer.close(true);
      await deadLetters.close();
    },

    /** True when the broker answers now and the topic exists. */
    async isReady(timeoutMs = 1000) {
      const probe = consumer.metadata({ topics: [topic], forceUpdate: true }).then(
        () => true,
        () => false,
      );
      const timeout = new Promise<boolean>((resolve) =>
        setTimeout(resolve, timeoutMs, false).unref(),
      );
      return Promise.race([probe, timeout]);
    },

    stats: () => ({ ...stats }),
  };
}
