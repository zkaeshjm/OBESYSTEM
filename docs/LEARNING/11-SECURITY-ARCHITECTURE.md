# Security Architecture and Review Map

This is a learning map of protections visible in the current code. It is not a claim that a production penetration test has been
performed.

## 1. Input validation

- Zod validates JSON bodies, route parameters and query strings (`server/src/middleware/validate.ts`).
- Schemas constrain enums, UUIDs, lengths, numbers, dates and URLs.
- Assessment validation checks item/CLO course ownership and rubric totals (`assessments.ts:69-104`).
- The server repeats critical validation even when the React form already validates, because clients are untrusted.

## 2. Broken access control and IDOR

The main defense is resource-level authorization, not obscurity of UUIDs:

- Tutors can only manage assigned offerings.
- Students can only view enrolled offerings and their own submissions.
- Tutor course visibility is computed from offerings, not a client-supplied role flag.
- PLO drill-down filters both run contributions and mapped CLOs by tutor/student scope.
- Measurement-criteria reads check student enrollment and tutor course authorship.

Tests to study: `server/tests/rbac.test.ts`, `server/tests/tutor-panel.test.ts` and the direct URL rejection in
`e2e/tutor-panel-complete.spec.ts`.

## 3. Passwords and sessions

- Passwords are bcrypt hashes; plaintext passwords are not stored.
- Login rate limiting and failed-login lockouts limit online guessing.
- JWT access tokens have issuer/audience and expiry validation.
- Refresh tokens are random, stored only as SHA-256 hashes, rotated on use and revoked on password/logout.
- Refresh cookie is `httpOnly`, `sameSite=lax`, path-limited and optionally secure.

## 4. HTTP/browser protections

`server/src/app.ts:63-97` configures Helmet, CORS, compression, cookie parsing, body limits and rate limiting. CORS accepts only
configured origins and credentials are explicit. Request logging intentionally omits authorization and cookies (`app.ts:41-50`).

## 5. Evidence and integrity protections

- Published assessments are retained and cannot be deleted.
- Closed/archived records preserve evidence.
- Regrading a published result requires a reason and creates `GradeChange` history.
- Attainment runs store engine version, policy version, policy snapshot and evidence JSON.
- Frozen runs prevent later mapping changes that would alter accreditation evidence.
- Measurement criteria are superseded rather than destroyed.
- Audit rows record consequential actions, actor and request metadata.

## 6. File/material boundaries

The current material feature stores controlled `http(s)` URLs (`materials.ts:16-25`); it does not accept arbitrary local paths or binary
uploads. Assessment submission attachments are also validated as URLs. The target `SYSTEM_DESIGN.md` describes future object storage;
that is not implemented in this current source.

## 7. Threat-learning checklist

| Threat | Current relevant defense | File to study |
|---|---|---|
| SQL injection | Prisma parameterized queries and schema validation | route files, `prisma/schema.prisma` |
| XSS | React escaping; no raw HTML renderer in inspected pages | React pages |
| CSRF | httpOnly same-site refresh cookie plus bearer access token | `tokens.ts`, `client.ts` |
| IDOR | ownership/enrollment helper checks | `authorization.ts` |
| Brute force | rate limit + failed-login lock | `auth.ts` |
| Session theft/reuse | refresh hashing and rotation | `auth.ts`, `tokens.ts` |
| Spreadsheet injection | CSV formula prefix neutralization | `reports.ts:423-430` |
| Evidence tampering | audit, immutable grade history, frozen runs | routes and schema |
| Secret leakage | `.env` ignored; no credentials in learning docs | `.gitignore`, `.env.example` |
