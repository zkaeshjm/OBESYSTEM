# OBE Attainment & Accreditation Management System — System Design

**Document type:** Technical system design (target production system)
**Status:** Design baseline for implementation
**Scope:** The **real project** — the deployed, multi-user system — not the single-user browser prototype in this repository.

---

## 1. Purpose and relationship to the prototype

This repository currently contains a **front-end prototype**: a React 19 single-page application whose entire persistence layer is `window.localStorage`, seeded from `src/data/mockData.js`. It demonstrates every screen, workflow and calculation rule of the finished product, but it has no server, no database, no real authentication and no real file storage.

This document specifies the **real system** that the prototype is a mock-up of:

| Concern | Prototype (this repo) | Real system (this document) |
|---|---|---|
| Persistence | `localStorage` key/value, seeded from `mockData.js`, version-keyed migration | PostgreSQL 16, normalised relational schema |
| Data sharing | One browser, one user | Many concurrent users, one source of truth |
| Authentication | Plaintext password compared against seed data, user object in `localStorage` | Argon2id password hashes, short-lived JWT access token + rotating refresh token |
| Authorisation | `isAdmin(user)` checks sprinkled through components | Enforced server-side by RBAC middleware; the client only *hides* what the API would refuse anyway |
| Attainment | Component weights derived correctly, but CLO/PLO attainment only described in the architecture figure | Computed server-side by a deterministic, versioned attainment engine |
| Audit | `logAudit()` prepends to a `localStorage` array, `ip` hard-coded to `127.0.0.1` | Append-only `audit_log` table, real client IP, actor, before/after diff, tamper-evident chain |
| Evidence files | Metadata only — the file is never uploaded | Upload to object storage; the database holds a pointer, checksum and size |
| Grading sheet | `obe_grading_status` map: `draft` \| `finalized` | First-class `grading_sheet` row with a state machine, sign-off and immutability trigger |

The prototype's **domain rules are authoritative** — where this document and the prototype disagree on a rule (category weights, minimum component counts, thresholds), the prototype's implemented behaviour is the specification, because it is the behaviour the client has already reviewed and signed off.

---

## 2. Architectural overview

Three-tier architecture with a clean split between presentation, application logic and data.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                                 │
│  React 19 SPA (Vite, Tailwind CSS 4, React Router 7, Recharts, lucide)   │
│  Desktop browser · tablet browser · print/PDF output                     │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │  HTTPS · JSON · Bearer JWT
┌────────────────────────────────▼─────────────────────────────────────────┐
│  APPLICATION TIER — Node.js 22 · Express 5                               │
│                                                                          │
│  Middleware chain:                                                       │
│    helmet → cors → rate-limit → body-parse → request-id → logger         │
│    → authenticate (verify JWT) → authorize (RBAC) → validate (zod)       │
│    → route handler → error handler                                       │
│                                                                          │
│  Route modules:                                                          │
│    /auth  /departments  /programs  /sessions  /courses  /sections        │
│    /users /students  /plos  /clos  /mappings  /blueprints  /marks        │
│    /documents  /attainment  /reports  /audit  /notifications             │
│                                                                          │
│  Domain services:                                                        │
│    BlueprintService   — category shares, derived weights, normalisation  │
│    AttainmentService  — component score → CLO → PLO → decision           │
│    GradingSheetService— Draft → Finalised lifecycle, immutability        │
│    AuditService       — append-only write, hash chain                    │
│    StorageService     — signed-URL upload/retrieval for evidence files   │
└───────────────┬──────────────────────────────┬───────────────────────────┘
                │ pg (pooled)                  │ S3 API
