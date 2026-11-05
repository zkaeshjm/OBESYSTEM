# Tutor Panel Implementation Plan

This document records the delivery sequence and the final gap-closure state for the tutor panel.

## Completed work

1. Installed Linux `node_modules`, generated the Prisma client, applied all migrations and seeded the development database.
2. Added the additive Phase 2 migration.
3. Implemented profile update, department exposure and the new audit entry on `PATCH /auth/me`.
4. Implemented CLO archive/unarchive, active-list filtering and evidence guard.
5. Implemented tutor-scoped CLO–PLO creation and deletion, including same-programme and frozen-run checks.
6. Added assessment types, passing marks, submission format, late policy, assessment archive/restore and guarded editing.
7. Implemented late submission policies and grade-change history.
8. Added the CSV report endpoint and the authenticated client download helper.
9. Added the required pages and navigation: profile, settings, CLO–PLO mapping, and account menu entries.
10. Added the focused API integration suite in `server/tests/tutor-panel.test.ts`.
11. Ran typecheck, lint, the runnable unit suite and build; PostgreSQL-backed execution remains environment-gated in this runner.
12. Added versioned CLO measurement criteria with active/history views and an approved-CLO edit guard.
13. Corrected PLO drill-down routing and applied tutor/student ownership filters to every contribution and mapped CLO.
14. Corrected roster progress to scope submissions by offering and distinguish submitted, pending, unpublished and published data;
    persisted individual CLO evidence snapshots are used when available.
15. Added a multi-page server PDF export and a Playwright global setup that seeds an isolated `obe_e2e` database.

## Endpoint inventory

### Profile

- `GET /api/v1/auth/me` — user, department, student profile, permissions.
- `PATCH /api/v1/auth/me` — self-service `name` and `phone` only.
- `PATCH /api/v1/auth/password` — password rotation; revokes refresh tokens.

### CLOs

- `POST /api/v1/clos/:id/archive`
- `POST /api/v1/clos/:id/unarchive`
- `GET /api/v1/clos?includeArchived=true`

### CLO–PLO mapping

- `GET /api/v1/clo-plo-mappings`
- `POST /api/v1/clo-plo-mappings`
- `DELETE /api/v1/clo-plo-mappings/:id`

### Assessments and grading

- `POST /api/v1/assessments` — includes `submissionFormat`, `passingMarks` and `latePolicy`.
- `PATCH /api/v1/assessments/:id` — editable metadata; archived and closed assessments are locked.
- `POST /api/v1/assessments/:id/archive`
- `POST /api/v1/assessments/:id/restore`
- `POST /api/v1/assessments/:id/submissions` — enforces the late policy.
- `PATCH /api/v1/submissions/:id` — enforces the late policy and PUBLISHED state.
- `PUT /api/v1/submissions/:id/grades` — optional `reason`, mandatory after publication.
- `GET /api/v1/submissions/:id/grade-history`

### Reports and plans

- `GET /api/v1/reports/attainment.csv`
- `POST /api/v1/offerings/:id/action-plans` — `gapDescription`, `followUp`.
- `PATCH /api/v1/action-plans/:id` — `gapDescription`, `followUp`, `evaluation`, `status`.

## Remaining implementation gaps

None. Every tutor-panel product gap from the original checklist is implemented and verified. The criteria UI exposes both the active
definitions and preserved superseded definitions. The complete browser workflow uses the correct student route, and the isolated
setup seeds `obe_e2e` from scratch (never the development database).

## Validation results — 2026-11-05

```bash
npm run typecheck          # success
npm run lint               # success (zero warnings)
npm run test:unit          # 20/20 pass
npm test                   # 60/60 pass (5 files, PostgreSQL obe_test)
npx playwright test        # 9/9 pass (chromium, obe_e2e, complete workflow included)
npm run build              # success (server + web; pre-existing chunk-size advisory)
```

Integration tests target PostgreSQL's `obe_test` schema and exercise the new authorization paths, late policies,
regrade history, archive guards and CSV export. Browser tests target the disposable `obe_e2e` database and run the complete
persisted tutor workflow through real UI interactions.
