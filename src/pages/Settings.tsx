import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, CardHeader, Field, Input, PageHeader } from '../components/ui';

export default function Settings() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Use at least 10 characters, including a letter and a number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      toast('Password changed. Please sign in again.');
      // The server revokes every refresh token on password change.
      await logout();
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to change your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Security controls for your account. Sessions and academic permissions remain managed by the institution."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Change password"
            description="Changing your password signs you out of every device. Use at least 10 characters with a letter and a number."
          />
          <form onSubmit={changePassword} className="space-y-4 px-5 py-5" noValidate>
            <Field label="Current password" htmlFor="current-password" required>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password" htmlFor="new-password" required>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password" required>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            {error && (
              <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">
                {error}
              </p>
            )}
            <Button type="submit" loading={saving}>
              Change password
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Session policy" description="How this account stays secure." />
            <ul className="space-y-2.5 px-5 py-4 text-[11px] text-gray-600">
              <li className="flex gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                Access tokens are short-lived; the refresh token rotates on every use and is revoke-on-use.
              </li>
              <li className="flex gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                The refresh token is stored in an httpOnly cookie and is never accessible to page scripts.
              </li>
              <li className="flex gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                Five failed sign-in attempts lock the account temporarily.
              </li>
              <li className="flex gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                Role and account status are re-read from the database on every request, so a token cannot keep a
                revoked permission alive.
              </li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Signed in as" />
            <div className="px-5 py-4">
              <p className="text-[11px] font-semibold text-gray-800">{user?.name}</p>
              <p className="text-[10px] text-gray-500">{user?.email}</p>
              <Button variant="secondary" className="mt-3" onClick={() => void logout()}>
                <LogOut size={13} /> Sign out
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
