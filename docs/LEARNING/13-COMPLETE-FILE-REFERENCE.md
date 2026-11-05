# Complete File Reference

This is a path-oriented index. Detailed behavior is expanded in the numbered learning documents and later lessons.

## Root/configuration

| Path | Reference |
|---|---|
| `package.json` | scripts and dependencies |
| `README.md` | setup summary |
| `SYSTEM_DESIGN.md` | target architecture, not a line-by-line current implementation |
| `.env.example` | configuration contract |
| `vite.config.ts` | Vite/Tailwind/proxy |
| `playwright.config.ts` | browser test servers/project |
| `vitest.config.ts` | test discovery/global setup |
| `tsconfig.json` / `tsconfig.server.json` | TypeScript scopes |
| `.oxlintrc.json` | lint configuration |
| `index.html` | browser HTML shell |

## Frontend entry, state and API

| Path | Reference |
|---|---|
| `src/main.tsx` | React root/providers/router |
| `src/App.tsx` | route table and guards |
| `src/api/client.ts` | fetch, retry, API methods, downloads |
| `src/api/types.ts` | response/domain TypeScript types |
| `src/context/AuthContext.tsx` | session/user/permissions |
| `src/context/ToastContext.tsx` | toast state |
| `src/hooks/useAsync.ts` | request lifecycle and display formatters |
| `src/components/ui.tsx` | UI/accessibility primitives |
| `src/components/Layout.tsx` | authenticated shell/navigation/notifications |
| `src/index.css` | global styling |

## Frontend pages

| Path | Main responsibility |
|---|---|
| `src/pages/Login.tsx` | login form |
| `src/pages/Dashboard.tsx` | role-specific dashboard |
| `src/pages/Departments.tsx` | admin departments |
| `src/pages/Programs.tsx` | admin programmes |
| `src/pages/Semesters.tsx` | admin sessions |
| `src/pages/Courses.tsx` | course catalogue |
| `src/pages/CourseDetail.tsx` | CLOs, criteria, PLO mappings, offerings |
| `src/pages/Offerings.tsx` | offering list |
| `src/pages/OfferingDetail.tsx` | offering tabs, roster and panels |
| `src/pages/AssessmentDetail.tsx` | items, submissions, grading, history |
| `src/pages/PLOs.tsx` | PLO framework and mapping entry |
| `src/pages/PloDrillDown.tsx` | scoped PLO provenance view |
| `src/pages/CloPloMapping.tsx` | mapping matrix |
| `src/pages/Reports.tsx` | charts/tables/CSV/PDF export |
| `src/pages/Notifications.tsx` | notification list |
| `src/pages/Profile.tsx` | profile and password links |
| `src/pages/Settings.tsx` | settings/session actions |
| `src/pages/Users.tsx` | admin users/students |
| `src/pages/AuditLog.tsx` | admin audit search |
| `src/pages/Policies.tsx` | admin attainment policies |
| `src/pages/NotFound.tsx` | unmatched route |

## Offering components

| Path | Responsibility |
|---|---|
| `src/components/offering/AssessmentFormModal.tsx` | assessment/items/rubric/CLO mapping form |
| `src/components/offering/AttainmentPanel.tsx` | stored run result display |
| `src/components/offering/EnrollmentModal.tsx` | admin enrollment form |
| `src/components/offering/MaterialsPanel.tsx` | learning material CRUD |
| `src/components/offering/PlansPanel.tsx` | improvement plan CRUD |
| `src/components/offering/RosterProgressPanel.tsx` | roster evidence/progress display |

## Backend infrastructure

| Path | Reference |
|---|---|
| `server/src/index.ts` | listener and reminder schedule |
| `server/src/app.ts` | Express middleware/router/static host |
| `server/src/config/env.ts` | environment parsing |
| `server/src/lib/prisma.ts` | Prisma client |
| `server/src/lib/tokens.ts` | access/refresh tokens |
| `server/src/lib/password.ts` | bcrypt wrapper |
| `server/src/lib/authorization.ts` | ownership/viewer helpers |
| `server/src/lib/audit.ts` | audit writes |
| `server/src/lib/notify.ts` | notification writes/deduplication |
| `server/src/lib/http.ts` | response/pagination helpers |
| `server/src/lib/errors.ts` | typed application errors |
| `server/src/lib/async-handler.ts` | async Express adapter |
| `server/src/lib/logger.ts` | Pino logger |
| `server/src/middleware/auth.ts` | authentication and role gates |
| `server/src/middleware/validate.ts` | Zod request validation |
| `server/src/middleware/error.ts` | error response mapping |

## Backend routes and services

| Path | Responsibility |
|---|---|
| `server/src/routes/auth.ts` | login/session/profile/password |
| `server/src/routes/structure.ts` | departments/programmes/sessions/courses/users/students |
| `server/src/routes/offerings.ts` | offerings/enrollment/roster progress |
| `server/src/routes/outcomes.ts` | CLO/PLO/mappings/measurement criteria |
| `server/src/routes/assessments.ts` | assessment/evidence/grading lifecycle |
| `server/src/routes/attainment.ts` | policies/runs/freeze/student progress |
| `server/src/routes/reports.ts` | report data/PLO drilldown/CSV/PDF |
| `server/src/routes/dashboard.ts` | role-specific metrics |
| `server/src/routes/notifications.ts` | notifications/reminders |
| `server/src/routes/audit.ts` | admin audit queries |
| `server/src/routes/plans.ts` | improvement plans |
| `server/src/routes/materials.ts` | course materials |
| `server/src/services/attainment/engine.ts` | pure calculation |
| `server/src/services/attainment/policy.ts` | policy validation/defaults |
| `server/src/services/attainment/blueprint.ts` | assessment blueprint rules |
| `server/src/services/attainment-service.ts` | evidence loading + persistence |
| `server/src/services/deadline-reminders.ts` | reminder job |
| `server/src/seed.ts` | development seed |
| `server/scripts/embedded-db.ts` | local PostgreSQL process |

## Database and tests

| Path | Reference |
|---|---|
| `prisma/schema.prisma` | all Prisma models/enums/relations |
| `prisma/migrations/*` | ordered SQL history |
| `server/tests/helpers.ts` | scenario factory and token helpers |
| `server/tests/global-setup.ts` | `obe_test` setup/migrations |
| `server/tests/setup.ts` | Prisma disconnect |
| `server/tests/engine.test.ts` | pure engine |
| `server/tests/constraints.test.ts` | database constraints |
| `server/tests/rbac.test.ts` | auth/RBAC |
| `server/tests/workflow.test.ts` | vertical workflow |
| `server/tests/tutor-panel.test.ts` | tutor panel |
| `e2e/global-setup.ts` | isolated browser database |
| `e2e/critical-flows.spec.ts` | critical role flows |
| `e2e/tutor-panel.spec.ts` | tutor panel browser flows |
| `e2e/tutor-panel-complete.spec.ts` | full isolated tutor workflow |
