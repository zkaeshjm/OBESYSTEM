import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, FileBarChart2, FileText, ListChecks, Target } from 'lucide-react';
import { api } from '../api/client';
import { useAsync, formatDate, formatPct } from '../hooks/useAsync';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
} from '../components/ui';

export default function PloDrillDown() {
  const { id: ploId = '' } = useParams();
  const [version, setVersion] = useState(0);
  const query = useAsync(
    () => (ploId ? api.ploDrillDown(ploId) : Promise.resolve(null)),
    [ploId, version]
  );

  const data = query.data?.data;

  const offeringRows = useMemo(
    () =>
      (data?.offerings ?? []).map((entry) => ({
        ...entry,
        gap: entry.result.targetPct - entry.result.attainmentPct,
      })),
    [data]
  );

  if (!ploId) return <EmptyState title="No PLO selected" description="Open a PLO from the framework to inspect its evidence." icon={<Target size={20} />} />;
  if (query.loading) return <Loading label="Loading PLO drill-down…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={() => setVersion((current) => current + 1)} />;
  if (!data) return <ErrorState message="PLO not found." />;

  const { plo } = data;

  return (
    <div>
      <Link to="/plos" className="mb-3 inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-900">
        <ChevronRight size={12} className="rotate-180" /> Back to PLO framework
      </Link>
      <PageHeader
        eyebrow={plo.program ? `${plo.program.code} · ${plo.program.name}` : undefined}
        title={`${plo.code} — ${plo.description}`}
        description="Every figure below is the persisted programme roll-up from a stored attainment run. No value is recomputed from raw marks on read."
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Offering contributions" description="Latest persisted PLO result per offering, with the run that produced it." />
            {offeringRows.length === 0 ? (
              <EmptyState
                title="No attainment evidence yet"
                description="Map CLOs to this PLO and calculate attainment for at least one offering."
                icon={<Target size={20} />}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                      <th className="px-4 py-2.5 font-bold">Offering</th>
                      <th className="px-4 py-2.5 font-bold">Attainment</th>
                      <th className="px-4 py-2.5 font-bold">Target</th>
                      <th className="px-4 py-2.5 font-bold">Status</th>
                      <th className="px-4 py-2.5 font-bold">Contributing CLOs</th>
                      <th className="px-4 py-2.5 font-bold">Calculation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {offeringRows.map((row) => (
                      <tr key={row.run.id} className="hover:bg-gray-50/60">
                        <td className="px-4 py-3">
                          <Link to={`/offerings/${row.offering.id}?tab=attainment`} className="text-[10px] font-semibold text-gray-900 hover:underline">
                            {row.offering.course.code} — {row.offering.course.title}
                          </Link>
                          <p className="text-[9px] text-gray-500">
                            {row.offering.sectionName} · {row.offering.semester.name} · {row.offering.tutor.name}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[11px] font-bold text-gray-900">{formatPct(row.result.attainmentPct)}</p>
                          {row.result.status !== 'MET' && (
                            <p className="text-[9px] font-medium text-amber-600">shortfall {formatPct(Math.max(0, row.gap))}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[10px] text-gray-600">{formatPct(row.result.targetPct)}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.result.status} /></td>
                        <td className="px-4 py-3 text-[10px] text-gray-600">
                          {row.result.contributingClos} CLOs · cohort {row.result.weightedCohort}
                        </td>
                        <td className="px-4 py-3 text-[9px] text-gray-500">
                          <p>{row.run.isFrozen ? 'Frozen run' : 'Draft run'} · {formatDate(row.run.computedAt, true)}</p>
                          <p>Policy {row.run.policyName} v{row.run.policyVersion}</p>
                           <p>Period {row.run.reportingPeriod || '—'} · by {row.run.computedBy || 'system'}</p>
                           <p>Evidence {row.result.evidence ? 'traceable snapshot stored' : 'legacy result without detail'}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Mapped CLOs" description="Course outcomes that provide evidence for this PLO." />
            {data.mappedClos.length === 0 ? (
              <EmptyState title="No CLO mappings" description="Map course CLOs to this PLO to begin gathering evidence." icon={<ListChecks size={20} />} />
            ) : (
              <ul className="divide-y divide-gray-50">
                {data.mappedClos.map((mapping) => (
                  <li key={mapping.mappingId} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-gray-900">{mapping.clo.code}</span>
                        <Badge tone="purple">weight {mapping.weight}</Badge>
                        <StatusBadge status={mapping.clo.approvalStatus} />
                        {mapping.clo.archivedAt && <StatusBadge status="ARCHIVED" />}
                      </div>
                      <p className="mt-0.5 text-[10px] text-gray-600">{mapping.clo.description}</p>
                      <p className="text-[9px] text-gray-400">{mapping.clo.course.code} — {mapping.clo.course.title}</p>
                    </div>
                    <Badge tone="gray">{mapping.clo.approvalStatus === 'APPROVED' ? 'Evidence eligible' : 'Not eligible'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Configured target" />
            <dl className="space-y-3 px-5 py-4 text-[10px]">
              <div>
                <dt className="text-gray-400">Attainment target</dt>
                <dd className="text-lg font-bold text-gray-900">{formatPct(data.configuredTarget.attainmentPct)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Accreditation reference</dt>
                <dd className="font-semibold text-gray-800">{data.configuredTarget.accreditationRef ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Bloom domain</dt>
                <dd className="font-semibold text-gray-800">{plo.bloomDomain}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Evidence status" description="How complete the current evidence base is." />
            <div className="space-y-2.5 px-5 py-4">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500">Offerings with a persisted result</span>
                <Badge tone={offeringRows.length ? 'green' : 'amber'}>{offeringRows.length}</Badge>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500">Contributing CLO mappings</span>
                <Badge tone="blue">{data.mappedClos.length}</Badge>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500">Eligible (approved, active) CLOs</span>
                <Badge tone={data.mappedClos.some((mapping) => mapping.clo.approvalStatus === 'APPROVED' && !mapping.clo.archivedAt) ? 'green' : 'amber'}>
                  {data.mappedClos.filter((mapping) => mapping.clo.approvalStatus === 'APPROVED' && !mapping.clo.archivedAt).length}
                </Badge>
              </div>
              <p className="rounded-xl bg-gray-50 p-2.5 text-[9px] leading-relaxed text-gray-500">
                Missing evidence is shown explicitly. The PLO attainment value is a weighted roll-up of CLO results and is
                always traceable to the specific run, policy version and computation timestamp listed above.
              </p>
            </div>
          </Card>

          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-[10px] text-blue-800">
            <p className="flex items-center gap-1.5 font-bold"><FileText size={13} /> Export</p>
            <p className="mt-1 leading-relaxed">
              The programme-level attainment report covering this PLO's offerings can be downloaded as a printable PDF or
              CSV from the <Link to="/reports" className="font-semibold underline">Reports</Link> page. The PDF is generated
              server-side from the same persisted runs shown here.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Link to="/reports" className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[9px] font-semibold text-white hover:bg-blue-700">
                <FileBarChart2 size={11} /> Open report
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
