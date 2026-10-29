import { useState, type FormEvent } from 'react';
import { Building2, Pencil, Plus, Search, UserX } from 'lucide-react';
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
  useConfirm,
} from '../components/ui';
import type { Department } from '../api/types';

const emptyForm = { name: '', code: '', hodName: '', contact: '' };

export default function Departments() {
  const { data, loading, error, reload } = useAsync(() => api.departments(), []);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const departments = data?.data ?? [];
  const filtered = departments.filter((department) =>
    `${department.name} ${department.code} ${department.hodName ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (department: Department) => {
    setEditing(department);
    setForm({
      name: department.name,
      code: department.code,
      hodName: department.hodName ?? '',
      contact: department.contact ?? '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.name.trim() || !form.code.trim()) {
      setFormError('Name and code are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        hodName: form.hodName.trim() || null,
        contact: form.contact.trim() || null,
      };
      if (editing) {
        await api.updateDepartment(editing.id, payload);
        toast('Department updated.');
      } else {
        await api.createDepartment(payload);
        toast('Department created.');
      }
      setModalOpen(false);
      await reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to save the department.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (department: Department) => {
    const confirmed = await confirm({
      title: 'Deactivate department',
      message: `Deactivate ${department.name}? Historical programmes and audit records are retained.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deactivateDepartment(department.id);
      toast('Department deactivated.');
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to deactivate the department.', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Departments"
        description="Institutional units that own programmes, staff and outcome frameworks."
        actions={
          <Button onClick={openCreate}>
            <Plus size={14} /> New department
          </Button>
        }
      />

      <Card className="mb-4 p-3">
        <div className="relative max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search departments…"
            className="pl-9"
            aria-label="Search departments"
          />
        </div>
      </Card>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={departments.length ? 'No matching departments' : 'No departments yet'}
            description="Create the first department before defining programmes."
            action={<Button onClick={openCreate}>Create department</Button>}
            icon={<Building2 size={20} />}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-3 font-bold">Department</th>
                  <th className="px-4 py-3 font-bold">Code</th>
                  <th className="px-4 py-3 font-bold">Head of department</th>
                  <th className="px-4 py-3 font-bold">Programmes</th>
                  <th className="px-4 py-3 font-bold">Staff</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((department) => (
                  <tr key={department.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="text-[11px] font-semibold text-gray-900">{department.name}</p>
                      <p className="text-[9px] text-gray-400">{department.contact || 'No contact on record'}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-gray-600">{department.code}</td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{department.hodName || '—'}</td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{department._count?.programs ?? 0}</td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{department._count?.users ?? 0}</td>
                    <td className="px-4 py-3">
                      <Badge tone={department.isActive ? 'green' : 'gray'}>{department.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(department)} aria-label={`Edit ${department.name}`}>
                          <Pencil size={12} />
                        </Button>
                        {department.isActive && (
                          <Button variant="ghost" size="sm" onClick={() => void deactivate(department)} aria-label={`Deactivate ${department.name}`}>
                            <UserX size={12} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-gray-100 px-4 py-2 text-[9px] text-gray-400">
            {filtered.length} department{filtered.length === 1 ? '' : 's'} · created records are never hard-deleted
          </p>
        </Card>
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Edit department' : 'Create department'}
        description="Departments group programmes and staff. Codes are unique and shown in reports."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="department-form" type="submit" loading={saving}>{editing ? 'Save changes' : 'Create department'}</Button>
          </>
        }
      >
        <form id="department-form" onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Department name" htmlFor="dept-name" required>
            <Input id="dept-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" htmlFor="dept-code" hint="Uppercase letters, digits or hyphens" required>
              <Input id="dept-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required />
            </Field>
            <Field label="Head of department" htmlFor="dept-hod">
              <Input id="dept-hod" value={form.hodName} onChange={(event) => setForm({ ...form, hodName: event.target.value })} />
            </Field>
          </div>
          <Field label="Contact" htmlFor="dept-contact">
            <Input id="dept-contact" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="Extension or phone" />
          </Field>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
