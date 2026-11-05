# End-to-End Data Flow

## 1. General read flow

```mermaid
sequenceDiagram
  participant Page as React page
  participant Hook as useAsync
  participant Client as api.client.ts
  participant API as Express route
  participant Auth as auth/validation/ownership
  participant DB as Prisma/PostgreSQL

  Page->>Hook: loader()
  Hook->>Client: api.course(id)
  Client->>API: GET /api/v1/courses/:id
  API->>Auth: authenticate + validate + courseViewerFilter
  Auth->>DB: scoped Course query with relations
  DB-->>API: typed Prisma result
  API-->>Client: { data, meta }
  Client-->>Hook: parsed response
  Hook-->>Page: data/loading/error state
  Page-->>Page: render table/card/empty state
```

## 2. General mutation flow

The mutation pattern is visible in `CourseDetail.tsx:80-115`:

1. Browser event calls `submit`.
2. `preventDefault()` stops a full page navigation.
3. Local validation checks obvious empty input.
4. `api.createClo` or `api.updateClo` serializes JSON.
5. Express validates UUID/body with Zod.
6. Handler checks ownership/role.
7. Prisma inserts/updates and may use a transaction.
8. Audit/notification side effects run.
9. API returns the row.
10. React closes the modal, shows a toast and reloads the query.

## 3. Assessment-to-attainment flow

```mermaid
flowchart TD
  Create[Create draft assessment] --> Items[Items + rubric criteria + item→CLO mappings]
  Items --> Publish[Publish assessment]
  Publish --> Submit[Student submission]
  Submit --> Grade[Tutor item/rubric grade]
  Grade --> PublishResults[Publish results]
  PublishResults --> Evidence[Published grades become attainment evidence]
  Evidence --> Build[buildOfferingInput]
  Build --> Engine[computeAttainment pure function]
  Engine --> Persist[AttainmentRun + CloAttainment + PloAttainment]
  Persist --> Report[JSON / CSV / PDF reports]
  Persist --> Freeze[Freeze immutable run]
```

The evidence gate is in `server/src/services/attainment-service.ts:61-75`: only `PUBLISHED`/`CLOSED` assessments with
`resultsPublishedAt` are included for normal staff computation. The engine output is persisted with policy and evidence snapshots.

## 4. CLO create flow

```mermaid
sequenceDiagram
  participant Course as CourseDetail.tsx
  participant API as POST /clos
  participant Scope as assertCourseAuthor
  participant DB as PostgreSQL
  participant Admin as admin notification

  Course->>API: courseId, code, description, Bloom, threshold, PLO mappings
  API->>Scope: tutor owns a course offering?
  API->>DB: create CLO + optional mapping rows transactionally
  DB-->>API: pending tutor CLO or approved admin CLO
  API->>DB: audit INSERT
  API->>Admin: notify active admins if pending
  API-->>Course: created CLO
  Course->>Course: reload course detail
```

## 5. Report flow

`server/src/routes/reports.ts:25-80` builds the authorization-filtered latest run set. `buildReport` then creates CLO rows directly from
persisted `CloAttainment` rows and computes programme PLO roll-up from persisted CLO results. CSV and PDF call the same `loadRuns` and
`buildReport`, so export scope matches the visible report rather than bypassing authorization.
