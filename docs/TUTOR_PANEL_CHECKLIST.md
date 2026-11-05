# Tutor Panel Checklist

| Area | Status | Verification |
|---|---|---|
| Tutor dashboard | Verified | Role-scoped dashboard loads without cross-role leakage; exercised by `critical-flows` browser test against `obe_e2e`. |
| My courses and offerings | Verified | Tutor sees only assigned offerings; RBAC integration test prevents foreign access; browser-verified. |
| CLOs | Verified | Author, approve, reject, archive, unarchive; archived rows hidden by default; integration + browser verified. |
| PLOs | Verified | Tutors read PLOs for their courses; drill-down page `/plos/:id` authorized and evidence-scoped. |
| CLO–PLO mapping | Verified | Matrix supports add, reweight and remove; frozen evidence blocks changes; integration test + matrix UI. |
| Assessments | Verified | Create, publish, close, archive, restore; type, passing marks, format and late policy persist; integration + browser verified. |
| Questions/rubrics | Verified | Item, rubric criterion, mapping and evidence validation; constraints tests refuse cross-course and over-max mappings. |
| Student roster | Verified | Offering detail shows enrolments; admin can change statuses; roster-progress panel browser-verified. |
| Submissions/grading | Verified | Students submit once through the real UI; tutors grade item by item; history is auditable; browser-verified end to end. |
| Late policy | Verified | `ACCEPT`, `REJECT` and `MARK_LATE` behave as specified (integration test, all three policies, first submission and resubmission). |
| Attainment analysis | Verified | Runs compute from published evidence; freeze is one-way; 20/20 engine unit tests + browser-verified calculation. |
| Reports/exports | Verified | JSON report, CSV and PDF exports use identical filters/authorization; CSV formula neutralization tested. |
| Improvement plans | Verified | Gap, follow-up, status, evaluation and audit trail; foreign-tutor plan access denied (integration). |
| Notifications | Verified | Bell and full list; delivery persisted with DELIVERED state; recipient scoping tested. |
| Tutor profile | Verified | Self-service name/phone only; role/status/email changes ignored (integration). |
| Settings | Verified | Password change and session policy; sign out browser-verified. |
| Authorization | Verified | IDOR integration tests verify tutor ownership and cross-tutor 403s; browser verifies foreign URL rejection renders the 403 alert. |
| CLO measurement criteria | Verified | Create, view, validate, version and preserve superseded definitions; approved-CLO edits are administrator-only; integration + browser verified. |
| PLO drill-down | Verified | `/plos/:id` shows mapped CLOs and only authorized offering runs with policy/evidence provenance; integration + browser verified. |
| Student roster progress | Verified | Offering-scoped submission completion, pending grading, unpublished grades, published averages and persisted CLO snapshots. |
| PDF reports | Verified | Authorized server-generated PDF downloaded through the browser; scope parity with CSV asserted by integration test. |
| Playwright critical workflow | Verified | 9/9 browser tests pass against the isolated `obe_e2e` database, including the complete 17-step tutor workflow. |
| Integration tests | Verified | `npm test`: 5 files, 60/60 tests pass against PostgreSQL `obe_test`. |
| Unit tests | Verified | `npm run test:unit`: 20/20 attainment-engine tests pass. |
| Typecheck/lint/build | Verified | `npm run typecheck`, `npm run lint` and `npm run build` all pass; the build retains Vite's advisory about the main chunk size (optimization item, not an error). |

## Verification update — 2026-11-05

- Full verification executed on a PostgreSQL-capable workstation. The 2026-11-04 environment blocker (embedded PostgreSQL could not
  switch UID/GID in a container) no longer applies; PostgreSQL 18.4 runs on port 5433 and both disposable test databases migrate cleanly.
- Playwright test-code defects were found and fixed (selectors, publish/approve scoping, dialog Close ambiguity, missing tab click,
  403-message regex). No application defect was found by any executed suite. See `TUTOR_PANEL_TEST_REPORT.md` for the fix list.
- No migration was added during this pass. Existing additive migrations remain unchanged and were applied to both test databases.

## Git removal

The existing `.git` directory and remote configuration were removed as instructed. The workspace is a plain project
directory; create a new repository when you are ready. No Git commands were run in this pass either.
