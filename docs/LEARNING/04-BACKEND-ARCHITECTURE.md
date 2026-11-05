# Backend Architecture

## 1. Server entry and app factory

`server/src/index.ts:1-20` imports `createApp`, starts `app.listen(env.PORT)`, and schedules the deadline-reminder job after startup
and every six hours. `server/src/app.ts:27-132` is an app factory, which makes the Express app reusable by Supertest without
opening a second listener.

The production server can also serve `dist/` (`app.ts:119-126`), while development uses Vite separately.

## 2. Middleware order

`server/src/app.ts:32-98` installs:

1. Pino HTTP logging and request IDs.
2. Helmet security headers.
3. CORS with configured allowed origins and credentials.
4. Compression and cookie parsing.
5. JSON/form body limits.
6. Global rate limiting (disabled in test mode).
7. Health endpoint.
8. Domain routers.
9. API/general not-found and error handlers.

Order matters: cookies must be parsed before refresh routes, request IDs must exist before audit/error responses, and the error handler
must be last.

## 3. Route module pattern

Typical route modules follow this shape:

```ts
const router = Router();
router.use(authenticate);

router.post(
  '/resource',
  requireRole('ADMIN', 'TUTOR'),
  validate(schema),
  asyncHandler(async (req, res) => {
    // ownership checks
    // Prisma transaction/query
    // audit/notification side effects
    return sendData(res, row, { status: 201 });
  })
);
```

Actual examples are `server/src/routes/outcomes.ts:101-166`, `assessments.ts:164-230` and `plans.ts:43-86`.

## 4. Validation and error flow

Zod schemas validate params, query strings and bodies through `server/src/middleware/validate.ts`. Invalid input becomes a structured
application error handled by `server/src/middleware/error.ts`. Domain helpers in `server/src/lib/errors.ts` create typed errors such
as unauthorized, forbidden, not found, conflict and locked states.

`asyncHandler` catches rejected promises and calls `next(error)`. This avoids wrapping every handler in a manual try/catch while
preserving one response format.

## 5. Authorization layers

There are three distinct layers:

- `authenticate`: verifies the bearer token and reloads the active user from PostgreSQL.
- `requireRole`/`adminOnly`: coarse role gate.
- Entity authorization: `getManagedOffering`, `getOfferingForViewer`, `assertCourseAuthor`, `assertAssessmentManager`,
  `getSubmissionForViewer` and route-specific checks.

For example, a tutor may have the `TUTOR` role but cannot manage an offering unless `offering.tutorId === req.user.id`.

## 6. Persistence boundary

`server/src/lib/prisma.ts` creates one configured `PrismaClient`. Route files import this client directly. Prisma generates typed query
methods from `prisma/schema.prisma`; the database itself remains authoritative through foreign keys, unique constraints, check
constraints and migration SQL.

Transactions appear where multiple writes must remain consistent:

- Refresh-token rotation (`auth.ts:175-191`).
- Semester active-state changes (`structure.ts:184-188`).
- Assessment creation with items/rubrics (`assessments.ts:177-222` uses nested Prisma writes).
- Grading plus history (`assessments.ts:825-896`).
- Attainment run plus CLO/PLO results (`attainment-service.ts:162-207`).

## 7. Service boundary

The attainment domain is extracted because it has rules that should not be coupled to HTTP:

- `services/attainment/policy.ts`: Zod policy schema, defaults and policy resolution.
- `services/attainment/blueprint.ts`: assessment component weight calculations.
- `services/attainment/engine.ts`: pure `computeAttainment(input)` function.
- `services/attainment-service.ts`: loads persisted evidence, invokes the pure engine and persists a run snapshot.
- `services/deadline-reminders.ts`: notification job logic.

The pure engine can be tested without a database; the service and routes are tested with PostgreSQL integration fixtures.
