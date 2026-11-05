# Testing and Debugging

## 1. Test layers in this repository

| Layer | Files | What it proves |
|---|---|---|
| Pure unit | `server/tests/engine.test.ts` | Deterministic attainment formulas, boundaries and invalid inputs |
| Database constraints | `server/tests/constraints.test.ts` | PostgreSQL/Prisma relational invariants |
| Authentication/RBAC | `server/tests/rbac.test.ts` | Tokens, roles, ownership and student isolation |
| Integration workflow | `server/tests/workflow.test.ts` | Multi-step OBE lifecycle through HTTP and database |
| Tutor integration | `server/tests/tutor-panel.test.ts` | Tutor profile, mappings, late policy, grading history, criteria, PLO, roster, exports |
| Browser E2E | `e2e/*.spec.ts` | User-visible flows through Vite, React, Express and PostgreSQL |

## 2. Test database lifecycle

`server/tests/global-setup.ts` connects to PostgreSQL, creates only a database whose name ends with `_test`, and runs
`prisma migrate deploy`. `server/tests/helpers.ts:14-43` clears child rows in foreign-key-safe order before each integration test.
`createScenario()` constructs two programmes, tutors, offerings, students, CLOs, PLOs and a policy so authorization tests have real
cross-owner records.

Playwright uses a separate `obe_e2e` database from `e2e/global-setup.ts`; it does not write to the development seed database.

## 3. How to read an integration test

Example: `tutor-panel.test.ts` creates a scenario, obtains a real signed access token with `tokenFor`, calls Supertest against
`createApp()`, then checks both HTTP response and direct Prisma read-back. This proves API behavior plus persistence, not just response
shape.

The most important assertions are authorization negatives: another tutor must receive 403, published regrades need a reason, and
missing evidence must remain null/insufficient rather than become a guessed mark.

## 4. Debugging workflows

### React rendering or state problem

1. Open browser developer tools and inspect console/network.
2. Confirm the page's `useAsync` loader URL and response.
3. Check whether `loading`, `error` or `data` branch rendered.
4. Check dependency arrays and request version behavior in `useAsync`.
5. Confirm the mutation calls `reload()` or the parent `onChanged` callback.

### API problem

1. Inspect HTTP method, URL, status and JSON error body in Network.
2. Trace to the mounted router in `server/src/app.ts`.
3. Check `authenticate`, `requireRole` and ownership helper order.
4. Read the Zod schema before changing the request body.
5. Read the route's Prisma query and error mapping.

### Database problem

1. Confirm `DATABASE_URL` and PostgreSQL availability.
2. Run `npx prisma validate` and `npx prisma generate`.
3. Inspect migration order; use `npx prisma migrate deploy` only against the intended database.
4. Check foreign-key and unique-constraint errors rather than weakening the schema.
5. Use a disposable `_test` database for reproduction.

### Authorization problem

1. Identify whether the request is unauthenticated (401), wrong role (403), or wrong resource owner (403).
2. Inspect `req.user` population in `authenticate`.
3. Follow the exact helper: `getManagedOffering`, `assertAssessmentManager`, `getSubmissionForViewer`, or route-specific query.
4. Add a test for both permitted and foreign-owner cases.

## 5. Safe test exercise

Choose the roster progress test. Predict what happens when a student is enrolled in two offerings but submits to only the second.
The current query must not count that submission in the first offering because it filters `assessment.offeringId`; write down the
expected JSON before reading the assertion.
