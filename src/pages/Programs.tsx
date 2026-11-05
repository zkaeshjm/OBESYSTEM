import { useState, type FormEvent } from 'react';
import { GraduationCap, Pencil, Plus, Search, UserX } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  useConfirm,
} from '../components/ui';
import type { Department, Program } from '../api/types';

const emptyForm = {
  departmentId: '',
  name: '',
  code: '',
  creditHours: 130,
  accreditationBody: 'PEC',
};

export default function Programs() {
  const programsQuery = useAsync(() => api.programs(), []);
  const departmentsQuery = useAsync(() => api.departments(), []);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const programs = programsQuery.data?.data ?? [];
  const departments: Department[] = departmentsQuery.data?.data ?? [];
  const filtered = programs.filter((program) =>
    `${program.name} ${program.code} ${program.department?.code ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, departmentId: departments[0]?.id ?? '' });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (program: Program) => {
    setEditing(program);
    setForm({
      departmentId: program.departmentId,
      name: program.name,
      code: program.code,
      creditHours: program.creditHours,
      accreditationBody: program.accreditationBody ?? 'PEC',
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.departmentId || !form.name.trim() || !form.code.trim()) {
      setFormError('Department, name and code are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        departmentId: form.departmentId,
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        creditHours: Number(form.creditHours),
        accreditationBody: form.accreditationBody || null,
      };
      if (editing) {
        await api.updateProgram(editing.id, payload);
        toast('Programme updated.');
      } else {
        await api.createProgram(payload);
        toast('Programme created.');
      }
      setModalOpen(false);
      await programsQuery.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to save the programme.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (program: Program) => {
    const confirmed = await confirm({
      title: 'Deactivate programme',
      message: `Deactivate ${program.name}? Existing courses, students and reports remain available.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deactivateProgram(program.id);
      toast('Programme deactivated.');
      await programsQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to deactivate the programme.', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Academic programmes"
        description="Degree programmes own PLOs and courses. Credit-hour totals and accreditation references feed programme reports."
        actions={<Button onClick={openCreate} disabled={!departments.length}><Plus size={14} /> New programme</Button>}
      />

      <Card className="mb-4 p-3">
        <div className="relative max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search programmes…" className="pl-9" aria-label="Search programmes" />
        </div>
      </Card>

      {programsQuery.loading ? (
        <Loading />
      ) : programsQuery.error ? (
        <ErrorState message={programsQuery.error} onRetry={programsQuery.reload} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={programs.length ? 'No matching programmes' : 'No programmes yet'}
            description="Create a programme, then define its PLOs and courses."
            action={departments.length ? <Button onClick={openCreate}>Create programme</Button> : undefined}
            icon={<GraduationCap size={20} />}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((program) => (
            <Card key={program.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-semibold text-gray-400">{program.code}</p>
                  <h2 className="mt-0.5 text-sm font-bold text-gray-900">{program.name}</h2>
                  <p className="mt-0.5 text-[10px] text-gray-500">{program.department?.name}</p>
                </div>
                <Badge tone={program.isActive ? 'green' : 'gray'}>{program.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-gray-50/80 p-3">
                <div>
                  <dt className="text-[9px] font-medium text-gray-400">Credit hours</dt>
                  <dd className="text-sm font-bold text-gray-800">{program.creditHours}</dd>
                </div>
                <div>
                  <dt className="text-[9px] font-medium text-gray-400">Courses</dt>
                  <dd className="text-sm font-bold text-gray-800">{program._count?.courses ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[9px] font-medium text-gray-400">PLOs</dt>
                  <dd className="text-sm font-bold text-gray-800">{program._count?.plos ?? 0}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[9px] text-gray-400">{program.accreditationBody ?? 'No accreditation body'}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(program)} aria-label={`Edit ${program.name}`}><Pencil size={12} /></Button>
                  {program.isActive && (
                    <Button variant="ghost" size="sm" onClick={() => void deactivate(program)} aria-label={`Deactivate ${program.name}`}><UserX size={12} /></Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Edit programme' : 'Create programme'}
        description="Programme codes must be unique across the institution."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="program-form" type="submit" loading={saving}>{editing ? 'Save changes' : 'Create programme'}</Button>
          </>
        }
      >
        <form id="program-form" onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Department" htmlFor="program-department" required>
            <Select id="program-department" value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })} required>
              <option value="">Select a department</option>
              {departments.filter((department) => department.isActive).map((department) => (
                <option key={department.id} value={department.id}>{department.name} ({department.code})</option>
              ))}
            </Select>
          </Field>
          <Field label="Programme name" htmlFor="program-name" required>
            <Input id="program-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" htmlFor="program-code" required>
              <Input id="program-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required />
            </Field>
            <Field label="Credit hours" htmlFor="program-credits" required>
              <Input id="program-credits" type="number" min={1} max={400} value={form.creditHours} onChange={(event) => setForm({ ...form, creditHours: Number(event.target.value) })} required />
            </Field>
          </div>
          <Field label="Accreditation body" htmlFor="program-accreditation">
            <Select id="program-accreditation" value={form.accreditationBody} onChange={(event) => setForm({ ...form, accreditationBody: event.target.value })}>
              <option value="">Not specified</option>
              <option value="PEC">PEC</option>
              <option value="ABET">ABET</option>
              <option value="HEC">HEC</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
