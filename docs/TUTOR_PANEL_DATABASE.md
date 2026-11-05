# Tutor Panel Database

The tutor panel uses additive Prisma migrations. The original Phase 2 migration is
`prisma/migrations/20261029130502_tutor_panel_phase2`; the gap-closure migration adds measurement-criteria versioning without
dropping academic records.

## Schema changes

### `assessments`

| Column | Type | Constraint / default | Purpose |
|---|---|---|---|
| `passingMarks` | `DECIMAL(7,2)` | nullable | Optional threshold below the total marks. |
| `submissionFormat` | `TEXT` | nullable | Student-facing expected submission type. |
| `latePolicy` | `LatePolicy` | `NOT NULL DEFAULT 'MARK_LATE'` | `ACCEPT`, `REJECT` or `MARK_LATE` after the deadline. |

### `clos`

| Column | Type | Purpose |
|---|---|---|
| `archivedAt` | `TIMESTAMP(3)` | Soft retirement. Rows are retained so historical evidence and audits remain explainable. |

### `users`

| Column | Type | Purpose |
|---|---|---|
| `phone` | `TEXT` | Optional self-service contact number. |

### `improvement_action_plans`

| Column | Type | Purpose |
|---|---|---|
| `gapDescription` | `TEXT` | Observed attainment shortfall or evidence gap. |
| `followUp` | `TEXT` | Planned check, re-measurement or next-cycle action. |

### `grade_changes`

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `UUID` | primary key | Identity of one consequential mark change. |
| `submissionId` | `UUID` | cascade delete with submission | The affected submission. |
| `itemId` | `UUID` | nullable, set-null on item delete | The affected assessment item. |
| `actorId` | `UUID` | nullable, set-null on user delete | Who performed the correction. |
| `previousMarks` | `DECIMAL(7,2)` | nullable | Null for the first recorded entry. |
| `newMarks` | `DECIMAL(7,2)` | not null | The resulting value. |
| `reason` | `TEXT` | nullable | Mandatory in the API when correcting published results. |
| `createdAt` | `TIMESTAMP(3)` | default `CURRENT_TIMESTAMP` | History ordering. |

Indexes: `(submissionId, createdAt)` and `itemId`.

### `clo_measurement_criteria`

| Column | Type | Purpose |
|---|---|---|
| `statement` | `TEXT` | Observable criterion used to judge a CLO. |
| `weight` | `INTEGER` | Relative weight from 1 to 5. |
| `position` | `INTEGER` | Display order within the active version. |
| `supersededAt` | `TIMESTAMP(3)` nullable | Timestamp at which this definition was replaced. |

Migration `20261103110000_version_clo_measurement_criteria` removes the statement uniqueness constraint and adds the
`(cloId, supersededAt, position)` index. Active reads filter `supersededAt IS NULL`; history reads retain every prior definition.

## Enumerations

- `AssessmentType` now includes `LAB`, `PRESENTATION` and `OTHER` in addition to the previous types.
- `AssessmentStatus` now includes `ARCHIVED`.
- `LatePolicy` is new with values `ACCEPT`, `REJECT`, `MARK_LATE`.

## Invariants

- No destructive migration: all changes are additive; the only other SQL is Prisma’s standard normalization of timestamp and
  default clauses on `course_materials`, `rubric_criteria` and `submission_criterion_grades`.
- `GradeChange` is append-only application data. Corrections overwrite `submission_item_grades` but leave the history.
- Archived CLOs are excluded from active lists unless `includeArchived=true` is requested.
- A CLO with assessment evidence or attainment rows cannot be archived.
- A tutor can create or delete a CLO–PLO mapping only when the CLO belongs to a course the tutor teaches.
- A mapping that contributed to a frozen attainment run cannot be created or deleted.
- Measurement-criteria writes validate submitted IDs against the same CLO, reject duplicate statements, and supersede the prior
  set atomically. Approved-CLO edits are administrator-only.
- Attainment runs persist individual CLO evidence snapshots where available. Roster progress never reconstructs an individual
  score from a newer run or an unrelated offering.

## Migration

```bash
npm run dev:db   # PostgreSQL on port 5433
npm run db:migrate
npm run db:seed  # optional; never overwrites a production database
```

For tests, the Vitest global setup applies the same migrations to the disposable `obe_test` database.

## Verification update — 2026-11-05

- No migration was added in this verification pass; all academic records and the existing additive migrations are preserved.
- `server/tests/global-setup.ts` detected the running PostgreSQL 18.4 instance on port 5433, applied all 9 migrations to the disposable
  `obe_test` database, and the full integration suite executed successfully (60/60 tests).
- The Playwright setup dropped, recreated, migrated and seeded the disposable `obe_e2e` database and the 9 browser tests executed
  successfully end to end. Neither test database shares data with the development (`obe`) database.
