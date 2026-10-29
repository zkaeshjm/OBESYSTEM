import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { badRequest, conflict, notFound, forbidden, locked } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { readPagination, sendData, sendPaginated } from '../lib/http.js';
import {
  assertAssessmentManager,
  assertAssessmentViewer,
  getManagedOffering,
  getStudentProfileId,
  getSubmissionForViewer,
} from '../lib/authorization.js';
import type { AssessmentType, GradeState, Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);

const rubricCriterionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional().nullable(),
  maxMarks: z.number().positive().max(10000),
});

const itemSchema = z.object({
  label: z.string().trim().min(1).max(40),
  prompt: z.string().trim().max(2000).optional().nullable(),
  maxMarks: z.number().positive().max(10000),
  rubricCriteria: z.array(rubricCriterionSchema).max(20).optional(),
  cloMappings: z
    .array(
      z.object({
        cloId: z.string().uuid(),
        weight: z.number().positive().max(1000).default(1),
      })
    )
    .min(1, 'Each assessment item must map to at least one CLO')
    .max(20),
});

const assessmentTypes = [
  'ASSIGNMENT',
  'QUIZ',
  'LAB',
  'PRESENTATION',
  'MID_EXAM',
  'PROJECT',
  'FINAL_EXAM',
  'OTHER',
] as const;
const latePolicies = ['ACCEPT', 'REJECT', 'MARK_LATE'] as const;

const assessmentCreateSchema = z.object({
  offeringId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  type: z.enum(assessmentTypes),
  instructions: z.string().trim().max(5000).optional().nullable(),
  submissionFormat: z.string().trim().max(200).optional().nullable(),
  passingMarks: z.number().min(0).max(10000).optional().nullable(),
  latePolicy: z.enum(latePolicies).default('MARK_LATE'),
  dueAt: z.coerce.date().optional().nullable(),
  items: z.array(itemSchema).min(1).max(100),
});

async function validateItemClos(
  courseId: string,
  items: Array<{ cloMappings: Array<{ cloId: string }>; label: string }>
) {
  const cloIds = [...new Set(items.flatMap((item) => item.cloMappings.map((mapping) => mapping.cloId)))];
  const clos = await prisma.clo.findMany({
    where: { id: { in: cloIds } },
    select: { id: true, courseId: true, approvalStatus: true, code: true },
  });
  if (clos.length !== cloIds.length) throw badRequest('One or more CLOs do not exist');
  const wrongCourse = clos.find((clo) => clo.courseId !== courseId);
  if (wrongCourse) throw badRequest(`CLO ${wrongCourse.code} does not belong to this course`);
  const unapproved = clos.find((clo) => clo.approvalStatus !== 'APPROVED');
  if (unapproved) {
    throw badRequest(`CLO ${unapproved.code} must be approved before it can be assessed`);
  }
  const labels = items.map((item) => item.label);
  if (new Set(labels).size !== labels.length) throw badRequest('Item labels must be unique within an assessment');
  return clos;
}

function validateRubric(items: Array<{ rubricCriteria?: Array<{ label: string; maxMarks: number }>; maxMarks: number; label: string }>) {
  for (const item of items) {
    if (!item.rubricCriteria?.length) continue;
    const labels = item.rubricCriteria.map((criterion) => criterion.label);
    if (new Set(labels).size !== labels.length) {
      throw badRequest(`Rubric criterion labels must be unique within item ${item.label}`);
    }
    const total = item.rubricCriteria.reduce((sum, criterion) => sum + criterion.maxMarks, 0);
    if (total > item.maxMarks + 0.001) {
      throw badRequest(`Rubric criteria for ${item.label} cannot exceed the item maximum of ${item.maxMarks}`);
    }
  }
}

function sumMarks(items: Array<{ maxMarks: number }>) {
  return Math.round(items.reduce((sum, item) => sum + item.maxMarks, 0) * 100) / 100;
}

