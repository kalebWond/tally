import { compatibilityPartitioner, Producer, stringSerializers } from '@platformatic/kafka';
import type { DeadLetterEvent } from '@tally/contracts';

/** Same bound as ingest: a broker that never answers must fail the batch, not hang it. */
const PUBLISH_DEADLINE_MS = 5000;

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`dead-letter publish timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Publishes to `votes.dead` and resolves only once the broker has acknowledged every message.
 * Keyed by the dead letter's idempotency key, like `votes.raw` (F35), so they spread evenly; a
 * malformed message's key is its `offset:topic/partition/offset`.
 */
export function createDeadLetterPublisher({
  brokers,
  topic,
}: {
  brokers: string[];
  topic: string;
}) {
  const producer = new Producer({
    clientId: 'tally-consumer-dead-letters',
    bootstrapBrokers: brokers,
    serializers: stringSerializers,
    acks: -1,
    idempotent: true,
    partitioner: compatibilityPartitioner,
    autocreateTopics: false,
    retries: 5,
    retryDelay: (_client, _op, attempt) => Math.min(100 * 2 ** (attempt - 1), 1000),
    connectTimeout: 1000,
    requestTimeout: 5000,
    timeout: 2000,
  });

  return {
    async publish(events: DeadLetterEvent[]) {
      if (events.length === 0) return;
      const send = producer.send({
        messages: events.map((e) => ({
          topic,
          key: e.idempotency_key,
          value: JSON.stringify(e),
        })),
      });
      await withDeadline(send, PUBLISH_DEADLINE_MS);
    },
    close: () => producer.close(),
  };
}

export type DeadLetterPublisher = Pick<ReturnType<typeof createDeadLetterPublisher>, 'publish'>;