┌───────────────▼──────────────────┐  ┌────────▼──────────────────────────┐
│  DATA TIER                       │  │  OBJECT STORAGE                   │
│  PostgreSQL 16                   │  │  S3-compatible bucket             │
│  ├── academic structure tables   │  │  (MinIO on-prem / S3 / R2)        │
│  ├── outcome tables (PLO/CLO)    │  │                                   │
│  ├── assessment & marks tables   │  │  evidence/{section}/{category}/   │
│  ├── attainment results          │  │    {uuid}-{filename}              │
│  ├── grading_sheet + sign-off    │  │                                   │
│  └── audit_log (append-only)     │  │  DB stores key, sha256, size,     │
│                                  │  │  mime, uploader — never the bytes │
│  Nightly pg_dump → WAL archive   │  └───────────────────────────────────┘
└──────────────────────────────────┘
```

### 2.1 Technology decisions

| Layer | Choice | Rationale |
|---|---|---|
| UI | React 19 + Vite + Tailwind CSS 4 | Already built and reviewed in the prototype — zero rewrite cost for the presentation layer |
| Routing | React Router 7 | Existing route table (`/departments`, `/clos`, `/blueprint`, `/marks`, `/reports`, `/documents`, `/audit`, …) maps 1:1 to API resources |
| Charts | Recharts 3 | Already used by the dashboard; attainment series are the same shape as the mock series |
| API | Node.js 22 + Express 5 | Same language as the UI (one toolchain, shared validation schemas in TypeScript), mature ecosystem for JWT, multer/S3, pg |
| Validation | zod | One schema per request body, shared between client and server; replaces the prototype's ad-hoc `Number()` coercion in forms |
| DB | PostgreSQL 16 | The attainment engine is set-based aggregation over joins; FK integrity, `CHECK` constraints and partial indexes enforce the blueprint rules *in the database*, not only in the service layer |
| DB access | `pg` with an explicit SQL layer (no ORM) | The attainment queries are analytical; hand-written SQL with a query builder for CRUD keeps them readable and indexable. Row-level types generated from the schema. |
| Cache | Redis 7 (optional, phase 2) | Only for attainment recomputation jobs and rate-limit counters; the system is correct without it |
| Jobs | `node-cron` in-process, or BullMQ when Redis is present | Nightly attainment pre-computation, evidence checksum verification, audit-chain verification |
| Files | S3-compatible object storage | Evidence scans are binary and large; never store them in the database |
| Auth | JWT (HS256 access, 15 min) + opaque refresh token (7 days, rotating, stored hashed) | Stateless verification on every request; revocation handled at the refresh layer |
| PDF | Server-side rendering of the grading sheet to PDF (Puppeteer or `@react-pdf/renderer`) | The prototype uses `window.print()`; the real system must produce a byte-identical archived copy |
| Deployment | Docker Compose (single-node) → Kubernetes (multi-node) | Start simple; the tiers are already separable |

---

## 3. Deployment topology

**Small deployment (single institution, one campus):**

```
                ┌───────────────┐
  Internet ────▶│  nginx / Caddy│  TLS termination, gzip/brotli, static SPA bundle
                └───┬───────┬───┘
                    │       │
        /api/*  ────┘       └──── everything else → SPA index.html (client routing)
                    │
              ┌─────▼──────┐        ┌──────────────┐      ┌──────────────┐
              │ api (×2)   │───────▶│ postgres 16  │      │ minio        │
              │ node:22    │        │ + WAL archive│      │ evidence     │
              └────────────┘        └──────────────┘      └──────────────┘
```

* Stateless API containers — scale horizontally behind nginx; no session affinity required because auth is a bearer token.
* PostgreSQL is the only stateful component. Streaming replication to a hot standby; nightly logical dump retained for 90 days (accreditation cycles are multi-year, so retention is a hard requirement, not a nicety).
* Object storage is append-mostly; lifecycle rule moves evidence to cold storage after the accreditation cycle closes, but never deletes it.
* All timestamps stored as `timestamptz` in UTC; rendered in the institution's local zone by the client.

---

## 4. Data model

### 4.1 Entity–relationship overview

```
department ─1:N─ program ─┬─1:N─ course ─┬─1:N─ section ─┬─1:N─ enrollment ─N:1─ student
                          │              │              │
                          │              │              └─1:N─ document
                          │              │
                          │              └─1:N─ clo ─┬─N:M─ plo        (clo_plo_mapping)
                          │                          └─1:N─ blueprint_component
                          │                                     │
                          │                                     └─1:N─ student_mark ─N:1─ student
                          │
                          └─1:N─ plo

semester (session) ─1:N─ course
semester (session) ─1:N─ section

app_user ─1:N─ section (as instructor)
app_user ─1:N─ audit_log (as actor)
section ─1:1─ grading_sheet ─1:N─ attainment_result
```

Two deliberate deviations from the prototype's flat model:

1. **`student` is separated from `enrollment`.** In the prototype `students` carries a `section_id`. In reality a student belongs to a programme and a batch, and *enrols* in many sections across a degree. Modelling this as a join table is what makes PLO attainment across a whole programme — the number that accreditation actually asks for — possible at all.
2. **CLO↔PLO is many-to-many.** The prototype uses `clos.plo_id`, a single FK. Real CLOs routinely serve two or three PLOs at different strengths, and the roll-up must weight them. The mapping table carries that weight.

### 4.2 Schema DDL

```sql
-- =====================================================================
--  Extensions and shared conventions
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email

-- Every mutable business table carries created_at/updated_at and is
-- audited by trigger (see §7.3). Surrogate keys are BIGINT identity
-- internally; UUIDs are exposed in URLs so ids are not enumerable.
```

```sql
-- =====================================================================
--  A. Institution and identity
-- =====================================================================
-- `department` is listed first because app_user.department_id points at
-- it; the remaining academic tables follow in block B.

CREATE TABLE department (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id   UUID        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name        TEXT        NOT NULL,
    code        TEXT        NOT NULL UNIQUE,          -- e.g. 'CS'
    hod_name    TEXT,
    contact     TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);



CREATE TABLE app_user (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id      UUID   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name           TEXT   NOT NULL,
    email          CITEXT NOT NULL UNIQUE,
    password_hash  TEXT   NOT NULL,                   -- argon2id, never a plaintext column
    role           TEXT   NOT NULL
                   CHECK (role IN ('admin','hod','instructor','coordinator','viewer')),
    department_id  BIGINT REFERENCES department(id) ON DELETE SET NULL,
    employee_no    TEXT   UNIQUE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    failed_logins  SMALLINT NOT NULL DEFAULT 0,
    locked_until   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_token (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash  TEXT   NOT NULL UNIQUE,               -- sha256 of the opaque token
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    user_agent  TEXT,
    ip          INET
);

CREATE INDEX refresh_token_active ON refresh_token (user_id) WHERE revoked_at IS NULL;
```

```sql
-- =====================================================================
--  B. Academic structure
-- =====================================================================

CREATE TABLE program (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id      UUID    NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    department_id  BIGINT  NOT NULL REFERENCES department(id) ON DELETE RESTRICT,
    name           TEXT    NOT NULL,                  -- 'BS Computer Science'
    code           TEXT    NOT NULL UNIQUE,           -- 'BSCS'
    credit_hours   INTEGER NOT NULL CHECK (credit_hours BETWEEN 60 AND 300),
    accreditation_body TEXT CHECK (accreditation_body IN ('PEC','ABET','HEC','OTHER')),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A "session" in the prototype's vocabulary is a term the institution
-- runs: 'Fall 2025'. It is the top-level time partition for courses.
CREATE TABLE semester (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name        TEXT NOT NULL UNIQUE,                 -- 'Fall 2025'
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT semester_dates CHECK (end_date > start_date)
);

-- Exactly one active session at a time; enforced by a partial unique index
-- rather than application logic.
CREATE UNIQUE INDEX semester_one_active ON semester (is_active) WHERE is_active;

CREATE TABLE course (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id     UUID    NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    program_id    BIGINT  NOT NULL REFERENCES program(id)  ON DELETE RESTRICT,
    semester_id   BIGINT  NOT NULL REFERENCES semester(id) ON DELETE RESTRICT,
    code          TEXT    NOT NULL,                   -- 'CS-301'
    title         TEXT    NOT NULL,
    credit_hours  INTEGER NOT NULL CHECK (credit_hours BETWEEN 1 AND 6),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (semester_id, code)
);

CREATE TABLE section (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id     UUID   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    course_id     BIGINT NOT NULL REFERENCES course(id) ON DELETE RESTRICT,
    semester_id   BIGINT NOT NULL REFERENCES semester(id) ON DELETE RESTRICT,
    instructor_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    class_name    TEXT   NOT NULL,                    -- 'BSCS-7A'
    shift         TEXT   NOT NULL DEFAULT 'Morning'
                  CHECK (shift IN ('Morning','Evening')),
    status        TEXT   NOT NULL DEFAULT 'active'
                  CHECK (status IN ('planned','active','completed','archived')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (semester_id, class_name, course_id)
);

-- The prototype stores students directly against a section. The real
-- model separates identity (student) from enrolment (enrollment) so a
-- student's whole programme trajectory can be aggregated for PLO roll-up.
CREATE TABLE student (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    roll_no     TEXT NOT NULL UNIQUE,                 -- '23-ARID-564'
    name        TEXT NOT NULL,
    program_id  BIGINT NOT NULL REFERENCES program(id) ON DELETE RESTRICT,
    batch       TEXT,                                 -- '2023'
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrollment (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id  BIGINT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    section_id  BIGINT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
    status      TEXT   NOT NULL DEFAULT 'enrolled'
                CHECK (status IN ('enrolled','dropped','withdrawn','completed')),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_id, section_id)
);

CREATE INDEX enrollment_section ON enrollment (section_id) WHERE status = 'enrolled';
```


```sql
-- =====================================================================
--  C. Outcomes
-- =====================================================================
CREATE TABLE plo (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id           UUID   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    program_id          BIGINT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    number              TEXT   NOT NULL,              -- 'PLO-3'
    title               TEXT   NOT NULL,
    bloom_domain        TEXT   NOT NULL
                        CHECK (bloom_domain IN ('Cognitive','Psychomotor','Affective')),
    accreditation_ref   TEXT,                         -- 'PEC Criterion 4 (b)', 'ABET 3(2)'
    target_attainment   NUMERIC(5,2) NOT NULL DEFAULT 65.00
                        CHECK (target_attainment BETWEEN 0 AND 100),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (program_id, number)
);

CREATE TABLE clo (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id          UUID   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    course_id          BIGINT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    number             TEXT   NOT NULL,               -- 'CLO-2'
    title              TEXT   NOT NULL,
    bloom_level        TEXT   NOT NULL
                       CHECK (bloom_level IN
                         ('Remember','Understand','Apply','Analyze','Evaluate','Create')),
    passing_threshold  NUMERIC(5,2) NOT NULL DEFAULT 50.00
                       CHECK (passing_threshold BETWEEN 0 AND 100),
    approval_status    TEXT NOT NULL DEFAULT 'pending'
                       CHECK (approval_status IN ('pending','approved','rejected')),
    created_by         BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    approved_by        BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
    approved_at        TIMESTAMPTZ,
    rejection_note     TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, number)
);

-- CLOs apply to a course, not a section: every section teaching the same
-- course shares its CLOs and its blueprint. This matches the prototype's
-- behaviour and is what makes cross-section comparison meaningful.
COMMENT ON TABLE clo IS
  'Course-level learning outcomes. Owned by the authoring instructor, '
  'approved by admin/HOD. Shared by all sections of the course.';

-- CLO → PLO is genuinely many-to-many. `weight` (1 = slight, 2 = moderate,
-- 3 = substantial) drives how a CLO result rolls up into each PLO.
CREATE TABLE clo_plo_mapping (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clo_id    BIGINT NOT NULL REFERENCES clo(id) ON DELETE CASCADE,
    plo_id    BIGINT NOT NULL REFERENCES plo(id) ON DELETE CASCADE,
    weight    SMALLINT NOT NULL DEFAULT 3 CHECK (weight BETWEEN 1 AND 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clo_id, plo_id)
);

CREATE INDEX clo_plo_plo ON clo_plo_mapping (plo_id);
```

```sql
-- =====================================================================
--  D. Assessment blueprint and marks
-- =====================================================================
CREATE TABLE blueprint_component (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id     UUID   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    clo_id        BIGINT NOT NULL REFERENCES clo(id) ON DELETE CASCADE,
    -- Denormalised from clo.course_id so the "one Mid / one Final / one
    -- Project per course" rule can be a plain partial unique index: an
    -- index expression may only use IMMUTABLE functions, and a lookup
    -- into `clo` is not immutable. Kept in step by a trigger.
    course_id     BIGINT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    exam_type     TEXT   NOT NULL
                  CHECK (exam_type IN ('Assignment','Quiz','Mid Exam','Project','Final Exam')),
    component_id  TEXT   NOT NULL,                    -- 'A1', 'Q3', 'M1', 'P1', 'F1'
    max_marks     NUMERIC(6,2) NOT NULL CHECK (max_marks > 0),
    is_kpi        BOOLEAN NOT NULL DEFAULT FALSE,
    is_fixed      BOOLEAN NOT NULL DEFAULT FALSE,     -- Mid and Final cannot be removed
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The blueprint spans a whole course, so the component label must be
    -- unique across every CLO of that course, not merely within one CLO.
    UNIQUE (course_id, component_id)
);

CREATE INDEX blueprint_component_clo ON blueprint_component (clo_id);

CREATE FUNCTION sync_blueprint_component_course() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    SELECT course_id INTO NEW.course_id FROM clo WHERE id = NEW.clo_id;
    IF NEW.course_id IS NULL THEN
        RAISE EXCEPTION 'blueprint component references a non-existent CLO %', NEW.clo_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER blueprint_component_sync_course
    BEFORE INSERT OR UPDATE OF clo_id ON blueprint_component
    FOR EACH ROW EXECUTE FUNCTION sync_blueprint_component_course();

-- Exactly one Mid Exam and one Final Exam per course, and at most one
-- Project -- the prototype's rules, enforced by the database.
CREATE UNIQUE INDEX blueprint_one_fixed_exam_per_course
    ON blueprint_component (course_id, exam_type)
    WHERE exam_type IN ('Mid Exam','Final Exam','Project');

CREATE TABLE student_mark (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id   BIGINT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    component_id BIGINT NOT NULL REFERENCES blueprint_component(id) ON DELETE CASCADE,
    section_id   BIGINT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
    marks        NUMERIC(6,2) NOT NULL CHECK (marks >= 0),
    entered_by   BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    entered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_id, component_id, section_id)
);

-- Marks cannot exceed the component's max: a trigger, since a CHECK
-- constraint cannot reference another table.
CREATE FUNCTION assert_marks_within_max() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_max NUMERIC;
BEGIN
    SELECT max_marks INTO v_max FROM blueprint_component WHERE id = NEW.component_id;
    IF NEW.marks > v_max THEN
        RAISE EXCEPTION 'marks % exceed component maximum %', NEW.marks, v_max
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER student_mark_within_max
    BEFORE INSERT OR UPDATE ON student_mark
    FOR EACH ROW EXECUTE FUNCTION assert_marks_within_max();

-- Marks are write-heavy and always read by section. A covering index
-- keeps the grading-sheet and attainment queries off the heap.
CREATE INDEX student_mark_section_component
    ON student_mark (section_id, component_id) INCLUDE (student_id, marks);
```

```sql
-- =====================================================================
--  E. Grading sheet lifecycle
-- =====================================================================
-- The prototype keeps this as a loose `{ [sectionId]: 'draft'|'finalized' }`
-- map in localStorage. In the real system it is a record with an owner,
-- a sign-off and an immutable snapshot of what was approved.
CREATE TABLE grading_sheet (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id       UUID   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    section_id      BIGINT NOT NULL REFERENCES section(id) ON DELETE RESTRICT,
    status          TEXT   NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','submitted','finalized','reopened')),
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_by    BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
    finalized_at    TIMESTAMPTZ,
    reopened_by     BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
    reopened_at     TIMESTAMPTZ,
    reopen_reason   TEXT,
    pdf_object_key  TEXT,                             -- archived copy in object storage
    pdf_sha256      TEXT,
    CONSTRAINT grading_sheet_finalized_fields CHECK (
        (status = 'finalized') = (finalized_at IS NOT NULL)
    )
);

-- One live sheet per section. Reopening keeps the previous row as history.
CREATE UNIQUE INDEX grading_sheet_one_live ON grading_sheet (section_id)
    WHERE status <> 'reopened';
```

```sql
-- =====================================================================
--  F. Computed attainment
-- =====================================================================
-- Attainment is materialised rather than computed on read, because it is
-- queried constantly (dashboards, reports, accreditation exports) and it
-- must be frozen at the moment a sheet is finalised for audit purposes.
CREATE TABLE attainment_run (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    section_id     BIGINT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
    grading_sheet_id BIGINT REFERENCES grading_sheet(id) ON DELETE SET NULL,
    engine_version TEXT   NOT NULL,                   -- 'attain-v1'
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    computed_by    BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
    is_frozen      BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE once the sheet is finalised
    UNIQUE (section_id, engine_version, computed_at)
);

CREATE TABLE attainment_result (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id         BIGINT NOT NULL REFERENCES attainment_run(id) ON DELETE CASCADE,
    scope          TEXT   NOT NULL CHECK (scope IN ('CLO','PLO')),
    clo_id         BIGINT REFERENCES clo(id) ON DELETE CASCADE,
    plo_id         BIGINT REFERENCES plo(id) ON DELETE CASCADE,
    cohort_size    INTEGER NOT NULL,
    attained_count INTEGER NOT NULL,
    mean_score     NUMERIC(5,2) NOT NULL,             -- average % across the cohort
    attainment_pct NUMERIC(5,2) NOT NULL,             -- attained_count / cohort_size × 100
    target_pct     NUMERIC(5,2) NOT NULL,
    status         TEXT   NOT NULL CHECK (status IN ('met','not_met','at_risk')),
    CONSTRAINT attainment_scope_target CHECK (
        (scope = 'CLO' AND clo_id IS NOT NULL AND plo_id IS NULL) OR
        (scope = 'PLO' AND plo_id IS NOT NULL AND clo_id IS NULL)
    )
);

CREATE INDEX attainment_result_run ON attainment_result (run_id, scope);
CREATE INDEX attainment_result_gap ON attainment_result (plo_id, attainment_pct)
    WHERE status <> 'met';
```

```sql
-- =====================================================================
--  G. Evidence, audit, notifications
-- =====================================================================
CREATE TABLE document (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id     UUID   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    course_id     BIGINT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    section_id    BIGINT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
    category      TEXT   NOT NULL,                    -- 'Assignment - Best', 'Course Outline', …
    object_key    TEXT   NOT NULL UNIQUE,             -- never store bytes in the DB
    filename      TEXT   NOT NULL,
    mime_type     TEXT   NOT NULL,
    size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256        TEXT   NOT NULL,                    -- integrity + de-duplication
    uploaded_by   BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_archived   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX document_section_category ON document (section_id, category)
    WHERE NOT is_archived;

CREATE TABLE audit_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type  TEXT   NOT NULL,                     -- 'Blueprint', 'CLO', 'Marks', …
    entity_id    BIGINT NOT NULL,
    action       TEXT   NOT NULL
                 CHECK (action IN ('INSERT','UPDATE','DELETE','APPROVE','REJECT',
                                   'FINALIZE','REOPEN','LOGIN','LOGIN_FAILED','EXPORT')),
    actor_id     BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
    actor_email  TEXT,                                -- denormalised: survives user deletion
    ip           INET,
    user_agent   TEXT,
    before_data  JSONB,
    after_data   JSONB,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_hash    TEXT,                                -- hash chain (§7.3)
    row_hash     TEXT NOT NULL
);

CREATE INDEX audit_log_entity  ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_actor   ON audit_log (actor_id, occurred_at DESC);
CREATE INDEX audit_log_time    ON audit_log (occurred_at DESC);

CREATE TABLE notification (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    message    TEXT   NOT NULL,
    link       TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notification_unread ON notification (user_id, created_at DESC)
    WHERE NOT is_read;
```

### 4.3 Constraint-to-prototype-rule traceability

Every rule the prototype enforces in JavaScript is enforced again — authoritatively — in the database. The service layer repeats the check only to produce a friendly message instead of a 500.

| Prototype rule | Where it lives now |
|---|---|
| `CATEGORY_WEIGHTS` = Assignment 15 / Quiz 15 / Mid 25 / Project 15 / Final 30 | `BlueprintService` (§6.1) — a config table is overkill; the values are institutional policy and change once a decade |
| Project's 15% redistributed evenly when absent | `computeCategoryShares()` in `BlueprintService` |
| Exactly one Mid Exam and one Final Exam | Partial unique index `blueprint_one_fixed_exam_per_course` |
| At most one Project | Same index |
| Minimum 4 Assignments and 4 Quizzes | `BLUEPRINT_MIN`, enforced in `normalizeCourseBlueprint()`; the count is checked at delete time exactly as `Blueprint.jsx:93` does |
| Weights always total exactly 100% | `applyDerivedWeights()` — last component of each category absorbs the rounding remainder |
| Marks ≤ component max, marks ≥ 0 | `CHECK (marks >= 0)` + `assert_marks_within_max()` trigger |
| Fixed components cannot be deleted | `is_fixed` + `BLUEPRINT_FIXED` check in `BlueprintService.remove()` |
| CLO approval is pending → approved/rejected by admin | `clo.approval_status` + `AuditService` recording `APPROVE`/`REJECT` |
| Grading sheet is draft until finalized | `grading_sheet.status` state machine (§6.4) |
| One active session | Partial unique index `semester_one_active` |

---

## 5. REST API surface

Conventions:

* Base path `/api/v1`. Breaking changes go to `/api/v2`, never into `/v1`.
* All responses are JSON envelopes: `{ "data": …, "meta": { "requestId", "page", "total" } }`; errors are `{ "error": { "code", "message", "details" } }`.
* `POST` returns `201` with a `Location` header. `DELETE` returns `204`.
* Collections support `?page=&limit=&sort=&q=` and, where noted, resource-specific filters.
* Idempotency: `PUT` is a full replace, `PATCH` is a partial merge, and blueprints/marks accept an `Idempotency-Key` header so a retried save cannot double-insert.
* `Idempotency-Key` responses are cached for 24 h.

### 5.1 Authentication

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/auth/login` | public | Email + password → access token (15 min) + refresh token (7 d). Rate-limited to 5 attempts / 15 min / IP, then exponential lock-out recorded in `app_user.locked_until`. |
| `POST` | `/auth/refresh` | public | Rotating refresh: the presented token is revoked and a new pair issued. Reuse of a revoked token revokes the whole family and forces re-login. |
| `POST` | `/auth/logout` | any | Revokes the presented refresh token. |
| `GET` | `/auth/me` | any | Current user, role, department, and the **permission set** the client uses to gate UI. |
| `POST` | `/auth/password` | any | Change own password; requires the current password. |

### 5.2 Academic structure (admin / hod)

All of the following are standard CRUD (`GET` list, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id`), admin-writable and instructor-readable:

| Resource | Path | Notes |
|---|---|---|
| Departments | `/departments` | Delete refused (409) while programmes reference it |
| Programmes | `/programs` | `?departmentId=` |
| Sessions | `/semesters` | `?active=true`; activating one deactivates the rest in the same transaction |
| Courses | `/courses` | `?programId=&semesterId=` |
| Sections | `/sections` | `?courseId=&semesterId=&instructorId=`; assigning `instructor_id` is what grants that instructor visibility |
| Users | `/users` | `?role=&departmentId=`; password never returned |
| Students | `/students` | `?programId=&batch=&sectionId=` |
| Enrolments | `/sections/:id/enrollments` | Bulk `POST` with a roll-number array; `DELETE /enrollments/:id` marks `dropped` rather than deleting |

### 5.3 Outcomes

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/plos?programId=` | any | PLO register (includes `target_attainment`) |
| `POST` `PATCH` `DELETE` | `/plos[/:id]` | admin, hod | Manage PLOs |
| `GET` | `/clos?courseId=&approvalStatus=` | any (filtered) | Instructors see their own; admin/hod see all |
| `POST` | `/clos` | instructor | Creates with `approval_status = 'pending'` |
| `PATCH` | `/clos/:id` | owner | Any edit resets the status to `pending` — an approved CLO that changes must be re-approved |
| `POST` | `/clos/:id/approve` | admin, hod | `{ decision: 'approved'\|'rejected', note? }`; writes an audit row |
| `GET` `PUT` | `/clos/:id/mappings` | any / owner | The CLO→PLO mapping set with weights |

### 5.4 Blueprint

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/courses/:id/blueprint` | any | Components grouped by `exam_type`, each with its **derived** `weight_pct` and a `total` of exactly 100 |
| `POST` | `/courses/:id/blueprint/components` | owner instructor | Add Assignment / Quiz / Project. Mid and Final are created automatically |
| `PATCH` | `/blueprint/components/:id` | owner | Change mapped CLO, max marks, KPI flag |
| `DELETE` | `/blueprint/components/:id` | owner | Refused for `is_fixed`, and refused when it would drop a category below its minimum (409 with the rule in `details`) |
| `POST` | `/courses/:id/blueprint/normalise` | owner | Re-applies the full rule set — the server calls this inside every write, so it is exposed only for repair/recovery |

> **Weight derivation is a server responsibility, never a client one.** The client may display weights and simulate a local edit for responsiveness, but the value persisted is whatever the server derives. This is the single most important behaviour to keep authoritative, because it is the number accreditation reviewers check.

### 5.5 Marks and grading

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/sections/:id/marks` | instructor (own), admin | Full grid: students × components, ready for the marks-entry table |
| `PUT` | `/sections/:id/marks` | instructor (own) | Bulk upsert of `[{ studentId, componentId, marks }]` in one transaction. Rejected with `409 sheet_finalized` if the sheet is not `draft` |
| `POST` | `/sections/:id/marks/import` | instructor | CSV import; returns a per-row validation report rather than failing atomically |
| `GET` | `/sections/:id/marks/export.csv` | instructor, admin | Round-trip format for the import |
| `POST` | `/sections/:id/grading-sheet/finalize` | instructor (own) | `draft → finalized`; freezes the attainment run and renders the archival PDF |
| `POST` | `/sections/:id/grading-sheet/reopen` | admin, hod | `finalized → reopened`, `{ reason }` required; writes an audit row |
| `GET` | `/sections/:id/grading-sheet.pdf` | any permitted | Streams the archived PDF (identical bytes to the one signed off) |

### 5.6 Attainment and reporting

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/sections/:id/attainment` | instructor (own), admin | CLO + PLO attainment for the section; `?recompute=true` forces a fresh run |
| `GET` | `/courses/:id/attainment?semesterId=` | admin, hod, coordinator | Cross-section comparison for one course |
| `GET` | `/programs/:id/attainment?from=&to=` | admin, hod, coordinator | Programme-level PLO roll-up across all courses and sessions — the accreditation number |
| `GET` | `/dashboard/summary` | any | KPI tiles: sections in flight, sheets finalised, CLOs approved, PLOs below target |
| `GET` | `/reports/gap-analysis?programId=&semesterId=` | admin, hod | Every PLO below target with the contributing CLOs ranked by shortfall |
| `GET` | `/reports/accreditation-pack?programId=&semesterId=` | admin, hod | Zip: PLO/CLO attainment tables, mapping matrix, evidence index with checksums, grading-sheet PDFs |

### 5.7 Evidence, audit and notifications

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/sections/:id/documents` | instructor (own) | Request a signed upload URL; the client PUTs the bytes directly to object storage, then confirms with `POST /documents/:id/complete` so the server can verify size and checksum |
| `GET` | `/sections/:id/documents?category=` | any permitted | Metadata list + short-lived signed download URL per file |
| `DELETE` | `/documents/:id` | instructor (own), admin | Soft archive |
| `GET` | `/audit?entityType=&entityId=&actorId=&from=&to=` | admin, hod | Paginated audit trail |
| `GET` | `/audit/verify` | admin | Walks the hash chain and reports the first broken link |
| `GET` `PATCH` | `/notifications[/:id]` | any | Own notifications only; `PATCH` marks read |

### 5.8 HTTP status conventions

| Status | Meaning in this API |
|---|---|
| `400` | Malformed request (schema validation failed; `details` lists the failing fields) |
| `401` | Missing, expired or malformed access token |
| `403` | Authenticated, but the role or ownership check failed |
| `404` | Not found **or** not visible to the caller — the same response either way, so IDs cannot be probed |
| `409` | Domain conflict: min component count, finalized sheet, duplicate roll number, referenced record |
| `422` | Semantically invalid but well-formed: marks above max, CLO mapping to a PLO of another programme |
| `423` | Locked: the section's sheet is finalised |
| `429` | Rate limit exceeded; `Retry-After` set |

---

## 6. Domain services and algorithms

### 6.1 BlueprintService — derived weights

Ported verbatim from the prototype's `src/data/store.js`, which is the reviewed specification.

**Category shares.** Fixed policy values:

| Category | Share of 100% |
|---|---|
| Assignment | 15 |
| Quiz | 15 |
| Mid Exam | 25 |
| Project | 15 |
| Final Exam | 30 |

When a course has **no** Project, its 15% is redistributed **evenly** across the four remaining categories (+3.75 each), so the total stays at 100%:

```
Assignment 18.75 · Quiz 18.75 · Mid Exam 28.75 · Final Exam 33.75
```

**Per-component weight.** Within each category, `per = round1(share / count)`, and the **last component absorbs the remainder** (`share − per × (count − 1)`) so the category sums to exactly its share and the blueprint sums to exactly 100.0. Rounding to one decimal place happens at each step; this is deliberate and matches what the client has already seen.

**Normalisation.** `normalizeCourseBlueprint()` runs inside every blueprint write:

1. Collapse duplicate Mid Exams / Final Exams down to one, and mark both `is_fixed = true`.
2. Create a missing Mid or Final Exam mapped to the course's first CLO, with `max_marks` from the category default table.
3. Collapse multiple Projects down to one (Project is optional, so it is never created automatically).
4. Top up Assignments and Quizzes to their minimum of 4 each.
5. Re-derive weights across the resulting set.

**Component labels** are generated as `<prefix><n>` where the prefix is `A`, `Q`, `M`, `P`, `F` by category and `n` is the lowest unused positive integer within the course — never reused after a delete, so a label always refers to the same assessment in historical records.

**Default max marks:** Assignment 20 · Quiz 10 · Mid Exam 30 · Project 50 · Final Exam 50. These are defaults for newly created components only; an instructor may override at creation, and the override is what the marks grid validates against.

### 6.2 AttainmentService — the computation

Implemented as a set of SQL statements inside one transaction, exposed to the application as `computeSectionAttainment(sectionId, engineVersion)`.

**Notation.** For section *S*, student *s*, blueprint component *c*, CLO *k*, PLO *p*:

* `m(s,c)` — raw marks from `student_mark`
* `M(c)` — `blueprint_component.max_marks`
* `w(c)` — the derived weight from §6.1
* `C(k)` — the set of components mapped to CLO *k*
* `t(k)` — `clo.passing_threshold`
* `T(p)` — `plo.target_attainment`
* `W(k,p)` — `clo_plo_mapping.weight` (1–3)

**Step 1 — component percentage.** Normalise each mark onto a 0–100 scale so components with different maxima are comparable:

```
score(s,c) = 100 × m(s,c) / M(c)
```

**Step 2 — student CLO score.** Weighted mean **within** the CLO, using the components' own weights renormalised so the CLO's members sum to 100%:

```
cloScore(s,k) = Σ_{c ∈ C(k)} score(s,c) · w(c)
                ─────────────────────────────────
                      Σ_{c ∈ C(k)} w(c)
```

Renormalising inside the CLO is essential: without it, a CLO assessed by three components would be scored on a different scale from one assessed by five, and the two would not be comparable.

**Step 3 — CLO attainment.** Two metrics, both reported, because accreditation bodies ask for different ones:

```
mean(k)        = mean over all enrolled students of cloScore(s,k)
attained(k)    = |{ s : cloScore(s,k) ≥ t(k) }|
attainment(k)  = 100 × attained(k) / cohort
```

*Primary metric* is `attainment(k)` — the share of students who met the threshold. `mean(k)` is reported alongside as the severity indicator: a CLO at 70% attainment with a 30% mean is a different problem from one at 70% with a 68% mean.

Students with **no marks at all** for a CLO are excluded from that CLO's cohort and the exclusion count is recorded, so an incomplete marks grid cannot silently depress attainment. A CLO with a cohort below a configurable minimum (default 5) is flagged `insufficient_data` rather than reported as met or not met.

**Step 4 — PLO attainment.** A CLO can serve several PLOs; the contribution is weighted by the mapping strength. Because different CLOs come from courses with different cohort sizes, the roll-up weights by cohort too, so a 100-student course does not get drowned by a 12-student elective:

```
ploAttainment(p) = Σ_{k → p} attainment(k) · W(k,p) · cohort(k)
                   ─────────────────────────────────────────────
                          Σ_{k → p} W(k,p) · cohort(k)
```

When rolling up to a **programme** PLO across many courses and sessions, the same formula is applied over every CLO in the window that maps to *p* — this is the number that answers "is the programme producing graduates who meet PLO-3?".

**Step 5 — decision.** Compare against target with a dead-band, so a result sitting exactly on the line is not reported as a failure:

| Condition | Status |
|---|---|
| `attainment ≥ target` | `met` |
| `target − 5 ≤ attainment < target` | `at_risk` |
| `attainment < target − 5` | `not_met` |
| cohort below minimum, or no data | `insufficient_data` |

The 5-point band is configurable per programme. Gaps (`not_met`) are what the gap-analysis report ranks, and what the continuous-improvement loop acts on in the next cycle.

**Worked example.** A course with 4 Assignments (18.75% total), 4 Quizzes (18.75%), one Mid (28.75%), no Project, one Final (33.75%). Suppose CLO-2 is assessed by `A2`, `Q2` and `M1`, with weights 4.7%, 4.7% and 28.75% respectively. A student scoring 18/20, 7/10 and 21/30 has `score` values of 90, 70 and 70, and a CLO score of

```
(90×4.7 + 70×4.7 + 70×28.75) / (4.7 + 4.7 + 28.75)
= (423 + 329 + 2012.5) / 38.15
= 72.5%
```

— comfortably above a 50% threshold. Substitute a class mean and the same arithmetic yields the CLO attainment figure.

### 6.3 Frozen runs

Every computation writes an `attainment_run` row plus its `attainment_result` children. When a grading sheet is finalised, the run's `is_frozen` becomes `TRUE` and it is never recomputed. This matters for accreditation: an evidence pack produced in 2026 must show the numbers as they were signed off, even if a mark is corrected in 2027. A correction reopens the sheet, which creates a *new* run — the historical one survives with a `reopened_at` marker on the sheet.

### 6.4 Grading sheet lifecycle

```
        ┌────────────────────────────────────────────────────┐
        │                                                    │
   ┌────▼─────┐  instructor submits   ┌───────────┐  approves │
   │  draft   │──────────────────────▶│ submitted │───────────┤
   └────┬─────┘                       └─────┬─────┘           │
        │  marks editable                   │ rejects         │
        │                                   ▼                 │
        │                            (back to draft)          │
        │  instructor finalises                              │
        ▼                                                    │
   ┌───────────┐   admin/HOD reopens (reason required)       │
   │ finalized │──────────────────────────────────────────────┘
   └───────────┘   attainment run frozen · PDF archived
                   marks immutable (HTTP 423)
```

* `draft` — marks freely editable by the owning instructor; attainment recomputed on demand and cached but not frozen.
* `submitted` — the instructor asserts the grid is complete; optional in a single-approver institution and enabled by configuration.
* `finalized` — immutable. `student_mark` writes for that section are refused by a trigger, the attainment run is frozen, and the PDF is rendered and stored with its SHA-256.
* `reopened` — the previous row is retired to history and a fresh `draft` sheet is created, preserving the audit story of who reopened what, when and why.

### 6.5 Role-based access control

Enforced by an `authorize(...)` middleware composed of three independent checks:

1. **Role** — does the user's role appear in the route's allowed set?
2. **Scope** — is the *specific* record within the user's reach? (An instructor owns sections where `instructor_id = user.id`; a HOD owns the programmes of their department; a coordinator owns a named programme.)
3. **State** — is the action legal in the record's current state? (Marks entry is refused when the sheet is finalised.)

```js
// Illustrative composition — ownership is resolved by a loader that has
// already fetched the record, so the scope rule cannot be bypassed by
// passing a different id in the body.
router.put(
  "/sections/:id/marks",
  authenticate,
  authorize.role("instructor", "admin"),
  loadSection,                                // attaches req.section or 404s
  authorize.ownsSection("instructor"),        // 403 unless instructor_id matches
  authorize.sheetIsDraft(),                   // 423 if finalised
  validate(marksBulkSchema),
  marksController.bulkUpsert
);
```

**Permission matrix:**

| Capability | admin | hod | instructor | coordinator | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| Manage departments / programmes / sessions | ✔ | dept | — | — | — |
| Manage courses and sections | ✔ | dept | — | — | — |
| Assign sections to instructors | ✔ | dept | — | — | — |
| Manage users | ✔ | dept | — | — | — |
| Manage students and enrolments | ✔ | dept | own sections | — | — |
| Manage PLOs | ✔ | dept | — | — | — |
| Author / edit CLOs | ✔ | — | own courses | — | — |
| Approve / reject CLOs | ✔ | dept | — | — | — |
| Edit the assessment blueprint | ✔ | — | own courses | — | — |
| Enter / import marks | ✔ | — | own sections (draft) | — | — |
| Finalise a grading sheet | ✔ | — | own sections | — | — |
| Reopen a finalised sheet | ✔ | dept | — | — | — |
| Upload evidence | ✔ | — | own sections | — | — |
| View attainment | ✔ | dept | own sections | own programme | read-only, all |
| View audit log | ✔ | dept | own actions | — | — |
| Export accreditation pack | ✔ | dept | — | own programme | — |

The client fetches `/auth/me` on load and uses the returned permission set to hide actions — but every hidden action is *also* refused by the server. The UI hiding is a convenience, never the control.

---

## 7. Cross-cutting concerns

### 7.1 Authentication and session security

* **Passwords** — Argon2id, `m=19456 KiB, t=2, p=1` (OWASP baseline). Minimum 12 characters, checked against a breached-password list. The prototype ships `demo123` for every seed user; that column does not exist in the real schema.
* **Access token** — JWT, HS256 (or RS256 once more than one service verifies it), 15-minute lifetime, claims `sub`, `role`, `dept`, `iat`, `exp`, `jti`. Never contains anything sensitive; it is signed, not encrypted.
* **Refresh token** — opaque 256-bit random value, stored only as a SHA-256 hash, 7-day lifetime, rotated on every use. Presenting a revoked token is treated as theft: the entire token family for that user is revoked and an alert is raised.
* **Transport** — HTTPS only; HSTS with a one-year max-age; cookies are not used for the API (bearer header instead), so CSRF is structurally absent for the JSON API.
* **Brute force** — 5 failed logins locks the account for a growing window (1, 5, 15, 60 minutes); every attempt is audited with the real IP.

### 7.2 Input validation and injection defence

* Every request body and query string is parsed by a **zod** schema at the route boundary. Unknown keys are stripped, not passed through.
* All SQL uses parameterised statements — string concatenation into SQL is prohibited and enforced by a lint rule.
* File uploads declare their own MIME and extension; the server sniffs the actual bytes, rejects anything that does not match, and caps size by category (evidence scans 25 MB, outlines 10 MB). Files are never served from the API origin — signed URLs point at object storage with a `Content-Disposition: attachment` header, so an uploaded HTML or SVG file cannot execute in a user's session.
* The SPA sets a strict Content-Security-Policy with no `unsafe-inline`; the API sends `helmet` defaults plus CORS restricted to the deployed origin.

### 7.3 Audit trail

`AuditService.record()` is called by a **database trigger** on every audited table, not by controllers — so a new code path added later cannot forget to log. Each row stores the actor, real IP, user agent, and a JSONB before/after diff.

Rows are chained: `row_hash = sha256(prev_hash ‖ canonical_json(row without row_hash))`. `GET /audit/verify` walks the chain and reports the first break, which makes a silent edit or deletion of history detectable. The table is append-only: `UPDATE` and `DELETE` are revoked from the application role, and a trigger raises on either.

**Retention:** minimum 7 years, aligned to a PEC/ABET accreditation cycle. Logs are exported monthly to WORM storage as a second copy.

### 7.4 Performance

| Concern | Approach |
|---|---|
| Marks grid (200 students × 20 components = 4 000 cells) | Single indexed query per section; the covering index `student_mark_section_component` means no heap fetch. Response under 100 ms. |
| Bulk mark save | One `INSERT … ON CONFLICT (student_id, component_id, section_id) DO UPDATE` per request, inside a transaction, capped at 2 000 rows |
| Attainment recomputation | Set-based SQL, one pass per level. A 200-student section with 20 components and 6 CLOs computes in well under a second; the dashboard reads the materialised `attainment_result` instead of recomputing |
| Programme-level roll-up | Materialised on finalise and refreshed nightly; a covering index on `(plo_id, attainment_pct)` serves the gap report |
| Dashboard | Pre-aggregated in the nightly job and cached with a short TTL; the endpoint never scans `student_mark` |
| Connection pool | `pg` pool sized `2 × vCPU + 1` per API container, with `statement_timeout = 30s` and `idle_in_transaction_session_timeout = 60s` so a stuck transaction cannot pin a connection |
| Large exports | Streamed, not buffered — an accreditation pack for a whole programme can exceed 500 MB |

### 7.5 Reliability and operations

* **Health** — `GET /healthz` (liveness, no dependencies) and `GET /readyz` (checks the pool, and object storage).
* **Structured logs** — JSON per request: `requestId`, `userId`, `route`, `status`, `durationMs`. The `requestId` is echoed in every error response so a user-reported problem maps to a log line.
* **Migrations** — versioned SQL files applied by a migration runner on boot; forward-only, with a tested `down` for each step. Schema changes never run automatically in production without a reviewed plan.
* **Backups** — nightly `pg_dump` + continuous WAL archiving (RPO ≈ 5 minutes, RTO ≈ 1 hour). Restores are rehearsed quarterly; an untested backup is not a backup.
* **Configuration** — environment variables, validated at boot against a schema, with the process refusing to start on a missing secret. No credentials in the repository.

---

## 8. Non-functional requirements

| Category | Requirement |
|---|---|
| Users | 200 concurrent, 2 000 registered |
| Data volume | 5 000 students, 1 500 sections, 10 M marks rows over 5 years |
| Response time | p95 < 300 ms for all read endpoints; < 1 s for a section attainment recomputation |
| Availability | 99.5% during term (academic hours), 99% otherwise; maintenance window outside 08:00–20:00 local |
| Browser support | Current Chrome, Edge, Firefox, Safari; 1366 × 768 minimum viewport; print layout tested on A4 and Letter |
| Accessibility | WCAG 2.1 AA — keyboard-navigable marks grid, labelled inputs, 4.5:1 contrast; the poster palette's dark green on white already exceeds this |
| Localisation | English (UI and documents); schema supports adding locale-keyed outcome text later without migration |
| Auditability | Every create/update/delete/approve/finalize reconstructible from `audit_log` alone |

---

## 9. Implementation roadmap

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Repo restructure: `apps/web` (existing SPA) + `apps/api` + `packages/shared` (zod schemas, types, the blueprint weight functions used by both) | — |
| 1 | Schema migration, seed script derived from `src/data/mockData.js`, migration runner, CI with a Postgres service container | 0 |
| 2 | Auth: login, refresh rotation, `/auth/me` permission set, lock-out, audit on login | 1 |
| 3 | Academic structure CRUD endpoints + swap `useLocalState` for API hooks on those pages | 2 |
| 4 | CLO authoring, CLO→PLO mappings, approval workflow | 3 |
| 5 | BlueprintService — port `computeCategoryShares`, `applyDerivedWeights`, `normalizeCourseBlueprint`, `nextComponentId` into `packages/shared`, with the prototype's behaviour as the test oracle | 3 |
| 6 | Marks endpoints, CSV import/export, marks-entry page on the API | 4, 5 |
| 7 | AttainmentService, materialised runs, dashboard and reports endpoints | 6 |
| 8 | Grading sheet lifecycle, server-side PDF rendering, archival | 6 |
| 9 | Evidence upload via signed URLs, checksum verification | 3 |
| 10 | Audit triggers, hash chain, verification endpoint, audit UI | 1 |
| 11 | Hardening: rate limits, CSP, penetration test, restore rehearsal, load test | all |
| 12 | Decommission the prototype's `localStorage` path; keep `mockData.js` as the seed fixture for tests | 11 |

**Migration strategy for existing prototype data.** Institutions piloting on the prototype will have real blueprints and marks in `localStorage`. Phase 1 therefore ships an export (browser → JSON) plus an importer (`POST /admin/import/prototype`) that maps the prototype's flat shape onto the normalised schema, creating `student` rows from the distinct `roll_no` values in `obe_students` and `enrollment` rows from their `section_id`. The `obe_prototype_data_version` string becomes the import manifest's version field, so a second import is refused rather than duplicating.

---

## 10. Traceability: prototype screen → real system

| Prototype file | Real-system counterpart |
|---|---|
| `src/pages/Login.jsx`, `src/data/auth.js` | `POST /auth/login`, JWT + refresh, `/auth/me` |
| `src/pages/Dashboard.jsx` | `GET /dashboard/summary` + materialised attainment |
| `src/pages/Departments.jsx`, `Programs.jsx`, `Semesters.jsx`, `Courses.jsx`, `Sections.jsx`, `Teachers.jsx` | `/departments`, `/programs`, `/semesters`, `/courses`, `/sections`, `/users` |
| `src/pages/PLOs.jsx`, `CLOs.jsx` | `/plos`, `/clos`, `/clos/:id/approve`, `/clos/:id/mappings` |
| `src/pages/Blueprint.jsx` | `/courses/:id/blueprint/*` + `BlueprintService` |
| `src/pages/MarksEntry.jsx` | `PUT /sections/:id/marks` + CSV import/export |
| `src/pages/Reports.jsx` | `grading_sheet` lifecycle, `/grading-sheet.pdf` |
| `src/pages/Documents.jsx` | `document` table + signed-URL upload |
| `src/pages/AuditLog.jsx` | `audit_log` + `/audit`, `/audit/verify` |
| `src/data/store.js` | `BlueprintService`, `AttainmentService`, `AuditService` |
| `src/hooks/useWorkflow.js` | Section scoping enforced server-side by `authorize.ownsSection()` |
| `src/hooks/usePermissions.js` | `/auth/me` permission set + RBAC middleware |
| `src/data/mockData.js` | Seed fixture and test oracle |

---

## 11. Open questions for the institutional stakeholders

These are decisions the design cannot make on its own; the defaults above are what the system ships with until each is answered.

1. **PLO target and measurement window.** Is a PLO judged per session, per academic year, or per graduating cohort? The schema supports all three; the dashboard must pick one as its headline.
2. **Attainment threshold semantics.** Is a CLO "attained" when the *class average* clears the threshold, or when a *majority of students* do? This design reports both and treats the second as primary, per common PEC practice — confirm against the institution's accreditation guidance.
3. **CLO approval authority.** Single admin approver, or a departmental committee? The `approval_status` column supports one approver today; a committee needs an approval-step table.
4. **Evidence retention.** How long must a Best/Average/Worst sample set be kept after the accreditation visit closes?
5. **Cross-listing.** Can a course be taught to two programmes at once? If so, PLO roll-up must attribute the CLO attainment to both programmes, which changes the programme-level query.
