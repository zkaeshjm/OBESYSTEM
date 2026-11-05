# Learning Progress

## Current status

- **Overall:** In Progress
- **Current phase:** Phase 1 — repository reverse engineering
- **Current lesson:** Initial architecture and project map
- **Application source changed for learning:** No
- **Learning documentation created:** Yes

## Lessons

| Module | Lesson | Status | Files studied | Exercise | Learner confirmation |
|---|---|---|---|---|---|
| 1 | Repository map and startup | In Progress | `src/main.tsx`, `src/App.tsx`, `server/src/index.ts`, `server/src/app.ts`, configs | Draw the startup chain from browser load to `/api/v1/health` | Pending |
| 1 | Frontend architecture | Not Started | `src/context`, `src/hooks`, `src/components`, pages | Pending | Pending |
| 1 | Backend architecture | Not Started | `server/src/lib`, middleware, routes, services | Pending | Pending |
| 1 | Database architecture | Not Started | `prisma/schema.prisma`, migrations | Pending | Pending |
| 1 | API and data flow | Not Started | `src/api/client.ts`, route modules | Pending | Pending |
| 1 | Authentication/authorization | Not Started | `auth.ts`, `tokens.ts`, `middleware/auth.ts`, `authorization.ts` | Pending | Pending |
| 2 | Tutor Panel module A | Not Started | Dashboard files | Pending | Pending |
| 2 | Tutor Panel modules B–N | Not Started | module-specific files | Pending | Pending |
| 3 | CLO CRUD deep dive | Not Started | `CourseDetail.tsx`, `outcomes.ts`, `Clo` model | Pending | Pending |
| 4 | OBE attainment formulas | Not Started | `attainment-service.ts`, `engine.ts`, `policy.ts` | Pending | Pending |
| 5 | Testing/debugging/security | Not Started | test suites, E2E, security boundaries | Pending | Pending |

## Questions to resolve during lessons

1. Why does the frontend keep the access token in memory while the refresh token is in an `httpOnly` cookie?
2. Why does a tutor need both `requireRole('TUTOR')` and an offering ownership check?
3. Why are `AssessmentItemClo` and `CloPloMapping` separate many-to-many relationships?
4. Why does attainment load only result-published assessments?
5. Why are frozen runs and grade-change history needed for accreditation evidence?

## Completion rule

A lesson is not marked `Completed` because its document exists. It becomes completed only after the learner answers the verification
questions and either completes the exercise or explicitly requests to move on.
