export type Role = 'ADMIN' | 'TUTOR' | 'STUDENT';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId?: string | null;
  department?: { id: string; name: string; code?: string } | null;
  lastLoginAt?: string | null;
  isActive?: boolean;
  employeeNo?: string | null;
  phone?: string | null;
  studentProfile?: StudentProfile | null;
}

export interface Permissions {
  manageUsers: boolean;
  manageAcademicStructure: boolean;
  manageProgramOutcomes: boolean;
  manageNotifications: boolean;
  viewAuditLog: boolean;
  authorClos: boolean;
  approveClos: boolean;
  authorAssessments: boolean;
  grade: boolean;
  computeAttainment: boolean;
  submitAssessments: boolean;
  viewReports: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  hodName?: string | null;
  contact?: string | null;
  isActive: boolean;
  _count?: { programs: number; users: number };
}

export interface Program {
  id: string;
  departmentId: string;
  name: string;
  code: string;
  creditHours: number;
  accreditationBody?: string | null;
  isActive: boolean;
  department?: Pick<Department, 'id' | 'name' | 'code'>;
  _count?: { courses: number; plos: number; students: number };
}

export interface Semester {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  _count?: { offerings: number };
}

export interface Course {
  id: string;
  programId: string;
  code: string;
  title: string;
  description?: string | null;
  creditHours: number;
  isActive: boolean;
  program?: Pick<Program, 'id' | 'code' | 'name'> & { departmentId?: string };
  _count?: { clos: number; offerings: number };
  clos?: Clo[];
  offerings?: CourseOffering[];
}

export interface CourseOffering {
  id: string;
  courseId: string;
  semesterId: string;
  tutorId: string;
  sectionName: string;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  reportingPeriod?: string | null;
  course: Pick<Course, 'id' | 'code' | 'title' | 'programId'> & {
    program?: Pick<Program, 'id' | 'code' | 'name'>;
    clos?: Clo[];
  };
  semester: Semester;
  tutor: { id: string; name: string; email?: string };
  enrollments?: Enrollment[];
  assessments?: Assessment[];
  _count?: { enrollments: number; assessments: number };
  attainmentRuns?: AttainmentRunSummary[];
}

export interface Enrollment {
  id: string;
  studentId: string;
  offeringId?: string;
  status: 'ENROLLED' | 'DROPPED' | 'WITHDRAWN' | 'COMPLETED';
  enrolledAt: string;
  student?: StudentProfile;
}

export interface StudentProfile {
  id: string;
  userId: string;
  rollNo: string;
  programId: string;
  batch?: string | null;
  isActive?: boolean;
  user?: Pick<User, 'id' | 'name' | 'email' | 'isActive'>;
  program?: Pick<Program, 'id' | 'code' | 'name'>;
  _count?: { enrollments: number };
}

export interface Plo {
  id: string;
  programId: string;
  code: string;
  description: string;
  bloomDomain: 'COGNITIVE' | 'PSYCHOMOTOR' | 'AFFECTIVE';
  accreditationRef?: string | null;
  targetAttainment: string | number;
  isActive: boolean;
  program?: Pick<Program, 'id' | 'code' | 'name'>;
  _count?: { cloMappings: number; attainment: number };
}

export interface CloPloMapping {
  id?: string;
  cloId: string;
  ploId: string;
  weight: number;
  plo?: Pick<Plo, 'id' | 'code' | 'description' | 'targetAttainment'>;
  clo?: Pick<Clo, 'id' | 'code' | 'description'> & { course?: Pick<Course, 'id' | 'code'> };
}

export interface Clo {
  id: string;
  courseId: string;
  code: string;
  description: string;
  bloomLevel: string;
  masteryThreshold: string | number;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionNote?: string | null;
  createdById?: string;
  createdBy?: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
  approvedAt?: string | null;
  archivedAt?: string | null;
  ploMappings: CloPloMapping[];
  _count?: { itemMappings: number; attainment: number };
  course?: Pick<Course, 'id' | 'code' | 'title' | 'programId'>;
}

export interface RubricCriterion {
  id: string;
  itemId?: string;
  label: string;
  description?: string | null;
  maxMarks: string | number;
  position?: number;
}

export interface CriterionGrade {
  id?: string;
  criterionId: string;
  marks: string | number;
  feedback?: string | null;
  criterion?: Pick<RubricCriterion, 'id' | 'label' | 'maxMarks'>;
}

export interface AssessmentItem {
  id: string;
  assessmentId?: string;
  label: string;
  prompt?: string | null;
  maxMarks: string | number;
  position: number;
  rubricCriteria?: RubricCriterion[];
  cloMappings: Array<{
    id?: string;
    cloId: string;
    weight: string | number;
    clo?: Pick<Clo, 'id' | 'code' | 'description'>;
  }>;
}

export type AssessmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
export type AssessmentType =
  | 'ASSIGNMENT'
  | 'QUIZ'
  | 'LAB'
  | 'PRESENTATION'
  | 'MID_EXAM'
  | 'PROJECT'
  | 'FINAL_EXAM'
  | 'OTHER';
export type LatePolicy = 'ACCEPT' | 'REJECT' | 'MARK_LATE';

export interface Assessment {
  id: string;
  offeringId: string;
  title: string;
  type: AssessmentType;
  instructions?: string | null;
  maxMarks: string | number;
  passingMarks?: string | number | null;
  submissionFormat?: string | null;
  latePolicy: LatePolicy;
  dueAt?: string | null;
  publishedAt?: string | null;
  resultsPublishedAt?: string | null;
  status: AssessmentStatus;
  createdAt: string;
  offering?: CourseOffering;
  items?: AssessmentItem[];
  submissions?: Submission[];
  _count?: { items: number; submissions: number };
  canViewResults?: boolean;
}