router.get(
  '/assessments',
  asyncHandler(async (req, res) => {
    const offeringId = typeof req.query.offeringId === 'string' ? req.query.offeringId : undefined;
    if (!offeringId) throw badRequest('offeringId is required');
    const offering = await prisma.courseOffering.findUnique({ where: { id: offeringId } });
    if (!offering) throw notFound('Course offering');

    let studentProfileId: string | null = null;
    if (req.user!.role === 'STUDENT') {
      studentProfileId = await getStudentProfileId(req.user!.id);
      const enrollment = await prisma.enrollment.findUnique({
        where: { studentId_offeringId: { studentId: studentProfileId, offeringId } },
      });
      if (!enrollment || !['ENROLLED', 'COMPLETED'].includes(enrollment.status)) {
        throw forbidden('You are not enrolled in this offering');
      }
    } else {
      await getManagedOffering(req.user!, offeringId);
    }

    const pagination = readPagination(req.query as Record<string, unknown>);
    const where: Prisma.AssessmentWhereInput = {
      offeringId,
      ...(req.user!.role === 'STUDENT'
        ? { status: { in: ['PUBLISHED', 'CLOSED'] } }
        : req.query.includeArchived === 'true'
          ? {}
          : { status: { not: 'ARCHIVED' } }),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.assessment.findMany({
        where,
        include: {
          _count: { select: { items: true, submissions: true } },
          ...(studentProfileId
            ? {
                submissions: {
                  where: { studentId: studentProfileId },
                  select: { id: true, status: true, submittedAt: true, isLate: true, overallFeedback: true, gradedAt: true },
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.assessment.count({ where }),
    ]);
    return sendPaginated(res, rows, pagination, total);
  })
);

router.post(
  '/assessments',
  requireRole('ADMIN', 'TUTOR'),
  validate(assessmentCreateSchema),
  asyncHandler(async (req, res) => {
    const offering = await getManagedOffering(req.user!, req.body.offeringId);
    await validateItemClos(offering.courseId, req.body.items);
    validateRubric(req.body.items);
    const maxMarks = sumMarks(req.body.items);
    if (req.body.passingMarks != null && req.body.passingMarks > maxMarks) {
      throw badRequest(`Passing marks cannot exceed the assessment total of ${maxMarks}`);
    }

    const row = await prisma.assessment.create({
      data: {
        offeringId: offering.id,
        title: req.body.title,
        type: req.body.type as AssessmentType,
        instructions: req.body.instructions ?? null,
        submissionFormat: req.body.submissionFormat ?? null,
        passingMarks: req.body.passingMarks ?? null,
        latePolicy: req.body.latePolicy,
        dueAt: req.body.dueAt ?? null,
        maxMarks,
        createdById: req.user!.id,
        items: {
          create: req.body.items.map((item: typeof req.body.items[number], index: number) => ({
            label: item.label,
            prompt: item.prompt ?? null,
            maxMarks: item.maxMarks,
            position: index,
            cloMappings: {
              create: item.cloMappings.map((mapping: { cloId: string; weight: number }) => ({
                cloId: mapping.cloId,
                weight: mapping.weight,
              })),
            },
            ...(item.rubricCriteria?.length
              ? {
                  rubricCriteria: {
                    create: item.rubricCriteria.map((criterion: { label: string; description?: string | null; maxMarks: number }, criterionIndex: number) => ({
                      label: criterion.label,
                      description: criterion.description ?? null,
                      maxMarks: criterion.maxMarks,
                      position: criterionIndex,
                    })),
                  },
                }
              : {}),
          })),
        },
      },
      include: {
        items: {
          include: { cloMappings: { include: { clo: true } }, rubricCriteria: { orderBy: { position: 'asc' } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    await audit(req, {
      action: 'INSERT',
      entityType: 'Assessment',
      entityId: row.id,
      metadata: { offeringId: offering.id, type: row.type, items: row.items.length },
    });
    return sendData(res, row, { status: 201 });
  })
);

router.get(
  '/assessments/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentViewer(req.user!, String(req.params.id));
    const isManager = req.user!.role === 'ADMIN' || req.user!.role === 'TUTOR';

    if (isManager) {
      const row = await prisma.assessment.findUnique({
        where: { id: assessment.id },
        include: {
          offering: {
            include: {
              course: { include: { program: { select: { id: true, code: true, name: true } }, clos: { orderBy: { code: 'asc' } } } },
              semester: true,
              tutor: { select: { id: true, name: true, email: true } },
            },
          },
          items: { orderBy: { position: 'asc' }, include: { cloMappings: { include: { clo: true } }, rubricCriteria: { orderBy: { position: 'asc' } } } },
          submissions: {
            include: {
              student: { include: { user: { select: { id: true, name: true, email: true } } } },
              grades: true,
              criterionGrades: true,
            },
            orderBy: { student: { rollNo: 'asc' } },
          },
          _count: { select: { submissions: true } },
        },
      });
      if (!row) throw notFound('Assessment');
      return sendData(res, row);
    }

    const profileId = await getStudentProfileId(req.user!.id);
    const row = await prisma.assessment.findUnique({
      where: { id: assessment.id },
      include: {
        offering: {
          include: {
            course: { select: { code: true, title: true, program: { select: { code: true, name: true } } } },
            semester: { select: { name: true } },
            tutor: { select: { name: true } },
          },
        },
        items: {
          orderBy: { position: 'asc' },
          include: {
            cloMappings: { include: { clo: { select: { id: true, code: true, description: true } } } },
            rubricCriteria: { orderBy: { position: 'asc' } },
          },
        },
        submissions: {
          where: { studentId: profileId },
          include: { grades: true, criterionGrades: true },
        },
      },
    });
    if (!row) throw notFound('Assessment');

    const canViewResults = Boolean(row.resultsPublishedAt);
    return sendData(res, {
      ...row,
      submissions: row.submissions.map((submission) => ({
        ...submission,
        grades: canViewResults ? submission.grades : [],
        criterionGrades: canViewResults ? submission.criterionGrades : [],
        overallFeedback: canViewResults ? submission.overallFeedback : null,
      })),
      canViewResults,
    });
  })
);

router.patch(
  '/assessments/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(
    z.object({
      title: z.string().trim().min(3).max(200).optional(),
      type: z.enum(assessmentTypes).optional(),
      instructions: z.string().trim().max(5000).optional().nullable(),
      submissionFormat: z.string().trim().max(200).optional().nullable(),
      passingMarks: z.number().min(0).max(10000).optional().nullable(),
      latePolicy: z.enum(latePolicies).optional(),
      dueAt: z.coerce.date().optional().nullable(),
    })
  ),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status === 'CLOSED') throw locked('A closed assessment cannot be edited');
    if (assessment.status === 'ARCHIVED') throw locked('An archived assessment cannot be edited');
    if (req.body.type && req.body.type !== assessment.type) {
      const submissions = await prisma.submission.count({ where: { assessmentId: assessment.id } });
      if (submissions > 0) {
        throw conflict('The assessment type cannot change once submissions exist');
      }
    }
    if (req.body.passingMarks != null && req.body.passingMarks > Number(assessment.maxMarks)) {
      throw badRequest(`Passing marks cannot exceed the assessment total of ${Number(assessment.maxMarks)}`);
    }
    const row = await prisma.assessment.update({ where: { id: assessment.id }, data: req.body });
    await audit(req, { action: 'UPDATE', entityType: 'Assessment', entityId: row.id, metadata: { fields: Object.keys(req.body) } });
    return sendData(res, row);
  })
);

router.post(
  '/assessments/:id/publish',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status !== 'DRAFT') throw conflict('Only draft assessments can be published');

    const row = await prisma.assessment.findUnique({
      where: { id: assessment.id },
      include: {
        items: { include: { cloMappings: true } },
        offering: {
          include: {
            course: true,
            semester: true,
            enrollments: { where: { status: 'ENROLLED' }, include: { student: { include: { user: true } } } },
          },
        },
      },
    });
    if (!row) throw notFound('Assessment');
    if (row.items.length === 0) throw badRequest('Add at least one assessment item before publishing');
    const unmapped = row.items.filter((item) => item.cloMappings.length === 0);
    if (unmapped.length > 0) {
      throw badRequest(`Every item must map to a CLO before publishing (missing: ${unmapped.map((item) => item.label).join(', ')})`);
    }

    const updated = await prisma.assessment.update({
      where: { id: row.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    await audit(req, {
      action: 'PUBLISH',
      entityType: 'Assessment',
      entityId: row.id,
      metadata: { offeringId: row.offeringId, recipients: row.offering.enrollments.length },
    });
    const recipients = row.offering.enrollments.map((enrollment) => enrollment.student.userId);
    await notify({
      userIds: recipients,
      type: 'ASSESSMENT_PUBLISHED',
      title: 'New assessment published',
      body: `${row.title} (${row.offering.course.code}) is now available${row.dueAt ? `, due ${row.dueAt.toISOString().slice(0, 10)}` : ''}.`,
      link: `/assessments/${row.id}`,
    });
    return sendData(res, updated);
  })
);

router.post(
  '/assessments/:id/close',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status !== 'PUBLISHED') throw conflict('Only published assessments can be closed');
    const row = await prisma.assessment.update({ where: { id: assessment.id }, data: { status: 'CLOSED' } });
    await audit(req, { action: 'UPDATE', entityType: 'Assessment', entityId: row.id, metadata: { status: 'CLOSED' } });
    return sendData(res, row);
  })
);

router.post(
  '/assessments/:id/archive',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status === 'ARCHIVED') throw conflict('This assessment is already archived');
    if (assessment.status === 'DRAFT') {
      throw conflict('Draft assessments should be deleted rather than archived');
    }
    const pending = await prisma.submission.count({
      where: { assessmentId: assessment.id, status: { in: ['SUBMITTED', 'LATE'] } },
    });
    if (pending > 0) throw conflict(`Grade ${pending} pending submission(s) before archiving`);
    const row = await prisma.assessment.update({
      where: { id: assessment.id },
      data: { status: 'ARCHIVED' },
    });
    await audit(req, { action: 'ARCHIVE', entityType: 'Assessment', entityId: row.id });
    return sendData(res, row);
  })
);

