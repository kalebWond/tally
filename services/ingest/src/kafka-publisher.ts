import { compatibilityPartitioner, Producer, stringSerializers } from '@platformatic/kafka';
import type { VoteEvent } from '@tally/contracts';
import { createBatcher } from './batcher.js';
import type { VotePublisher } from './publisher.js';

interface KafkaPublisherOptions {
  brokers: string[];
  topic: string;
}

/** Retry schedule for a failed produce: 100, 200, 400, 800, 1000 ms, then give up (→ 503). */
const RETRIES = 5;
/**
 * Hard cap on one publish, whatever the retries and connect timeouts add up to. A broker that
 * never answers (stopped container, blackholed host) otherwise held requests for ~60 s.
 */
export const PUBLISH_DEADLINE_MS = 5000;
const backoff = (_client: unknown, _op: string, attempt: number) =>
  Math.min(100 * 2 ** (attempt - 1), 1000);

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`publish timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export function createKafkaPublisher({ brokers, topic }: KafkaPublisherOptions) {
  const producer = new Producer({
    clientId: 'tally-ingest',
    bootstrapBrokers: brokers,
    serializers: stringSerializers,
    // A 202 means every in-sync replica has the vote.
    acks: -1,
    // Broker-side dedupe of our own retries, so a retried batch can't duplicate votes.
    idempotent: true,
    // Java-compatible murmur2: the same code maps to the same partition as rpk, franz-go and
    // the Java client would put it, so partition placement can be checked independently.
    partitioner: compatibilityPartitioner,
    autocreateTopics: false,
    retries: RETRIES,
    retryDelay: backoff,
    connectTimeout: 1000,
    requestTimeout: 5000,
    /** Broker-side wait for replica acks, sent with each produce request. */
    timeout: 2000,
  });

  // Concurrent requests share one produce call; each still waits for its own ack.
  const enqueue = createBatcher<VoteEvent>(
    async (events) => {
      const send = producer.send({
        messages: events.map((e) => ({ topic, key: e.code, value: JSON.stringify(e) })),
      });
      // Past the deadline the caller gets a 503, but the send may still land later. A retry
      // that carries the same Idempotency-Key is then deduped by the consumer.
      await withDeadline(send, PUBLISH_DEADLINE_MS);
    },
    { maxBatch: 500, maxWaitMs: 5 },
  );

  return {
    publish: enqueue,
    /** True when the broker answers now and the topic exists (forceUpdate: never from cache). */
    async isReady(timeoutMs = 1000): Promise<boolean> {
      const probe = producer.metadata({ topics: [topic], forceUpdate: true }).then(
        () => true,
        () => false,
      );
      const timeout = new Promise<boolean>((resolve) =>
        setTimeout(resolve, timeoutMs, false).unref(),
      );
      return Promise.race([probe, timeout]);
    },
    close: () => producer.close(),
  } satisfies VotePublisher & Record<string, unknown>;
}
