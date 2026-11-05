/**
 * Read-only database integrity scan for the OBE system.
 *
 * Connects with prisma to the configured DATABASE_URL and runs orphan /
 * duplicate / consistency probes. Prints a report; performs ZERO writes.
 * Used by the system audit (docs/SYSTEM_REPORT.md) — safe to run anywhere.
 */
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const checks: Array<{ name: string; result: unknown }> = [];
  const check = async <T>(name: string, fn: () => Promise<T>) => {
    checks.push({ name, result: await fn() });
  };

  console.log('== Read-only OBE database integrity scan ==\n');

  // A. Orphan / missing profiles ------------------------------------------------
  await check('students with an auth account but missing profile (STUDENT role, no studentProfile)', () =>
    prisma.user.count({ where: { role: 'STUDENT', studentProfile: null } }),
  );
  await check('orphaned student profiles (no auth identity; impossible via FK, SQL-proven)', () =>
    prisma.$queryRawUnsafe<Array<unknown>>(
      'SELECT sp.id FROM student_profiles sp LEFT JOIN users u ON u.id = sp."userId" WHERE u.id IS NULL',
    ),
  );
  await check('duplicate student profiles per user', () =>
    prisma.$queryRawUnsafe<Array<{ user_id: string; count: number }>>(
      'SELECT "userId", COUNT(*) AS count FROM student_profiles GROUP BY "userId" HAVING COUNT(*) > 1',
    ),
  );
  await check('duplicate roll numbers', () =>
    prisma.$queryRawUnsafe<Array<{ roll_no: string; count: number }>>(
      'SELECT "rollNo" AS "roll_no", COUNT(*) FROM student_profiles GROUP BY "rollNo" HAVING COUNT(*) > 1',
    ),
  );

  // B. Identity consistency -----------------------------------------------------
  await check('duplicate e-mails among users', () =>
    prisma.$queryRawUnsafe<Array<{ email: string; count: number }>>(
      'SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1',
    ),
  );
  await check('duplicate employee numbers (non-null only)', () =>
    prisma.$queryRawUnsafe<Array<{ employee_no: string; count: number }>>(
      'SELECT "employeeNo" AS "employee_no", COUNT(*) FROM users WHERE "employeeNo" IS NOT NULL GROUP BY "employeeNo" HAVING COUNT(*) > 1',
    ),
  );
  await check('STUDENT accounts without a student profile', () =>
    prisma.user.count({ where: { role: 'STUDENT', studentProfile: null } }),
  );
  await check('users with a not-yet-live role value', () =>
    prisma.$queryRawUnsafe<Array<{ role: string; count: number }>>(
      "SELECT role, COUNT(*) FROM users WHERE role NOT IN ('ADMIN','TUTOR','STUDENT') GROUP BY role",
    ),
  );

  // C. Enrolment and offering integrity ----------------------------------------
  await check('duplicate enrollments (student+offering)', () =>
    prisma.$queryRawUnsafe<Array<{ student_id: string; offering_id: string; count: number }>>(
      'SELECT "studentId", "offeringId", COUNT(*) FROM enrollments GROUP BY "studentId", "offeringId" HAVING COUNT(*) > 1',
    ),
  );
  await check('enrollments pointing to a different-programme student (warning-level)', () =>
    prisma.$queryRawUnsafe<Array<{ enrollment_id: unknown }>>(
      `SELECT e.id AS "enrollment_id" FROM enrollments e
        JOIN course_offerings o ON o.id = e."offeringId"
        JOIN courses c ON c.id = o."courseId"
        JOIN student_profiles sp ON sp.id = e."studentId"
        WHERE c."programId" <> sp."programId"`,
    ),
  );
  await check('offerings assigned to a deactivated tutor (warning-level)', () =>
    prisma.courseOffering.count({ where: { tutor: { isActive: false } } }),
  );
  await check('enrollments on offerings taught by the same tutor to their own student profile', () =>
    prisma.$queryRawUnsafe<Array<unknown>>(
      `SELECT e.id FROM enrollments e
        JOIN student_profiles sp ON sp.id = e."studentId"
        JOIN course_offerings o ON o.id = e."offeringId"
        WHERE o."tutorId" = sp."userId"`,
    ),
  );

  // D. Outcome and assessment dangling references ------------------------------
  await check('CLO approval without approver id/time mismatch', () =>
    prisma.$queryRawUnsafe<Array<unknown>>(
      `SELECT id FROM clos
        WHERE ("approvalStatus" = 'APPROVED' AND ("approvedAt" IS NULL OR "approvedById" IS NULL))
           OR ("approvalStatus" <> 'APPROVED' AND ("approvedAt" IS NOT NULL OR "approvedById" IS NOT NULL))`,
    ),
  );
  await check('CLO–PLO mappings across different programmes (must be zero)', () =>
    prisma.$queryRawUnsafe<Array<unknown>>(
      `SELECT m.id FROM clo_plo_mappings m
        JOIN clos c ON c.id = m."cloId"
        JOIN courses k ON k.id = c."courseId"
        JOIN plos p ON p.id = m."ploId"
        WHERE k."programId" <> p."programId"`,
    ),
  );
  await check('assessment item CLO mappings to CLOs of another course (must be zero)', () =>
    prisma.$queryRawUnsafe<Array<unknown>>(
      `SELECT ai.id AS item_id, aic."cloId" FROM assessment_item_clos aic
        JOIN assessment_items ai ON ai.id = aic."itemId"
        JOIN assessments a ON a.id = ai."assessmentId"
        JOIN course_offerings o ON o.id = a."offeringId"
        JOIN clos c ON c.id = aic."cloId"
        WHERE o."courseId" <> c."courseId"`,
    ),
  );
  await check('submission item grades exceeding max marks', () =>
    prisma.$queryRawUnsafe<Array<unknown>>(
      `SELECT g.id FROM submission_item_grades g
        JOIN assessment_items i ON i.id = g."itemId"
        WHERE g.marks > i."maxMarks"`,
    ),
  );

  // E. Session/token hygiene ----------------------------------------------------
  await check('orphaned refresh tokens (missing user; impossible via FK, SQL-proven)', () =>
    prisma.$queryRawUnsafe<Array<unknown>>(
      'SELECT t.id FROM refresh_tokens t LEFT JOIN users u ON u.id = t."userId" WHERE u.id IS NULL',
    ),
  );
  await check('inactive users still holding un-revoked refresh tokens', () =>
    prisma.user.count({ where: { isActive: false, refreshTokens: { none: { revokedAt: null } } } }),
  );
  await check('un-revoked expired refresh tokens', () =>
    prisma.refreshToken.count({ where: { revokedAt: null, expiresAt: { lt: new Date() } } }),
  );
  await check('awaiting-lockout users (failed>=5, no lock)', () =>
    prisma.user.count({ where: { failedLoginCount: { gte: 5 }, lockedUntil: null } }),
  );

  // F. Shape of the institution -------------------------------------------------
  await check('institution shape summary', () =>
    Promise.all([
      prisma.user.groupBy({ by: ['role', 'isActive'], _count: { _all: true }, orderBy: [{ role: 'asc' }] }),
      prisma.studentProfile.count(),
      prisma.enrollment.count(),
      prisma.courseOffering.count(),
      prisma.course.count(),
      prisma.clo.count(),
      prisma.plo.count(),
      prisma.cloPloMapping.count(),
      prisma.assessment.count(),
      prisma.submission.count(),
      prisma.auditLog.count(),
      prisma.notification.count(),
    ]),
  );

  for (const { name, result } of checks) {
    console.log(`- ${name}: ${JSON.stringify(result, (_key, value) => (typeof value === 'bigint' ? Number(value) : value))}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Scan failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
