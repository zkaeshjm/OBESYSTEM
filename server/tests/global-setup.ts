import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { Client } from 'pg';

const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/obe_test?schema=public';

const port = Number(new URL(TEST_URL).port || 5432);

function isPortOpen(host: string, targetPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: targetPort });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForPort(host: string, targetPort: number, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port: targetPort });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Timed out waiting for PostgreSQL on ${host}:${targetPort}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

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

  let db: ChildProcess | null = null;
  try {
    if (!(await isPortOpen('127.0.0.1', port))) {
      db = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/scripts/embedded-db.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: process.env.HOME ?? '/tmp',
          EMBEDDED_PG_PORT: String(port),
          EMBEDDED_PG_DATABASE: databaseName,
          EMBEDDED_PG_DATA_DIR: process.env.EMBEDDED_PG_DATA_DIR || '.data/pg-test',
        },
        stdio: 'ignore',
      });
      const databaseExit = new Promise<never>((_resolve, reject) => {
        db!.once('error', reject);
        db!.once('exit', (code, signal) => reject(new Error(`Embedded PostgreSQL exited (${code ?? signal ?? 'unknown'})`)));
      });
      await Promise.race([waitForPort('127.0.0.1', port), databaseExit]);
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

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'inherit',
    });
  } catch (error) {
    db?.kill('SIGTERM');
    throw error;
  }

  return async () => {
    db?.kill('SIGTERM');
  };
}
