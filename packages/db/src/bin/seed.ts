import { createDb } from '../client.ts';
import { loadEnv } from '../env.ts';
import { SEED_CONTEST_ID, seed } from '../seed.ts';

const { db, close } = createDb(loadEnv().DATABASE_URL);
try {
  await seed(db);
  console.log(`seeded contest ${SEED_CONTEST_ID}`);
} finally {
  await close();
}
