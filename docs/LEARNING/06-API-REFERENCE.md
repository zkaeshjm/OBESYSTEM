# API Reference from the Current Route Code

## Conventions

- Base URL: `/api/v1`.
- JSON success responses use `sendData`/`sendPaginated` from `server/src/lib/http.ts`.
- Protected routers call `authenticate`; role/resource restrictions are listed below.
- IDs are UUIDs.
- Validation is performed with Zod before handler logic.
- A paginated response contains `data` plus `meta.page`, `meta.limit` and `meta.total`.

## Health and authentication

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/health` | public | API status and timestamp (`app.ts:100-102`) |
| POST | `/auth/login` | public | Validate credentials, issue JWT + refresh cookie |
| POST | `/auth/refresh` | refresh cookie | Rotate refresh token and issue new access token |
| POST | `/auth/logout` | public/session | Revoke current refresh token and clear cookie |
| GET | `/auth/me` | authenticated | Current user, department/student profile and permissions |
| PATCH | `/auth/me` | authenticated | Self-service name/phone only |
| PATCH | `/auth/password` | authenticated | Verify old password, hash new password and revoke refresh sessions |

Authentication is implemented in `server/src/routes/auth.ts:85-319`.

## Academic structure and users (`structure.ts`)

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET/POST | `/departments` | all authenticated / admin write | List or create departments |
| PATCH/DELETE | `/departments/:id` | admin | Update or deactivate department |
| GET/POST | `/programs` | authenticated / admin write | List or create programmes |
| PATCH/DELETE | `/programs/:id` | admin | Update or deactivate programme |
| GET/POST | `/semesters` | authenticated / admin write | List or create academic sessions |
| PATCH/DELETE | `/semesters/:id` | admin | Update or delete an unused session |
| GET/POST | `/courses` | scoped read / admin write | Course catalogue and creation |
| GET | `/courses/:id` | scoped read | Course, CLOs, active criteria and offerings |
| PATCH/DELETE | `/courses/:id` | admin | Update/deactivate course |
| GET | `/users` | admin | Paginated user list |
| POST | `/users` | admin | Create staff/student and optional student profile |
| PATCH | `/users/:id` | admin | Name/email/active status |
| POST | `/users/:id/reset-password` | admin | Reset password and revoke sessions |
| GET | `/students` | admin/tutor scoped | Student profiles, optionally filtered by offering |
| GET | `/students/me` | student | Own profile and enrollments |

The tutor course scope is `courseViewerFilter` (`structure.ts:245-253`). A tutor sees courses with at least one offering assigned
to that tutor; a student sees courses with an active/completed enrollment.

## Offerings and roster (`offerings.ts`)

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/offerings` | scoped | List offerings; tutors see assigned, students enrolled |
| POST | `/offerings` | admin | Create tutor assignment/offering |
| GET | `/offerings/:id` | viewer | Offering detail and role-appropriate enrollments/assessments |
| PATCH | `/offerings/:id` | admin | Offering settings/status/reporting period |
| DELETE | `/offerings/:id` | admin | Archive offering |
| GET | `/offerings/:id/roster-progress` | admin/tutor owner | Submission, grading, publication and CLO progress |
| GET | `/offerings/:id/enrollments` | admin/tutor owner | Roster |
| POST | `/offerings/:id/enrollments` | admin | Enroll students |
| PATCH | `/enrollments/:id` | admin | Change enrollment status |

`roster-progress` deliberately scopes submission queries by `assessment.offeringId` so a student's other course cannot enter the
current roster (`offerings.ts:273-315`).

