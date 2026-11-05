# Project Structure and Complete Inventory

## 1. Root files

| Path | Responsibility | Used by |
|---|---|---|
| `package.json` | Scripts, runtime dependencies and development dependencies | npm, Vite, TypeScript, Prisma, Vitest, Playwright |
| `package-lock.json` | Reproducible npm dependency resolution | `npm install` |
| `README.md` | Basic setup and run instructions | Developers |
| `SYSTEM_DESIGN.md` | Target-system architecture/design baseline | Architects; it is not a precise description of every current implementation |
| `.env.example` | Names and safe placeholders for runtime configuration | Developers and deployment setup |
| `.env` | Local environment values; ignored and not a learning source for credentials | Local runtime only |
| `vite.config.ts` | React/Vite build and `/api` development proxy to port 4000 | Vite |
| `playwright.config.ts` | Browser test project, web servers and isolated test database setup | Playwright |
| `vitest.config.ts` | Node test environment, test discovery, global setup and test database URL | Vitest |
| `tsconfig.json` | Frontend TypeScript compiler configuration; includes `src` | `npm run typecheck`, Vite |
| `tsconfig.server.json` | Backend TypeScript compiler configuration; includes `server` | `npm run typecheck`, server build |
| `.oxlintrc.json` | Oxlint configuration | `npm run lint` |
| `index.html` | Vite HTML shell containing the `root` element | Browser/Vite |
| `public/` | Static favicon and SVG icon assets | Vite static serving |

## 2. Frontend tree

```text
src/
├── main.tsx                 React root, providers and BrowserRouter
├── App.tsx                  route table and auth/role route guards
├── index.css                global/Tailwind CSS
├── api/
│   ├── client.ts            fetch wrapper, refresh retry, API methods, downloads
│   └── types.ts             frontend representations of API/domain objects
├── context/
│   ├── AuthContext.tsx      current user, permissions, login, refresh, logout
│   └── ToastContext.tsx     transient success/error notifications
├── hooks/
│   └── useAsync.ts          loading/error/data lifecycle and formatting helpers
├── components/
│   ├── Layout.tsx           authenticated shell, nav, notifications, account menu
│   ├── ui.tsx               reusable buttons, cards, fields, modal, badges and tables
│   └── offering/             offering-specific panels and forms
├── pages/                   route-level screens
└── assets/                  bundled Vite/React assets
```

`src/App.tsx:47-89` imports every route-level page. `src/main.tsx:10-21` wraps the application in `StrictMode`,
`BrowserRouter`, `ToastProvider`, `ConfirmProvider` and `AuthProvider`. Provider order matters: pages can consume auth, toast and
confirmation contexts because those providers are above `App`.

## 3. Backend tree

```text
server/
├── src/
│   ├── index.ts             HTTP server startup and reminder timer
│   ├── app.ts               Express app, security middleware and router mounts
│   ├── config/env.ts        Zod environment parsing and production secret guard
│   ├── lib/                 shared infrastructure and domain authorization helpers
│   ├── middleware/          authentication, validation and error translation
│   ├── routes/              authenticated REST route modules
│   ├── services/            attainment policy/engine and deadline reminders
│   ├── seed.ts              development data and persisted demonstration evidence
│   └── types/express.d.ts   Express Request.user type augmentation
├── scripts/embedded-db.ts   local embedded PostgreSQL launcher
└── tests/                   Vitest tests, fixtures and database global setup
```

The route modules are mounted under `/api/v1` in `server/src/app.ts:104-115`. There is no separate controller directory: the route
handlers currently perform validation orchestration, authorization calls and Prisma operations directly, while reusable calculation
logic is extracted into services.

## 4. Database and migration tree

```text
prisma/
├── schema.prisma
├── migrations/
│   ├── 20261017060105_init
│   ├── 20261017060223_grade_state
│   ├── 20261017061000_constraints
│   ├── 20261017062000_notification_dedupe
│   ├── 20261017064000_rubric_criteria
│   ├── 20261017065000_course_materials
│   ├── 20261029130502_tutor_panel_phase2
│   ├── 20261029152941_clo_measurement_criteria
│   ├── 20261103110000_version_clo_measurement_criteria
│   └── migration_lock.toml
```

`schema.prisma` is the declarative model used to generate Prisma Client. SQL migrations are the durable database history. The newest
migration adds `supersededAt` to measurement criteria and removes the historical statement uniqueness constraint so edits preserve old
criteria rows.

## 5. Tests and documents

- `server/tests/engine.test.ts`: pure attainment and policy calculations.
- `server/tests/constraints.test.ts`: database integrity constraints.
- `server/tests/rbac.test.ts`: login, role and data isolation.
- `server/tests/workflow.test.ts`: vertical OBE workflow.
- `server/tests/tutor-panel.test.ts`: tutor-panel integration boundaries.
- `server/tests/helpers.ts`: disposable scenario factory, tokens and test data helpers.
- `server/tests/global-setup.ts`: creates `obe_test` and deploys migrations.
- `e2e/critical-flows.spec.ts`: administrator, tutor and student browser flows.
- `e2e/tutor-panel.spec.ts`: existing seeded tutor flows.
- `e2e/tutor-panel-complete.spec.ts`: isolated full tutor workflow.
- `e2e/global-setup.ts`: creates/seeds `obe_e2e` before Playwright.
- `docs/TUTOR_PANEL_*.md`: implementation, architecture, database, checklist and verification history.
- `docs/LEARNING/`: this repository-grounded course.

## 6. Runtime startup sequence

Development uses `npm run dev`, which concurrently starts the embedded database, `server/src/index.ts` through `tsx watch`, and
Vite. The browser loads `index.html`, Vite imports `src/main.tsx`, and the API client talks to `/api/v1`; Vite proxies that path to
Express at `http://localhost:4000` (`vite.config.ts:7-14`).
