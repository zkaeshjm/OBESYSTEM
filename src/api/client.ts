import type {
  Assessment,
  AttainmentPolicy,
  AttainmentReport,
  AttainmentRun,
  AuditLog,
  Clo,
  CloPloMapping,
  Course,
  CourseOffering,
  Department,
  ImprovementPlan,
  Notification,
  Paginated,
  Permissions,
  Plo,
  Program,
  Semester,
  StudentProfile,
  Submission,
  User,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}

type QueryValue = string | number | boolean | null | undefined;

export function withQuery(path: string, query?: Record<string, QueryValue>) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return false;
    const body = await response.json();
    accessToken = body.data.accessToken as string;
    return true;
  } catch {
    return false;
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, QueryValue>; retry?: boolean } = {}
): Promise<T> {
  const url = `/api/v1${withQuery(path, options.query)}`;
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && options.retry !== false && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      return request<T>(method, path, { ...options, retry: false });
    }
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = body?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'REQUEST_FAILED',
      error.message ?? `Request failed (${response.status})`,
      error.details
    );
  }
  return body as T;
}

export interface SessionResponse {
  data: { accessToken: string; user: User; permissions: Permissions };
}

export const api = {
  login: (email: string, password: string) =>
    request<SessionResponse>('POST', '/auth/login', { body: { email, password } }),
  refresh: async () => {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw new ApiError(401, 'UNAUTHENTICATED', 'No active session');
    return (await response.json()) as SessionResponse;
  },
  logout: () => request<{ data: { ok: boolean } }>('POST', '/auth/logout'),
  me: () => request<{ data: { user: User; permissions: Permissions } }>('GET', '/auth/me'),
  updateMe: (body: { name?: string; phone?: string | null }) =>
    request<{ data: { user: User } }>('PATCH', '/auth/me', { body }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('PATCH', '/auth/password', { body: { currentPassword, newPassword } }),

  dashboard: () => request<{ data: Record<string, unknown> }>('GET', '/dashboard'),

  departments: () => request<{ data: Department[] }>('GET', '/departments'),
  createDepartment: (body: Partial<Department>) => request<{ data: Department }>('POST', '/departments', { body }),
  updateDepartment: (id: string, body: Partial<Department>) =>
    request<{ data: Department }>('PATCH', `/departments/${id}`, { body }),
  deactivateDepartment: (id: string) => request('DELETE', `/departments/${id}`),

  programs: (query?: Record<string, QueryValue>) => request<{ data: Program[] }>('GET', '/programs', { query }),
  createProgram: (body: Partial<Program>) => request<{ data: Program }>('POST', '/programs', { body }),
  updateProgram: (id: string, body: Partial<Program>) => request<{ data: Program }>('PATCH', `/programs/${id}`, { body }),
  deactivateProgram: (id: string) => request('DELETE', `/programs/${id}`),

  semesters: () => request<{ data: Semester[] }>('GET', '/semesters'),
  createSemester: (body: { name: string; startDate: string; endDate: string; isActive?: boolean }) =>
    request<{ data: Semester }>('POST', '/semesters', { body }),
  updateSemester: (id: string, body: Partial<Semester>) => request<{ data: Semester }>('PATCH', `/semesters/${id}`, { body }),
  deleteSemester: (id: string) => request('DELETE', `/semesters/${id}`),

  courses: (query?: Record<string, QueryValue>) => request<Paginated<Course>>('GET', '/courses', { query }),
  course: (id: string) => request<{ data: Course }>('GET', `/courses/${id}`),
  createCourse: (body: Partial<Course>) => request<{ data: Course }>('POST', '/courses', { body }),
  updateCourse: (id: string, body: Partial<Course>) => request<{ data: Course }>('PATCH', `/courses/${id}`, { body }),
  deactivateCourse: (id: string) => request('DELETE', `/courses/${id}`),

  offerings: (query?: Record<string, QueryValue>) => request<Paginated<CourseOffering>>('GET', '/offerings', { query }),
  offering: (id: string) => request<{ data: CourseOffering }>('GET', `/offerings/${id}`),
  createOffering: (body: Partial<CourseOffering>) => request<{ data: CourseOffering }>('POST', '/offerings', { body }),
  updateOffering: (id: string, body: Partial<CourseOffering>) =>
    request<{ data: CourseOffering }>('PATCH', `/offerings/${id}`, { body }),
  archiveOffering: (id: string) => request('DELETE', `/offerings/${id}`),
  enroll: (offeringId: string, studentIds: string[]) =>
    request('POST', `/offerings/${offeringId}/enrollments`, { body: { studentIds } }),
  updateEnrollment: (id: string, status: string) =>
    request('PATCH', `/enrollments/${id}`, { body: { status } }),

  users: (query?: Record<string, QueryValue>) => request<Paginated<User>>('GET', '/users', { query }),
  createUser: (body: Record<string, unknown>) => request<{ data: User }>('POST', '/users', { body }),
  updateUser: (id: string, body: Record<string, unknown>) => request<{ data: User }>('PATCH', `/users/${id}`, { body }),
  resetPassword: (id: string, password: string) =>
    request('POST', `/users/${id}/reset-password`, { body: { password } }),
  students: (query?: Record<string, QueryValue>) => request<Paginated<StudentProfile>>('GET', '/students', { query }),
  meStudent: () => request<{ data: StudentProfile & { enrollments: unknown[] } }>('GET', '/students/me'),

  clos: (query?: Record<string, QueryValue>) => request<{ data: Clo[] }>('GET', '/clos', { query }),
  createClo: (body: Record<string, unknown>) => request<{ data: Clo }>('POST', '/clos', { body }),
  updateClo: (id: string, body: Record<string, unknown>) => request<{ data: Clo }>('PATCH', `/clos/${id}`, { body }),
  approveClo: (id: string) => request('POST', `/clos/${id}/approve`),
  rejectClo: (id: string, note: string) => request('POST', `/clos/${id}/reject`, { body: { note } }),
  deleteClo: (id: string) => request('DELETE', `/clos/${id}`),
  archiveClo: (id: string) => request<{ data: Clo }>('POST', `/clos/${id}/archive`),
  unarchiveClo: (id: string) => request<{ data: Clo }>('POST', `/clos/${id}/unarchive`),

  plos: (query?: Record<string, QueryValue>) => request<{ data: Plo[] }>('GET', '/plos', { query }),
  createPlo: (body: Record<string, unknown>) => request<{ data: Plo }>('POST', '/plos', { body }),
  updatePlo: (id: string, body: Record<string, unknown>) => request<{ data: Plo }>('PATCH', `/plos/${id}`, { body }),
  deactivatePlo: (id: string) => request('DELETE', `/plos/${id}`),
  mappings: (query?: Record<string, QueryValue>) => request<{ data: CloPloMapping[] }>('GET', '/clo-plo-mappings', { query }),
  mapCloPlo: (body: { cloId: string; ploId: string; weight: number }) =>
    request<{ data: CloPloMapping }>('POST', '/clo-plo-mappings', { body }),
  deleteMapping: (id: string) => request('DELETE', `/clo-plo-mappings/${id}`),

  assessments: (offeringId: string) =>
    request<Paginated<Assessment>>('GET', '/assessments', { query: { offeringId, limit: 100 } }),
  assessment: (id: string) => request<{ data: Assessment }>('GET', `/assessments/${id}`),
  createAssessment: (body: Record<string, unknown>) => request<{ data: Assessment }>('POST', '/assessments', { body }),
  updateAssessment: (id: string, body: Record<string, unknown>) =>
    request<{ data: Assessment }>('PATCH', `/assessments/${id}`, { body }),
  publishAssessment: (id: string) => request<{ data: Assessment }>('POST', `/assessments/${id}/publish`),
  closeAssessment: (id: string) => request<{ data: Assessment }>('POST', `/assessments/${id}/close`),
  archiveAssessment: (id: string) => request<{ data: Assessment }>('POST', `/assessments/${id}/archive`),
  restoreAssessment: (id: string) => request<{ data: Assessment }>('POST', `/assessments/${id}/restore`),
  deleteAssessment: (id: string) => request('DELETE', `/assessments/${id}`),
  submissions: (assessmentId: string) => request<{ data: Submission[] }>('GET', `/assessments/${assessmentId}/submissions`),
  submit: (assessmentId: string, body: { content?: string; attachmentUrl?: string }) =>
    request<{ data: Submission }>('POST', `/assessments/${assessmentId}/submissions`, { body }),
  updateSubmission: (id: string, body: { content?: string; attachmentUrl?: string }) =>
    request<{ data: Submission }>('PATCH', `/submissions/${id}`, { body }),
  submission: (id: string) => request<{ data: Submission }>('GET', `/submissions/${id}`),
  grade: (submissionId: string, body: unknown) =>
    request('PUT', `/submissions/${submissionId}/grades`, { body }),
  gradeHistory: (submissionId: string) =>
    request<{ data: import('./types').GradeChange[] }>('GET', `/submissions/${submissionId}/grade-history`),
  publishResults: (assessmentId: string) =>
    request<{ data: Assessment }>('POST', `/assessments/${assessmentId}/publish-results`),

  attainmentLatest: (offeringId: string) =>
    request<{ data: AttainmentRun | null }>('GET', `/offerings/${offeringId}/attainment/latest`),
  attainmentRuns: (offeringId: string) =>
    request<{ data: AttainmentRun[] }>('GET', `/offerings/${offeringId}/attainment-runs`),
  attainmentRun: (id: string) => request<{ data: AttainmentRun }>('GET', `/attainment-runs/${id}`),
  computeAttainment: (offeringId: string, body: { policyId?: string; reportingPeriod?: string }) =>
    request<{ data: AttainmentRun }>('POST', `/offerings/${offeringId}/attainment-runs`, { body }),
  freezeRun: (id: string) => request<{ data: AttainmentRun }>('POST', `/attainment-runs/${id}/freeze`),
  progress: () =>
    request<{
      data: {
        offerings: Array<{
          offering: CourseOffering;
          run: AttainmentRun | null;
          cloScores: Array<{
            cloId: string;
            code: string;
            score: number | null;
            mastered: boolean | null;
            masteryThreshold: number;
            cohortAttainmentPct: number;
            cohortStatus: string;
          }>;
          message: string | null;
        }>;
      };
    }>('GET', '/students/me/progress'),

  report: (query?: Record<string, QueryValue>) => request<{ data: AttainmentReport }>('GET', '/reports/attainment', { query }),
  gaps: (query?: Record<string, QueryValue>) => request<{ data: Record<string, unknown> }>('GET', '/reports/gaps', { query }),

  policies: () => request<{ data: AttainmentPolicy[] }>('GET', '/attainment-policies'),
  createPolicy: (body: Record<string, unknown>) => request<{ data: AttainmentPolicy }>('POST', '/attainment-policies', { body }),
  activatePolicy: (id: string) => request<{ data: AttainmentPolicy }>('POST', `/attainment-policies/${id}/activate`),

  notifications: (query?: Record<string, QueryValue>) =>
    request<{ data: Notification[]; meta: { unread: number; total: number } }>('GET', '/notifications', { query }),
  unreadCount: () => request<{ data: { unread: number } }>('GET', '/notifications/unread-count'),
  markRead: (id: string) => request('PATCH', `/notifications/${id}/read`),
  markAllRead: () => request('POST', '/notifications/read-all'),
  broadcast: (body: Record<string, unknown>) => request('POST', '/notifications', { body }),

  audits: (query?: Record<string, QueryValue>) => request<Paginated<AuditLog>>('GET', '/audit-logs', { query }),
  auditFilters: () => request<{ data: { actions: string[]; entityTypes: string[] } }>('GET', '/audit-logs/filters'),

  materials: (offeringId: string) => request<{ data: import('./types').CourseMaterial[] }>('GET', `/offerings/${offeringId}/materials`),
  createMaterial: (offeringId: string, body: Record<string, unknown>) =>
    request<{ data: import('./types').CourseMaterial }>('POST', `/offerings/${offeringId}/materials`, { body }),
  updateMaterial: (id: string, body: Record<string, unknown>) =>
    request<{ data: import('./types').CourseMaterial }>('PATCH', `/materials/${id}`, { body }),
  deleteMaterial: (id: string) => request('DELETE', `/materials/${id}`),

  plans: (offeringId: string) => request<{ data: ImprovementPlan[] }>('GET', `/offerings/${offeringId}/action-plans`),
  createPlan: (offeringId: string, body: Record<string, unknown>) =>
    request<{ data: ImprovementPlan }>('POST', `/offerings/${offeringId}/action-plans`, { body }),
  updatePlan: (id: string, body: Record<string, unknown>) =>
    request<{ data: ImprovementPlan }>('PATCH', `/action-plans/${id}`, { body }),
};

// CSV is fetched with the in-memory bearer token (the export endpoint is
// authenticated exactly like the HTML report), then handed to the browser as a
// download. This keeps authorization identical for displayed and exported data.
export async function downloadAttainmentCsv(query?: Record<string, QueryValue>): Promise<void> {
  const url = `/api/v1${withQuery('/reports/attainment.csv', query)}`;
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response = await fetch(url, { headers, credentials: 'include' });
  if (response.status === 401 && (await refreshSession())) {
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(url, { headers, credentials: 'include' });
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'Unable to export the report.');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'obe-attainment.csv';
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