router.post(
  '/assessments/:id/restore',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status !== 'ARCHIVED') throw conflict('Only archived assessments can be restored');
    const row = await prisma.assessment.update({
      where: { id: assessment.id },
      data: { status: assessment.publishedAt ? 'CLOSED' : 'DRAFT' },
    });
    await audit(req, { action: 'RESTORE', entityType: 'Assessment', entityId: row.id });
    return sendData(res, row);
  })
);

router.delete(
  '/assessments/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status !== 'DRAFT') throw conflict('Published assessments are retained as evidence and cannot be deleted');
    const submissions = await prisma.submission.count({ where: { assessmentId: assessment.id } });
    if (submissions > 0) throw conflict('This assessment has submissions and cannot be deleted');
    await prisma.assessment.delete({ where: { id: assessment.id } });
    await audit(req, { action: 'DELETE', entityType: 'Assessment', entityId: assessment.id });
    return sendData(res, { id: assessment.id });
  })
);

/* ------------------------------- Items -------------------------------- */
router.post(
  '/assessments/:id/items',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(itemSchema),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status !== 'DRAFT') throw locked('Items are immutable after publication');
    await validateItemClos(assessment.offering.courseId, [req.body]);
    validateRubric([req.body]);
    const count = await prisma.assessmentItem.count({ where: { assessmentId: assessment.id } });
    const row = await prisma.assessmentItem.create({
      data: {
        assessmentId: assessment.id,
        label: req.body.label,
        prompt: req.body.prompt ?? null,
        maxMarks: req.body.maxMarks,
        position: count,
        cloMappings: {
          create: req.body.cloMappings.map((mapping: { cloId: string; weight: number }) => ({
            cloId: mapping.cloId,
            weight: mapping.weight,
          })),
        },
        ...(req.body.rubricCriteria?.length
          ? {
              rubricCriteria: {
                create: req.body.rubricCriteria.map((criterion: { label: string; description?: string | null; maxMarks: number }, index: number) => ({
                  label: criterion.label,
                  description: criterion.description ?? null,
                  maxMarks: criterion.maxMarks,
                  position: index,
                })),
              },
            }
          : {}),
      },
      include: { cloMappings: { include: { clo: true } }, rubricCriteria: { orderBy: { position: 'asc' } } },
    });
    await recalcAssessmentTotal(assessment.id);
    await audit(req, { action: 'INSERT', entityType: 'AssessmentItem', entityId: row.id, metadata: { assessmentId: assessment.id } });
    return sendData(res, row, { status: 201 });
  })
);

