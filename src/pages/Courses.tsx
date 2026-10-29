import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Pencil, Plus, Search, UserX } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
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
  Textarea,
  useConfirm,
} from '../components/ui';
import type { Course } from '../api/types';

const emptyForm = { programId: '', code: '', title: '', description: '', creditHours: 3 };

export default function Courses() {
  const { user, permissions } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [programId, setProgramId] = useState('');
  const [search, setSearch] = useState('');
  const programsQuery = useAsync(() => api.programs(), []);
  const coursesQuery = useAsync(() => api.courses({ programId, limit: 100 }), [programId]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const programs = programsQuery.data?.data ?? [];
  const courses = coursesQuery.data?.data ?? [];
  const filtered = courses.filter((course) =>
    `${course.code} ${course.title}`.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, programId: programId || programs[0]?.id || '' });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (course: Course) => {
    setEditing(course);
    setForm({
      programId: course.programId,
      code: course.code,
      title: course.title,
      description: course.description ?? '',
      creditHours: course.creditHours,
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.programId || !form.code.trim() || !form.title.trim()) {
      setFormError('Programme, code and title are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        programId: form.programId,
        code: form.code.trim().toUpperCase(),
        title: form.title.trim(),
        description: form.description.trim() || null,
        creditHours: Number(form.creditHours),
      };
      if (editing) {
        await api.updateCourse(editing.id, payload);
        toast('Course updated.');
      } else {
        await api.createCourse(payload);
        toast('Course created. Add CLOs before creating assessments.');
      }
      setModalOpen(false);
      await coursesQuery.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to save the course.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (course: Course) => {
    const confirmed = await confirm({
      title: 'Deactivate course',
      message: `Deactivate ${course.code} — ${course.title}? Existing offerings and evidence remain available.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deactivateCourse(course.id);
      toast('Course deactivated.');
      await coursesQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to deactivate the course.', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Course catalogue"
        description={
          user?.role === 'ADMIN'
            ? 'Course definitions are independent of semester delivery. Create an offering to teach a course in a session.'
            : 'Courses you are assigned to teach across all offerings.'
        }
        actions={
          permissions?.manageAcademicStructure ? (
            <Button onClick={openCreate} disabled={!programs.length}><Plus size={14} /> New course</Button>
          ) : undefined
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search course code or title…" className="pl-9" aria-label="Search courses" />
        </div>
        <InlineSelect value={programId} onChange={(event) => setProgramId(event.target.value)} aria-label="Filter by programme">
          <option value="">All programmes</option>
          {programs.map((program) => (
            <option key={program.id} value={program.id}>{program.code} — {program.name}</option>
          ))}
        </InlineSelect>
      </Card>

      {coursesQuery.loading ? (
        <Loading />
      ) : coursesQuery.error ? (
        <ErrorState message={coursesQuery.error} onRetry={coursesQuery.reload} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={courses.length ? 'No matching courses' : 'No courses yet'}
            description={user?.role === 'ADMIN' ? 'Create a course, then author its CLOs and map them to programme PLOs.' : 'An administrator has not assigned a course offering to you yet.'}
            action={permissions?.manageAcademicStructure && programs.length ? <Button onClick={openCreate}>Create course</Button> : undefined}
            icon={<BookOpen size={20} />}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((course) => (
            <Card key={course.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/courses/${course.id}`} className="group">
                  <p className="font-mono text-[10px] font-semibold text-gray-400">{course.code}</p>
                  <h2 className="mt-0.5 text-sm font-bold text-gray-900 group-hover:underline">{course.title}</h2>
                  <p className="mt-0.5 text-[10px] text-gray-500">{course.program?.code} · {course.creditHours} credit hours</p>
                </Link>
                <Badge tone={course.isActive ? 'green' : 'gray'}>{course.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>
              {course.description && <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-gray-500">{course.description}</p>}
              <div className="mt-3 flex items-center gap-3 text-[10px]">
                <span className="rounded-full bg-gray-50 px-2 py-1 font-medium text-gray-600">{course._count?.clos ?? 0} CLOs</span>
                <span className="rounded-full bg-gray-50 px-2 py-1 font-medium text-gray-600">{course._count?.offerings ?? 0} offerings</span>
              </div>
              <div className="mt-auto flex items-center justify-end gap-1 pt-3">
                <Link to={`/courses/${course.id}`}>
                  <Button variant="secondary" size="sm">Open CLOs</Button>
                </Link>
                {permissions?.manageAcademicStructure && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(course)} aria-label={`Edit ${course.code}`}><Pencil size={12} /></Button>
                    {course.isActive && (
                      <Button variant="ghost" size="sm" onClick={() => void deactivate(course)} aria-label={`Deactivate ${course.code}`}><UserX size={12} /></Button>
                    )}
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Edit course' : 'Create course'}
        description="A course can be offered in any number of sessions. CLOs belong to the course definition."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="course-form" type="submit" loading={saving}>{editing ? 'Save changes' : 'Create course'}</Button>
          </>
        }
      >
        <form id="course-form" onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Programme" htmlFor="course-program" required>
            <Select id="course-program" value={form.programId} onChange={(event) => setForm({ ...form, programId: event.target.value })} required>
              <option value="">Select a programme</option>
              {programs.filter((program) => program.isActive).map((program) => (
                <option key={program.id} value={program.id}>{program.code} — {program.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Course title" htmlFor="course-title" required>
              <Input id="course-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
            </Field>
            <Field label="Code" htmlFor="course-code" required>
              <Input id="course-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required />
            </Field>
          </div>
          <Field label="Credit hours" htmlFor="course-credits" required>
            <Input id="course-credits" type="number" min={1} max={6} value={form.creditHours} onChange={(event) => setForm({ ...form, creditHours: Number(event.target.value) })} required />
          </Field>
          <Field label="Description" htmlFor="course-description">
            <Textarea id="course-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} />
          </Field>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
