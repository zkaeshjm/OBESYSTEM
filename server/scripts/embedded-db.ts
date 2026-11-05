import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const port = Number(process.env.EMBEDDED_PG_PORT || 5433);

// PostgreSQL requires its data directory to be secured with chmod 0700 and
// refuses to start otherwise ("data directory has invalid permissions"). On
// FUSE mounts such as NTFS/exFAT (common for secondary drives under /media)
// permission bits are silently ignored, so a cluster there can never start.
// Probe the requested location and transparently fall back to the user's
// native filesystem (XDG data home) when the probe fails.
function canSecureDirectory(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o700);
    return (fs.statSync(dir).mode & 0o777) === 0o700;
  } catch {
    return false;
  }
}

const requestedDir = process.env.EMBEDDED_PG_DATA_DIR
  ? path.resolve(process.env.EMBEDDED_PG_DATA_DIR)
  : process.getuid?.() === 0
    ? '/tmp/opencode/obe2-pg'
    : path.resolve('.data/pg');

const databaseDir = canSecureDirectory(requestedDir)
  ? requestedDir
  : path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'),
      'obe-pg',
      path.basename(requestedDir),
    );

if (path.resolve(databaseDir) !== path.resolve(requestedDir)) {
  console.warn(
    `[db] "${requestedDir}" cannot hold a PostgreSQL cluster (this filesystem ignores permission bits, e.g. NTFS/FAT). ` +
      `Falling back to "${databaseDir}".`,
  );
}

const database = process.env.EMBEDDED_PG_DATABASE || 'obe';

// Some container/user-namespace filesystems reject chown even for root. The
// embedded server already runs under the existing `postgres` account, so a
// writable directory is sufficient and keeps the launcher usable there.
fs.mkdirSync(databaseDir, { recursive: true });
if (process.getuid?.() === 0) fs.chmodSync(databaseDir, 0o777);

const postgresUserAvailable = (() => {
  try {
    execFileSync('id', ['-u', 'postgres'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  // PostgreSQL itself still runs under the dedicated postgres account when
  // this launcher is invoked by a root-owned container process.
  createPostgresUser: process.getuid?.() === 0 && !postgresUserAvailable,
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