async function recalcAssessmentTotal(assessmentId: string) {
  const items = await prisma.assessmentItem.findMany({ where: { assessmentId }, select: { maxMarks: true } });
  await prisma.assessment.update({
    where: { id: assessmentId },
    data: { maxMarks: Math.max(0.01, sumMarks(items.map((item) => ({ maxMarks: Number(item.maxMarks) })))) },
  });
}

router.patch(
  '/items/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(itemSchema.partial()),
  asyncHandler(async (req, res) => {
    const item = await prisma.assessmentItem.findUnique({
      where: { id: String(req.params.id) },
      include: { assessment: { include: { offering: true } } },
    });
    if (!item) throw notFound('Assessment item');
    await assertAssessmentManager(req.user!, item.assessmentId);
    if (item.assessment.status !== 'DRAFT') throw locked('Items are immutable after publication');

    const { cloMappings, rubricCriteria, ...data } = req.body;
    if (cloMappings) await validateItemClos(item.assessment.offering.courseId, [{ cloMappings, label: item.label }]);
    if (rubricCriteria) validateRubric([{ rubricCriteria, maxMarks: Number(data.maxMarks ?? item.maxMarks), label: item.label }]);

    const row = await prisma.$transaction(async (tx) => {
      await tx.assessmentItem.update({ where: { id: item.id }, data });
      if (rubricCriteria) {
        await tx.rubricCriterion.deleteMany({ where: { itemId: item.id } });
        if (rubricCriteria.length) {
          await tx.rubricCriterion.createMany({
            data: rubricCriteria.map((criterion: { label: string; description?: string | null; maxMarks: number }, index: number) => ({
              itemId: item.id,
              label: criterion.label,
              description: criterion.description ?? null,
              maxMarks: criterion.maxMarks,
              position: index,
            })),
          });
        }
      }
      if (cloMappings) {
        await tx.assessmentItemClo.deleteMany({ where: { itemId: item.id } });
        await tx.assessmentItemClo.createMany({
          data: cloMappings.map((mapping: { cloId: string; weight: number }) => ({
            itemId: item.id,
            cloId: mapping.cloId,
            weight: mapping.weight,
          })),
        });
      }
      return tx.assessmentItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { cloMappings: { include: { clo: true } }, rubricCriteria: { orderBy: { position: 'asc' } } },
      });
    });
    await recalcAssessmentTotal(item.assessmentId);
    await audit(req, { action: 'UPDATE', entityType: 'AssessmentItem', entityId: row.id });
    return sendData(res, row);
  })
);

