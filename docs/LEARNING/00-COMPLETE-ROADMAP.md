# OBE System Learning Roadmap

## Purpose

This is a repository-grounded course for understanding the OBE system as it exists in this workspace. The course follows the real
dependency direction: browser entry point → React pages and API client → Express routes and middleware → Prisma/PostgreSQL → persisted
OBE evidence and reports.

## Current repository facts

- Frontend: React 19, TypeScript, Vite, React Router, Tailwind CSS, Recharts and Lucide icons.
- Backend: Node.js, Express 5, TypeScript, Zod validation, Prisma Client and PostgreSQL.
- Persistence: PostgreSQL schema in `prisma/schema.prisma`, with nine versioned migrations currently present.
- Authentication: short-lived JWT access token plus rotating opaque refresh token in an `httpOnly` cookie.
- Roles: `ADMIN`, `TUTOR`, `STUDENT` (`prisma/schema.prisma:15-19`).
- Tests: Vitest integration/unit suite under `server/tests`, Playwright browser suite under `e2e`.
- Main server mount point: `server/src/app.ts:104-115`.
- Browser entry point: `src/main.tsx:10-21`.

## Learning sequence

| Phase | Lessons | Status | Output |
|---|---|---|---|
| 1. Repository reverse engineering | Inventory, startup, structure, architecture, dependencies | In Progress | Documents `01`–`13` |
| 2. Runtime architecture | Request lifecycle, frontend tree, database relationships | Not Started | Diagrams and execution traces |
| 3. Frontend foundations | `main.tsx`, `App.tsx`, `AuthContext`, `useAsync`, shared UI | Not Started | Small code-reading lessons |
| 4. Backend foundations | `index.ts`, `app.ts`, middleware, routes, errors | Not Started | Request lifecycle lessons |
| 5. Database engineering | Prisma models, migrations, queries, constraints | Not Started | ER and table lessons |
| 6. Authentication and authorization | Login, refresh rotation, RBAC and ownership | Not Started | Security-focused lessons |
| 7. Tutor Panel | Dashboard through settings, in the requested A–N order | Not Started | One module at a time |
| 8. Deep CRUD | CLO first, then assessments and improvement plans | Not Started | End-to-end CRUD traces |
| 9. OBE domain logic | CLO/PLO, evidence, mastery, cohort and policy calculations | Not Started | Formula walkthroughs |
| 10. Testing and debugging | Vitest, API tests, Playwright, failure diagnosis | Not Started | Test-writing exercises |
| 11. Security engineering | IDOR, validation, tokens, CORS, rate limiting, audit | Not Started | Threat-to-code analysis |
| 12. Maintenance and extension | How to add a module without breaking authorization or evidence | Not Started | Design exercises |

## Lesson rule

Each lesson will use the same structure: concept, reason, exact file paths, actual source excerpts, line-by-line explanation,
execution flow, dependencies, database relationship, practical example, common errors, exercise and 3–5 verification questions.
Lessons will stop for the learner's answers before the next lesson begins.

## Recommended path through the code

1. Read this roadmap and `01-PROJECT-STRUCTURE.md`.
2. Read startup files: `src/main.tsx`, `src/App.tsx`, `server/src/index.ts`, `server/src/app.ts`.
3. Follow authentication: `src/context/AuthContext.tsx` → `src/api/client.ts` → `server/src/routes/auth.ts` → `server/src/middleware/auth.ts`.
4. Follow one domain object: CLO through `src/pages/CourseDetail.tsx`, `/clos` routes in `server/src/routes/outcomes.ts`, and `Clo` in `prisma/schema.prisma`.
5. Follow assessment evidence into `server/src/services/attainment-service.ts` and the pure engine in `server/src/services/attainment/engine.ts`.
6. Use tests as executable specifications: `server/tests/helpers.ts`, `workflow.test.ts`, `tutor-panel.test.ts` and the Playwright specs.

## Important distinction

The older `SYSTEM_DESIGN.md` describes a target production system and explicitly contrasts it with the prototype. The current source is
more advanced than that document's prototype description: it has a real Express API, Prisma/PostgreSQL persistence, authentication,
RBAC, attainment persistence and tutor-panel workflows. The learning documents describe the code that is actually present, while
calling out where design documents describe future or alternative architecture.
