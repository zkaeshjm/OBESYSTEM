# System Architecture

## 1. Actual architecture

```mermaid
flowchart LR
  Browser[React 19 SPA\nVite bundle] -->|fetch /api/v1\nBearer access token + cookie| Proxy[Vite dev proxy\nor production Express static host]
  Proxy --> Express[Express 5 app\nserver/src/app.ts]
  Express --> Middleware[helmet • cors • compression\nrate limit • request id • logger]
  Middleware --> Auth[authenticate / requireRole\nZod validation]
  Auth --> Routes[REST route modules]
  Routes --> Authz[entity authorization helpers]
  Authz --> Prisma[Prisma Client]
  Prisma --> PostgreSQL[(PostgreSQL)]
  Routes --> Services[attainment engine\npolicy • reminders]
  Services --> Prisma
  Routes --> Audit[AuditLog + notifications]
  Audit --> PostgreSQL
  Express --> Browser
```

The current backend does not use a separate repository layer or controller directory. Route handlers are the application boundary;
`server/src/lib/authorization.ts` centralizes ownership checks, and `server/src/services/attainment*` contains the calculation
domain logic that must be deterministic and testable.

## 2. Browser startup

```mermaid
sequenceDiagram
  participant HTML as index.html
  participant Main as src/main.tsx
  participant Auth as AuthProvider
  participant API as api.client.ts
  participant Server as Express /auth/refresh
  participant App as App.tsx

  HTML->>Main: load JavaScript and find #root
  Main->>Auth: mount providers and AuthProvider
  Auth->>API: api.refresh()
  API->>Server: POST /api/v1/auth/refresh with cookie
  Server-->>API: accessToken, user, permissions or 401
  API-->>Auth: resolve session
  Auth->>App: user/loading state
  App-->>HTML: login screen or protected Layout + page
```

The refresh call is intentionally attempted on every provider mount. The access token lives in module memory in `src/api/client.ts`;
the refresh cookie is `httpOnly`, so browser JavaScript cannot read it.

## 3. Backend request lifecycle

```mermaid
flowchart TD
  Request[HTTP request] --> Pino[pinoHttp request id/logging]
  Pino --> Helmet[helmet]
  Helmet --> CORS[CORS]
  CORS --> Compression[compression + cookie parser + body parser]
  Compression --> Limit[global rate limit]
  Limit --> Health{health endpoint?}
  Health -->|yes| HealthResponse[JSON status ok]
  Health -->|no| Router[router module]
  Router --> Authenticate[router.use(authenticate)]
  Authenticate --> Validate[validate Zod params/query/body]
  Validate --> Role[requireRole/adminOnly when present]
  Role --> Ownership[getManagedOffering / assertCourseAuthor / viewer helpers]
  Ownership --> Handler[Prisma/service/audit/notify work]
  Handler --> Success[sendData or sendPaginated]
  Handler --> Error[asyncHandler forwards error]
  Error --> ErrorHandler[errorHandler maps AppError/Zod/Prisma]
```

`server/src/app.ts:32-98` installs cross-cutting middleware. Every domain router calls `router.use(authenticate)` or explicitly uses
`authenticate`, then handlers add role and resource checks. `server/src/lib/async-handler.ts` prevents rejected async promises from
becoming unhandled Express errors.

## 4. Main domain relationships

```mermaid
erDiagram
  USER ||--o| STUDENT_PROFILE : has
  PROGRAM ||--o{ COURSE : contains
  COURSE ||--o{ COURSE_OFFERING : delivered_as
  SEMESTER ||--o{ COURSE_OFFERING : schedules
  USER ||--o{ COURSE_OFFERING : tutors
  STUDENT_PROFILE ||--o{ ENROLLMENT : joins
  COURSE_OFFERING ||--o{ ENROLLMENT : contains
  COURSE ||--o{ CLO : defines
  PROGRAM ||--o{ PLO : defines
  CLO ||--o{ CLO_PLO_MAPPING : maps
  PLO ||--o{ CLO_PLO_MAPPING : receives
  COURSE_OFFERING ||--o{ ASSESSMENT : schedules
  ASSESSMENT ||--o{ ASSESSMENT_ITEM : contains
  ASSESSMENT_ITEM ||--o{ ASSESSMENT_ITEM_CLO : measures
  CLO ||--o{ ASSESSMENT_ITEM_CLO : measured_by
  ASSESSMENT ||--o{ SUBMISSION : receives
  STUDENT_PROFILE ||--o{ SUBMISSION : submits
  SUBMISSION ||--o{ SUBMISSION_ITEM_GRADE : receives
  ASSESSMENT_ITEM ||--o{ SUBMISSION_ITEM_GRADE : graded
  COURSE_OFFERING ||--o{ ATTAINMENT_RUN : computes
  ATTAINMENT_RUN ||--o{ CLO_ATTAINMENT : stores
  ATTAINMENT_RUN ||--o{ PLO_ATTAINMENT : stores
```

The concrete fields and all additional entities are documented in `05-DATABASE-ARCHITECTURE.md`.

## 5. Design decisions visible in code

1. **Database authority for current identity:** access-token claims are not trusted for current role or activation; `authenticate`
   reloads the user (`server/src/middleware/auth.ts:18-27`).
2. **Resource-level authorization:** role checks alone are insufficient. Tutors are restricted by `tutorId`, and course/CLO access
   uses offering ownership or student enrollment (`server/src/lib/authorization.ts`).
3. **Persisted attainment snapshots:** reports read stored `AttainmentRun`, `CloAttainment` and `PloAttainment` rows rather than
   recalculating raw marks during every report request.
4. **Soft retirement for evidence-bearing records:** assessments and CLOs are archived or rejected for deletion when evidence exists.
5. **Audit and notification side effects:** consequential changes call `audit()` and, where appropriate, `notify()` from route handlers.
