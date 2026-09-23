import type { ClickHouseClient } from '@clickhouse/client';
import {
  Consumer,
  type Message,
  type MessagesStream,
  stringDeserializers,
} from '@platformatic/kafka';
import type { Logger } from 'pino';
import { type DeadRow, type RawRow, toRow } from './rows.js';
import { insertBatch } from './sink.js';

interface AnalyticsConsumerOptions {
  brokers: string[];
  topics: string[];
  groupId: string;
  clickhouse: ClickHouseClient;
  log: Logger;
  /** ClickHouse likes big inserts: flush at this many messages… */
  maxBatch?: number;
  /** …or this long after the last flush. */
  maxWaitMs?: number;
}

type Msg = Message<string, string, string, string>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads votes.raw and votes.dead in its own consumer group, so its offsets, pace and outages are
 * its own: live results never wait for it. At-least-once, like the totals consumer: offsets are
 * committed only after ClickHouse has the batch; a failed insert is retried, never skipped.
 */
export function createAnalyticsConsumer(opts: AnalyticsConsumerOptions) {
  const { clickhouse, log, maxBatch = 5000, maxWaitMs = 1000 } = opts;
  const consumer = new Consumer({
    clientId: 'tally-analytics',
    groupId: opts.groupId,
    bootstrapBrokers: opts.brokers,
    deserializers: stringDeserializers,
    connectTimeout: 1000,
  });

  const stats = { raw: 0, dead: 0, skipped: 0, batches: 0 };
  let buffer: Msg[] = [];
  let queue = Promise.resolve();
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let stream: MessagesStream<string, string, string, string>;
  let loop: Promise<void> | undefined;

  async function write(batch: Msg[]) {
    const raw: RawRow[] = [];
    const dead: DeadRow[] = [];
    for (const m of batch) {
      const mapped = toRow({
        topic: m.topic,
        partition: m.partition,
        offset: m.offset,
        value: m.value,
      });
      if (mapped.table === 'votes_raw') raw.push(mapped.row);
      else if (mapped.table === 'votes_dead') dead.push(mapped.row);
      else stats.skipped++;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await insertBatch(clickhouse, raw, dead);
        return { raw: raw.length, dead: dead.length };
      } catch (err) {
        log.error({ err, attempt, size: batch.length }, 'insert failed, retrying');
        if (stopping) return undefined;
        await sleep(Math.min(250 * 2 ** (attempt - 1), 10_000));
      }
    }
  }

  async function commit(batch: Msg[]) {
    const last = new Map<string, Msg>();
    for (const m of batch) {
      const key = `${m.topic}/${m.partition}`;
      const seen = last.get(key);
      if (!seen || m.offset > seen.offset) last.set(key, m);
    }
    try {
      await consumer.commit({
        offsets: [...last.values()].map((m) => ({
          topic: m.topic,
          partition: m.partition,
          offset: m.offset + 1n,
          leaderEpoch: m.leaderEpoch,
        })),
      });
    } catch (err) {
      log.warn({ err }, 'offset commit failed; the batch will be redelivered');
    }
  }

  function flush() {
    queue = queue.then(async () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      const written = await write(batch);
      if (!written) return;
      await commit(batch);
      stats.raw += written.raw;
      stats.dead += written.dead;
      stats.batches++;
      log.debug({ size: batch.length, ...written }, 'batch inserted');
    });
    return queue;
  }

  return {
    async start() {
      stream = await consumer.consume({
        topics: opts.topics,
        mode: 'committed',
        fallbackMode: 'earliest', // a new group replays everything: analytics starts complete
        autocommit: false,
        maxWaitTime: maxWaitMs,
      });
      timer = setInterval(() => void flush(), maxWaitMs);
      loop = (async () => {
        for await (const m of stream) {
          buffer.push(m);
          if (buffer.length >= maxBatch) await flush();
        }
      })().catch((err) => {
        if (!stopping) log.error({ err }, 'consume loop failed');
      });
    },

    async stop() {
      stopping = true;
      clearInterval(timer);
      await stream?.close();
      await loop;
      await flush();
      await consumer.close(true);
    },

    async isReady(timeoutMs = 1000) {
      const probe = consumer.metadata({ topics: opts.topics, forceUpdate: true }).then(
        () => true,
        () => false,
      );
      const timeout = new Promise<boolean>((r) => setTimeout(r, timeoutMs, false).unref());
      return Promise.race([probe, timeout]);
    },

    stats: () => ({ ...stats }),
  };
}
