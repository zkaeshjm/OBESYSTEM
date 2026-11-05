# Tutor Panel Test Report

Date: 2026-11-05
Scope: Full Tutor Panel verification on a PostgreSQL-capable workstation (Ubuntu, Node 22.23.4, PostgreSQL 18.4 embedded on port 5433).

Unlike the 2026-11-04 pass, every previously blocked PostgreSQL-backed suite was **actually executed** in this pass.

## Environment

| Component | Value |
|---|---|
| OS | Linux (user workstation, UID `saad`) |
| Node.js | v22.23.4 (provisioned at `/tmp/opencode/node-v22.23.4-linux-x64`; system Node 18.19.1 is too old for Vitest 5, which requires `node:util.styleText`) |
| PostgreSQL | 18.4, embedded, port 5433 (started via `npm run dev:db`) |
| Databases | `obe` (dev), `obe_test` (integration), `obe_e2e` (browser) — test databases are disposable and never touch development or production records |
| Browsers | Playwright Chromium 1248 + ubuntu24.04 fallback build |

## Commands and results

### `npm run typecheck`

```text
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit
```

- Result: **success**, no compiler errors.

### `npm run lint`

```text
oxlint src server --deny-warnings
```

- Result: **success**, zero warnings.

### `npm run test:unit`

```text
vitest run --config vitest.unit.config.ts
```

- Result: **success — 1 file, 20/20 tests passed** (779 ms). Covers the pure attainment engine including measurement-criteria evidence provenance.

### `npm test` (integration — previously blocked, now executed)

```text
vitest run
```

- Result: **success — 5 files, 60/60 tests passed** in 30.9 s against PostgreSQL `obe_test`.
- Global setup detected the running PostgreSQL on port 5433, created `obe_test`, and applied all 9 migrations (`No pending migrations to apply`).
- Per-file: attainment engine 20, tutor-panel gap-closure 12, database constraints 10, authentication/RBAC 9, vertical workflow 9.

### `npx playwright test` (browser — previously blocked, now executed)

```text
npx playwright test
```

- Result: **success — 9/9 tests passed** (chromium, 1 worker) after the test-code fixes listed below.
- Global setup drops and recreates `obe_e2e`, applies all migrations and reseeds with `FORCE_SEED=true`, then boots the API (`NODE_ENV=test`) and the Vite dev server. The complete 17-step tutor workflow, the four focused tutor checks and the four critical-flow checks all ran against real browser sessions.

### `npm run build`

```text
npm run build:server && npm run build:web
```

- Result: **success**. Vite emitted the pre-existing advisory that the main JS chunk exceeds 500 kB after minification (`dist/assets/index-*.js`, 1,250 kB / 320 kB gzip). This is an optimization advisory, not an error.

## Executed test coverage

### Integration suite (60 tests, PostgreSQL)

1. Authentication: wrong-password rejection without user enumeration, token issuance, refresh rotation with reuse detection, protected-route enforcement.
2. RBAC and data isolation: student/staff endpoint separation, cross-tutor offering denial, cross-student submission denial, scoped course lists, scoped notifications.
3. Database constraints: non-tutor offering assignment, grade above maximum, negative marks, cross-course CLO evidence mapping, rubric over-marking, unenrolled submission, duplicate enrolment, single active session/policy, notification delivery invariant.
4. Tutor-panel gap closure (13 cases): profile self-service field allow-list, tutor-scoped CLO–PLO mapping with frozen-run protection, extended assessment metadata with guarded archive/restore, all three late policies, published-regrade reason requirement with immutable `GradeChange` history and cross-tutor denial, CLO archive guards, improvement-plan gap/follow-up fields, CSV export scope + formula neutralization + `EXPORT` audit, measurement-criteria versioning with approved-CLO guard, PLO drill-down scoping, roster progress from published evidence only, PDF export validity and scope parity with CSV.

### Browser suite (9 tests, Chromium)

1. `tutor-panel-complete.spec.ts` — the full persisted workflow: tutor login → assigned course → CLO create → CLO edit → measurement criteria → admin approval → assessment creation with rubric and CLO mapping → publish → student submission through the student UI → rubric grading → result publication → audited regrade with stated reason → grade-history verification → attainment calculation → attainment tab verification → PDF export download → PLO drill-down → assessment archive/restore → cross-tutor offering URL rejection → cross-tutor assessment URL rejection.
2–5. `tutor-panel.spec.ts` — CLO authoring + admin approval + assessment-to-CLO mapping with rubric + student visibility + foreign-tutor invisibility; grading screen with grade-history dialog; attainment tab + PDF/CSV export buttons; roster progress panel columns.
6–9. `critical-flows.spec.ts` — admin institutional metrics; tutor assigned-offering scoping and grading entry; student enrolled-course published results; admin-route URL hardening.

## Test-code fixes made in this pass

All defects were in **test selectors**, not in the application. Playwright's `getByRole(name)` performs case-insensitive substring matching by default, and seeded data contains near-duplicate controls:

| File | Defect | Fix |
|---|---|---|
| `e2e/tutor-panel.spec.ts` | `login()` attempted sign-out from a fresh `about:blank` page, where no account menu exists | Navigate to `/` first, then decide |
| `e2e/tutor-panel.spec.ts` | `Publish` used `.first()` across the whole table; the seeded draft “Assignment 2 — Feature Engineering” could absorb it | Scope to `getByRole('row', { name: <title> })` |
| `e2e/tutor-panel.spec.ts` | `Approve` used `.first()`; the seeded PENDING CLO absorbed it; loose `/approved/i` toast check masked the wrong approval | Scope to the CLO card; assert exact toast `${cloCode} approved.` |
| `e2e/tutor-panel.spec.ts` | Student visibility asserted on the Overview tab; assessments render on the Assessments tab | Click the Assessments tab first |
| `e2e/tutor-panel-complete.spec.ts` | `Publish` used `.last()`; same seeded-draft trap | Row-scoped publish |
| `e2e/tutor-panel-complete.spec.ts` | `Approve` used `.last()` (ordered correctly only by luck) | Card-scoped approve |
| `e2e/tutor-panel-complete.spec.ts` | `name: 'Grade'` substring-matched “View grade history”, opening the wrong dialog | `exact: true` |
| `e2e/tutor-panel-complete.spec.ts` | History dialog has two `Close` buttons → strict-mode violation | `getByRole('dialog').getByRole('button', { name: 'Close', exact: true })` |
| `e2e/tutor-panel-complete.spec.ts` | Cross-tutor 403 text regex did not include the API wording “You do not have permission to perform this action” | Regex extended with `permission` |

The final cross-tutor assertion confirmed the API rejects the foreign tutor with 403 and the UI renders the error alert with a retry action — unauthorized access is enforced server-side, not merely hidden.

## Verification limitations

- None outstanding for the listed scope. All suites executed against real PostgreSQL with isolated disposable databases.
- Playwright runs the Chromium project only; other browser engines are untested (unchanged scope).
- The Vite chunk-size advisory remains an accepted optimization item, documented in the checklist.
