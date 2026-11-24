import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  GraduationCap,
  Hourglass,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { Button, Field, Input, Select } from '../components/ui';
import type { Role } from '../api/types';

const emptyForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  departmentId: '',
  employeeNo: '',
  programId: '',
  rollNo: '',
  batch: '',
};

export default function Register() {
  const [role, setRole] = useState<Extract<Role, 'TUTOR' | 'STUDENT'>>('TUTOR');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ email: string; role: string; message: string } | null>(null);
  const optionsQuery = useAsync(() => api.registrationOptions(), []);

  const departments = optionsQuery.data?.data.departments ?? [];
  const programs = optionsQuery.data?.data.programs ?? [];

  const set = (key: keyof typeof emptyForm) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (form.name.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (form.password.length < 10 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setError('Use a password of at least 10 characters that includes a letter and a number.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    if (role === 'TUTOR' && !form.departmentId) {
      setError('Select the department you teach in.');
      return;
    }
    if (role === 'STUDENT' && (!form.rollNo.trim() || !form.programId)) {
      setError('Enter your roll number and select your programme.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role,
        password: form.password,
      };
      if (role === 'TUTOR') {
        payload.departmentId = form.departmentId;
        payload.employeeNo = form.employeeNo.trim() || null;
      } else {
        payload.rollNo = form.rollNo.trim();
        payload.programId = form.programId;
        payload.batch = form.batch.trim() || null;
      }
      const response = await api.register(payload);
      setSubmitted({
        email: response.data.request.email,
        role: response.data.request.role,
        message: response.data.message,
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Unable to submit your request. Check your connection and try again.'
      );
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
              Request access to the academic workspace.
            </h1>
            <p className="mt-3 text-xs leading-relaxed text-white/60">
              Tutor and student accounts are not created on sign-up. Your request is reviewed by an administrator and a
              decision is recorded before any access is granted.
            </p>
          </div>
          <ul className="space-y-2.5 text-[11px] text-white/70">
            <li className="flex items-center gap-2">
              <ShieldCheck size={14} /> Administrator approval required
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck size={14} /> One open application per email
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck size={14} /> Decisions and requests are audited
            </li>
          </ul>
        </section>

        <section className="p-6 sm:p-8">
          {submitted ? (
            <div>
              <div className="mb-6 text-center md:text-left">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">UIIT Rawalpindi</p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-900">Request submitted</h2>
                <p className="mt-1 text-[11px] text-gray-500">
                  {submitted.role === 'TUTOR' ? 'Tutor' : 'Student'} application received for {submitted.email}.
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">
                  <Hourglass size={13} /> Awaiting administrator approval
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-amber-800">{submitted.message}</p>
                <p className="mt-2 text-[10px] leading-relaxed text-amber-700/80">
                  You cannot apply again for this email while the request is open. If it is rejected you may submit a new
                  request.
                </p>
              </div>

              <Link
                to="/login"
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-gray-800"
              >
                <ArrowLeft size={14} /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-5 text-center md:text-left">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">UIIT Rawalpindi</p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-900">Request an account</h2>
                <p className="mt-1 text-[11px] text-gray-500">
                  Tutor and student sign-up is reviewed by an administrator. No access is granted until approval.
                </p>
              </div>

              <div role="group" aria-label="Account type" className="mb-4 grid grid-cols-2 gap-2">
                {(['TUTOR', 'STUDENT'] as const).map((option) => {
                  const active = role === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setRole(option);
                        setError('');
                      }}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-100 bg-gray-50/60 text-gray-700 hover:border-gray-200 hover:bg-white'
                      }`}
                    >
                      <span>
                        <span className="block text-[10px] font-bold">{option === 'TUTOR' ? 'Teacher / Tutor' : 'Student'}</span>
                        <span className={`block text-[9px] ${active ? 'text-white/60' : 'text-gray-500'}`}>
                          {option === 'TUTOR' ? 'Department account' : 'Programme account'}
                        </span>
                      </span>
                      <UserRound size={14} className={active ? 'text-white/70' : 'text-gray-400'} />
                    </button>
                  );
                })}
              </div>

              <form onSubmit={submit} className="space-y-3.5" noValidate>
                <Field label="Full name" htmlFor="name" required>
                  <Input
                    id="name"
                    autoComplete="name"
                    value={form.name}
                    onChange={(event) => set('name')(event.target.value)}
                    placeholder="As printed on your institutional record"
                    required
                  />
                </Field>

                <Field label="Official email" htmlFor="email" required>
                  <div className="relative">
                    <Mail size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) => set('email')(event.target.value)}
                      className="pl-9"
                      placeholder="name@uiit.edu.pk"
                      required
                    />
                  </div>
                </Field>

                {role === 'TUTOR' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Department" htmlFor="department" required>
                      <Select
                        id="department"
                        value={form.departmentId}
                        onChange={(event) => set('departmentId')(event.target.value)}
                        required
                      >
                        <option value="">Select a department</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Employee number" htmlFor="employeeNo" hint="Optional">
                      <Input
                        id="employeeNo"
                        value={form.employeeNo}
                        onChange={(event) => set('employeeNo')(event.target.value)}
                        placeholder="e.g. UIIT-1042"
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Programme" htmlFor="program" required>
                      <Select
                        id="program"
                        value={form.programId}
                        onChange={(event) => set('programId')(event.target.value)}
                        required
                      >
                        <option value="">Select a programme</option>
                        {programs.map((program) => (
                          <option key={program.id} value={program.id}>
                            {program.code} — {program.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Roll number" htmlFor="rollNo" required>
                      <Input
                        id="rollNo"
                        value={form.rollNo}
                        onChange={(event) => set('rollNo')(event.target.value)}
                        placeholder="e.g. BSCS-21-014"
                        required
                      />
                    </Field>
                    <Field label="Batch" htmlFor="batch" hint="Optional" className="sm:col-span-2">
                      <Input
                        id="batch"
                        value={form.batch}
                        onChange={(event) => set('batch')(event.target.value)}
                        placeholder="e.g. 2021–2025"
                      />
                    </Field>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Password" htmlFor="password" hint="10+ characters, letter and number" required>
                    <div className="relative">
                      <LockKeyhole size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden />
                      <Input
                        id="password"
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(event) => set('password')(event.target.value)}
                        className="pl-9"
                        placeholder="Choose a password"
                        required
                      />
                    </div>
                  </Field>
                  <Field label="Confirm password" htmlFor="confirmPassword" required>
                    <div className="relative">
                      <LockKeyhole size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden />
                      <Input
                        id="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        value={form.confirmPassword}
                        onChange={(event) => set('confirmPassword')(event.target.value)}
                        className="pl-9"
                        placeholder="Repeat the password"
                        required
                      />
                    </div>
                  </Field>
                </div>

                {optionsQuery.error && (
                  <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] font-medium text-amber-700">
                    Departments and programmes could not be loaded. {optionsQuery.error}
                  </p>
                )}

                {error && (
                  <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">
                    {error}
                  </p>
                )}

                <Button type="submit" loading={submitting} className="w-full">
                  Submit request <ArrowRight size={14} />
                </Button>
              </form>

              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="text-[10px] leading-relaxed text-gray-400">
                  Submitting a request does not create an account. An administrator approves or rejects it, and only an
                  approved account can sign in.
                </p>
                <Link
                  to="/login"
                  className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-700 hover:text-gray-900"
                >
                  <ArrowLeft size={13} /> Already have an account? Sign in
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
