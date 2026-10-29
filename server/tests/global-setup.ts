import { execSync } from 'node:child_process';
import { Client } from 'pg';

const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/obe_test?schema=public';

/**
 * The test database is isolated and disposable. This setup creates it if
 * needed and applies the versioned migrations. It refuses to run against any
 * database whose name does not end in `_test`.
 */
export default async function globalSetup() {
  const url = new URL(TEST_URL);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against database "${databaseName}"`);
  }

  const adminUrl = new URL(TEST_URL);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'inherit',
  });
}
