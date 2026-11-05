# Deployment and Configuration

## 1. Environment contract

`.env.example` defines the actual runtime variables:

| Variable | Used by | Meaning |
|---|---|---|
| `NODE_ENV` | `config/env.ts` | development/test/production behavior |
| `PORT` | `server/src/index.ts` | Express port |
| `DATABASE_URL` | Prisma datasource | PostgreSQL connection |
| `JWT_ACCESS_SECRET` | token signing | access JWT secret; production rejects the development default |
| `ACCESS_TOKEN_TTL_MINUTES` | tokens | access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | tokens | refresh session lifetime |
| `COOKIE_SECURE` | refresh cookie | HTTPS cookie flag |
| `CLIENT_ORIGIN` | CORS | comma-separated allowed browser origins |
| `SEED_*` | seed script | development seed credentials |
| `LOG_LEVEL` | Pino logger | log level |

`server/src/config/env.ts:30-42` parses the values with Zod and refuses production if the JWT secret still contains the development
marker.

## 2. npm scripts and execution

| Script | Actual command | Use |
|---|---|---|
| `dev` | `concurrently` database/API/web | local development |
| `dev:web` | `vite` | frontend dev server |
| `dev:server` | `tsx watch server/src/index.ts` | backend watch mode |
| `dev:db` | `tsx server/scripts/embedded-db.ts` | local PostgreSQL helper |
| `db:generate` | `prisma generate` | generate typed Prisma client |
| `db:migrate` | `prisma migrate deploy` | apply committed migrations |
| `db:migrate:dev` | `prisma migrate dev` | create/apply development migration |
| `db:seed` | `tsx server/src/seed.ts` | seed development data |
| `build` | server build then web build | production compilation |
| `start` | `node dist-server/index.js` | compiled server |
| `typecheck` | frontend + server `tsc --noEmit` | static checks |
| `lint` | `oxlint src server --deny-warnings` | lint |
| `test` | `vitest run` | integration/unit suite |
| `test:e2e` | `playwright test` | browser suite |

## 3. Vite and production hosting

Development Vite listens on port 5173 and proxies `/api` to port 4000 (`vite.config.ts:7-15`). In production, `app.ts:119-126`
serves `dist/` and sends HTML navigation requests to `dist/index.html`, allowing React Router paths to work on refresh.

## 4. Database deployment sequence

1. Start PostgreSQL.
2. Set `DATABASE_URL` to the intended database.
3. Run `npm run db:generate` after schema changes.
4. Run `npm run db:migrate` to apply committed migration SQL.
5. Run `npm run db:seed` only for a deliberately seeded development database.
6. Run `npm run build` and `npm start`.

Production records should never be reset with the test helper or forced seed. The migration files are the source of durable schema
history.

## 5. Current deployment boundary

The repository contains a compiled server/static-SPA mode but no Dockerfile or Kubernetes manifests in the current file inventory.
`SYSTEM_DESIGN.md` describes a future Docker Compose/Kubernetes and S3 architecture; learning must distinguish that target from the
current PostgreSQL + URL-material implementation.
