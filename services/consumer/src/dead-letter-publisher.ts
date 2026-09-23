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

const codeOf = (original: unknown) =>
  typeof original === 'object' &&
  original !== null &&
  'code' in original &&
  typeof original.code === 'string'
    ? original.code
    : undefined;

/**
 * Publishes to `votes.dead` and resolves only once the broker has acknowledged every message.
 * Keyed by the original code where there is one, so a contestant's dead letters stay ordered
 * on one partition; keyless (malformed) messages spread across partitions.
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
        messages: events.map((e) => {
          const key = codeOf(e.original);
          return { topic, value: JSON.stringify(e), ...(key && { key }) };
        }),
      });
      await withDeadline(send, PUBLISH_DEADLINE_MS);
    },
    close: () => producer.close(),
  };
}

export type DeadLetterPublisher = Pick<ReturnType<typeof createDeadLetterPublisher>, 'publish'>;
