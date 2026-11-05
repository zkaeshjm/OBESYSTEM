import { AlertTriangle, Target } from 'lucide-react';
import type { AttainmentRun } from '../../api/types';
import { formatDate, formatPct } from '../../hooks/useAsync';
import { Badge, Card, CardHeader, EmptyState, ProgressBar, StatusBadge } from '../ui';

export function AttainmentPanel({
  run,
  onOpenRun,
}: {
  run: AttainmentRun | null;
  onOpenRun?: () => void;
}) {
  if (!run) {
    return (
      <Card>
        <CardHeader title="CLO and PLO attainment" description="No attainment run exists for this offering yet." />
        <EmptyState
          title="Attainment not calculated"
          description="Compute attainment after grading. The run stores the policy version, evidence counts and timestamps."
          icon={<Target size={20} />}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Calculation provenance"
          description="Stored with the results and never overwritten by a later recalculation."
          action={
            <div className="flex items-center gap-1">
              <Badge tone={run.isFrozen ? 'green' : 'amber'}>{run.isFrozen ? 'Frozen' : 'Draft run'}</Badge>
              <Badge tone="blue">{run.engineVersion}</Badge>
            </div>
          }
        />
        <dl className="grid gap-3 px-5 py-4 text-[10px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-gray-400">Computed</dt>
            <dd className="mt-0.5 font-semibold text-gray-800">{formatDate(run.computedAt, true)}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Policy version</dt>
            <dd className="mt-0.5 font-semibold text-gray-800">{run.policyVersion}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Reporting period</dt>
            <dd className="mt-0.5 font-semibold text-gray-800">{run.reportingPeriod ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Computed by</dt>
            <dd className="mt-0.5 font-semibold text-gray-800">{run.computedBy?.name ?? 'System'}</dd>
          </div>
        </dl>
        {onOpenRun && (
          <div className="border-t border-gray-100 px-5 py-2.5">
            <button type="button" onClick={onOpenRun} className="text-[10px] font-semibold text-gray-500 hover:text-gray-900">
              View run history and frozen snapshots
            </button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="CLO attainment" description="Student-mastery cohort attainment from eligible assessment evidence." />
        {run.cloResults.length === 0 ? (
          <EmptyState title="No CLO results" description="No approved CLO has mapped assessment evidence." icon={<Target size={20} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-2.5 font-bold">CLO</th>
                  <th className="px-4 py-2.5 font-bold">Attainment</th>
                  <th className="px-4 py-2.5 font-bold">Target</th>
                  <th className="px-4 py-2.5 font-bold">Students meeting</th>
                  <th className="px-4 py-2.5 font-bold">Eligible / cohort</th>
                  <th className="px-4 py-2.5 font-bold">Mean score</th>
                  <th className="px-4 py-2.5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {run.cloResults.map((result) => (
                  <tr key={result.cloId} className="align-top hover:bg-gray-50/60">
                    <td className="max-w-xs px-4 py-3">
                      <p className="font-mono text-[10px] font-bold text-gray-900">{result.clo.code}</p>
                      <p className="mt-0.5 line-clamp-2 text-[9px] leading-relaxed text-gray-500">{result.clo.description}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[11px] font-bold text-gray-900">{formatPct(result.attainmentPct)}</p>
                      <div className="mt-1 w-24">
                        <ProgressBar
                          value={Number(result.attainmentPct)}
                          tone={result.status === 'MET' ? 'green' : result.status === 'AT_RISK' ? 'amber' : result.status === 'NOT_MET' ? 'red' : 'blue'}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{formatPct(result.targetPct)}</td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">
                      {result.attainedCount} / {result.eligibleCount}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">
                      {result.eligibleCount} / {result.cohortSize}
                      {result.missingEvidenceCount > 0 && (
                        <span className="mt-0.5 block text-[9px] text-amber-600">{result.missingEvidenceCount} without evidence</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{formatPct(result.meanScore)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={result.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="PLO roll-up"
          description="Weighted aggregation of this offering's CLO results. Programme-level reports combine offerings."
        />
        {run.ploResults.length === 0 ? (
          <EmptyState title="No mapped PLO results" description="Map CLOs to programme PLOs to produce programme outcomes." icon={<Target size={20} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                  <th className="px-4 py-2.5 font-bold">PLO</th>
                  <th className="px-4 py-2.5 font-bold">Attainment</th>
                  <th className="px-4 py-2.5 font-bold">Target</th>
                  <th className="px-4 py-2.5 font-bold">Contributing CLOs</th>
                  <th className="px-4 py-2.5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {run.ploResults.map((result) => (
                  <tr key={result.ploId} className="hover:bg-gray-50/60">
                    <td className="max-w-md px-4 py-3">
                      <p className="font-mono text-[10px] font-bold text-gray-900">{result.plo.code}</p>
                      <p className="mt-0.5 line-clamp-1 text-[9px] text-gray-500">{result.plo.description}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[11px] font-bold text-gray-900">{formatPct(result.attainmentPct)}</p>
                      <div className="mt-1 w-24">
                        <ProgressBar
                          value={Number(result.attainmentPct)}
                          tone={result.status === 'MET' ? 'green' : result.status === 'AT_RISK' ? 'amber' : 'red'}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{formatPct(result.targetPct)}</td>
                    <td className="px-4 py-3 text-[10px] text-gray-600">{result.contributingClos}</td>
                    <td className="px-4 py-3"><StatusBadge status={result.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {run.cloResults.some((result) => result.status === 'INSUFFICIENT_DATA') && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            Some CLOs have fewer eligible students than the configured minimum cohort size. They are reported as insufficient data rather
            than met or not met, so a small class cannot silently pass or fail an outcome.
          </p>
        </div>
      )}
    </div>
  );
}
