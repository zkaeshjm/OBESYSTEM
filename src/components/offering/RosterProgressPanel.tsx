import { useState } from 'react';
import { ChevronRight, Clock, FileText, ListChecks, Percent } from 'lucide-react';
import { api } from '../../api/client';
import type { RosterProgressResponse } from '../../api/types';
import { useAsync, formatDate, formatPct } from '../../hooks/useAsync';
import { useAuth } from '../../context/AuthContext';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Loading, ProgressBar, StatusBadge } from '../ui';

export function RosterProgressPanel({ offeringId }: { offeringId: string }) {
  const { user } = useAuth();
  const isManager = user?.role === 'ADMIN' || user?.role === 'TUTOR';
  const [expanded, setExpanded] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const query = useAsync(() => (isManager ? api.rosterProgress(offeringId) : Promise.resolve(null)), [offeringId, isManager, version]);

  const data = query.data?.data as RosterProgressResponse | undefined;

  if (!isManager) return null;
  if (query.loading) return <Loading label="Loading roster progress…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={() => setVersion((current) => current + 1)} />;
  if (!data || data.students.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No enrolled students"
          description="Enrol students before submission and grading data can be tracked."
          icon={<ListChecks size={20} />}
        />
      </Card>
    );
  }

  const masteryByStudent = new Map(data.cloMastery.map((entry) => [entry.studentId, entry]));

  return (
    <Card>
      <CardHeader
        title="Student progress"
        description={
          data.latestRun
            ? `CLO attainment is from the ${data.latestRun.isFrozen ? 'frozen' : 'draft'} run of ${formatDate(
                data.latestRun.computedAt,
                true
              )} (policy ${data.latestRun.policyVersion}). Per-student figures use published grades only; missing evidence is shown explicitly, never invented.`
            : 'No attainment run yet — cohort CLO mastery will appear after the first calculation.'
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
              <th className="px-4 py-2.5 font-bold">Student</th>
              <th className="px-4 py-2.5 font-bold">Submissions</th>
              <th className="px-4 py-2.5 font-bold">Published grade</th>
              <th className="px-4 py-2.5 font-bold">Status</th>
              <th className="px-4 py-2.5 font-bold">CLO mastery</th>
              <th className="px-4 py-2.5 text-right font-bold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.students.map((entry) => {
              const mastery = masteryByStudent.get(entry.student.id)?.outcomes ?? [];
              const masteredCount = mastery.filter((outcome) => outcome.status === 'MET').length;
              const open = expanded === entry.student.id;
              return [
                <tr key={entry.enrollmentId} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <p className="text-[10px] font-semibold text-gray-800">{entry.student.name}</p>
                    <p className="font-mono text-[9px] text-gray-400">{entry.student.rollNo}</p>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-gray-600">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={entry.submittedAssessmentCount === entry.totalAssessmentCount && entry.totalAssessmentCount > 0 ? 'green' : 'gray'}>
                        {entry.submittedAssessmentCount} / {entry.totalAssessmentCount} submitted
                      </Badge>
                      {entry.pendingGradingCount > 0 && (
                        <Badge tone="amber">
                          <Clock size={9} /> {entry.pendingGradingCount} awaiting marks
                        </Badge>
                      )}
                      {entry.unpublishedGradedCount > 0 && (
                        <Badge tone="blue">{entry.unpublishedGradedCount} grade(s) unpublished</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {entry.publishedAveragePct === null ? (
                      <span className="text-[10px] text-gray-400">
                        {entry.unpublishedGradedCount > 0
                          ? 'Grade recorded — awaiting publication'
                          : entry.pendingGradingCount > 0
                            ? 'Submission awaiting grading'
                            : 'No published grades'}
                      </span>
                    ) : (
                      <div>
                        <p className="text-[11px] font-bold text-gray-900">{formatPct(entry.publishedAveragePct)}</p>
                        <div className="mt-0.5 w-24">
                          <ProgressBar
                            value={entry.publishedAveragePct}
                            tone={entry.publishedAveragePct >= 60 ? 'green' : entry.publishedAveragePct >= 40 ? 'amber' : 'red'}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.enrollmentStatus} />
                  </td>
                  <td className="px-4 py-3">
                    {mastery.length === 0 ? (
                      <span className="text-[10px] text-gray-400">
                        {data.latestRun ? 'No eligible CLO evidence in this run' : 'No attainment run yet'}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {mastery.map((outcome) => (
                          <Badge key={outcome.cloCode} tone={outcome.status === 'MET' ? 'green' : outcome.status === 'INSUFFICIENT_DATA' ? 'gray' : 'red'}>
                            {outcome.cloCode}
                            {outcome.studentScore === null ? ' — no evidence' : ` ${formatPct(outcome.studentScore)} ${outcome.status === 'MET' ? 'met' : 'not met'}`}
                          </Badge>
                        ))}
                        <Badge tone="blue">
                          {masteredCount}/{mastery.length} CLOs met
                        </Badge>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-gray-500 hover:text-gray-900"
                      onClick={() => setExpanded(open ? null : entry.student.id)}
                      aria-expanded={open}
                    >
                      Detail <ChevronRight size={11} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
                    </button>
                  </td>
                </tr>,
                open ? (
                  <tr key={`${entry.enrollmentId}-detail`} className="bg-gray-50/40">
                    <td colSpan={6} className="px-4 py-3">
                      {mastery.length === 0 ? (
                        <p className="flex items-center gap-1.5 text-[10px] text-gray-500">
                          <FileText size={12} /> No per-CLO evidence for this student in the latest run — the cohort figures
                          above are not available to fabricate an individual value.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {mastery.map((outcome) => (
                            <li key={outcome.cloCode} className="text-[10px] text-gray-600">
                              <span className="font-semibold">{outcome.cloCode}</span> {outcome.description}
                               <span className="ml-2 text-gray-400">
                                 {outcome.studentScore === null
                                   ? 'no individual evidence'
                                   : `score ${formatPct(outcome.studentScore)} · threshold ${formatPct(outcome.masteryThreshold)}`}{' '}
                                 · cohort {formatPct(outcome.cohortAttainmentPct)} ({outcome.cohortStatus ?? 'legacy run'})
                               </span>
                            </li>
                          ))}
                          <li className="flex items-center gap-1.5 text-[10px] text-gray-500">
                            <Percent size={11} className="text-gray-400" />
                             Per-student CLO mastery is shown only when the persisted run contains an individual evidence
                             snapshot; missing snapshots remain visibly unavailable.
                          </li>
                        </ul>
                      )}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-gray-100 px-5 py-2.5 text-[9px] text-gray-400">
        “Published grade” reflects only results the tutor has actually published. “Awaiting marks” counts submissions still
        in SUBMITTED or LATE state. CLO mastery badges show the cohort attainment for this offering's latest run, with
        thresholds from the active policy; INSUFFICIENT_DATA means not enough eligible evidence yet.
      </p>
    </Card>
  );
}
