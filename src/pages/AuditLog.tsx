import { useState } from 'react';
import { Filter, ScrollText, Search } from 'lucide-react';
import { api } from '../api/client';
import { useAsync, formatDate } from '../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  InlineSelect,
  Loading,
  PageHeader,
} from '../components/ui';

export default function AuditLog() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const filterKey = `${action}|${entityType}|${search}|${from}|${to}|${page}`;
  const auditQuery = useAsync(
    () =>
      api.audits({
        action,
        entityType,
        q: search || undefined,
        from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
        page,
        limit: 50,
      }),
    [filterKey]
  );
  const filtersQuery = useAsync(() => api.auditFilters(), []);

  const logs = auditQuery.data?.data ?? [];
  const meta = auditQuery.data?.meta;
  const filters = filtersQuery.data?.data;

  const resetFilters = () => {
    setAction('');
    setEntityType('');
    setSearch('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only records of academic and administrative actions. Passwords, tokens and submission contents are never written to the audit trail."
        actions={<Badge tone="blue">{meta?.total ?? 0} entries</Badge>}
      />

      <Card className="mb-4 flex flex-wrap items-end gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search actor, entity or id…" className="pl-9" aria-label="Search audit log" />
        </div>
        <InlineSelect value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} aria-label="Filter by action">
          <option value="">All actions</option>
          {(filters?.actions ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
        </InlineSelect>
        <InlineSelect value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }} aria-label="Filter by entity">
          <option value="">All entities</option>
          {(filters?.entityTypes ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
        </InlineSelect>
        <div className="flex items-center gap-1">
          <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label="From date" className="w-36" />
          <span className="text-[10px] text-gray-400">to</span>
          <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label="To date" className="w-36" />
        </div>
        {(action || entityType || search || from || to) && (
          <Button variant="ghost" size="sm" onClick={resetFilters}><Filter size={12} /> Clear</Button>
        )}
      </Card>

      {auditQuery.loading ? (
        <Loading />
      ) : auditQuery.error ? (
        <ErrorState message={auditQuery.error} onRetry={auditQuery.reload} />
      ) : logs.length === 0 ? (
        <Card><EmptyState title="No audit entries match" description="Adjust the filters to inspect a different period." icon={<ScrollText size={20} />} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-3 font-bold">When</th>
                  <th className="px-4 py-3 font-bold">Actor</th>
                  <th className="px-4 py-3 font-bold">Action</th>
                  <th className="px-4 py-3 font-bold">Entity</th>
                  <th className="px-4 py-3 font-bold">Metadata</th>
                  <th className="px-4 py-3 font-bold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((entry) => (
                  <tr key={entry.id} className="align-top hover:bg-gray-50/60">
                    <td className="whitespace-nowrap px-4 py-3 text-[10px] text-gray-600">{formatDate(entry.occurredAt, true)}</td>
                    <td className="px-4 py-3">
                      <p className="text-[10px] font-semibold text-gray-800">{entry.actor?.name ?? 'System / anonymous'}</p>
                      <p className="text-[9px] text-gray-400">{entry.actorEmail ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3"><Badge tone={entry.action.includes('DELETE') || entry.action.includes('FAILED') ? 'red' : entry.action.includes('APPROVE') || entry.action.includes('FINALIZE') ? 'green' : 'blue'}>{entry.action}</Badge></td>
                    <td className="px-4 py-3">
                      <p className="text-[10px] font-semibold text-gray-700">{entry.entityType}</p>
                      <p className="max-w-[140px] truncate font-mono text-[9px] text-gray-400">{entry.entityId ?? '—'}</p>
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      <p className="truncate font-mono text-[9px] text-gray-500">{entry.metadata ? JSON.stringify(entry.metadata) : '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[9px] text-gray-500">{entry.ip ?? '—'}</p>
                      <p className="max-w-[140px] truncate text-[9px] text-gray-400">{entry.requestId ?? ''}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5">
            <p className="text-[9px] text-gray-400">
              Page {meta?.page ?? 1} · {meta?.limit ?? 50} per page · {meta?.total ?? 0} total
            </p>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" disabled={(meta?.page ?? 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={(meta?.page ?? 1) * (meta?.limit ?? 50) >= (meta?.total ?? 0)} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
