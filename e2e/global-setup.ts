import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from 'pg';

const port = 5433;
const database = 'obe_e2e';
const databaseUrl = `postgresql://postgres:postgres@localhost:${port}/${database}?schema=public`;

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

export default async function globalSetup() {
  const cwd = process.cwd();
  let db: ChildProcess | null = null;

  try {
    if (!(await isPortOpen('127.0.0.1', port))) {
      db = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/scripts/embedded-db.ts'], {
        cwd,
        env: {
          ...process.env,
          HOME: process.env.HOME ?? '/tmp',
          EMBEDDED_PG_PORT: String(port),
          EMBEDDED_PG_DATABASE: database,
          EMBEDDED_PG_DATA_DIR: path.resolve(cwd, '.data/pg-e2e'),
        },
        stdio: 'ignore',
      });

      const databaseExit = new Promise<never>((_resolve, reject) => {
        db!.once('error', reject);
        db!.once('exit', (code, signal) => reject(new Error(`Embedded PostgreSQL exited (${code ?? signal ?? 'unknown'})`)));
      });
      await Promise.race([waitForPort('127.0.0.1', port), databaseExit]);
    }

    const admin = new Client({ connectionString: `postgresql://postgres:postgres@localhost:${port}/postgres` });
    await admin.connect();
    try {
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [database]);
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.query(`CREATE DATABASE "${database}"`);
    } finally {
      await admin.end();
    }

    const env = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      JWT_ACCESS_SECRET: 'e2e-only-secret-at-least-32-characters-long',
      CLIENT_ORIGIN: 'http://localhost:5173',
      SEED_ADMIN_EMAIL: 'admin@uiit.edu.pk',
      SEED_ADMIN_PASSWORD: 'Admin123!',
      SEED_TUTOR_PASSWORD: 'Tutor123!',
      SEED_STUDENT_PASSWORD: 'Student123!',
      FORCE_SEED: 'true',
    };
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd, env, stdio: 'inherit' });
    execFileSync('npx', ['tsx', 'server/src/seed.ts'], { cwd, env, stdio: 'inherit' });
  } catch (error) {
    db?.kill('SIGTERM');
    throw error;
  }

  return async () => {
    db?.kill('SIGTERM');
  };
}

export { databaseUrl };
