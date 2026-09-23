import { createDb } from '../client.ts';
import { loadEnv } from '../env.ts';
import { migrate } from '../migrate.ts';

const { db, close } = createDb(loadEnv().DATABASE_URL);
try {
  await migrate(db);
  console.log('migrations applied');
} finally {
  await close();
}