## Outcomes (`outcomes.ts`)

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/clos` | scoped | Active CLOs, optionally by course/offering/programme |
| POST | `/clos` | admin/tutor author | Create CLO; tutor-created CLO is pending |
| PATCH | `/clos/:id` | author/admin rules | Edit unapproved authored CLO or admin-managed CLO |
| POST | `/clos/:id/approve` | admin | Approve CLO |
| POST | `/clos/:id/reject` | admin | Return CLO with note |
| DELETE | `/clos/:id` | admin | Delete only evidence-free CLO |
| POST | `/clos/:id/archive` | owner/admin | Safe retirement if no evidence/attainment |
| POST | `/clos/:id/unarchive` | owner/admin | Restore archived CLO |
| GET | `/clos/:id/measurement-criteria` | authorized viewer | Current criteria; `includeHistory=true` includes superseded rows |
| PUT | `/clos/:id/measurement-criteria` | admin/tutor rules | Atomically supersede/create current criteria |
| GET | `/plos` | scoped | PLO framework |
| POST/PATCH/DELETE | `/plos`, `/plos/:id` | admin | Manage/deactivate PLOs |
| GET | `/clo-plo-mappings` | scoped | Mapping matrix data |
| POST | `/clo-plo-mappings` | admin/tutor owner | Create/upsert same-programme mapping |
| DELETE | `/clo-plo-mappings/:id` | admin/tutor owner | Remove unfrozen mapping |

## Assessments, submissions and grading (`assessments.ts`)

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/assessments?offeringId=...` | owner/student enrolled | Assessment list; students see published/closed |
| POST | `/assessments` | admin/tutor owner | Create draft with items, rubric and CLO mappings |
| GET | `/assessments/:id` | owner/student allowed | Assessment detail and role-specific submissions |
| PATCH | `/assessments/:id` | owner/admin | Edit draft metadata |
| POST | `/assessments/:id/publish` | owner/admin | Publish assessment after item mapping validation |
| POST | `/assessments/:id/close` | owner/admin | Stop new submissions |
| POST | `/assessments/:id/archive` | owner/admin | Archive after pending submissions are resolved |
| POST | `/assessments/:id/restore` | owner/admin | Restore archived assessment |
| DELETE | `/assessments/:id` | owner/admin | Delete draft without submissions |
| POST | `/assessments/:id/items` | owner/admin | Add draft item |
| PATCH/DELETE | `/items/:id` | owner/admin | Edit/delete draft item |
| POST | `/assessments/:id/submissions` | student enrolled | Submit once, applying late policy |
| PATCH | `/submissions/:id` | submitting student | Update before grading and deadline rules |
| GET | `/assessments/:id/submissions` | owner/admin | Tutor roster of submissions |
| GET | `/submissions/:id` | owner/student | Submission detail with publication masking |
| GET | `/submissions/:id/grade-history` | owner/admin | Immutable mark history |
| PUT | `/submissions/:id/grades` | owner/admin | Item/rubric grading and regrading |
| POST | `/assessments/:id/publish-results` | owner/admin | Publish graded results to students |

The route implementation is in `server/src/routes/assessments.ts:110-958`; its schemas at `:23-67` explain the request body shape.

## Attainment and reports

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET/POST | `/attainment-policies` | admin/tutor read; admin write | View/create policies |
| POST | `/attainment-policies/:id/activate` | admin | Activate one policy |
| POST | `/offerings/:id/attainment-runs` | owner/admin | Load published evidence, calculate and persist run |
| GET | `/offerings/:id/attainment-runs` | viewer | Run history |
| GET | `/offerings/:id/attainment/latest` | viewer | Latest result |
| GET | `/attainment-runs/:id` | viewer | One run with results |
| POST | `/attainment-runs/:id/freeze` | owner/admin | Freeze historical evidence |
| GET | `/students/me/progress` | student | Own course/CLO progress |
| GET | `/reports/attainment` | scoped | Latest persisted run per offering |
| GET | `/reports/gaps` | scoped | CLO/PLO gaps and shortfall |
| GET | `/reports/plos/:id` | scoped | PLO mapped CLOs, offerings and provenance |
| GET | `/reports/attainment.csv` | scoped | CSV export with formula-prefix neutralization |
| GET | `/reports/attainment.pdf` | scoped | Server-generated PDF of the same persisted report scope |

## Remaining route groups

- `/notifications`, `/notifications/unread-count`, `/:id/read`, `/read-all`, admin broadcast and reminder job:
  `server/src/routes/notifications.ts`.
- `/audit-logs`, `/audit-logs/filters`: admin-only audit queries in `server/src/routes/audit.ts`.
- `/offerings/:id/action-plans`, `/action-plans/:id`: staff improvement plans in `server/src/routes/plans.ts`.
- `/offerings/:id/materials`, `/materials/:id`: published course materials in `server/src/routes/materials.ts`.
- `/dashboard`: role-specific metrics in `server/src/routes/dashboard.ts`.
