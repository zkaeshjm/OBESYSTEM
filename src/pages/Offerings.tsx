import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ListChecks, Plus, Search } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync, formatDate } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  InlineSelect,
  Loading,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
} from '../components/ui';
import type { Course, Semester, User } from '../api/types';

const emptyForm = {
  courseId: '',
  semesterId: '',
  tutorId: '',
  sectionName: '',
  status: 'ACTIVE' as const,
  reportingPeriod: '',
};

export default function Offerings() {
  const { user, permissions } = useAuth();
  const { toast } = useToast();
  const [programId, setProgramId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const offeringsQuery = useAsync(() => api.offerings({ programId, semesterId, limit: 100 }), [programId, semesterId]);
  const programsQuery = useAsync(() => api.programs(), []);
  const semestersQuery = useAsync(() => api.semesters(), []);
  const coursesQuery = useAsync(() => api.courses({ limit: 100 }), []);
  const tutorsQuery = useAsync(() => (permissions?.manageAcademicStructure ? api.users({ role: 'TUTOR', limit: 100 }) : Promise.resolve(null)), [permissions?.manageAcademicStructure]);

  const offerings = offeringsQuery.data?.data ?? [];
  const programs = programsQuery.data?.data ?? [];
  const semesters: Semester[] = semestersQuery.data?.data ?? [];
  const courses: Course[] = coursesQuery.data?.data ?? [];
  const tutors: User[] = tutorsQuery.data?.data ?? [];

  const filtered = offerings.filter((offering) =>
    `${offering.course.code} ${offering.course.title} ${offering.sectionName} ${offering.tutor.name} ${offering.semester.name}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const openCreate = () => {
    setForm({
      ...emptyForm,
      courseId: courses[0]?.id ?? '',
      semesterId: semesters.find((semester) => semester.isActive)?.id ?? semesters[0]?.id ?? '',
      tutorId: tutors[0]?.id ?? '',
      reportingPeriod: semesters.find((semester) => semester.isActive)?.name ?? '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.courseId || !form.semesterId || !form.tutorId || !form.sectionName.trim()) {
      setFormError('Course, session, tutor and section name are required.');
      return;
    }
    setSaving(true);
    try {
      await api.createOffering({
        courseId: form.courseId,
        semesterId: form.semesterId,
        tutorId: form.tutorId,
        sectionName: form.sectionName.trim(),
        status: form.status,
        reportingPeriod: form.reportingPeriod.trim() || null,
      });
      toast('Course offering created and the tutor notified.');
      setModalOpen(false);
      await offeringsQuery.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to create the offering.');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (id: string, status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED') => {
    try {
      await api.updateOffering(id, { status });
      toast('Offering status updated.');
      await offeringsQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to update the offering.', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title={user?.role === 'STUDENT' ? 'My courses' : user?.role === 'TUTOR' ? 'My course offerings' : 'Course offerings'}
        description={
          user?.role === 'STUDENT'
            ? 'Offerings you are enrolled in. Open a course to see published outcomes, assessments and feedback.'
            : user?.role === 'TUTOR'
              ? 'Offerings assigned to you. Only your assigned students and assessments are visible.'
              : 'A course offering is a course taught to a section in a specific academic session.'
        }
        actions={
          permissions?.manageAcademicStructure ? (
            <Button onClick={openCreate} disabled={!courses.length || !semesters.length || !tutors.length}><Plus size={14} /> New offering</Button>
          ) : undefined
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search course, tutor or section…" className="pl-9" aria-label="Search offerings" />
        </div>
        {user?.role === 'ADMIN' && (
          <>
            <InlineSelect value={programId} onChange={(event) => setProgramId(event.target.value)} aria-label="Filter by programme">
              <option value="">All programmes</option>
              {programs.map((program) => <option key={program.id} value={program.id}>{program.code}</option>)}
            </InlineSelect>
            <InlineSelect value={semesterId} onChange={(event) => setSemesterId(event.target.value)} aria-label="Filter by session">
              <option value="">All sessions</option>
              {semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}</option>)}
            </InlineSelect>
          </>
        )}
      </Card>

      {offeringsQuery.loading ? (
        <Loading />
      ) : offeringsQuery.error ? (
        <ErrorState message={offeringsQuery.error} onRetry={offeringsQuery.reload} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No course offerings"
            description={
              permissions?.manageAcademicStructure
                ? 'Create an offering, assign a tutor and enrol students to start the OBE workflow.'
                : 'Nothing has been assigned or enrolled for you yet.'
            }
            action={permissions?.manageAcademicStructure ? <Button onClick={openCreate}>Create offering</Button> : undefined}
            icon={<ListChecks size={20} />}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-3 font-bold">Course</th>
                  <th className="px-4 py-3 font-bold">Session</th>
                  <th className="px-4 py-3 font-bold">Section</th>
                  <th className="px-4 py-3 font-bold">Tutor</th>
                  <th className="px-4 py-3 font-bold">Students</th>
                  <th className="px-4 py-3 font-bold">Assessments</th>
                  <th className="px-4 py-3 font-bold">Attainment</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 text-right font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((offering) => {
                  const run = offering.attainmentRuns?.[0];
                  return (
                    <tr key={offering.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3">
                        <Link to={`/offerings/${offering.id}`} className="text-[11px] font-semibold text-gray-900 hover:underline">
                          {offering.course.code} — {offering.course.title}
                        </Link>
                        <p className="text-[9px] text-gray-400">{offering.course.program?.code ?? ''}</p>
                      </td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering.semester.name}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering.sectionName}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering.tutor.name}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering._count?.enrollments ?? 0}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering._count?.assessments ?? 0}</td>
                      <td className="px-4 py-3">
                        {run ? <Badge tone={run.isFrozen ? 'green' : 'amber'}>{run.isFrozen ? 'Frozen run' : 'Draft run'}</Badge> : <Badge>Not calculated</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        {user?.role === 'ADMIN' && offering.status !== 'ARCHIVED' ? (
                          <InlineSelect value={offering.status} onChange={(event) => void changeStatus(offering.id, event.target.value as 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED')} aria-label={`Status for ${offering.course.code}`}>
                            <option value="PLANNED">Planned</option>
                            <option value="ACTIVE">Active</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="ARCHIVED">Archived</option>
                          </InlineSelect>
                        ) : (
                          <StatusBadge status={offering.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/offerings/${offering.id}`} className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[9px] font-semibold text-gray-600 hover:bg-gray-50">
                          Open <ArrowUpRight size={10} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-gray-100 px-4 py-2 text-[9px] text-gray-400">
            {filtered.length} offering{filtered.length === 1 ? '' : 's'}
            {filtered[0] ? ` · latest activity ${formatDate(filtered[0].attainmentRuns?.[0]?.computedAt)}` : ''}
          </p>
        </Card>
      )}

      <Modal
        open={modalOpen}
        title="Create course offering"
        description="The selected tutor receives a notification and can then author assessments for this section."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="offering-form" type="submit" loading={saving}>Create offering</Button>
          </>
        }
      >
        <form id="offering-form" onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Course" htmlFor="offering-course" required>
            <Select id="offering-course" value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })} required>
              <option value="">Select a course</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Academic session" htmlFor="offering-semester" required>
              <Select id="offering-semester" value={form.semesterId} onChange={(event) => {
                const semester = semesters.find((item) => item.id === event.target.value);
                setForm({ ...form, semesterId: event.target.value, reportingPeriod: semester?.name ?? form.reportingPeriod });
              }} required>
                <option value="">Select a session</option>
                {semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}{semester.isActive ? ' (active)' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Assigned tutor" htmlFor="offering-tutor" required>
              <Select id="offering-tutor" value={form.tutorId} onChange={(event) => setForm({ ...form, tutorId: event.target.value })} required>
                <option value="">Select a tutor</option>
                {tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Section name" htmlFor="offering-section" hint="For example: BSCS-4A" required>
              <Input id="offering-section" value={form.sectionName} onChange={(event) => setForm({ ...form, sectionName: event.target.value })} required />
            </Field>
            <Field label="Status" htmlFor="offering-status">
              <Select id="offering-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as typeof form.status })}>
                <option value="PLANNED">Planned</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            </Field>
          </div>
          <Field label="Reporting period" htmlFor="offering-period" hint="Used on attainment reports and frozen runs.">
            <Input id="offering-period" value={form.reportingPeriod} onChange={(event) => setForm({ ...form, reportingPeriod: event.target.value })} />
          </Field>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
