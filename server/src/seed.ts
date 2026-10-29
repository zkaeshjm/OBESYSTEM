import { PrismaClient } from '@prisma/client';
import { hashPassword } from './lib/password.js';
import { env } from './config/env.js';
import { DEFAULT_POLICY, ENGINE_VERSION } from './services/attainment/policy.js';
import { computeOfferingAttainment } from './services/attainment-service.js';

const prisma = new PrismaClient();

const day = (offset: number) => {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
};

async function main() {
  const force = process.env.FORCE_SEED === 'true';
  const existing = await prisma.user.count();
  if (existing > 0 && !force) {
    console.log('[seed] Database already contains users. Set FORCE_SEED=true to replace seed data.');
    return;
  }

  if (force && existing > 0) {
    console.log('[seed] FORCE_SEED=true — clearing existing data.');
    await prisma.$transaction([
      prisma.auditLog.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.improvementActionPlan.deleteMany(),
      prisma.ploAttainment.deleteMany(),
      prisma.cloAttainment.deleteMany(),
      prisma.attainmentRun.deleteMany(),
      prisma.attainmentPolicy.deleteMany(),
      prisma.submissionItemGrade.deleteMany(),
      prisma.submission.deleteMany(),
      prisma.assessmentItemClo.deleteMany(),
      prisma.assessmentItem.deleteMany(),
      prisma.assessment.deleteMany(),
      prisma.enrollment.deleteMany(),
      prisma.courseOffering.deleteMany(),
      prisma.cloPloMapping.deleteMany(),
      prisma.clo.deleteMany(),
      prisma.plo.deleteMany(),
      prisma.course.deleteMany(),
      prisma.studentProfile.deleteMany(),
      prisma.refreshToken.deleteMany(),
      prisma.user.deleteMany(),
      prisma.semester.deleteMany(),
      prisma.program.deleteMany(),
      prisma.department.deleteMany(),
    ]);
  }

  const [adminHash, tutorHash, studentHash] = await Promise.all([
    hashPassword(env.SEED_ADMIN_PASSWORD),
    hashPassword(env.SEED_TUTOR_PASSWORD),
    hashPassword(env.SEED_STUDENT_PASSWORD),
  ]);

  const department = await prisma.department.create({
    data: {
      name: 'University Institute of Information Technology',
      code: 'UIIT',
      hodName: 'Dr. Yasir Hafeez',
      contact: '051-9281234',
    },
  });

  const [bscs, bsse] = await Promise.all([
    prisma.program.create({
      data: { departmentId: department.id, name: 'BS Computer Science', code: 'BSCS', creditHours: 136, accreditationBody: 'PEC' },
    }),
    prisma.program.create({
      data: { departmentId: department.id, name: 'BS Software Engineering', code: 'BSSE', creditHours: 140, accreditationBody: 'PEC' },
    }),
  ]);

  const [spring2026, fall2025] = await Promise.all([
    prisma.semester.create({
      data: { name: 'Spring 2026', startDate: new Date('2026-02-01'), endDate: new Date('2026-06-15'), isActive: true },
    }),
    prisma.semester.create({
      data: { name: 'Fall 2025', startDate: new Date('2025-09-01'), endDate: new Date('2026-01-15'), isActive: false },
    }),
  ]);

  const [ds, ml, db, se] = await Promise.all([
    prisma.course.create({
      data: { programId: bscs.id, code: 'CS-301', title: 'Data Structures', creditHours: 3, description: 'Core data structures and algorithm analysis.' },
    }),
    prisma.course.create({
      data: { programId: bscs.id, code: 'CS-401', title: 'Machine Learning', creditHours: 3, description: 'Supervised and unsupervised learning with applied projects.' },
    }),
    prisma.course.create({
      data: { programId: bscs.id, code: 'CS-302', title: 'Database Systems', creditHours: 3, description: 'Relational modelling, SQL and transaction processing.' },
    }),
    prisma.course.create({
      data: { programId: bsse.id, code: 'SE-301', title: 'Software Architecture', creditHours: 3, description: 'Architectural styles, quality attributes and documentation.' },
    }),
  ]);

  const [admin, sara, hamza, ayesha] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Dr. Ahmad Khan',
        email: env.SEED_ADMIN_EMAIL,
        passwordHash: adminHash,
        role: 'ADMIN',
        departmentId: department.id,
        employeeNo: 'UIIT-ADM-001',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Dr. Sara Malik',
        email: 'sara.malik@uiit.edu.pk',
        passwordHash: tutorHash,
        role: 'TUTOR',
        departmentId: department.id,
        employeeNo: 'UIIT-TUT-002',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Prof. Hamza Tariq',
        email: 'hamza.tariq@uiit.edu.pk',
        passwordHash: tutorHash,
        role: 'TUTOR',
        departmentId: department.id,
        employeeNo: 'UIIT-TUT-003',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Dr. Ayesha Noor',
        email: 'ayesha.noor@uiit.edu.pk',
        passwordHash: tutorHash,
        role: 'TUTOR',
        departmentId: department.id,
        employeeNo: 'UIIT-TUT-004',
      },
    }),
  ]);

  const studentNames = [
    ['Bilal Ahmed', 'BSCS-2022-001'],
    ['Ayesha Khan', 'BSCS-2022-002'],
    ['Hamna Raza', 'BSCS-2022-003'],
    ['Usman Ali', 'BSCS-2022-004'],
    ['Zainab Fatima', 'BSCS-2022-005'],
    ['Omar Farooq', 'BSCS-2022-006'],
    ['Hira Malik', 'BSCS-2022-007'],
    ['Ali Hassan', 'BSCS-2023-001'],
    ['Mahnoor Akram', 'BSCS-2023-002'],
    ['Taimoor Shah', 'BSCS-2023-003'],
    ['Noor ul Ain', 'BSSE-2023-001'],
    ['Sami Ullah', 'BSSE-2023-002'],
    ['Iqra Aslam', 'BSSE-2023-003'],
    ['Daniyal Riaz', 'BSSE-2023-004'],
  ];

  const students = [];
  for (const [index, [name, rollNo]] of studentNames.entries()) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@student.uiit.edu.pk`;
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: studentHash,
        role: 'STUDENT',
        departmentId: department.id,
        studentProfile: {
          create: {
            rollNo,
            programId: index < 10 ? bscs.id : bsse.id,
            batch: rollNo.includes('2022') ? '2022' : '2023',
          },
        },
      },
      include: { studentProfile: true },
    });
    students.push(user.studentProfile!);
  }

  /* ------------------------------ Outcomes ------------------------------ */
  const bscsPlos = await Promise.all(
    [
      ['PLO-1', 'Knowledge', 'COGNITIVE', 'PEC Criterion 4(a)', 65],
      ['PLO-2', 'Problem Analysis', 'COGNITIVE', 'PEC Criterion 4(b)', 65],
      ['PLO-3', 'Design and Development of Solutions', 'COGNITIVE', 'PEC Criterion 4(c)', 65],
      ['PLO-4', 'Investigation', 'COGNITIVE', 'PEC Criterion 4(d)', 60],
      ['PLO-5', 'Modern Tool Usage', 'PSYCHOMOTOR', 'PEC Criterion 4(e)', 60],
    ].map(([code, description, bloomDomain, accreditationRef, target]) =>
      prisma.plo.create({
        data: {
          programId: bscs.id,
          code: code as string,
          description: description as string,
          bloomDomain: bloomDomain as 'COGNITIVE',
          accreditationRef: accreditationRef as string,
          targetAttainment: target as number,
        },
      })
    )
  );
  const bssePlos = await Promise.all(
    [
      ['PLO-1', 'Engineering Knowledge', 'COGNITIVE', 65],
      ['PLO-2', 'Problem Analysis', 'COGNITIVE', 65],
      ['PLO-3', 'Design/Development of Solutions', 'COGNITIVE', 65],
    ].map(([code, description, bloomDomain, target]) =>
      prisma.plo.create({
        data: {
          programId: bsse.id,
          code: code as string,
          description: description as string,
          bloomDomain: bloomDomain as 'COGNITIVE',
          targetAttainment: target as number,
        },
      })
    )
  );
  const ploByCode = new Map(bscsPlos.map((plo) => [plo.code, plo]));

  const mlClos: Array<{ id: string }> = [];
  for (const [code, description, bloomLevel, mappings] of [
    ['CLO-1', 'Analyze supervised learning algorithms for classification and regression tasks', 'ANALYZE', [['PLO-2', 3]]],
    ['CLO-2', 'Evaluate model performance using appropriate metrics and validation strategies', 'EVALUATE', [['PLO-2', 2], ['PLO-3', 2]]],
    ['CLO-3', 'Design end-to-end machine learning pipelines for real-world problems', 'CREATE', [['PLO-3', 3], ['PLO-5', 1]]],
  ] as Array<[string, string, 'ANALYZE', Array<[string, number]>]>) {
    const clo = await prisma.clo.create({
      data: {
        courseId: ml.id,
        code,
        description,
        bloomLevel,
        masteryThreshold: 60,
        approvalStatus: 'APPROVED',
        createdById: sara.id,
        approvedById: admin.id,
        approvedAt: new Date(),
        ploMappings: {
          create: mappings.map(([ploCode, weight]) => ({ ploId: ploByCode.get(ploCode)!.id, weight })),
        },
      },
    });
    mlClos.push(clo);
  }
  await prisma.clo.create({
    data: {
      courseId: ml.id,
      code: 'CLO-4',
      description: 'Communicate machine learning findings to technical and non-technical audiences',
      bloomLevel: 'APPLY',
      masteryThreshold: 50,
      approvalStatus: 'PENDING',
      createdById: sara.id,
      ploMappings: { create: [{ ploId: ploByCode.get('PLO-4')!.id, weight: 2 }] },
    },
  });

  const dsClos: Array<{ id: string }> = [];
  for (const [code, description, bloomLevel, mappings] of [
    ['CLO-1', 'Explain the operations and complexity of core data structures', 'UNDERSTAND', [['PLO-1', 3]]],
    ['CLO-2', 'Analyze time and space complexity of algorithms', 'ANALYZE', [['PLO-2', 3]]],
    ['CLO-3', 'Apply appropriate data structures to solve programming problems', 'APPLY', [['PLO-3', 2]]],
  ] as Array<[string, string, 'UNDERSTAND', Array<[string, number]>]>) {
    const clo = await prisma.clo.create({
      data: {
        courseId: ds.id,
        code,
        description,
        bloomLevel,
        masteryThreshold: 55,
        approvalStatus: 'APPROVED',
        createdById: hamza.id,
        approvedById: admin.id,
        approvedAt: new Date(),
        ploMappings: {
          create: mappings.map(([ploCode, weight]) => ({ ploId: ploByCode.get(ploCode)!.id, weight })),
        },
      },
    });
    dsClos.push(clo);
  }

  const seClos: Array<{ id: string }> = [];
  for (const [code, description, bloomLevel, weight] of [
    ['CLO-1', 'Design software architectures that satisfy quality attributes', 'CREATE', 3],
    ['CLO-2', 'Evaluate architectural trade-offs using documented scenarios', 'EVALUATE', 2],
  ] as Array<[string, string, 'CREATE', number]>) {
    const clo = await prisma.clo.create({
      data: {
        courseId: se.id,
        code,
        description,
        bloomLevel,
        masteryThreshold: 55,
        approvalStatus: 'APPROVED',
        createdById: ayesha.id,
        approvedById: admin.id,
        approvedAt: new Date(),
        ploMappings: { create: [{ ploId: bssePlos[2].id, weight }] },
      },
    });
    seClos.push(clo);
  }

  /* ----------------------------- Offerings ------------------------------ */
  const mlOffering = await prisma.courseOffering.create({
    data: {
      courseId: ml.id,
      semesterId: spring2026.id,
      tutorId: sara.id,
      sectionName: 'BSCS-4A',
      status: 'ACTIVE',
      reportingPeriod: 'Spring 2026',
    },
  });
  const dsOffering = await prisma.courseOffering.create({
    data: {
      courseId: ds.id,
      semesterId: spring2026.id,
      tutorId: hamza.id,
      sectionName: 'BSCS-2A',
      status: 'ACTIVE',
      reportingPeriod: 'Spring 2026',
    },
  });
  const seOffering = await prisma.courseOffering.create({
    data: {
      courseId: se.id,
      semesterId: spring2026.id,
      tutorId: ayesha.id,
      sectionName: 'BSSE-3A',
      status: 'ACTIVE',
      reportingPeriod: 'Spring 2026',
    },
  });
  await prisma.courseOffering.create({
    data: {
      courseId: db.id,
      semesterId: spring2026.id,
      tutorId: hamza.id,
      sectionName: 'BSCS-3A',
      status: 'PLANNED',
      reportingPeriod: 'Spring 2026',
    },
  });
  await prisma.courseOffering.create({
    data: {
      courseId: ml.id,
      semesterId: fall2025.id,
      tutorId: sara.id,
      sectionName: 'BSCS-4A',
      status: 'COMPLETED',
      reportingPeriod: 'Fall 2025',
    },
  });

  // ML cohort: first 8 BSCS students. DS: first 6. SE: 4 BSSE students.
  await prisma.enrollment.createMany({
    data: [
      ...students.slice(0, 8).map((student) => ({ studentId: student.id, offeringId: mlOffering.id })),
      ...students.slice(0, 6).map((student) => ({ studentId: student.id, offeringId: dsOffering.id })),
      ...students.slice(10, 14).map((student) => ({ studentId: student.id, offeringId: seOffering.id })),
    ],
  });

  /* ---------------------------- Assessments ----------------------------- */
  const mlProject = await prisma.assessment.create({
    data: {
      offeringId: mlOffering.id,
      title: 'Applied Machine Learning Project',
      type: 'ASSIGNMENT',
      instructions:
        'Submit a single report covering exploratory analysis, model evaluation and a reproducible pipeline. Include your code repository link in the appendix.',
      maxMarks: 100,
      dueAt: day(-10),
      publishedAt: day(-25),
      resultsPublishedAt: day(-3),
      status: 'PUBLISHED',
      createdById: sara.id,
      items: {
        create: [
          {
            label: 'EDA and preprocessing',
            prompt: 'Explore the dataset and justify preprocessing decisions.',
            maxMarks: 20,
            position: 0,
            cloMappings: { create: [{ cloId: mlClos[0].id, weight: 1 }] },
          },
          {
            label: 'Model evaluation',
            prompt: 'Compare at least two models with appropriate validation and metrics.',
            maxMarks: 30,
            position: 1,
            cloMappings: { create: [{ cloId: mlClos[1].id, weight: 2 }] },
          },
          {
            label: 'Pipeline design',
            prompt: 'Document a reproducible end-to-end pipeline.',
            maxMarks: 50,
            position: 2,
            cloMappings: { create: [{ cloId: mlClos[2].id, weight: 1 }] },
          },
        ],
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });

  await prisma.assessment.create({
    data: {
      offeringId: mlOffering.id,
      title: 'Quiz 1 — Regression Foundations',
      type: 'QUIZ',
      instructions: 'Answer all short questions. One attempt only.',
      maxMarks: 20,
      dueAt: day(3),
      publishedAt: day(-2),
      status: 'PUBLISHED',
      createdById: sara.id,
      items: {
        create: [
          {
            label: 'Short answers',
            prompt: 'Explain bias-variance trade-off and regularisation.',
            maxMarks: 20,
            position: 0,
            cloMappings: { create: [{ cloId: mlClos[0].id, weight: 1 }] },
          },
        ],
      },
    },
  });

  await prisma.assessment.create({
    data: {
      offeringId: mlOffering.id,
      title: 'Assignment 2 — Feature Engineering',
      type: 'ASSIGNMENT',
      maxMarks: 20,
      dueAt: day(14),
      status: 'DRAFT',
      createdById: sara.id,
      items: {
        create: [
          {
            label: 'Feature study',
            maxMarks: 20,
            position: 0,
            cloMappings: { create: [{ cloId: mlClos[1].id, weight: 1 }] },
          },
        ],
      },
    },
  });

  const dsAssignment = await prisma.assessment.create({
    data: {
      offeringId: dsOffering.id,
      title: 'Data Structures Assignment 1',
      type: 'ASSIGNMENT',
      maxMarks: 40,
      dueAt: day(-5),
      publishedAt: day(-20),
      resultsPublishedAt: day(-1),
      status: 'PUBLISHED',
      createdById: hamza.id,
      items: {
        create: [
          {
            label: 'Complexity analysis',
            maxMarks: 20,
            position: 0,
            cloMappings: { create: [{ cloId: dsClos[1].id, weight: 1 }] },
          },
          {
            label: 'Implementation',
            maxMarks: 20,
            position: 1,
            cloMappings: { create: [{ cloId: dsClos[2].id, weight: 1 }] },
          },
        ],
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });

  // Deliberate spread: CLO-1 high, CLO-2 mixed, CLO-3 below target.
  const mlMarks = [
    [19, 28, 40],
    [18, 26, 35],
    [17, 24, 30],
    [16, 22, 25],
    [15, 18, 20],
    [14, 15, 15],
    [12, 12, 10],
    [10, 8, 5],
  ];
  for (const [index, student] of students.slice(0, 8).entries()) {
    const marks = mlMarks[index];
    const submission = await prisma.submission.create({
      data: {
        assessmentId: mlProject.id,
        studentId: student.id,
        content: `Project report submitted by ${student.rollNo}.`,
        status: 'GRADED',
        submittedAt: day(-12),
        gradedAt: day(-4),
        overallFeedback: 'Good structure. Strengthen evaluation depth and reproducibility notes.',
      },
    });
    await prisma.submissionItemGrade.createMany({
      data: mlProject.items.map((item, itemIndex) => ({
        submissionId: submission.id,
        itemId: item.id,
        marks: marks[itemIndex],
        state: 'GRADED' as const,
        feedback: itemIndex === 2 ? 'Pipeline steps are present but reproducibility is partial.' : 'Meets expectations.',
        gradedById: sara.id,
        gradedAt: day(-4),
      })),
    });
  }

  const dsMarks = [
    [18, 18],
    [16, 15],
    [14, 13],
    [12, 11],
    [10, 9],
    [8, 7],
  ];
  for (const [index, student] of students.slice(0, 6).entries()) {
    const submission = await prisma.submission.create({
      data: {
        assessmentId: dsAssignment.id,
        studentId: student.id,
        content: `Assignment submitted by ${student.rollNo}.`,
        status: 'GRADED',
        submittedAt: day(-7),
        gradedAt: day(-2),
        overallFeedback: 'Clear complexity analysis.',
      },
    });
    await prisma.submissionItemGrade.createMany({
      data: dsAssignment.items.map((item, itemIndex) => ({
        submissionId: submission.id,
        itemId: item.id,
        marks: dsMarks[index][itemIndex],
        state: 'GRADED' as const,
        gradedById: hamza.id,
        gradedAt: day(-2),
      })),
    });
  }

  /* ------------------------ Policy and attainment ----------------------- */
  const policy = await prisma.attainmentPolicy.create({
    data: {
      name: 'Institutional OBE Policy (default)',
      version: '2026.1',
      description:
        'Student-mastery CLO attainment with a cohort target, excluded missing evidence, and cohort-weighted CLO-to-PLO roll-up. Configurable; not a universal OBE formula.',
      config: DEFAULT_POLICY as never,
      isActive: true,
      createdById: admin.id,
    },
  });

  const mlRunResult = await computeOfferingAttainment(mlOffering.id, {
    policy: DEFAULT_POLICY,
    persist: true,
    computedById: sara.id,
    policyId: policy.id,
    reportingPeriod: 'Spring 2026',
  });
  if (mlRunResult.run) {
    await prisma.attainmentRun.update({
      where: { id: mlRunResult.run.id },
      data: { isFrozen: true, frozenAt: new Date() },
    });
  }
  const dsRunResult = await computeOfferingAttainment(dsOffering.id, {
    policy: DEFAULT_POLICY,
    persist: true,
    computedById: hamza.id,
    policyId: policy.id,
    reportingPeriod: 'Spring 2026',
  });
  if (dsRunResult.run) {
    await prisma.attainmentRun.update({
      where: { id: dsRunResult.run.id },
      data: { isFrozen: true, frozenAt: new Date() },
    });
  }

  const mlClo3 = mlRunResult.output?.cloResults.find((result) => result.cloId === mlClos[2].id);
  await prisma.improvementActionPlan.create({
    data: {
      offeringId: mlOffering.id,
      cloId: mlClos[2].id,
      createdById: sara.id,
      title: 'Strengthen reproducible pipeline evidence',
      description:
        'Add a scaffolded pipeline workshop and require a reproducible notebook with pinned dependencies. Evaluate against the next cohort.',
      status: 'IN_PROGRESS',
      dueDate: day(45),
    },
  });

  /* --------------------------- Notifications ---------------------------- */
  const studentsInMl = students.slice(0, 8);
  await prisma.notification.createMany({
    data: [
      ...studentsInMl.map((student) => ({
        userId: student.userId,
        type: 'ASSESSMENT_PUBLISHED' as const,
        title: 'New assessment published',
        body: 'Quiz 1 — Regression Foundations is now available, due in three days.',
        link: '/assessments',
        deliveryStatus: 'DELIVERED' as const,
        deliveredAt: new Date(),
      })),
      ...studentsInMl.map((student) => ({
        userId: student.userId,
        type: 'GRADE_PUBLISHED' as const,
        title: 'Results published',
        body: 'Your results and feedback for Applied Machine Learning Project are available.',
        link: '/assessments',
        deliveryStatus: 'DELIVERED' as const,
        deliveredAt: new Date(),
      })),
      {
        userId: admin.id,
        type: 'SYSTEM' as const,
        title: 'CLO awaiting approval',
        body: 'CLO-4 for CS-401 Machine Learning was submitted by Dr. Sara Malik.',
        link: '/courses',
        deliveryStatus: 'DELIVERED' as const,
        deliveredAt: new Date(),
      },
      {
        userId: sara.id,
        type: 'IMPROVEMENT_PLAN' as const,
        title: 'Attainment gap identified',
        body: 'CLO-3 in CS-401 is below its cohort target. An improvement plan is in progress.',
        link: '/reports',
        deliveryStatus: 'DELIVERED' as const,
        deliveredAt: new Date(),
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorId: admin.id,
        actorEmail: admin.email,
        action: 'INSERT',
        entityType: 'Program',
        entityId: bscs.id,
        metadata: { code: 'BSCS' },
        ip: '127.0.0.1',
      },
      {
        actorId: sara.id,
        actorEmail: sara.email,
        action: 'PUBLISH',
        entityType: 'Assessment',
        entityId: mlProject.id,
        metadata: { offeringId: mlOffering.id },
        ip: '127.0.0.1',
      },
      {
        actorId: sara.id,
        actorEmail: sara.email,
        action: 'COMPUTE_ATTAINMENT',
        entityType: 'AttainmentRun',
        entityId: mlRunResult.run?.id ?? null,
        metadata: { policyVersion: policy.version, engineVersion: ENGINE_VERSION },
        ip: '127.0.0.1',
      },
      {
        actorId: admin.id,
        actorEmail: admin.email,
        action: 'FINALIZE',
        entityType: 'AttainmentRun',
        entityId: mlRunResult.run?.id ?? null,
        metadata: { frozen: true },
        ip: '127.0.0.1',
      },
    ],
  });

  console.log('[seed] Complete.');
  console.log(`[seed] Admin: ${env.SEED_ADMIN_EMAIL}`);
  console.log('[seed] Tutor: sara.malik@uiit.edu.pk / hamza.tariq@uiit.edu.pk');
  console.log('[seed] Student: bilal.ahmed@student.uiit.edu.pk');
  console.log(`[seed] CLO-3 attainment (CS-401): ${mlClo3?.attainmentPct ?? 'n/a'}% (${mlClo3?.status ?? 'n/a'})`);
}

main()
  .catch((error) => {
    console.error('[seed] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
