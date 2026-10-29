import { useState, type FormEvent } from 'react';
import { CalendarDays, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync, formatDate } from '../hooks/useAsync';
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
  useConfirm,
} from '../components/ui';
import type { Semester } from '../api/types';

const today = new Date().toISOString().slice(0, 10);
const emptyForm = { name: '', startDate: today, endDate: today, isActive: false };

export default function Semesters() {
  const { data, loading, error, reload } = useAsync(() => api.semesters(), []);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Semester | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const semesters = data?.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (semester: Semester) => {
    setEditing(semester);
    setForm({
      name: semester.name,
      startDate: semester.startDate.slice(0, 10),
      endDate: semester.endDate.slice(0, 10),
      isActive: semester.isActive,
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.name.trim() || !form.startDate || !form.endDate) {
      setFormError('Name, start date and end date are required.');
      return;
    }
    if (form.endDate <= form.startDate) {
      setFormError('End date must be after the start date.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        startDate: new Date(`${form.startDate}T00:00:00.000Z`).toISOString(),
        endDate: new Date(`${form.endDate}T00:00:00.000Z`).toISOString(),
        isActive: form.isActive,
      };
      if (editing) {
        await api.updateSemester(editing.id, payload);
        toast('Academic session updated.');
      } else {
        await api.createSemester(payload);
        toast('Academic session created.');
      }
      setModalOpen(false);
      await reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to save the academic session.');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (semester: Semester) => {
    try {
      await api.updateSemester(semester.id, { isActive: true });
      toast(`${semester.name} is now the active session.`);
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to activate the session.', 'error');
    }
  };

  const remove = async (semester: Semester) => {
    const confirmed = await confirm({
      title: 'Delete academic session',
      message: `Delete ${semester.name}? This is only possible when no course offerings reference it.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deleteSemester(semester.id);
      toast('Academic session deleted.');
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to delete the session.', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Academic sessions"
        description="Exactly one session is active at a time. Offerings are delivered within a session; historical offerings are never removed automatically."
        actions={<Button onClick={openCreate}><Plus size={14} /> New session</Button>}
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : semesters.length === 0 ? (
        <Card><EmptyState title="No academic sessions" description="Create a session before creating course offerings." action={<Button onClick={openCreate}>Create session</Button>} icon={<CalendarDays size={20} />} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-3 font-bold">Session</th>
                  <th className="px-4 py-3 font-bold">Starts</th>
                  <th className="px-4 py-3 font-bold">Ends</th>
                  <th className="px-4 py-3 font-bold">Offerings</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {semesters.map((semester) => (
                  <tr key={semester.id} className={semester.isActive ? 'bg-emerald-50/30' : 'hover:bg-gray-50/60'}>
                    <td className="px-4 py-3">
                      <p className="text-[11px] font-semibold text-gray-900">{semester.name}</p>
                      {semester.isActive && <p className="text-[9px] text-emerald-600">Institution-wide active session</p>}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{formatDate(semester.startDate)}</td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{formatDate(semester.endDate)}</td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{semester._count?.offerings ?? 0}</td>
                    <td className="px-4 py-3"><Badge tone={semester.isActive ? 'green' : 'gray'}>{semester.isActive ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {!semester.isActive && (
                          <Button variant="ghost" size="sm" onClick={() => void activate(semester)} aria-label={`Activate ${semester.name}`}><Power size={12} /></Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openEdit(semester)} aria-label={`Edit ${semester.name}`}><Pencil size={12} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => void remove(semester)} aria-label={`Delete ${semester.name}`}><Trash2 size={12} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Edit academic session' : 'Create academic session'}
        description="Activating a session deactivates the previous one atomically."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="semester-form" type="submit" loading={saving}>{editing ? 'Save changes' : 'Create session'}</Button>
          </>
        }
      >
        <form id="semester-form" onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Session name" htmlFor="semester-name" hint="For example: Spring 2026" required>
            <Input id="semester-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date" htmlFor="semester-start" required>
              <Input id="semester-start" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required />
            </Field>
            <Field label="End date" htmlFor="semester-end" required>
              <Input id="semester-end" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required />
            </Field>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-[11px] font-medium text-gray-700">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-3.5 w-3.5 rounded border-gray-300" />
            Make this the active institutional session
          </label>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
