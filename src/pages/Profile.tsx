import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Building2, KeyRound, Mail, ShieldCheck, UserCircle2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { roleLabel } from '../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
} from '../components/ui';

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name ?? '');
    setPhone(user?.phone ?? '');
  }, [user?.name, user?.phone]);

  if (!user) return null;

  const dirty = name.trim() !== user.name || (phone.trim() || '') !== (user.phone ?? '');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (name.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }
    setSaving(true);
    try {
      await api.updateMe({ name: name.trim(), phone: phone.trim() || null });
      await refreshUser();
      toast('Profile updated.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update your profile.');
    } finally {
      setSaving(false);
    }
  };

  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');

  return (
    <div>
      <PageHeader
        eyebrow="Account"
        title="Tutor profile"
        description="Update your display name and contact number. Your role, institutional identity and course assignments are managed by the administrator."
        actions={
          <Link to="/settings">
            <Button variant="secondary" size="sm">
              <KeyRound size={13} /> Security settings
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-700 text-lg font-bold text-white">
              {initials || <UserCircle2 size={22} />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-gray-900">{user.name}</p>
              <p className="truncate text-[11px] text-gray-500">{user.email}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <Badge tone="green">{roleLabel(user.role)}</Badge>
                {user.isActive !== false && <Badge tone="blue"><BadgeCheck size={10} /> Active</Badge>}
              </div>
            </div>
          </div>

          <dl className="mt-5 space-y-3 border-t border-gray-100 pt-4 text-[11px]">
            <div className="flex items-start gap-2">
              <Mail size={13} className="mt-0.5 text-gray-400" />
              <div>
                <dt className="text-[9px] uppercase tracking-[0.12em] text-gray-400">Institutional email</dt>
                <dd className="font-semibold text-gray-800">{user.email}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Building2 size={13} className="mt-0.5 text-gray-400" />
              <div>
                <dt className="text-[9px] uppercase tracking-[0.12em] text-gray-400">Department</dt>
                <dd className="font-semibold text-gray-800">{user.department?.name ?? '—'}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck size={13} className="mt-0.5 text-gray-400" />
              <div>
                <dt className="text-[9px] uppercase tracking-[0.12em] text-gray-400">Employee number</dt>
                <dd className="font-semibold text-gray-800">{user.employeeNo ?? 'Not recorded'}</dd>
              </div>
            </div>
          </dl>

          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-[9px] leading-relaxed text-gray-500">
            Role, account status, permissions and course assignments cannot be changed from this page. Those are
            institution-level controls enforced by the API.
          </p>
        </Card>

        <Card>
          <CardHeader title="Editable details" description="Only the fields below can be changed by you." />
          <form onSubmit={save} className="space-y-4 px-5 py-5" noValidate>
            <Field label="Display name" htmlFor="profile-name" required>
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <Field
              label="Contact number"
              htmlFor="profile-phone"
              hint="Optional. Stored for institutional correspondence only."
            >
              <Input
                id="profile-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                autoComplete="tel"
                placeholder="+92 300 1234567"
              />
            </Field>
            {error && (
              <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={saving} disabled={!dirty}>
                Save changes
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!dirty}
                onClick={() => {
                  setName(user.name);
                  setPhone(user.phone ?? '');
                  setError('');
                }}
              >
                Reset
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