router.delete(
  '/items/:id',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const item = await prisma.assessmentItem.findUnique({
      where: { id: String(req.params.id) },
      include: { assessment: { include: { _count: { select: { items: true } } } } },
    });
    if (!item) throw notFound('Assessment item');
    await assertAssessmentManager(req.user!, item.assessmentId);
    if (item.assessment.status !== 'DRAFT') throw locked('Items are immutable after publication');
    if (item.assessment._count.items <= 1) throw conflict('An assessment must retain at least one item');
    await prisma.assessmentItem.delete({ where: { id: item.id } });
    await recalcAssessmentTotal(item.assessmentId);
    await audit(req, { action: 'DELETE', entityType: 'AssessmentItem', entityId: item.id });
    return sendData(res, { id: item.id });
  })
);

/* ---------------------------- Submissions ----------------------------- */
const submissionSchema = z
  .object({
    content: z.string().trim().max(20000).optional().nullable(),
    attachmentUrl: z.string().url().max(2000).optional().nullable(),
  })
  .refine((value) => Boolean(value.content?.trim() || value.attachmentUrl), {
    message: 'Provide submission text or an attachment URL',
    path: ['content'],
  });

router.post(
  '/assessments/:id/submissions',
  requireRole('STUDENT'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(submissionSchema),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentViewer(req.user!, String(req.params.id));
    if (assessment.status !== 'PUBLISHED') throw conflict('This assessment is not accepting submissions');
    const profileId = await getStudentProfileId(req.user!.id);

    const existing = await prisma.submission.findUnique({
      where: { assessmentId_studentId: { assessmentId: assessment.id, studentId: profileId } },
    });
    if (existing) throw conflict('You have already submitted this assessment');

    const dueAt = await prisma.assessment.findUnique({ where: { id: assessment.id }, select: { dueAt: true, latePolicy: true, title: true, offering: { select: { tutorId: true, course: { select: { code: true } } } } } });
    const afterDeadline = Boolean(dueAt?.dueAt && new Date() > dueAt.dueAt);
    if (afterDeadline && dueAt?.latePolicy === 'REJECT') {
      throw conflict('The deadline has passed and this assessment does not accept late submissions');
    }
    const isLate = afterDeadline && dueAt?.latePolicy !== 'ACCEPT';

    const row = await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: profileId,
        content: req.body.content ?? null,
        attachmentUrl: req.body.attachmentUrl ?? null,
        isLate,
        status: isLate ? 'LATE' : 'SUBMITTED',
      },
    });
    await audit(req, {
      action: 'INSERT',
      entityType: 'Submission',
      entityId: row.id,
      metadata: { assessmentId: assessment.id, late: isLate },
    });
    if (dueAt) {
      await notify({
        userIds: [dueAt.offering.tutorId],
        type: 'SYSTEM',
        title: 'New submission received',
        body: `${req.user!.name} submitted ${dueAt.title} (${dueAt.offering.course.code})${isLate ? ' after the deadline' : ''}.`,
        link: `/assessments/${assessment.id}`,
      });
    }
    return sendData(res, row, { status: 201 });
  })
);

