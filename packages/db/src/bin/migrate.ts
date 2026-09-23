import { createDb } from '../client.js';
import { loadEnv } from '../env.js';
import { migrate } from '../migrate.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
try {
  await migrate(db);
  console.log('migrations applied');
} finally {
  await close();
}
