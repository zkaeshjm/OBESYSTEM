# Tutor Panel Walkthrough

This document is the map for the later detailed lessons. It records the actual entry points and first dependency chain for each
Tutor Panel module.

| Module | Frontend entry | API/backend entry | Primary persistence |
|---|---|---|---|
| A. Tutor dashboard | `src/pages/Dashboard.tsx` | `GET /dashboard`, `server/src/routes/dashboard.ts` | offerings, submissions, runs, plans, notifications |
| B. My courses | `src/pages/Courses.tsx`, `CourseDetail.tsx` | `/courses`, `/courses/:id` in `structure.ts` | `Course`, `Clo`, `CourseOffering` |
| C. CLO management | `CourseDetail.tsx` | `/clos` in `outcomes.ts` | `Clo`, `CloMeasurementCriterion`, mappings, audit |
| D. PLO management | `src/pages/PLOs.tsx`, `PloDrillDown.tsx` | `/plos`, `/reports/plos/:id` | `Plo`, `PloAttainment`, mapping rows |
| E. CLO/PLO mapping | `src/pages/CloPloMapping.tsx` | `/clo-plo-mappings` | `CloPloMapping` |
| F. Assessment management | `OfferingDetail.tsx`, `AssessmentDetail.tsx`, `AssessmentFormModal.tsx` | `/assessments` | `Assessment`, `AssessmentItem` |
| G. Questions/rubrics | `AssessmentFormModal.tsx`, `AssessmentDetail.tsx` | nested create and grading routes | `RubricCriterion`, criterion grades |
| H. Student roster | `OfferingDetail.tsx`, `RosterProgressPanel.tsx` | `/offerings/:id/roster-progress`, enrollments | `Enrollment`, submissions, runs |
| I. Submissions/grading | `AssessmentDetail.tsx` | submission and grade routes | `Submission`, grades, `GradeChange` |
| J. Attainment | `AttainmentPanel.tsx`, `OfferingDetail.tsx` | `attainment.ts`, `attainment-service.ts`, `engine.ts` | policies, runs, CLO/PLO results |
| K. Reports | `src/pages/Reports.tsx` | `reports.ts` JSON/CSV/PDF | persisted attainment rows + audit |
| L. Improvement plans | `PlansPanel.tsx` | `plans.ts` | `ImprovementActionPlan` |
| M. Notifications | `Layout.tsx`, `Notifications.tsx` | `notifications.ts` and `notify.ts` | `Notification` |
| N. Profile/settings | `Profile.tsx`, `Settings.tsx` | `/auth/me`, `/auth/password` | `User`, `RefreshToken`, audit |

## Tutor workflow order

1. Tutor logs in; `AuthContext` restores permissions.
2. Dashboard queries role-scoped metrics.
3. Courses and offerings are filtered by tutor assignment.
4. Tutor authors a CLO; it is pending until admin approval.
5. Approved CLOs can receive assessment evidence and PLO mappings.
6. Tutor creates an assessment draft, defines items/rubric and maps each item to a CLO.
7. Publishing exposes the assessment to enrolled students.
8. Student submits; tutor grades; results remain hidden until publication.
9. Published results feed `buildOfferingInput` and the pure attainment engine.
10. Tutor reviews and freezes a run, creates improvement plans for gaps, and exports reports.

## Important role distinction

The tutor panel is not a separate application. It is the same route table and same API as administration and student views. The
difference is the authenticated role plus ownership filters. `Layout.tsx:38-77` filters navigation for usability, while backend
ownership checks remain authoritative.
