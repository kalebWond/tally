import type { AddressInfo } from 'node:net';
import { LiveCloseCodes, LiveMessage, redisKeys } from '@tally/contracts';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createGateway } from './gateway.js';

// F7 done-when: clients see the same totals within a second of each other, and only changed
// contestants appear in update frames. Runs against the local Redis, logical DB 14.

const redisEnv = process.env.REDIS_URL;
if (!redisEnv) throw new Error('REDIS_URL must be set (see .env.example)');
const redisUrl = Object.assign(new URL(redisEnv), { pathname: '/14' }).toString();

const CONTEST = '0192f3a0-7c1e-7000-8000-00000000c0de';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const POLL_MS = 50;

let redis: Redis;
let gateway: ReturnType<typeof createGateway>;
let url: string;

async function setTotals(totals: Record<string, number>) {
  await redis.hset(redisKeys.totals(CONTEST), totals);
  const all = await redis.hvals(redisKeys.totals(CONTEST));
  await redis.hset(
    redisKeys.meta(CONTEST),
    'totalVotes',
    all.reduce((s, v) => s + Number(v), 0),
  );
}

/** A client that records every frame it receives, with arrival time. */
function connect(query = `contestId=${CONTEST}`) {
  const ws = new WebSocket(`${url}/live?${query}`);
  const frames: { at: number; msg: LiveMessage }[] = [];
  ws.on('message', (data) =>
    frames.push({ at: Date.now(), msg: LiveMessage.parse(JSON.parse(String(data))) }),
  );
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })),
  );
  return { ws, frames, closed };
}

async function until(check: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  redis = new Redis(redisUrl);
});

afterAll(() => {
  redis.disconnect();
});

beforeEach(async () => {
  await redis.flushdb();
  gateway = createGateway({ redis, pollMs: POLL_MS, log: pino({ level: 'silent' }) });
  await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await gateway.close();
});

describe('gateway /live', () => {
  it('sends a full snapshot on connect', async () => {
    await setTotals({ [A]: 10, [B]: 4 });
    const client = connect();
    await until(() => client.frames.length === 1);

    const [first] = client.frames;
    expect(first?.msg).toMatchObject({ type: 'snapshot', contestId: CONTEST, totalVotes: 14 });
    expect(first?.msg.type === 'snapshot' && first.msg.totals).toEqual(
      expect.arrayContaining([
        { contestantId: A, total: 10 },
        { contestantId: B, total: 4 },
      ]),
    );
    client.ws.close();
  });

  it('update frames carry only the contestants that changed', async () => {
    await setTotals({ [A]: 10, [B]: 4 });
    const client = connect();
    await until(() => client.frames.length === 1);

    await setTotals({ [B]: 5 });
    await until(() => client.frames.length === 2);

    expect(client.frames[1]?.msg).toMatchObject({
      type: 'update',
      changed: [{ contestantId: B, total: 5 }],
      totalVotes: 15,
    });
    client.ws.close();
  });

  it('two clients receive identical frames within a second of each other', async () => {
    await setTotals({ [A]: 1 });
    const one = connect();
    const two = connect();
    await until(() => one.frames.length === 1 && two.frames.length === 1);

    for (let i = 2; i <= 6; i++) {
      await setTotals({ [A]: i });
      await sleep(POLL_MS * 2);
    }
    await until(() => one.frames.length === 6 && two.frames.length === 6);

    const strip = ({ msg }: { msg: LiveMessage }) => msg;
    expect(one.frames.slice(1).map(strip)).toEqual(two.frames.slice(1).map(strip));
    for (let i = 0; i < one.frames.length; i++) {
      expect(Math.abs((one.frames[i]?.at ?? 0) - (two.frames[i]?.at ?? 0))).toBeLessThan(1000);
    }
    one.ws.close();
    two.ws.close();
  });

  it('sends nothing while totals are unchanged', async () => {
    await setTotals({ [A]: 3 });
    const client = connect();
    await until(() => client.frames.length === 1);

    await sleep(POLL_MS * 6);

    expect(client.frames).toHaveLength(1);
    client.ws.close();
  });

  it.each([
    ['missing', ''],
    ['not a uuid', 'contestId=abc'],
  ])('closes with 4400 when contestId is %s', async (_name, query) => {
    const client = connect(query);
    expect((await client.closed).code).toBe(LiveCloseCodes.invalidContest);
  });

  it('stops polling a contest once its last client leaves', async () => {
    const client = connect();
    await until(() => client.frames.length === 1);
    expect(gateway.stats().rooms).toBe(1);

    client.ws.close();
    await until(() => gateway.stats().rooms === 0);
  });
});
