import { Writable } from 'node:stream';
import { ErrorResponse, HealthResponse, VoteAccepted, type VoteEvent } from '@tally/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { hashSender } from './hash.js';
import type { VotePublisher } from './publisher.js';

// F3 done-when: valid payloads → 202, malformed → 400 with a useful message,
// and no raw sender identifier appears in logs, responses or published events.

const SALT = 'test-salt-0123456789abcdef';
const CONTEST_ID = '0192f3a0-7c1e-7000-8000-00000000c0de';
const valid = { contestId: CONTEST_ID, code: 'C7', sender: '+447700900123', source: 'sms' };

let published: VoteEvent[];
let logs: string[];

function setup(publisher?: VotePublisher) {
  const stream = new Writable({
    write(chunk, _enc, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  return buildApp({
    config: { LOG_LEVEL: 'trace', VOTER_HASH_SALT: SALT },
    publisher: publisher ?? {
      publish: async (event) => {
        published.push(event);
      },
    },
    logStream: stream,
  });
}

const post = (app: ReturnType<typeof setup>, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/votes',
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  published = [];
  logs = [];
});

describe('GET /health', () => {
  it('returns 200 with the shared health contract', async () => {
    const res = await setup().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: 'ok', service: 'ingest' });
  });
});

describe('POST /votes — accepted', () => {
  it('returns 202 and publishes one event matching the contract', async () => {
    const res = await post(setup(), valid);

    expect(res.statusCode).toBe(202);
    const body = VoteAccepted.parse(res.json());
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      v: 1,
      event_id: body.eventId,
      idempotency_key: body.idempotencyKey,
      contest_id: CONTEST_ID,
      code: 'C7',
      source: 'sms',
      voter_hash: hashSender(valid.sender, SALT),
    });
  });

  it('normalises the code so " c7 " and "C7" become the same partition key', async () => {
    await post(setup(), { ...valid, code: ' c7 ' });
    expect(published[0]?.code).toBe('C7');
  });

  it('uses a client Idempotency-Key when given, so a retried POST carries the same key', async () => {
    const app = setup();
    const first = await post(app, valid, { 'idempotency-key': 'retry-abc-123' });
    const retry = await post(app, valid, { 'idempotency-key': 'retry-abc-123' });

    expect(first.json().idempotencyKey).toBe('retry-abc-123');
    expect(published.map((e) => e.idempotency_key)).toEqual(['retry-abc-123', 'retry-abc-123']);
    expect(first.json().eventId).not.toBe(retry.json().eventId);
  });

  it('generates a distinct idempotency key per request when none is given', async () => {
    const app = setup();
    await post(app, valid);
    await post(app, valid);
    expect(published[0]?.idempotency_key).not.toBe(published[1]?.idempotency_key);
  });
});

describe('POST /votes — rejected', () => {
  const { contestId: _, ...withoutContest } = valid;

  it.each([
    ['missing field', withoutContest, 'contestId'],
    ['contestId not a uuid', { ...valid, contestId: 'abc' }, 'contestId'],
    ['code with symbols', { ...valid, code: 'C7!!' }, 'code'],
    ['code too long', { ...valid, code: 'C'.repeat(17) }, 'code'],
    ['blank sender', { ...valid, sender: '   ' }, 'sender'],
    ['sender not a string', { ...valid, sender: 447700900123 }, 'sender'],
    ['unknown source', { ...valid, source: 'fax' }, 'source'],
  ])('%s → 400 naming the field', async (_name, body, field) => {
    const res = await post(setup(), body);

    expect(res.statusCode).toBe(400);
    const err = ErrorResponse.parse(res.json());
    expect(err.error).toBe('invalid_request');
    expect(err.issues.map((i) => i.path)).toContain(field);
    expect(published).toHaveLength(0);
  });

  it('non-JSON body → 400 with a fixed message', async () => {
    const res = await post(setup(), '{"sender": "+447700900123",');
    expect(res.statusCode).toBe(400);
    expect(ErrorResponse.parse(res.json()).issues[0]?.message).toBe('body must be valid JSON');
  });

  it('JSON that is not an object → 400', async () => {
    const res = await post(setup(), [valid]);
    expect(res.statusCode).toBe(400);
  });

  it('invalid Idempotency-Key header → 400 naming the header', async () => {
    const res = await post(setup(), valid, { 'idempotency-key': 'has spaces in it' });
    expect(res.statusCode).toBe(400);
    expect(ErrorResponse.parse(res.json()).issues.map((i) => i.path)).toContain('idempotency-key');
  });

  it('non-JSON content type → 415', async () => {
    const res = await post(setup(), 'sender=x', { 'content-type': 'text/plain' });
    expect(res.statusCode).toBe(415);
  });

  it('oversized body → 413', async () => {
    const res = await post(setup(), { ...valid, sender: 'x'.repeat(10_000) });
    expect(res.statusCode).toBe(413);
  });

  it('publisher failure → 503, never a silent 202', async () => {
    const app = setup({
      publish: async () => {
        throw new Error('broker down');
      },
    });
    const res = await post(app, valid);
    expect(res.statusCode).toBe(503);
  });
});

describe('sender privacy', () => {
  it('the raw sender never appears in logs, responses or events — accepted or rejected', async () => {
    const sender = '+447700900999';
    const app = setup();
    const responses = await Promise.all([
      post(app, { ...valid, sender }),
      post(app, { ...valid, sender: ` ${sender} ` }),
      post(app, { ...valid, sender, code: 'C7!!' }),
      post(app, { ...valid, sender, source: 'fax' }),
      post(app, `{"sender": "${sender}", "code": }`), // malformed JSON: V8's message quotes the input
      post(app, { ...valid, sender: sender.repeat(40) }), // too long
      post(app, { ...valid, sender: sender.repeat(1_000) }), // body too large
    ]);
    const failing = setup({
      publish: async () => {
        throw new Error('broker down');
      },
    });
    responses.push(await post(failing, { ...valid, sender }));

    expect(logs.length).toBeGreaterThan(0);
    const everything = [...logs, ...responses.map((r) => r.body), JSON.stringify(published)].join(
      '\n',
    );
    expect(everything).not.toContain(sender);
    expect(everything).not.toContain(sender.slice(1)); // without the leading +
  });
});