router.patch(
  '/submissions/:id',
  requireRole('STUDENT'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(submissionSchema),
  asyncHandler(async (req, res) => {
    const submission = await getSubmissionForViewer(req.user!, String(req.params.id));
    if (submission.status === 'GRADED' || submission.status === 'RETURNED') {
      throw locked('A graded submission can no longer be edited');
    }
    const isLate = Boolean(submission.assessment.dueAt && new Date() > submission.assessment.dueAt);
    const row = await prisma.submission.update({
      where: { id: submission.id },
      data: {
        content: req.body.content ?? null,
        attachmentUrl: req.body.attachmentUrl ?? null,
        submittedAt: new Date(),
        isLate,
        status: isLate ? 'LATE' : 'SUBMITTED',
      },
    });
    await audit(req, { action: 'UPDATE', entityType: 'Submission', entityId: row.id });
    return sendData(res, row);
  })
);

router.get(
  '/assessments/:id/submissions',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    const rows = await prisma.submission.findMany({
      where: { assessmentId: assessment.id },
      include: {
        student: { include: { user: { select: { id: true, name: true, email: true } } } },
        grades: true,
      },
      orderBy: { student: { rollNo: 'asc' } },
    });
    return sendData(res, rows);
  })
);

router.get(
  '/submissions/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const submission = await getSubmissionForViewer(req.user!, String(req.params.id));
    if (req.user!.role === 'STUDENT' && !submission.assessment.resultsPublishedAt) {
      return sendData(res, {
        ...submission,
        grades: [],
        overallFeedback: null,
        canViewResults: false,
      });
    }
    return sendData(res, { ...submission, canViewResults: true });
  })
);

router.get(
  '/submissions/:id/grade-history',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const submission = await getSubmissionForViewer(req.user!, String(req.params.id));
    if (req.user!.role === 'TUTOR' && submission.assessment.offering.tutorId !== req.user!.id) {
      throw forbidden();
    }
    const rows = await prisma.gradeChange.findMany({
      where: { submissionId: submission.id },
      include: {
        actor: { select: { id: true, name: true, role: true } },
        item: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sendData(res, rows);
  })
);

/* ------------------------------ Grading ------------------------------- */
const gradeSchema = z.object({
  grades: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        marks: z.number().min(0).max(10000),
        state: z.enum(['GRADED', 'EXCUSED', 'INCOMPLETE']).default('GRADED'),
        feedback: z.string().trim().max(2000).optional().nullable(),
      })
    )
    .max(100),
  criterionGrades: z
    .array(
      z.object({
        criterionId: z.string().uuid(),
        marks: z.number().min(0).max(10000),
        feedback: z.string().trim().max(2000).optional().nullable(),
      })
    )
    .max(500)
    .optional(),
  overallFeedback: z.string().trim().max(5000).optional().nullable(),
  // Required when correcting a grade whose results have already been published.
  reason: z.string().trim().min(5).max(500).optional().nullable(),
});

