# Administrator Panel — Audit & Verification Matrix

> Audit date: 2026-11-05 · Audit scope: Admin Panel + cross-role integration with the verified Tutor/Student panels.
> Baseline before this pass: `npm test` 60/60 integration, `npm run test:unit` 20/20, browser 19/19 (see `TUTOR_PANEL_TEST_REPORT.md`).
> Environment note: system Node.js is 18.19.1; all commands ran with portable **Node v22.23.4** (`~/.local/opt/node-v22.23.4-linux-x64`) prefixed to PATH. The embedded PostgreSQL filesystem probe + `~/.local/share/obe-pg/` fallback (required on the NTFS `/media/saad/Data1` mount) is preserved.

## 1. Method

Every capability below was verified against four layers, not just page rendering:

1. **UI** — Playwright in real headed Google Chrome (`channel: chrome`, slowMo 150).
2. **API** — supertest against the real Express app (`server/tests/admin-panel.test.ts`).
3. **Database** — direct `prisma.*` assertions after each API/UI action (persistence, audit rows, notifications, invariant single-active flags).
4. **Authorization** — negative tests for Tutor and Student against admin-only endpoints.

## 2. Audit matrix

| # | Capability | UI | API | Database | Authorization | Tests | Status after pass |
|---|---|---|---|---|---|---|---|
| 1 | Institutional dashboard (students, programmes, offerings, attainment summary, plans, unread) | Verified (admin UI) | `/dashboard` ADMIN branch | Live aggregates, no hardcoding | `authenticate` | integrated + e2e `renders the dashboard from live database state` (UI vs API cross-check) | **Complete and verified** |
| 2 | Department management (create/update/deactivate/search/duplicate prevention) | Verified | `/departments` | `code @@unique`, soft-delete keeps history | `adminOnly` writes, reads open | integrated ×3 + e2e lifecycle | **Complete and verified** |
| 3 | Programme management (create/update/deactivate/search/department FK) | Verified | `/programs` | `code @@unique`, `departmentId` Restrict | `adminOnly` writes; role-scoped reads (tutor/student filters) | integrated ×2 + e2e create | **Complete and verified** |
| 4 | Academic session management (single-active invariant, date validation, delete guard) | Verified | `/semesters` | transactional deactivation of previous session; conflict on used sessions | `adminOnly` | integrated ×2 + e2e atomic activation | **Complete and verified** |
| 5 | Course catalogue & course detail (admin visibility, CLO workspace) | Verified | `/courses`, `/courses/:id` | `@@unique([programId, code])` | `adminOnly` writes; scoped reads | existing rbac/workflow suites + browser specs | **Complete and verified** (pre-existing) |
| 6 | User & student account management (create staff/student, profile rules, duplicate e-mail/employeeNo, deactivate/reactivate, self-deactivation guard) | Verified | `/users`, `/users/:id` | `email @unique`, `employeeNo @unique`, `student_profiles` | `adminOnly`, self-guard | integrated ×3 + e2e create/toggle + sign-in with admin-set password | **Complete and verified** |
| 7 | Administrative password reset (revokes sessions, clears lockout, audited) | Verified | `/users/:id/reset-password` | `refresh_tokens` mass-revocation in tx; `failedLoginCount=0` | `adminOnly` | integrated (old refresh cookie rejected) + e2e (once-reset password works at login) | **Complete and verified** |
| 8 | Student roster (pagination, search, programme/offering filters, tutor isolation) | Verified (Users page) | `/students` | paginated `student_profiles` | ADMIN/TUTOR; tutor sees only own enrollments | integrated ×2 | **Complete and verified** |
| 9 | CLO approval / rejection | Verified (CourseDetail) | `/clos/:id/approve` | `approval_status`, approver+timestamp | `adminOnly` | existing workflow + browser suites | **Complete and verified** (pre-existing) |
| 10 | Attainment policy versioning + activation | Verified (Policies page) | `/attainment-policies`, `/:id/activate` | `version @unique`, invariant single `isActive` | `adminOnly` writes, admin+tutor reads | existing workflow + integrated single-active test + e2e versioning | **Complete and verified** |
| 11 | Attainment runs (compute/freeze, immutability of frozen evidence) | Verified (OfferingDetail) | `/offerings/:id/attainment-runs`, `/attainment-runs/:id/freeze` | snapshot JSON per run | owner or admin | existing workflow + browser suites | **Complete and verified** (pre-existing) |
| 12 | Audit trail query + filter options | Verified (AuditLog page) | `/audit-logs`, `/audit-logs/filters` | append-only audit rows written by every admin mutation above | `adminOnly` | integrated filters/RBAC + existing critical-flows UI test | **Complete and verified** |
| 13 | Notifications (per-recipient, broadcast for admins, dedupe) | Verified (Notifications page) | `/notifications`, broadcast | `dedupe_key @unique`, delivery state | scoped per recipient | existing workflow/notification suites | **Complete and verified** (pre-existing) |
| 14 | Reports & exports (CSV/PDF, `EXPORT` audit row) | Verified (Reports page) | `/reports` | read-only aggregation | role-scoped to offerings/data the viewer owns | existing browser export tests (tutor) + admin access check | **Complete and verified** |
| 15 | Improvement action plans (tutor-authored, admin-visible in dashboard aggregate) | Verified | `/plans` | `plan_status` | admin read aggregation | existing tutor suites + dashboard counts | **Complete and verified** |

## 3. Gaps found by this pass and their resolution

| # | Gap (evidence) | Resolution |
|---|---|---|
| 1 | No executed automated verification of any admin write workflow (docs §17.3 of the tutor completion report explicitly deferred this) | New `server/tests/admin-panel.test.ts` — 11 integration tests; new `e2e/admin-panel.spec.ts` — 6 headed browser tests |
| 2 | Dashboard numbers never cross-checked against independent database state | `admin-panel.test.ts` asserts card values equal direct `prisma` scenario counts; e2e `renders the dashboard from live database state` compares each rendered card against the live API |
| 3 | Single-active policy/session invariants only exercised through the tutor workflow path | Direct API tests for create-with-`isActive`, activate-idempotence, tutor 403, and the transactional semester deactivation |
| 4 | Password reset session revocation never verified at HTTP level | Old refresh cookie is rejected after admin reset; audit metadata `password_reset` verified |
| 5 | Duplicate protection tested only for programme codes | Department code, user e-mail and employee number duplicates now produce `409 DUPLICATE` (verified) |
| 6 | Profile page title said “Tutor profile” for every role (found in the prior pass) | Fixed in the previous pass; re-verified by lint/typecheck (no admin regression) |

No application defects were found in the Admin Panel during this pass; all failures surfaced during test development were selector-level issues in the tests themselves.

## 4. Out of scope (documented, not silently dropped)

- Email notification channel (in-app only, per test report §104) — platform-level, unchanged.
- Audit hash-chain verification endpoint from `SYSTEM_DESIGN.md` §4.2 — design-baseline feature never implemented in the actual system; the implemented append-only audit log is verified above.
- Multi-browser coverage (Chrome only; Playwright suite hardening applies to Chromium/Chrome channel).
- CI pipeline parity (no CI infrastructure in the repository).

## 5. Command provenance

```
npm run test:unit          # 20/20 (attainment engine)
npm test                   # integration incl. new admin-panel.test.ts
npx playwright test        # headed Chrome, all browser specs
npm run typecheck && npm run lint
```
