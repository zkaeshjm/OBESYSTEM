import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';

const port = Number(process.env.EMBEDDED_PG_PORT || 5433);
const databaseDir = process.env.EMBEDDED_PG_DATA_DIR
  ? path.resolve(process.env.EMBEDDED_PG_DATA_DIR)
  : path.resolve('.data/pg');
const database = process.env.EMBEDDED_PG_DATABASE || 'obe';

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
});

try {
  await pg.initialise();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already|exists|initialized/i.test(message)) throw error;
}

await pg.start();
try {
  await pg.createDatabase(database);
  console.log(`[db] created database ${database}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already exists/i.test(message)) console.warn(`[db] createDatabase: ${message}`);
}

console.log(`[db] PostgreSQL listening on port ${port} (database: ${database})`);
console.log('[db] Press Ctrl+C to stop.');

const shutdown = async () => {
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep the process (and therefore the database) alive.
await new Promise(() => {});