export type GradeState = 'GRADED' | 'EXCUSED' | 'INCOMPLETE';

export interface Grade {
  id?: string;
  submissionId?: string;
  itemId: string;
  marks: string | number;
  state: GradeState;
  feedback?: string | null;
}

export interface GradeChange {
  id: string;
  submissionId: string;
  itemId?: string | null;
  previousMarks?: string | number | null;
  newMarks: string | number;
  reason?: string | null;
  createdAt: string;
  actor?: { id: string; name: string; role: Role } | null;
  item?: { id: string; label: string } | null;
}

export interface Submission {
  id: string;
  assessmentId: string;
  studentId: string;
  content?: string | null;
  attachmentUrl?: string | null;
  status: 'SUBMITTED' | 'LATE' | 'GRADED' | 'RETURNED';
  submittedAt: string;
  isLate: boolean;
  overallFeedback?: string | null;
  gradedAt?: string | null;
  student?: StudentProfile;
  grades: Grade[];
  criterionGrades?: CriterionGrade[];
  assessment?: Assessment;
  canViewResults?: boolean;
}

export interface AttainmentRunSummary {
  id: string;
  computedAt: string;
  isFrozen: boolean;
  policyVersion: string;
  engineVersion?: string;
  reportingPeriod?: string;
  policy?: { id: string; name: string; version: string };
  computedBy?: { id: string; name: string } | null;
  _count?: { cloResults: number; ploResults: number };
}

export type AttainmentStatus = 'MET' | 'AT_RISK' | 'NOT_MET' | 'INSUFFICIENT_DATA';

export interface CloAttainment {
  id?: string;
  cloId: string;
  cohortSize: number;
  eligibleCount: number;
  attainedCount: number;
  meanScore: string | number;
  attainmentPct: string | number;
  targetPct: string | number;
  status: AttainmentStatus;
  missingEvidenceCount: number;
  clo: Pick<Clo, 'id' | 'code' | 'description'>;
}

export interface PloAttainment {
  id?: string;
  ploId: string;
  attainmentPct: string | number;
  targetPct: string | number;
  status: AttainmentStatus;
  contributingClos: number;
  weightedCohort: string | number;
  plo: Pick<Plo, 'id' | 'code' | 'description' | 'targetAttainment'>;
}

export interface AttainmentRun extends AttainmentRunSummary {
  offeringId?: string;
  cloResults: CloAttainment[];
  ploResults: PloAttainment[];
  policySnapshot?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  readAt?: string | null;
  deliveryStatus: 'PENDING' | 'DELIVERED' | 'FAILED';
  deliveredAt?: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorEmail?: string | null;
  actor?: { id: string; name: string; role: Role } | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt: string;
}

export interface ImprovementPlan {
  id: string;
  offeringId: string;
  cloId?: string | null;
  title: string;
  description: string;
  gapDescription?: string | null;
  followUp?: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  dueDate?: string | null;
  evaluation?: string | null;
  evaluatedAt?: string | null;
  createdAt: string;
  clo?: Pick<Clo, 'id' | 'code'> | null;
  offering?: Pick<CourseOffering, 'id'> & { course?: Pick<Course, 'id' | 'code' | 'title'> };
  createdBy?: { id: string; name: string };
}

export interface CourseMaterial {
  id: string;
  offeringId: string;
  title: string;
  description?: string | null;
  url: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string };
}

export interface AttainmentPolicy {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  createdBy?: { id: string; name: string };
  _count?: { runs: number };
}

export interface ReportCloRow {
  runId: string;
  offeringId: string;
  computedAt: string;
  isFrozen: boolean;
  policyVersion: string;
  engineVersion: string;
  course: Pick<Course, 'id' | 'code' | 'title'> & { program?: Program };
  semester: Pick<Semester, 'id' | 'name'>;
  tutor: { id: string; name: string };
  clo: { id: string; code: string; description: string };
  cohortSize: number;
  eligibleCount: number;
  attainedCount: number;
  meanScore: number;
  attainmentPct: number;
  targetPct: number;
  status: AttainmentStatus;
  missingEvidenceCount: number;
}

export interface ReportPloRow {
  plo: { id: string; code: string; description: string; targetAttainment: number };
  attainmentPct: number;
  targetPct: number;
  status: AttainmentStatus;
  contributingClos: number;
  weightedCohort: number;
  runIds: string[];
}

export interface AttainmentReport {
  filters: { programId?: string; semesterId?: string; offeringId?: string };
  note: string;
  runs: Array<
    AttainmentRunSummary & {
      offeringId: string;
      course: Pick<Course, 'code' | 'title'>;
      semester: Pick<Semester, 'name'>;
      tutor: { name: string };
      computedBy?: { name: string } | null;
    }
  >;
  cloRows: ReportCloRow[];
  ploRows: ReportPloRow[];
  summary: {
    clo: StatusCounts;
    plo: StatusCounts;
    policy: { id: string; name: string; version: string } | null;
    aggregationBand: number;
  };
  provenance: { source: string; latestRunPerOffering: boolean; offeringCount: number };
}

export interface StatusCounts {
  total: number;
  met: number;
  atRisk: number;
  notMet: number;
  insufficientData: number;
}

export interface Paginated<T> {
  data: T[];
  meta: {
    requestId?: string;
    page: number;
    limit: number;
    total: number;
    [key: string]: unknown;
  };
}

export interface AppNotificationList {
  data: Notification[];
  meta: { unread: number; total: number; page: number; limit: number };
}
