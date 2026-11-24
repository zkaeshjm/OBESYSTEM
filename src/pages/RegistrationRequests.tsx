import { useState, type FormEvent } from 'react';
import { Check, ClipboardList, Search, X } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { formatDate, useAsync } from '../hooks/useAsync';
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
  Tabs,
  Textarea,
  useConfirm,
} from '../components/ui';
import type { RegistrationRequest, RegistrationStatus } from '../api/types';

const roleTone = { TUTOR: 'blue', STUDENT: 'green' } as const;
const statusTone = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red' } as const;

export default function RegistrationRequests() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<RegistrationStatus>('PENDING');
  const [search, setSearch] = useState('');
  const [rejecting, setRejecting] = useState<RegistrationRequest | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const query = useAsync(() => api.registrationRequests({ status: tab, limit: 100 }), [tab]);
  const rows = query.data?.data ?? [];
  const counts = query.data?.meta.counts ?? { PENDING: 0, APPROVED: 0, REJECTED: 0 };

  const filtered = rows.filter((row) =>
    `${row.name} ${row.email} ${row.rollNo ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
  );

  const approve = async (row: RegistrationRequest) => {
    const confirmed = await confirm({
      title: 'Approve access request',
      message: `Create a ${row.role === 'TUTOR' ? 'tutor' : 'student'} account for ${row.name} (${row.email})? They will be able to sign in with the password they chose.`,
      confirmLabel: 'Approve',
    });
    if (!confirmed) return;
    setBusyId(row.id);
    try {
      await api.approveRegistration(row.id);
      toast(`Account created for ${row.name}.`);
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to approve this request.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (event: FormEvent) => {
    event.preventDefault();
    if (!rejecting) return;
    if (reason.trim().length < 3) {
      toast('Give a short reason for the rejection.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.rejectRegistration(rejecting.id, reason.trim());
      toast(`Request from ${rejecting.name} rejected.`);
      setRejecting(null);
      setReason('');
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to reject this request.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Access requests"
        description="Tutors and students request their own account. Nothing is granted until you approve, and every decision is written to the audit log."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'PENDING', label: 'Awaiting review', count: counts.PENDING },
            { id: 'APPROVED', label: 'Approved', count: counts.APPROVED },
            { id: 'REJECTED', label: 'Rejected', count: counts.REJECTED },
          ]}
        />
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email or roll number…"
            className="pl-9"
            aria-label="Search access requests"
          />
        </div>
      </div>

      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList size={20} />}
            title={tab === 'PENDING' ? 'No requests awaiting review' : `No ${tab.toLowerCase()} requests`}
            description={
              tab === 'PENDING'
                ? 'New tutor and student sign-up requests appear here for approval.'
                : 'Requests move here once they have been reviewed.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-3 font-bold">Applicant</th>
                  <th className="px-4 py-3 font-bold">Type</th>
                  <th className="px-4 py-3 font-bold">Department / programme</th>
                  <th className="px-4 py-3 font-bold">Requested</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="text-[11px] font-semibold text-gray-900">{row.name}</p>
                      <p className="text-[9px] text-gray-400">{row.email}</p>
                      {row.rollNo && <p className="font-mono text-[9px] text-gray-400">{row.rollNo}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={roleTone[row.role]}>{row.role === 'TUTOR' ? 'Tutor' : 'Student'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">
                      {row.role === 'STUDENT' ? (
                        <>
                          <span className="block">{row.program?.code ?? '—'}</span>
                          {row.batch && <span className="block text-[9px] text-gray-400">Batch {row.batch}</span>}
                        </>
                      ) : (
                        <>
                          <span className="block">{row.department?.name ?? '—'}</span>
                          {row.employeeNo && <span className="block text-[9px] text-gray-400">{row.employeeNo}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{formatDate(row.createdAt, true)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone[row.status]}>{row.status.charAt(0) + row.status.slice(1).toLowerCase()}</Badge>
                      {row.status !== 'PENDING' && row.reviewedBy && (
                        <p className="mt-1 text-[9px] text-gray-400">by {row.reviewedBy.name}</p>
                      )}
                      {row.status === 'REJECTED' && row.decisionNote && (
                        <p className="mt-1 max-w-[220px] text-[9px] leading-relaxed text-gray-400">{row.decisionNote}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === 'PENDING' ? (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => void approve(row)}
                            loading={busyId === row.id}
                            aria-label={`Approve ${row.name}`}
                          >
                            <Check size={12} /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setRejecting(row);
                              setReason('');
                            }}
                            aria-label={`Reject ${row.name}`}
                          >
                            <X size={12} /> Reject
                          </Button>
                        </div>
                      ) : (
                        <p className="text-right text-[10px] text-gray-400">{formatDate(row.reviewedAt)}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={Boolean(rejecting)}
        title={`Reject request from ${rejecting?.name ?? ''}`}
        description="The applicant is told nothing is created. They may submit a new request later."
        onClose={() => setRejecting(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button form="reject-form" type="submit" loading={saving}>Reject request</Button>
          </>
        }
      >
        <form id="reject-form" onSubmit={reject} className="space-y-3">
          <Field label="Reason" htmlFor="reject-reason" hint="Recorded on the request and in the audit log." required>
            <Textarea
              id="reject-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Roll number does not match departmental records"
              required
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
