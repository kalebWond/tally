import { createDb } from '../client.js';
import { loadEnv } from '../env.js';
import { SEED_CONTEST_ID, seed } from '../seed.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
try {
  await seed(db);
  console.log(`seeded contest ${SEED_CONTEST_ID}`);
} finally {
  await close();
}
