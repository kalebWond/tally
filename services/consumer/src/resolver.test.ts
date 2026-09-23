import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createResolver, RESOLVER_TTL_MS } from './resolver.js';
import { CONTEST_ID, createTestStores } from './test-support.js';

// Admin changes (F14) must reach a running consumer: a contestant added, deactivated or
// reactivated is picked up within RESOLVER_TTL_MS, without a restart.

let stores: Awaited<ReturnType<typeof createTestStores>>;
let clock = 0;
const now = () => clock;

beforeAll(async () => {
  stores = await createTestStores();
});

afterAll(async () => {
  await stores?.cleanup();
});

const setActive = (code: string, active: boolean) =>
  stores.db.execute(sql`update contestants set active = ${active} where code = ${code}`);

describe('resolver', () => {
  it('resolves a code to its contestant', async () => {
    const r = createResolver(stores.db, now);
    expect(await r.resolve(CONTEST_ID, 'C1')).toMatchObject({ kind: 'counted' });
    expect(await r.resolve(CONTEST_ID, 'NOPE')).toEqual({ kind: 'unknown' });
  });

  it('picks up a contestant added after a miss, once the window passes', async () => {
    const r = createResolver(stores.db, now);
    expect(await r.resolve(CONTEST_ID, 'NEW1')).toEqual({ kind: 'unknown' });
    await stores.db.execute(
      sql`insert into contestants (contest_id, name, code) values (${CONTEST_ID}, 'Newcomer', 'NEW1')`,
    );
    expect(await r.resolve(CONTEST_ID, 'NEW1')).toEqual({ kind: 'unknown' }); // cached miss
    clock += RESOLVER_TTL_MS;
    expect(await r.resolve(CONTEST_ID, 'NEW1')).toMatchObject({ kind: 'counted' });
  });

  it('sees deactivation and reactivation of an already-resolved code within the window', async () => {
    const r = createResolver(stores.db, now);
    const first = await r.resolve(CONTEST_ID, 'C2');
    expect(first.kind).toBe('counted');

    await setActive('C2', false);
    expect((await r.resolve(CONTEST_ID, 'C2')).kind).toBe('counted'); // cached until the window ends
    clock += RESOLVER_TTL_MS;
    expect(await r.resolve(CONTEST_ID, 'C2')).toEqual({
      kind: 'inactive',
      contestantId: 'contestantId' in first ? first.contestantId : '',
    });

    await setActive('C2', true);
    clock += RESOLVER_TTL_MS;
    expect((await r.resolve(CONTEST_ID, 'C2')).kind).toBe('counted');
  });

  it('asks Postgres at most once per code per window, however many votes arrive', async () => {
    let queries = 0;
    const counting = new Proxy(stores.db, {
      get(target, prop, receiver) {
        if (prop === 'select') queries++;
        return Reflect.get(target, prop, receiver);
      },
    });
    const r = createResolver(counting, now);
    for (let i = 0; i < 500; i++) await r.resolve(CONTEST_ID, i % 2 ? 'C1' : 'BOGUS');
    expect(queries).toBe(2);
  });
});
