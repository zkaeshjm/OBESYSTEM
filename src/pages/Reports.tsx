import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, FileBarChart2, Target } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiError, downloadAttainmentCsv } from '../api/client';
import type { AttainmentReport } from '../api/types';
import { useAsync, formatDate, formatPct } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  InlineSelect,
  Loading,
  PageHeader,
  ProgressBar,
  StatCard,
  StatusBadge,
  Tabs,
} from '../components/ui';

const statusColor: Record<string, string> = {
  MET: '#10b981',
  AT_RISK: '#f59e0b',
  NOT_MET: '#f43f5e',
  INSUFFICIENT_DATA: '#9ca3af',
};

export default function Reports() {
  const { toast } = useToast();
  const [programId, setProgramId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [tab, setTab] = useState<'overview' | 'gaps'>('overview');
  const [exporting, setExporting] = useState(false);

  const programsQuery = useAsync(() => api.programs(), []);
  const semestersQuery = useAsync(() => api.semesters(), []);
  const offeringsQuery = useAsync(() => api.offerings({ limit: 100 }), []);
  const filterKey = `${programId}|${semesterId}|${offeringId}`;
  const reportsQuery = useAsync(
    () => api.report({ programId, semesterId, offeringId }),
    [filterKey]
  );
  const gapsQuery = useAsync(
    () => (tab === 'gaps' ? api.gaps({ programId, semesterId, offeringId }) : Promise.resolve(null)),
    [filterKey, tab]
  );

  const programs = programsQuery.data?.data ?? [];
  const semesters = semestersQuery.data?.data ?? [];
  const offerings = offeringsQuery.data?.data ?? [];
  const report = reportsQuery.data?.data as AttainmentReport | undefined;
  const gaps = gapsQuery.data?.data as
    | { cloGaps?: Array<Record<string, unknown>>; ploGaps?: Array<Record<string, unknown>> }
    | undefined;

  const ploChart =
    report?.ploRows.map((row) => ({
      name: row.plo.code,
      attainment: row.attainmentPct,
      target: row.targetPct,
      status: row.status,
    })) ?? [];

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAttainmentCsv({ programId, semesterId, offeringId });
      toast('CSV report downloaded.');
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to export the report.', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Attainment & gap analysis"
        description="Reports are built from persisted attainment runs. Programme PLO figures roll up stored CLO results and never recalculate marks on read."
        actions={
          <Button variant="secondary" size="sm" loading={exporting} onClick={() => void exportCsv()}>
            <Download size={13} /> Export CSV
          </Button>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <InlineSelect value={programId} onChange={(event) => setProgramId(event.target.value)} aria-label="Filter by programme">
          <option value="">All accessible programmes</option>
          {programs.map((program) => <option key={program.id} value={program.id}>{program.code} — {program.name}</option>)}
        </InlineSelect>
        <InlineSelect value={semesterId} onChange={(event) => setSemesterId(event.target.value)} aria-label="Filter by session">
          <option value="">All sessions</option>
          {semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}</option>)}
        </InlineSelect>
        <InlineSelect value={offeringId} onChange={(event) => setOfferingId(event.target.value)} aria-label="Filter by offering">
          <option value="">All offerings</option>
          {offerings.map((offering) => (
            <option key={offering.id} value={offering.id}>{offering.course.code} · {offering.sectionName} · {offering.semester.name}</option>
          ))}
        </InlineSelect>
        <div className="ml-auto">
          <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'gaps', label: 'Gaps' }]} value={tab} onChange={setTab} />
        </div>
      </Card>

      {reportsQuery.loading ? (
        <Loading label="Loading attainment report…" />
      ) : reportsQuery.error ? (
        <ErrorState message={reportsQuery.error} onRetry={reportsQuery.reload} />
      ) : !report ? (
        <Card><EmptyState title="No report data" icon={<FileBarChart2 size={20} />} /></Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Offering runs" value={report.provenance.offeringCount} detail="Latest run per offering" icon={<FileBarChart2 size={18} />} tone="blue" />
            <StatCard label="CLO results" value={report.summary.clo.total} detail={`${report.summary.clo.met} met · ${report.summary.clo.notMet} gaps`} icon={<Target size={18} />} tone="green" />
            <StatCard label="PLO results" value={report.summary.plo.total} detail={`${report.summary.plo.met} met · ${report.summary.plo.notMet} gaps`} icon={<BarChart3 size={18} />} tone={report.summary.plo.notMet ? 'amber' : 'green'} />
            <StatCard label="Policy" value={report.summary.policy?.version ?? '—'} detail={report.summary.policy?.name ?? 'No run policy'} icon={<FileBarChart2 size={18} />} tone="gray" />
          </div>

          {tab === 'overview' ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                <Card>
                  <CardHeader title="PLO attainment" description="Programme roll-up across the selected offerings" />
                  {ploChart.length === 0 ? (
                    <EmptyState title="No PLO results" description="Map CLOs to PLOs and calculate attainment." icon={<Target size={20} />} />
                  ) : (
                    <div className="h-64 px-3 py-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ploChart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                          <Tooltip contentStyle={{ fontSize: 10, borderRadius: 12 }} />
                          <Bar dataKey="target" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="attainment" radius={[4, 4, 0, 0]}>
                            {ploChart.map((entry, index) => <Cell key={index} fill={statusColor[entry.status]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Run provenance" description="Each figure below is traceable to a stored run." />
                  <ul className="max-h-72 divide-y divide-gray-50 overflow-y-auto">
                    {report.runs.map((run) => (
                      <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <div>
                          <p className="text-[11px] font-semibold text-gray-800">{run.course.code} — {run.course.title}</p>
                          <p className="text-[9px] text-gray-400">
                            {run.semester.name} · {formatDate(run.computedAt, true)} · policy {run.policyVersion}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Badge tone={run.isFrozen ? 'green' : 'amber'}>{run.isFrozen ? 'Frozen' : 'Draft'}</Badge>
                          <Link to={`/offerings/${run.offeringId}?tab=attainment`} className="text-[9px] font-semibold text-gray-500 hover:text-gray-900">Open</Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>

              <Card>
                <CardHeader title="PLO attainment table" description="Weighted by mapping strength and eligible cohort." />
                {report.ploRows.length === 0 ? (
                  <EmptyState title="No PLO attainment" icon={<Target size={20} />} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left">
                      <thead>
                        <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                          <th className="px-4 py-2.5 font-bold">PLO</th>
                          <th className="px-4 py-2.5 font-bold">Attainment</th>
                          <th className="px-4 py-2.5 font-bold">Target</th>
                          <th className="px-4 py-2.5 font-bold">CLOs</th>
                          <th className="px-4 py-2.5 font-bold">Weighted cohort</th>
                          <th className="px-4 py-2.5 font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {report.ploRows.map((row) => (
                          <tr key={row.plo.id} className="hover:bg-gray-50/60">
                            <td className="max-w-md px-4 py-3">
                              <p className="font-mono text-[10px] font-bold text-gray-900">{row.plo.code}</p>
                              <p className="mt-0.5 line-clamp-1 text-[9px] text-gray-500">{row.plo.description}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-[11px] font-bold text-gray-900">{formatPct(row.attainmentPct)}</p>
                              <div className="mt-1 w-24"><ProgressBar value={row.attainmentPct} tone={row.status === 'MET' ? 'green' : row.status === 'AT_RISK' ? 'amber' : 'red'} /></div>
                            </td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{formatPct(row.targetPct)}</td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{row.contributingClos}</td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{row.weightedCohort}</td>
                            <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader title="CLO attainment by offering" description={`${report.cloRows.length} persisted CLO results`} />
                {report.cloRows.length === 0 ? (
                  <EmptyState title="No CLO results" description="Calculate attainment for an offering with graded evidence." icon={<Target size={20} />} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left">
                      <thead>
                        <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                          <th className="px-4 py-2.5 font-bold">Course / CLO</th>
                          <th className="px-4 py-2.5 font-bold">Session</th>
                          <th className="px-4 py-2.5 font-bold">Attainment</th>
                          <th className="px-4 py-2.5 font-bold">Target</th>
                          <th className="px-4 py-2.5 font-bold">Met / eligible</th>
                          <th className="px-4 py-2.5 font-bold">Mean</th>
                          <th className="px-4 py-2.5 font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {report.cloRows.map((row, index) => (
                          <tr key={`${row.runId}-${row.clo.id}-${index}`} className="hover:bg-gray-50/60">
                            <td className="px-4 py-3">
                              <p className="text-[10px] font-semibold text-gray-900">{row.course.code} · {row.clo.code}</p>
                              <p className="line-clamp-1 text-[9px] text-gray-500">{row.clo.description}</p>
                            </td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{row.semester.name}</td>
                            <td className="px-4 py-3">
                              <p className="text-[11px] font-bold text-gray-900">{formatPct(row.attainmentPct)}</p>
                              <div className="mt-1 w-20"><ProgressBar value={row.attainmentPct} tone={row.status === 'MET' ? 'green' : row.status === 'AT_RISK' ? 'amber' : 'red'} /></div>
                            </td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{formatPct(row.targetPct)}</td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{row.attainedCount} / {row.eligibleCount} <span className="text-gray-400">of {row.cohortSize}</span></td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{formatPct(row.meanScore)}</td>
                            <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : gapsQuery.loading ? (
            <Loading label="Loading gaps…" />
          ) : gapsQuery.error ? (
            <ErrorState message={gapsQuery.error} onRetry={gapsQuery.reload} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="CLO gaps" description="Ranked by shortfall against target" />
                {!gaps?.cloGaps?.length ? (
                  <EmptyState title="No CLO gaps" description="Every reported CLO meets its target." icon={<Target size={20} />} />
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {gaps.cloGaps.map((gap, index) => (
                      <li key={index} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold text-gray-800">
                              {String(gap.course && (gap.course as { code?: string }).code)} · {String((gap.clo as { code?: string })?.code)}
                            </p>
                            <p className="text-[9px] text-gray-400">
                              attainment {formatPct(gap.attainmentPct as number)} · target {formatPct(gap.targetPct as number)} · shortfall {formatPct(gap.shortfall as number)}
                            </p>
                          </div>
                          <StatusBadge status={String(gap.status)} />
                        </div>
                        <div className="mt-2"><ProgressBar value={gap.attainmentPct as number} tone={gap.status === 'NOT_MET' ? 'red' : 'amber'} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader title="PLO gaps" description="Programme-level outcomes below target" />
                {!gaps?.ploGaps?.length ? (
                  <EmptyState title="No PLO gaps" description="Every reported PLO meets its target." icon={<Target size={20} />} />
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {gaps.ploGaps.map((gap, index) => (
                      <li key={index} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold text-gray-800">{String((gap.plo as { code?: string })?.code)}</p>
                            <p className="text-[9px] text-gray-400">
                              attainment {formatPct(gap.attainmentPct as number)} · target {formatPct(gap.targetPct as number)} · shortfall {formatPct(gap.shortfall as number)}
                            </p>
                          </div>
                          <StatusBadge status={String(gap.status)} />
                        </div>
                        <div className="mt-2"><ProgressBar value={gap.attainmentPct as number} tone={gap.status === 'NOT_MET' ? 'red' : 'amber'} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          <p className="text-[9px] leading-relaxed text-gray-400">{report.note}</p>
        </div>
      )}
    </div>
  );
}
