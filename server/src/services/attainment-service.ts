import { prisma } from '../lib/prisma.js';
import { conflict, notFound } from '../lib/errors.js';
import { computeAttainment, type EngineInput, type EngineOutput } from './attainment/engine.js';
import { ENGINE_VERSION, resolvePolicy, type AttainmentPolicy } from './attainment/policy.js';

export async function resolveActivePolicy(policyId?: string) {
  const policy = policyId
    ? await prisma.attainmentPolicy.findUnique({ where: { id: policyId } })
    : await prisma.attainmentPolicy.findFirst({ where: { isActive: true } });
  if (!policy) throw notFound('Attainment policy');
  return { ...policy, parsedConfig: resolvePolicy(policy.config) };
}

interface BuildOptions {
  includeUnpublishedResults?: boolean;
  onlyStudentProfileId?: string;
  policy: AttainmentPolicy;
}

/**
 * Loads the complete evidence graph for an offering. Every persisted grade is
 * current evidence; only assessments that were published carry academic
 * evidence. `includeUnpublishedResults` is used exclusively for staff
 * computation, never for a student-facing response.
 */
export async function buildOfferingInput(offeringId: string, options: BuildOptions) {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    include: {
      course: { select: { id: true, code: true, title: true, programId: true, program: { select: { id: true, code: true, name: true } } } },
      semester: { select: { id: true, name: true } },
      enrollments: {
        where: {
          status: { in: ['ENROLLED', 'COMPLETED'] },
          ...(options.onlyStudentProfileId ? { studentId: options.onlyStudentProfileId } : {}),
        },
        include: {
          student: {
            include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
          },
        },
      },
    },
  });
  if (!offering) throw notFound('Course offering');

  const clos = await prisma.clo.findMany({
    where: {
      courseId: offering.courseId,
      ...(options.policy.includeUnapprovedClos ? {} : { approvalStatus: 'APPROVED' }),
    },
    include: { ploMappings: true },
    orderBy: { code: 'asc' },
  });

  const plos = await prisma.plo.findMany({
    where: { programId: offering.course.programId, isActive: true },
    orderBy: { code: 'asc' },
  });

  const assessments = await prisma.assessment.findMany({
    where: {
      offeringId,
      status: { in: ['PUBLISHED', 'CLOSED'] },
      ...(options.includeUnpublishedResults ? {} : { resultsPublishedAt: { not: null } }),
    },
    include: {
      items: { include: { cloMappings: true }, orderBy: { position: 'asc' } },
      submissions: {
        include: { grades: true },
        ...(options.onlyStudentProfileId ? { where: { studentId: options.onlyStudentProfileId } } : {}),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const publishedCloIds = new Set(clos.map((clo) => clo.id));
  const items = assessments.flatMap((assessment) =>
    assessment.items.map((item) => ({
      id: item.id,
      maxMarks: Number(item.maxMarks),
      cloMappings: item.cloMappings
        .filter((mapping) => publishedCloIds.has(mapping.cloId))
        .map((mapping) => ({ cloId: mapping.cloId, weight: Number(mapping.weight) })),
    }))
  );

  const students = offering.enrollments
    .map((enrollment) => {
      const grades = assessments.flatMap((assessment) => {
        const submission = assessment.submissions.find((entry) => entry.studentId === enrollment.studentId);
        if (!submission) return [];
        return submission.grades
          .filter((grade) => items.some((item) => item.id === grade.itemId))
          .map((grade) => ({
            itemId: grade.itemId,
            marks: Number(grade.marks),
            state: grade.state,
          }));
      });
      return {
        id: enrollment.studentId,
        name: enrollment.student.user.name,
        rollNo: enrollment.student.rollNo,
        grades,
      };
    })
    .sort((a, b) => a.rollNo.localeCompare(b.rollNo));

  const input: EngineInput = {
    clos: clos.map((clo) => ({
      id: clo.id,
      code: clo.code,
      masteryThreshold: Number(clo.masteryThreshold),
      ploMappings: clo.ploMappings.map((mapping) => ({ ploId: mapping.ploId, weight: mapping.weight })),
    })),
    plos: plos.map((plo) => ({
      id: plo.id,
      code: plo.code,
      targetAttainment: Number(plo.targetAttainment),
    })),
    items,
    students,
    policy: options.policy,
  };

  return {
    input,
    offering,
    clos,
    plos,
    assessmentCount: assessments.length,
    gradeCount: students.reduce((sum, student) => sum + student.grades.length, 0),
    studentCount: students.length,
  };
}

export async function computeOfferingAttainment(
  offeringId: string,
  options: BuildOptions & { persist: boolean; computedById?: string; policyId?: string; reportingPeriod?: string | null }
) {
  const resolved = options.policyId ? await resolveActivePolicy(options.policyId) : null;
  const policy = resolved?.parsedConfig ?? options.policy;
  const evidence = await buildOfferingInput(offeringId, { ...options, policy });

  let output: EngineOutput;
  try {
    output = computeAttainment(evidence.input);
  } catch (error) {
    throw conflict(error instanceof Error ? error.message : 'Attainment evidence is invalid');
  }

  if (!options.persist) {
    return { output, evidence, policy, policyMeta: resolved };
  }

  if (!resolved) throw notFound('Attainment policy');

  const reportingPeriod =
    options.reportingPeriod?.trim() || evidence.offering.reportingPeriod || evidence.offering.semester.name;

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.attainmentRun.create({
      data: {
        offeringId,
        policyId: resolved.id,
        engineVersion: ENGINE_VERSION,
        policyVersion: resolved.version,
        policySnapshot: policy as never,
        reportingPeriod,
        computedById: options.computedById ?? null,
        notes: `Evidence: ${evidence.assessmentCount} published assessment(s), ${evidence.gradeCount} grade record(s), ${evidence.studentCount} enrolled student(s).`,
      },
    });
    if (output.cloResults.length) {
      await tx.cloAttainment.createMany({
        data: output.cloResults.map((result) => ({
          runId: created.id,
          cloId: result.cloId,
          cohortSize: result.cohortSize,
          eligibleCount: result.eligibleCount,
          attainedCount: result.attainedCount,
          meanScore: result.meanScore,
          attainmentPct: result.attainmentPct,
          targetPct: result.targetPct,
          status: result.status,
          missingEvidenceCount: result.missingEvidenceCount,
          evidenceJson: result.evidence as never,
        })),
      });
    }
    if (output.ploResults.length) {
      await tx.ploAttainment.createMany({
        data: output.ploResults.map((result) => ({
          runId: created.id,
          ploId: result.ploId,
          attainmentPct: result.attainmentPct,
          targetPct: result.targetPct,
          status: result.status,
          contributingClos: result.contributingClos,
          weightedCohort: result.weightedCohort,
          evidenceJson: result.evidence as never,
        })),
      });
    }
    return created;
  });

  return { run, policy, policyMeta: resolved, evidence, output };
}

export async function freezeRun(runId: string, userId: string) {
  const run = await prisma.attainmentRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Attainment run');
  if (run.isFrozen) throw conflict('This attainment run is already frozen');
  return prisma.attainmentRun.update({
    where: { id: runId },
    data: { isFrozen: true, frozenAt: new Date(), computedById: run.computedById ?? userId },
  });
}
