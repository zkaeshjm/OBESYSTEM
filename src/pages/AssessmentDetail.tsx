import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CheckCircle2, Clock, History, Send, Target } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { Assessment, GradeChange, GradeState, Submission } from '../api/types';
import { formatDate, formatPct } from '../hooks/useAsync';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  useConfirm,
} from '../components/ui';

interface GradeDraft {
  itemId: string;
  marks: string;
  state: GradeState;
  feedback: string;
}

export default function AssessmentDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const query = useAsync(() => api.assessment(id), [id]);
  const assessment = query.data?.data as Assessment | undefined;
  const isManager = user?.role === 'ADMIN' || user?.role === 'TUTOR';

  const [grading, setGrading] = useState<Submission | null>(null);
  const [draft, setDraft] = useState<GradeDraft[]>([]);
  const [criterionDraft, setCriterionDraft] = useState<Record<string, { marks: string; feedback: string }>>({});
  const [overallFeedback, setOverallFeedback] = useState('');
  const [gradeReason, setGradeReason] = useState('');
  const [overallError, setOverallError] = useState('');
  const [saving, setSaving] = useState(false);

  const [historySubmission, setHistorySubmission] = useState<Submission | null>(null);
  const [history, setHistory] = useState<GradeChange[]>([]);
  const [historyError, setHistoryError] = useState('');

  const [submissionContent, setSubmissionContent] = useState('');
  const [submissionUrl, setSubmissionUrl] = useState('');
  const [studentError, setStudentError] = useState('');

  const studentSubmission = useMemo(() => assessment?.submissions?.[0] ?? null, [assessment]);

  useEffect(() => {
    if (!studentSubmission) return;
    setSubmissionContent(studentSubmission.content ?? '');
    setSubmissionUrl(studentSubmission.attachmentUrl ?? '');
  }, [studentSubmission]);

  const openGrading = (submission: Submission) => {
    if (!assessment?.items) return;
    const existing = new Map(submission.grades.map((grade) => [grade.itemId, grade]));
    setDraft(
      assessment.items.map((item) => {
        const grade = existing.get(item.id);
        return {
          itemId: item.id,
          marks: grade ? String(Number(grade.marks)) : '',
          state: grade?.state ?? 'GRADED',
          feedback: grade?.feedback ?? '',
        };
      })
    );
    const initialCriteria: Record<string, { marks: string; feedback: string }> = {};
    for (const item of assessment.items) {
      for (const criterion of item.rubricCriteria ?? []) {
        const existingCriterion = submission.criterionGrades?.find((grade) => grade.criterionId === criterion.id);
        initialCriteria[criterion.id] = {
          marks: existingCriterion ? String(Number(existingCriterion.marks)) : '',
          feedback: existingCriterion?.feedback ?? '',
        };
      }
    }
    setCriterionDraft(initialCriteria);
    setOverallFeedback(submission.overallFeedback ?? '');
    setGradeReason('');
    setOverallError('');
    setGrading(submission);
  };

  const openHistory = async (submission: Submission) => {
    setHistorySubmission(submission);
    setHistory([]);
    setHistoryError('');
    try {
      const response = await api.gradeHistory(submission.id);
      setHistory(response.data);
    } catch (caught) {
      setHistoryError(caught instanceof ApiError ? caught.message : 'Unable to load the grade history.');
    }
  };

  const saveGrades = async (event: FormEvent) => {
    event.preventDefault();
    if (!grading || !assessment?.items) return;
    const payload = [];
    const criterionPayload: Array<{ criterionId: string; marks: number; feedback: string | null }> = [];
    for (const entry of draft) {
      const item = assessment.items.find((candidate) => candidate.id === entry.itemId);
      if (!item) continue;
      const criteria = item.rubricCriteria ?? [];
      let marks = entry.state === 'GRADED' ? Number(entry.marks) : 0;

      if (criteria.length > 0 && entry.state === 'GRADED') {
        const criterionMarks: number[] = [];
        for (const criterion of criteria) {
          const recorded = criterionDraft[criterion.id];
          if (!recorded || recorded.marks === '') {
            setOverallError(`Enter marks for every rubric criterion of ${item.label}.`);
            return;
          }
          const value = Number(recorded.marks);
          if (Number.isNaN(value) || value < 0 || value > Number(criterion.maxMarks)) {
            setOverallError(`${criterion.label} must be between 0 and ${Number(criterion.maxMarks)}.`);
            return;
          }
          criterionMarks.push(value);
          criterionPayload.push({
            criterionId: criterion.id,
            marks: value,
            feedback: recorded.feedback.trim() || null,
          });
        }
        marks = criterionMarks.reduce((sum, value) => sum + value, 0);
      } else if (entry.state === 'GRADED') {
        if (entry.marks === '') {
          setOverallError(`Enter marks or mark ${item.label} as excused/incomplete.`);
          return;
        }
        if (Number.isNaN(marks) || marks < 0 || marks > Number(item.maxMarks)) {
          setOverallError(`Marks for ${item.label} must be between 0 and ${Number(item.maxMarks)}.`);
          return;
        }
      }
      payload.push({ itemId: entry.itemId, marks, state: entry.state, feedback: entry.feedback.trim() || null });
    }
    setSaving(true);
    setOverallError('');
    if (assessment.resultsPublishedAt && gradeReason.trim().length < 5) {
      setSaving(false);
      setOverallError('Results are already published. Enter a reason of at least 5 characters for this correction.');
      return;
    }
    try {
      await api.grade(grading.id, {
        grades: payload,
        criterionGrades: criterionPayload,
        overallFeedback: overallFeedback.trim() || null,
        reason: gradeReason.trim() || null,
      });
      toast('Grades saved.');
      setGrading(null);
      await query.reload();
    } catch (caught) {
      setOverallError(caught instanceof ApiError ? caught.message : 'Unable to save grades.');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!assessment) return;
    try {
      await api.publishAssessment(assessment.id);
      toast('Assessment published.');
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to publish.', 'error');
    }
  };

  const close = async () => {
    if (!assessment) return;
    const confirmed = await confirm({
      title: 'Close assessment',
      message: 'Closing stops new submissions. Existing submissions remain gradable.',
      confirmLabel: 'Close assessment',
    });
    if (!confirmed) return;
    try {
      await api.closeAssessment(assessment.id);
      toast('Assessment closed.');
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to close the assessment.', 'error');
    }
  };

  const archive = async () => {
    if (!assessment) return;
    const confirmed = await confirm({
      title: 'Archive assessment',
      message: 'Archiving hides this assessment from active lists while keeping its grades and evidence. All pending submissions must be graded first.',
      confirmLabel: 'Archive assessment',
    });
    if (!confirmed) return;
    try {
      await api.archiveAssessment(assessment.id);
      toast('Assessment archived.');
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to archive the assessment.', 'error');
    }
  };

  const restore = async () => {
    if (!assessment) return;
    try {
      await api.restoreAssessment(assessment.id);
      toast('Assessment restored.');
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to restore the assessment.', 'error');
    }
  };

  const publishResults = async () => {    if (!assessment) return;
    try {
      await api.publishResults(assessment.id);
      toast('Results published to students.');
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to publish results.', 'error');
    }
  };

  const submitWork = async (event: FormEvent) => {
    event.preventDefault();
    setStudentError('');
    if (!submissionContent.trim() && !submissionUrl.trim()) {
      setStudentError('Provide your submission text or an attachment URL.');
      return;
    }
    setSaving(true);
    try {
      const body = { content: submissionContent.trim() || undefined, attachmentUrl: submissionUrl.trim() || undefined };
      if (studentSubmission) {
        await api.updateSubmission(studentSubmission.id, body);
        toast('Submission updated.');
      } else {
        await api.submit(id, body);
        toast('Submission received.');
      }
      await query.reload();
    } catch (caught) {
      setStudentError(caught instanceof ApiError ? caught.message : 'Unable to submit.');
    } finally {
      setSaving(false);
    }
  };

  if (query.loading) return <Loading label="Loading assessment…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />;
  if (!assessment) return <ErrorState message="Assessment not found." />;

  const offering = assessment.offering;
  const totalMax = (assessment.items ?? []).reduce((sum, item) => sum + Number(item.maxMarks), 0);
  const canSubmit = assessment.status === 'PUBLISHED' && (!studentSubmission || studentSubmission.status === 'SUBMITTED' || studentSubmission.status === 'LATE');
  const showGrades = Boolean(studentSubmission) && (isManager || assessment.canViewResults);

  return (
    <div>
      <Link to={offering ? `/offerings/${offering.id}` : '/offerings'} className="mb-3 inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-900">
        <ArrowLeft size={12} /> Back to offering
      </Link>
      <PageHeader
        eyebrow={offering ? `${offering.course.code} · ${offering.semester?.name ?? ''}` : undefined}
        title={assessment.title}
        description={assessment.instructions ?? 'No additional instructions were provided.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={assessment.status} />
            <Badge tone="blue">{assessment.type.replaceAll('_', ' ')}</Badge>
            {isManager && assessment.status === 'DRAFT' && (
              <Button size="sm" onClick={() => void publish()}>Publish</Button>
            )}
            {isManager && assessment.status === 'PUBLISHED' && (
              <Button size="sm" variant="secondary" onClick={() => void close()}>Close</Button>
            )}
            {isManager && assessment.status !== 'DRAFT' && !assessment.resultsPublishedAt && (
              <Button size="sm" variant="success" onClick={() => void publishResults()}>Publish results</Button>
            )}
            {assessment.resultsPublishedAt && <Badge tone="green">Results published {formatDate(assessment.resultsPublishedAt)}</Badge>}
            {isManager && (assessment.status === 'PUBLISHED' || assessment.status === 'CLOSED') && (
              <Button size="sm" variant="ghost" onClick={() => void archive()}>Archive</Button>
            )}
            {isManager && assessment.status === 'ARCHIVED' && (
              <Button size="sm" variant="secondary" onClick={() => void restore()}>Restore</Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Assessment items" description="Each item shows the CLOs it provides evidence for." />
            {(assessment.items ?? []).length === 0 ? (
              <EmptyState title="No items" icon={<BookOpen size={20} />} />
            ) : (
              <ul className="divide-y divide-gray-50">
                {assessment.items!.map((item) => (
                  <li key={item.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-gray-800">{item.label}</p>
                        {item.prompt && <p className="mt-0.5 text-[10px] text-gray-500">{item.prompt}</p>}
                      </div>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold text-gray-600">
                        {Number(item.maxMarks)} marks
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.cloMappings.map((mapping) => (
                        <Badge key={mapping.cloId} tone="purple">
                          {mapping.clo?.code} · weight {Number(mapping.weight)}
                        </Badge>
                      ))}
                    </div>
                    {item.rubricCriteria && item.rubricCriteria.length > 0 && (
                      <ul className="mt-2 space-y-1 rounded-xl bg-gray-50 p-2">
                        <li className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">Rubric</li>
                        {item.rubricCriteria.map((criterion) => (
                          <li key={criterion.id} className="flex items-center justify-between gap-2 text-[9px] text-gray-600">
                            <span>{criterion.label}</span>
                            <span className="font-semibold">{Number(criterion.maxMarks)} marks</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-2.5 text-[10px] text-gray-500">
              <span>{assessment.items?.length ?? 0} items</span>
              <span className="font-bold text-gray-800">Total {totalMax} marks</span>
            </div>
          </Card>

          {isManager && (
            <Card>
              <CardHeader
                title="Submissions"
                description="Grade item-by-item. Overall feedback is visible to the student only after results are published."
                action={<Badge>{assessment.submissions?.length ?? 0} submitted</Badge>}
              />
              {(assessment.submissions ?? []).length === 0 ? (
                <EmptyState title="No submissions yet" description="Students see the assessment once it is published." icon={<Clock size={20} />} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                        <th className="px-4 py-2.5 font-bold">Student</th>
                        <th className="px-4 py-2.5 font-bold">Submitted</th>
                        <th className="px-4 py-2.5 font-bold">Late</th>
                        <th className="px-4 py-2.5 font-bold">Grade</th>
                        <th className="px-4 py-2.5 font-bold">Status</th>
                        <th className="px-4 py-2.5 text-right font-bold" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {assessment.submissions!.map((submission) => {
                        const earned = submission.grades.reduce((sum, grade) => sum + Number(grade.marks), 0);
                        const max = assessment.items?.reduce((sum, item) => sum + Number(item.maxMarks), 0) ?? 0;
                        return (
                          <tr key={submission.id} className="hover:bg-gray-50/60">
                            <td className="px-4 py-3">
                              <p className="text-[10px] font-semibold text-gray-800">{submission.student?.user?.name}</p>
                              <p className="font-mono text-[9px] text-gray-400">{submission.student?.rollNo}</p>
                            </td>
                            <td className="px-4 py-3 text-[10px] text-gray-600">{formatDate(submission.submittedAt, true)}</td>
                            <td className="px-4 py-3">{submission.isLate ? <Badge tone="red">Late</Badge> : <span className="text-[9px] text-gray-400">On time</span>}</td>
                            <td className="px-4 py-3 text-[10px] font-semibold text-gray-700">
                              {submission.grades.length > 0 ? `${earned} / ${max} (${formatPct(max ? (earned / max) * 100 : 0)})` : '—'}
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={submission.status} /></td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-1.5">
                                <Button size="sm" variant="ghost" onClick={() => void openHistory(submission)} aria-label="View grade history">
                                  <History size={12} /> History
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => openGrading(submission)}>
                                  {submission.grades.length > 0 ? 'Edit grade' : 'Grade'}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {!isManager && (
            <Card>
              <CardHeader title="Your submission" description="You can update your work until it is graded." />
              <div className="px-5 py-4">
                {studentSubmission && (
                  <div className="mb-3 rounded-2xl bg-gray-50 p-3 text-[10px] text-gray-600">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={studentSubmission.status} />
                      <span>Submitted {formatDate(studentSubmission.submittedAt, true)}</span>
                      {studentSubmission.isLate && <Badge tone="red">Late</Badge>}
                    </div>
                    {studentSubmission.content && <p className="mt-2 whitespace-pre-wrap">{studentSubmission.content}</p>}
                    {studentSubmission.attachmentUrl && (
                      <a href={studentSubmission.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] font-semibold text-blue-600 underline">
                        Open attachment
                      </a>
                    )}
                  </div>
                )}

                {canSubmit ? (
                  <form onSubmit={submitWork} className="space-y-3">
                    <Field label="Submission text" htmlFor="submission-content">
                      <Textarea id="submission-content" rows={5} value={submissionContent} onChange={(event) => setSubmissionContent(event.target.value)} />
                    </Field>
                    <Field label="Attachment URL" htmlFor="submission-url" hint="Optional. Provide a controlled link to your uploaded file.">
                      <Input id="submission-url" type="url" value={submissionUrl} onChange={(event) => setSubmissionUrl(event.target.value)} placeholder="https://…" />
                    </Field>
                    {studentError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{studentError}</p>}
                    <Button type="submit" loading={saving}>
                      <Send size={13} /> {studentSubmission ? 'Update submission' : 'Submit assessment'}
                    </Button>
                    {assessment.dueAt && <p className="text-[9px] text-gray-400">Deadline: {formatDate(assessment.dueAt, true)}</p>}
                  </form>
                ) : (
                  <p className="rounded-xl bg-gray-50 p-3 text-[10px] text-gray-500">
                    {assessment.status === 'CLOSED'
                      ? 'This assessment is closed and no longer accepts submissions.'
                      : 'Your submission has been graded and can no longer be edited.'}
                  </p>
                )}
              </div>
            </Card>
          )}

          {showGrades && studentSubmission && (
            <Card>
              <CardHeader title="Feedback and marks" description={assessment.canViewResults ? 'Published by your tutor.' : 'Staff preview before publication.'} />
              <div className="px-5 py-4">
                {studentSubmission.grades.length === 0 ? (
                  <p className="text-[10px] text-gray-500">No marks recorded yet.</p>
                ) : (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                        <th className="py-2 font-bold">Item</th>
                        <th className="py-2 font-bold">Marks</th>
                        <th className="py-2 font-bold">State</th>
                        <th className="py-2 font-bold">Feedback</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {studentSubmission.grades.map((grade) => {
                        const item = assessment.items?.find((candidate) => candidate.id === grade.itemId);
                        return (
                          <tr key={grade.itemId}>
                            <td className="py-2 text-[10px] text-gray-700">{item?.label}</td>
                            <td className="py-2 text-[10px] font-semibold text-gray-800">{Number(grade.marks)} / {item ? Number(item.maxMarks) : '—'}</td>
                            <td className="py-2 text-[10px] text-gray-600">{grade.state}</td>
                            <td className="py-2 text-[10px] text-gray-500">{grade.feedback || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {studentSubmission.overallFeedback && (
                  <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-[10px] text-emerald-800">{studentSubmission.overallFeedback}</p>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Delivery detail" />
            <dl className="space-y-3 px-5 py-4 text-[10px]">
              <div>
                <dt className="text-gray-400">Course</dt>
                <dd className="font-semibold text-gray-800">{offering?.course.code} — {offering?.course.title}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Tutor</dt>
                <dd className="font-semibold text-gray-800">{offering?.tutor?.name}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Deadline</dt>
                <dd className="font-semibold text-gray-800">{formatDate(assessment.dueAt, true)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Published</dt>
                <dd className="font-semibold text-gray-800">{formatDate(assessment.publishedAt, true)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Maximum marks</dt>
                <dd className="font-semibold text-gray-800">{Number(assessment.maxMarks)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Passing marks</dt>
                <dd className="font-semibold text-gray-800">
                  {assessment.passingMarks != null ? Number(assessment.passingMarks) : 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Submission format</dt>
                <dd className="font-semibold text-gray-800">{assessment.submissionFormat || 'Not specified'}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Late policy</dt>
                <dd className="font-semibold text-gray-800">
                  {assessment.latePolicy === 'REJECT'
                    ? 'Reject after deadline'
                    : assessment.latePolicy === 'ACCEPT'
                      ? 'Accept without late flag'
                      : 'Accept and flag late'}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Outcome evidence" description="CLOs receive evidence from item grades through these mappings." />
            <div className="px-5 py-4">
              {(() => {
                const cloMap = new Map<string, { code: string; description: string; weight: number }>();
                for (const item of assessment.items ?? []) {
                  for (const mapping of item.cloMappings) {
                    if (!mapping.clo) continue;
                    cloMap.set(mapping.clo.id, {
                      code: mapping.clo.code,
                      description: mapping.clo.description,
                      weight: Number(mapping.weight),
                    });
                  }
                }
                if (cloMap.size === 0) return <p className="text-[10px] text-gray-400">No CLO mappings.</p>;
                return (
                  <ul className="space-y-2">
                    {[...cloMap.entries()].map(([cloId, clo]) => (
                      <li key={cloId} className="rounded-xl bg-gray-50 p-2.5">
                        <div className="flex items-center gap-1.5">
                          <Target size={12} className="text-gray-400" />
                          <p className="text-[10px] font-bold text-gray-800">{clo.code}</p>
                        </div>
                        <p className="mt-0.5 text-[9px] leading-relaxed text-gray-500">{clo.description}</p>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </Card>

          {isManager && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-[10px] text-blue-800">
              <p className="flex items-center gap-1.5 font-bold"><CheckCircle2 size={13} /> Grading rules</p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[9px]">
                <li>Marks cannot exceed an item's maximum (enforced by the API and database).</li>
                <li>Excused evidence is excluded from attainment; incomplete evidence follows the active policy.</li>
                <li>Results must be published before students can see marks or feedback.</li>
              </ul>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(grading)}
        title={`Grade ${grading?.student?.user?.name ?? 'submission'}`}
        description={grading ? `${grading.student?.rollNo} · ${grading.isLate ? 'submitted late' : 'submitted on time'}` : undefined}
        onClose={() => setGrading(null)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setGrading(null)}>Cancel</Button>
            <Button form="grade-form" type="submit" loading={saving}>Save grades</Button>
          </>
        }
      >
        <form id="grade-form" onSubmit={saveGrades} className="space-y-3">
          {grading?.content && <div className="rounded-xl bg-gray-50 p-3 text-[10px] whitespace-pre-wrap text-gray-600">{grading.content}</div>}
          {grading?.attachmentUrl && (
            <a href={grading.attachmentUrl} target="_blank" rel="noreferrer" className="inline-block text-[10px] font-semibold text-blue-600 underline">
              Open submitted attachment
            </a>
          )}
          <div className="space-y-2">
            {draft.map((entry, index) => {
              const item = assessment.items?.find((candidate) => candidate.id === entry.itemId);
              return (
                <div key={entry.itemId} className="rounded-2xl border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold text-gray-800">{item?.label}</p>
                    <Badge>{item ? Number(item.maxMarks) : 0} marks max</Badge>
                  </div>
                  {item?.rubricCriteria && item.rubricCriteria.length > 0 && entry.state === 'GRADED' ? (
                    <div className="mt-2 space-y-2">
                      {item.rubricCriteria.map((criterion) => {
                        const recorded = criterionDraft[criterion.id] ?? { marks: '', feedback: '' };
                        return (
                          <div key={criterion.id} className="grid gap-2 rounded-xl bg-gray-50 p-2 sm:grid-cols-[1fr_80px_1fr]">
                            <div>
                              <p className="text-[10px] font-semibold text-gray-700">{criterion.label}</p>
                              <p className="text-[9px] text-gray-400">Max {Number(criterion.maxMarks)} marks</p>
                            </div>
                            <Input
                              type="number"
                              min={0}
                              max={Number(criterion.maxMarks)}
                              step="0.01"
                              value={recorded.marks}
                              aria-label={`${criterion.label} marks`}
                              onChange={(event) =>
                                setCriterionDraft((current) => ({
                                  ...current,
                                  [criterion.id]: { ...recorded, marks: event.target.value },
                                }))
                              }
                            />
                            <Input
                              value={recorded.feedback}
                              aria-label={`${criterion.label} feedback`}
                              placeholder="Criterion feedback"
                              onChange={(event) =>
                                setCriterionDraft((current) => ({
                                  ...current,
                                  [criterion.id]: { ...recorded, feedback: event.target.value },
                                }))
                              }
                            />
                          </div>
                        );
                      })}
                      <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                        <Field label="Rubric total" htmlFor={`grade-total-${index}`}>
                          <Input
                            id={`grade-total-${index}`}
                            readOnly
                            value={item.rubricCriteria.reduce((sum, criterion) => sum + Number(criterionDraft[criterion.id]?.marks || 0), 0)}
                          />
                        </Field>
                        <Field label="Overall item feedback" htmlFor={`grade-feedback-${index}`}>
                          <Input
                            id={`grade-feedback-${index}`}
                            value={entry.feedback}
                            onChange={(event) =>
                              setDraft((current) => current.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, feedback: event.target.value } : candidate)))
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[100px_140px_1fr]">
                      <Field label="Marks" htmlFor={`grade-marks-${index}`}>
                        <Input
                          id={`grade-marks-${index}`}
                          type="number"
                          min={0}
                          max={item ? Number(item.maxMarks) : undefined}
                          step="0.01"
                          value={entry.state === 'GRADED' ? entry.marks : '0'}
                          disabled={entry.state !== 'GRADED'}
                          onChange={(event) =>
                            setDraft((current) => current.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, marks: event.target.value } : candidate)))
                          }
                        />
                      </Field>
                      <Field label="Item feedback" htmlFor={`grade-feedback-${index}`}>
                        <Input
                          id={`grade-feedback-${index}`}
                          value={entry.feedback}
                          onChange={(event) =>
                            setDraft((current) => current.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, feedback: event.target.value } : candidate)))
                          }
                        />
                      </Field>
                    </div>
                  )}
                  <div className="mt-2">
                    <Field label="State" htmlFor={`grade-state-${index}`}>
                      <Select
                        id={`grade-state-${index}`}
                        value={entry.state}
                        onChange={(event) =>
                          setDraft((current) =>
                            current.map((candidate, candidateIndex) =>
                              candidateIndex === index
                                ? { ...candidate, state: event.target.value as GradeState, marks: event.target.value === 'GRADED' ? candidate.marks : '0' }
                                : candidate
                            )
                          )
                        }
                      >
                        <option value="GRADED">Graded</option>
                        <option value="EXCUSED">Excused</option>
                        <option value="INCOMPLETE">Incomplete</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
          <Field label="Overall feedback" htmlFor="overall-feedback">
            <Textarea id="overall-feedback" rows={3} value={overallFeedback} onChange={(event) => setOverallFeedback(event.target.value)} />
          </Field>
          {assessment.resultsPublishedAt && (
            <Field
              label="Reason for correction"
              htmlFor="grade-reason"
              required
              hint="Results are already published. This reason is stored with the previous and new marks for audit."
            >
              <Input id="grade-reason" value={gradeReason} onChange={(event) => setGradeReason(event.target.value)} />
            </Field>
          )}
          {overallError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{overallError}</p>}
        </form>
      </Modal>

      <Modal
        open={Boolean(historySubmission)}
        title={`Grade history — ${historySubmission?.student?.user?.name ?? ''}`}
        description="Every recorded mark change, including the actor and the stated reason."
        onClose={() => setHistorySubmission(null)}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setHistorySubmission(null)}>Close</Button>}
      >
        {historyError ? (
          <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{historyError}</p>
        ) : history.length === 0 ? (
          <EmptyState title="No grade changes recorded" description="This submission has not been regraded since marks were first entered." icon={<History size={20} />} />
        ) : (
          <ol className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold text-gray-800">{entry.item?.label ?? 'Overall'}</p>
                  <span className="text-[9px] text-gray-400">{formatDate(entry.createdAt, true)}</span>
                </div>
                <p className="mt-1 text-[10px] text-gray-600">
                  {entry.previousMarks == null ? 'First entry' : Number(entry.previousMarks)} → {Number(entry.newMarks)} marks
                </p>
                <p className="text-[9px] text-gray-400">By {entry.actor?.name ?? 'system'}{entry.actor ? ` (${entry.actor.role})` : ''}</p>
                {entry.reason && <p className="mt-1 rounded-xl bg-amber-50 p-2 text-[9px] text-amber-800">{entry.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </div>
  );
}
