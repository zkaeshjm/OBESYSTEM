import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Button, Field, Input } from '../components/ui';

const demoAccounts = [
  { label: 'Administrator', email: 'admin@uiit.edu.pk', password: 'Admin123!' },
  { label: 'Tutor', email: 'sara.malik@uiit.edu.pk', password: 'Tutor123!' },
  { label: 'Student', email: 'bilal.ahmed@student.uiit.edu.pk', password: 'Student123!' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@uiit.edu.pk');
  const [password, setPassword] = useState('Admin123!');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to sign in. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f4f7] p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-[0_12px_48px_rgba(0,0,0,0.06)] md:grid-cols-[1.05fr_1fr]">
        <section className="hidden flex-col justify-between bg-gray-900 p-8 text-white md:flex">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <GraduationCap size={24} />
            </div>
            <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Outcome-Based Education</p>
            <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight">
              Evidence, outcomes and improvement in one academic workspace.
            </h1>
            <p className="mt-3 text-xs leading-relaxed text-white/60">
              Course-level CLO attainment, programme PLO roll-up, assessment evidence and auditable improvement plans — calculated
              server-side from persisted records.
            </p>
          </div>
          <ul className="space-y-2.5 text-[11px] text-white/70">
            <li className="flex items-center gap-2">
              <ShieldCheck size={14} /> Role-scoped access enforced by the API
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck size={14} /> Versioned policies, frozen attainment runs
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck size={14} /> No dashboard figure without stored evidence
            </li>
          </ul>
        </section>

        <section className="p-6 sm:p-8">
          <div className="mb-6 text-center md:text-left">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">UIIT Rawalpindi</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-900">Sign in to the OBE system</h2>
            <p className="mt-1 text-[11px] text-gray-500">Use your institutional account. Access is determined by your assigned role.</p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Official email" htmlFor="email" required>
              <div className="relative">
                <Mail size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-9"
                  placeholder="name@uiit.edu.pk"
                  required
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password" required>
              <div className="relative">
                <LockKeyhole size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pl-9"
                  placeholder="Enter your password"
                  required
                />
              </div>
            </Field>

            {error && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">
                {error}
              </p>
            )}

            <Button type="submit" loading={submitting} className="w-full">
              Sign in <ArrowRight size={14} />
            </Button>
          </form>

          <div className="mt-6 border-t border-gray-100 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Seeded demonstration accounts</p>
            <div className="mt-2 space-y-1.5">
              {demoAccounts.map((account) => (
                <button
                  key={account.label}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setError('');
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2 text-left transition-colors hover:border-gray-200 hover:bg-white"
                >
                  <span>
                    <span className="block text-[10px] font-bold text-gray-700">{account.label}</span>
                    <span className="block text-[9px] text-gray-500">{account.email}</span>
                  </span>
                  <span className="font-mono text-[9px] text-gray-400">{account.password}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-gray-400">
              Demonstration credentials only. Change all seeded passwords before deploying to a real institution.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
