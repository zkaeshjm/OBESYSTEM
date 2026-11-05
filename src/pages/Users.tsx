import { useState, type FormEvent } from 'react';
import { KeyRound, Plus, Search, UserCheck, UserX, Users as UsersIcon } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync, formatDate, roleLabel } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineSelect,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  useConfirm,
} from '../components/ui';
import type { Department, Program, User } from '../api/types';

const emptyForm = {
  name: '',
  email: '',
  role: 'TUTOR',
  password: '',
  departmentId: '',
  employeeNo: '',
  rollNo: '',
  programId: '',
  batch: '',
};

export default function Users() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const usersQuery = useAsync(() => api.users({ role: role || undefined, limit: 100 }), [role]);
  const departmentsQuery = useAsync(() => api.departments(), []);
  const programsQuery = useAsync(() => api.programs(), []);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const users = usersQuery.data?.data ?? [];
  const departments: Department[] = departmentsQuery.data?.data ?? [];
  const programs: Program[] = programsQuery.data?.data ?? [];
  const filtered = users.filter((user) =>
    `${user.name} ${user.email} ${user.studentProfile?.rollNo ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setForm({
      ...emptyForm,
      departmentId: departments[0]?.id ?? '',
      programId: programs[0]?.id ?? '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.name.trim() || !form.email.trim() || form.password.length < 10) {
      setFormError('Name, email and a password of at least 10 characters are required.');
      return;
    }
    if (form.role === 'STUDENT' && (!form.rollNo.trim() || !form.programId)) {
      setFormError('A student needs a roll number and a programme.');
      return;
    }
    if (form.role !== 'STUDENT' && !form.departmentId) {
      setFormError('Staff accounts need a department.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        password: form.password,
      };
      if (form.role === 'STUDENT') {
        payload.studentProfile = {
          rollNo: form.rollNo.trim(),
          programId: form.programId,
          batch: form.batch.trim() || null,
        };
      } else {
        payload.departmentId = form.departmentId;
        payload.employeeNo = form.employeeNo.trim() || null;
      }
      await api.createUser(payload);
      toast('Account created.');
      setModalOpen(false);
      await usersQuery.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to create the account.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: User) => {
    const confirmed = await confirm({
      title: user.isActive === false ? 'Reactivate account' : 'Deactivate account',
      message:
        user.isActive === false
          ? `Reactivate ${user.name}? They will be able to sign in again.`
          : `Deactivate ${user.name}? Their academic history is preserved and they cannot sign in.`,
      confirmLabel: user.isActive === false ? 'Reactivate' : 'Deactivate',
      danger: user.isActive !== false,
    });
    if (!confirmed) return;
    try {
      await api.updateUser(user.id, { isActive: user.isActive === false });
      toast(user.isActive === false ? 'Account reactivated.' : 'Account deactivated.');
      await usersQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to update the account.', 'error');
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetUser) return;
    if (newPassword.length < 10) {
      toast('Use a password of at least 10 characters.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.resetPassword(resetUser.id, newPassword);
      toast('Password reset. Existing sessions were revoked.');
      setResetUser(null);
      setNewPassword('');
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to reset the password.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Users & students"
        description="Accounts are created with a server-assigned role. Students also receive a roll number and programme profile."
        actions={<Button onClick={openCreate}><Plus size={14} /> New account</Button>}
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email or roll number…" className="pl-9" aria-label="Search users" />
        </div>
        <InlineSelect value={role} onChange={(event) => setRole(event.target.value)} aria-label="Filter by role">
          <option value="">All roles</option>
          <option value="ADMIN">Administrators</option>
          <option value="TUTOR">Tutors</option>
          <option value="STUDENT">Students</option>
        </InlineSelect>
      </Card>

      {usersQuery.loading ? (
        <Loading />
      ) : usersQuery.error ? (
        <ErrorState message={usersQuery.error} onRetry={usersQuery.reload} />
      ) : filtered.length === 0 ? (
        <Card><EmptyState title="No matching accounts" description="Create an administrator, tutor or student account." action={<Button onClick={openCreate}>Create account</Button>} icon={<UsersIcon size={20} />} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-3 font-bold">Account</th>
                  <th className="px-4 py-3 font-bold">Role</th>
                  <th className="px-4 py-3 font-bold">Department / programme</th>
                  <th className="px-4 py-3 font-bold">Last sign-in</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="text-[11px] font-semibold text-gray-900">{user.name}</p>
                      <p className="text-[9px] text-gray-400">{user.email}</p>
                      {user.studentProfile && <p className="font-mono text-[9px] text-gray-400">{user.studentProfile.rollNo}</p>}
                    </td>
                    <td className="px-4 py-3"><Badge tone={user.role === 'ADMIN' ? 'purple' : user.role === 'TUTOR' ? 'blue' : 'green'}>{roleLabel(user.role)}</Badge></td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">
                      {user.role === 'STUDENT' ? user.studentProfile?.program?.code ?? '—' : user.department?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{formatDate(user.lastLoginAt, true)}</td>
                    <td className="px-4 py-3"><Badge tone={user.isActive === false ? 'gray' : 'green'}>{user.isActive === false ? 'Inactive' : 'Active'}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { setResetUser(user); setNewPassword(''); }} aria-label={`Reset password for ${user.name}`}>
                          <KeyRound size={12} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void toggleActive(user)} aria-label={user.isActive === false ? `Reactivate ${user.name}` : `Deactivate ${user.name}`}>
                          {user.isActive === false ? <UserCheck size={12} /> : <UserX size={12} />}
                        </Button>
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
        title="Create account"
        description="Passwords are hashed with bcrypt and never returned by the API."
        onClose={() => setModalOpen(false)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="user-form" type="submit" loading={saving}>Create account</Button>
          </>
        }
      >
        <form id="user-form" onSubmit={submit} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="user-name" required>
              <Input id="user-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </Field>
            <Field label="Email" htmlFor="user-email" required>
              <Input id="user-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" htmlFor="user-role" required>
              <Select id="user-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="ADMIN">Administrator</option>
                <option value="TUTOR">Tutor</option>
                <option value="STUDENT">Student</option>
              </Select>
            </Field>
            <Field label="Initial password" htmlFor="user-password" hint="At least 10 characters" required>
              <Input id="user-password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
            </Field>
          </div>
          {form.role === 'STUDENT' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Roll number" htmlFor="user-roll" required>
                <Input id="user-roll" value={form.rollNo} onChange={(event) => setForm({ ...form, rollNo: event.target.value })} required />
              </Field>
              <Field label="Programme" htmlFor="user-program" required>
                <Select id="user-program" value={form.programId} onChange={(event) => setForm({ ...form, programId: event.target.value })} required>
                  <option value="">Select a programme</option>
                  {programs.map((program) => <option key={program.id} value={program.id}>{program.code}</option>)}
                </Select>
              </Field>
              <Field label="Batch" htmlFor="user-batch">
                <Input id="user-batch" value={form.batch} onChange={(event) => setForm({ ...form, batch: event.target.value })} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Department" htmlFor="user-department" required>
                <Select id="user-department" value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })} required>
                  <option value="">Select a department</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </Select>
              </Field>
              <Field label="Employee number" htmlFor="user-employee">
                <Input id="user-employee" value={form.employeeNo} onChange={(event) => setForm({ ...form, employeeNo: event.target.value })} />
              </Field>
            </div>
          )}
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={Boolean(resetUser)}
        title={`Reset password for ${resetUser?.name ?? ''}`}
        description="Resetting revokes all existing refresh sessions for the account."
        onClose={() => setResetUser(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetUser(null)}>Cancel</Button>
            <Button form="reset-form" type="submit" loading={saving}>Reset password</Button>
          </>
        }
      >
        <form id="reset-form" onSubmit={resetPassword} className="space-y-3">
          <Field label="New password" htmlFor="reset-password" hint="At least 10 characters" required>
            <Input id="reset-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