router.put(
  '/submissions/:id/grades',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(gradeSchema),
  asyncHandler(async (req, res) => {
    const submission = await getSubmissionForViewer(req.user!, String(req.params.id));
    if (req.user!.role === 'TUTOR' && submission.assessment.offering.tutorId !== req.user!.id) {
      throw forbidden();
    }
    if (submission.assessment.status === 'DRAFT') throw conflict('Publish the assessment before grading');
    const resultsPublished = Boolean(submission.assessment.resultsPublishedAt);
    if (resultsPublished && !req.body.reason) {
      throw badRequest('Provide a reason when correcting a published grade');
    }
    const previousByItem = new Map(submission.grades.map((grade) => [grade.itemId, grade]));

    const itemById = new Map(submission.assessment.items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const criterionGrades: Array<{ criterionId: string; marks: number; feedback?: string | null }> =
      req.body.criterionGrades ?? [];
    const criterionIds = new Set<string>();
    for (const criterionGrade of criterionGrades) {
      if (criterionIds.has(criterionGrade.criterionId)) throw badRequest('Duplicate rubric criterion grade');
      criterionIds.add(criterionGrade.criterionId);
      const item = submission.assessment.items.find((candidate) =>
        candidate.rubricCriteria.some((criterion) => criterion.id === criterionGrade.criterionId)
      );
      if (!item) throw badRequest('A rubric criterion does not belong to this assessment');
      const criterion = item.rubricCriteria.find((entry) => entry.id === criterionGrade.criterionId)!;
      if (criterionGrade.marks > Number(criterion.maxMarks)) {
        throw badRequest(`Marks for rubric criterion ${criterion.label} cannot exceed ${criterion.maxMarks}`);
      }
    }

    for (const grade of req.body.grades) {
      const item = itemById.get(grade.itemId);
      if (!item) throw badRequest('A grade references an item that does not belong to this assessment');
      if (seen.has(grade.itemId)) throw badRequest('Duplicate grade for the same item');
      seen.add(grade.itemId);
      const itemCriterionGrades = criterionGrades.filter((criterionGrade) =>
        item.rubricCriteria.some((criterion) => criterion.id === criterionGrade.criterionId)
      );
      if (itemCriterionGrades.length > 0) {
        if (itemCriterionGrades.length !== item.rubricCriteria.length) {
          throw badRequest(`Grade every rubric criterion for ${item.label}, or none of them`);
        }
        const rubricTotal = itemCriterionGrades.reduce((sum, criterionGrade) => sum + criterionGrade.marks, 0);
        if (rubricTotal > Number(item.maxMarks) + 0.001) {
          throw badRequest(`Rubric marks for ${item.label} cannot exceed ${item.maxMarks}`);
        }
      }
      if (grade.marks > Number(item.maxMarks)) {
        throw badRequest(`Marks for ${item.label} cannot exceed ${item.maxMarks}`);
      }
      if (grade.state !== 'GRADED' && grade.marks !== 0) {
        throw badRequest(`Marks for an ${grade.state.toLowerCase()} item must be zero`);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.submissionItemGrade.deleteMany({
        where: {
          submissionId: submission.id,
          itemId: { notIn: req.body.grades.map((grade: { itemId: string }) => grade.itemId) },
        },
      });
      await tx.submissionCriterionGrade.deleteMany({ where: { submissionId: submission.id } });
      if (criterionGrades.length) {
        await tx.submissionCriterionGrade.createMany({
          data: criterionGrades.map((criterionGrade: { criterionId: string; marks: number; feedback?: string | null }) => ({
            submissionId: submission.id,
            criterionId: criterionGrade.criterionId,
            marks: criterionGrade.marks,
            feedback: criterionGrade.feedback ?? null,
          })),
        });
      }
      for (const grade of req.body.grades) {
        const item = itemById.get(grade.itemId)!;
        const itemCriterionGrades = criterionGrades.filter((criterionGrade) =>
          item.rubricCriteria.some((criterion) => criterion.id === criterionGrade.criterionId)
        );
        const effectiveMarks =
          itemCriterionGrades.length > 0
            ? itemCriterionGrades.reduce((sum, criterionGrade) => sum + criterionGrade.marks, 0)
            : grade.marks;
        await tx.submissionItemGrade.upsert({
          where: { submissionId_itemId: { submissionId: submission.id, itemId: grade.itemId } },
          create: {
            submissionId: submission.id,
            itemId: grade.itemId,
            marks: effectiveMarks,
            state: grade.state as GradeState,
            feedback: grade.feedback ?? null,
            gradedById: req.user!.id,
          },
          update: {
            marks: effectiveMarks,
            state: grade.state as GradeState,
            feedback: grade.feedback ?? null,
            gradedById: req.user!.id,
            gradedAt: new Date(),
          },
        });

        // Keep an immutable trail only when the value actually changes, so a
        // no-op save does not pollute the regrade history.
        const previous = previousByItem.get(grade.itemId);
        const changed = !previous || Number(previous.marks) !== effectiveMarks || previous.state !== grade.state;
        if (changed) {
          await tx.gradeChange.create({
            data: {
              submissionId: submission.id,
              itemId: grade.itemId,
              actorId: req.user!.id,
              previousMarks: previous ? previous.marks : null,
              newMarks: effectiveMarks,
              reason: req.body.reason ?? null,
            },
          });
        }
      }
      await tx.submission.update({
        where: { id: submission.id },
        data: {
          status: 'GRADED',
          gradedAt: new Date(),
          overallFeedback: req.body.overallFeedback ?? null,
        },
      });
    });

    await audit(req, {
      action: 'GRADE',
      entityType: 'Submission',
      entityId: submission.id,
      metadata: {
        assessmentId: submission.assessmentId,
        items: req.body.grades.length,
        correctedPublishedResults: resultsPublished,
        reason: req.body.reason ?? undefined,
      },
    });

    if (submission.assessment.resultsPublishedAt) {
      await notify({
        userIds: [submission.student.user.id],
        type: 'GRADE_PUBLISHED',
        title: 'Grade updated',
        body: `Your grade for ${submission.assessment.title} was updated.`,
        link: `/assessments/${submission.assessmentId}`,
      });
    }
    return sendData(res, { id: submission.id, grades: req.body.grades.length });
  })
);

router.post(
  '/assessments/:id/publish-results',
  requireRole('ADMIN', 'TUTOR'),
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const assessment = await assertAssessmentManager(req.user!, String(req.params.id));
    if (assessment.status === 'DRAFT') throw conflict('Publish the assessment before publishing results');
    if (assessment.resultsPublishedAt) throw conflict('Results have already been published');

    const pending = await prisma.submission.count({
      where: { assessmentId: assessment.id, status: { in: ['SUBMITTED', 'LATE'] } },
    });
    if (pending > 0) throw conflict(`${pending} submission(s) still need grading`);
    const graded = await prisma.submission.count({ where: { assessmentId: assessment.id, status: 'GRADED' } });
    if (graded === 0) throw conflict('There are no graded submissions to publish');

    const row = await prisma.assessment.update({
      where: { id: assessment.id },
      data: { resultsPublishedAt: new Date() },
    });
    await audit(req, { action: 'PUBLISH', entityType: 'AssessmentResults', entityId: assessment.id, metadata: { graded } });

    const submissions = await prisma.submission.findMany({
      where: { assessmentId: assessment.id },
      include: { student: { select: { userId: true } } },
    });
    await notify({
      userIds: submissions.map((submission) => submission.student.userId),
      type: 'GRADE_PUBLISHED',
      title: 'Results published',
      body: `Your results and feedback for ${assessment.title} are now available.`,
      link: `/assessments/${assessment.id}`,
    });
    return sendData(res, row);
  })
);

export default router;
