import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Lock,
  Play,
  Plus,
  Settings2,
  Target,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { AttainmentRun, Enrollment, ImprovementPlan, User } from '../api/types';
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
  InlineSelect,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
  useConfirm,
} from '../components/ui';
import { AttainmentPanel } from '../components/offering/AttainmentPanel';
import { AssessmentFormModal } from '../components/offering/AssessmentFormModal';
import { EnrollmentModal } from '../components/offering/EnrollmentModal';
import { PlansPanel } from '../components/offering/PlansPanel';
import { MaterialsPanel } from '../components/offering/MaterialsPanel';

type TabId = 'overview' | 'outcomes' | 'materials' | 'assessments' | 'attainment' | 'plans';

export default function OfferingDetail() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<TabId>((searchParams.get('tab') as TabId) || 'overview');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [settings, setSettings] = useState<{ status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'; sectionName: string; reportingPeriod: string }>({ status: 'ACTIVE', sectionName: '', reportingPeriod: '' });
  const [tutors, setTutors] = useState<User[]>([]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const offeringQuery = useAsync(() => api.offering(id), [id]);
  const attainmentQuery = useAsync(() => api.attainmentLatest(id), [id]);
  const runsQuery = useAsync(() => api.attainmentRuns(id), [id]);
  const isManager = user?.role === 'ADMIN' || user?.role === 'TUTOR';
  const plansQuery = useAsync(
    () => (isManager ? api.plans(id) : Promise.resolve({ data: [] as ImprovementPlan[] })),
    [id, isManager]
  );

  const offering = offeringQuery.data?.data;
  const latestRun = (attainmentQuery.data?.data ?? null) as AttainmentRun | null;
  const runs = (runsQuery.data?.data ?? []) as AttainmentRun[];
  const plans = plansQuery.data?.data ?? [];

  useEffect(() => {
    const next = (searchParams.get('tab') as TabId) || 'overview';
    setTab(next);
  }, [searchParams]);

  const changeTab = (value: TabId) => {
    setTab(value);
    setSearchParams(value === 'overview' ? {} : { tab: value }, { replace: true });
  };

  const reload = async () => {
    await Promise.all([offeringQuery.reload(), attainmentQuery.reload(), runsQuery.reload(), isManager ? plansQuery.reload() : Promise.resolve()]);
  };

  const openSettings = async () => {
    if (!offeringQuery.data?.data) return;
    const current = offeringQuery.data.data;
    setSettings({
      status: current.status,
      sectionName: current.sectionName,
      reportingPeriod: current.reportingPeriod ?? '',
    });
    setFormError('');
    setSettingsOpen(true);
    if (user?.role === 'ADMIN' && tutors.length === 0) {
      try {
        const response = await api.users({ role: 'TUTOR', limit: 100 });
        setTutors(response.data);
      } catch {
        // The settings form still works without changing the tutor.
      }
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setFormError('');
    try {
      await api.updateOffering(id, {
        status: settings.status,
        sectionName: settings.sectionName,
        reportingPeriod: settings.reportingPeriod || null,
      });
      toast('Offering updated.');
      setSettingsOpen(false);
      await reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to update the offering.');
    } finally {
      setSaving(false);
    }
  };

  const compute = async () => {
    setSaving(true);
    try {
      await api.computeAttainment(id, {});
      toast('Attainment calculated and stored as a new run.');
      await reload();
      changeTab('attainment');
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to calculate attainment.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const freeze = async () => {
    if (!latestRun) return;
    const confirmed = await confirm({
      title: 'Freeze attainment run',
      message: 'Freezing preserves this result as historic accreditation evidence. Later evidence produces a new run.',
      confirmLabel: 'Freeze run',
    });
    if (!confirmed) return;
    try {
      await api.freezeRun(latestRun.id);
      toast('Attainment run frozen.');
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to freeze the run.', 'error');
    }
  };

  const publish = async (assessmentId: string) => {
    try {
      await api.publishAssessment(assessmentId);
      toast('Assessment published and students notified.');
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to publish the assessment.', 'error');
    }
  };

  const publishResults = async (assessmentId: string) => {
    try {
      await api.publishResults(assessmentId);
      toast('Results published.');
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to publish results.', 'error');
    }
  };

  const updateEnrollment = async (enrollment: Enrollment, status: string) => {
    try {
      await api.updateEnrollment(enrollment.id, status);
      toast('Enrolment status updated.');
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to update the enrolment.', 'error');
    }
  };

  if (offeringQuery.loading) return <Loading label="Loading offering…" />;
  if (offeringQuery.error) return <ErrorState message={offeringQuery.error} onRetry={offeringQuery.reload} />;
  if (!offering) return <ErrorState message="Course offering not found." />;

  const clos = (offering.course.clos ?? []).filter((clo) => isManager || clo.approvalStatus === 'APPROVED');
  const approvedClos = clos.filter((clo) => clo.approvalStatus === 'APPROVED');
  const enrollments = offering.enrollments ?? [];
  const assessments = offering.assessments ?? [];
  const activeEnrollments = enrollments.filter((enrollment) => enrollment.status === 'ENROLLED');

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'outcomes', label: 'CLOs', count: clos.length },
    { id: 'materials', label: 'Materials' },
    { id: 'assessments', label: 'Assessments', count: assessments.length },
    { id: 'attainment', label: 'Attainment' },
    ...(isManager ? [{ id: 'plans' as TabId, label: 'Improvement plans', count: plans.length }] : []),
  ];

  return (
    <div>
      <Link to="/offerings" className="mb-3 inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-900">
        <ArrowLeft size={12} /> Back to offerings
      </Link>
      <PageHeader
        eyebrow={`${offering.course.program?.code ?? ''} · ${offering.semester.name} · ${offering.sectionName}`}
        title={`${offering.course.code} — ${offering.course.title}`}
        description={`Tutor: ${offering.tutor.name}. ${isManager ? 'Manage assessments, grading and attainment for this offering.' : 'Published outcomes, assessments and your feedback.'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={offering.status} />
            {isManager && (
              <>
                <Button variant="secondary" size="sm" onClick={() => void openSettings()}>
                  <Settings2 size={13} /> Manage
                </Button>
                <Button size="sm" onClick={() => void compute()} loading={saving}>
                  <Play size={13} /> Calculate attainment
                </Button>
              </>
            )}
            {user?.role === 'ADMIN' && (
              <Button variant="secondary" size="sm" onClick={() => setEnrollOpen(true)}>
                <UserPlus size={13} /> Enrol students
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 overflow-x-auto">
        <Tabs tabs={tabs} value={tab} onChange={changeTab} />
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Offering detail" description="This delivery is separate from the course definition, so historical evidence is preserved." />
            <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">Course</dt>
                <dd className="mt-1 text-[11px] font-semibold text-gray-800">{offering.course.code} — {offering.course.title}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">Programme</dt>
                <dd className="mt-1 text-[11px] font-semibold text-gray-800">{offering.course.program?.name}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">Tutor</dt>
                <dd className="mt-1 text-[11px] font-semibold text-gray-800">{offering.tutor.name}</dd>
                <dd className="text-[9px] text-gray-400">{offering.tutor.email}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">Session</dt>
                <dd className="mt-1 text-[11px] font-semibold text-gray-800">{offering.semester.name}</dd>
                <dd className="text-[9px] text-gray-400">{formatDate(offering.semester.startDate)} – {formatDate(offering.semester.endDate)}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">Section</dt>
                <dd className="mt-1 text-[11px] font-semibold text-gray-800">{offering.sectionName}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">Reporting period</dt>
                <dd className="mt-1 text-[11px] font-semibold text-gray-800">{offering.reportingPeriod || offering.semester.name}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="At a glance" />
            <div className="grid grid-cols-2 gap-2 p-4">
              <div className="rounded-2xl bg-gray-50 p-3">
                <Users size={15} className="text-gray-400" />
                <p className="mt-2 text-xl font-bold text-gray-900">{activeEnrollments.length}</p>
                <p className="text-[9px] text-gray-500">Enrolled students</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <BookOpen size={15} className="text-gray-400" />
                <p className="mt-2 text-xl font-bold text-gray-900">{assessments.length}</p>
                <p className="text-[9px] text-gray-500">Assessments</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <Target size={15} className="text-gray-400" />
                <p className="mt-2 text-xl font-bold text-gray-900">{latestRun ? formatPct(latestRun.cloResults.filter((result) => result.status === 'MET').length / Math.max(1, latestRun.cloResults.length) * 100) : '—'}</p>
                <p className="text-[9px] text-gray-500">CLOs met</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <Lock size={15} className="text-gray-400" />
                <p className="mt-2 text-[11px] font-bold text-gray-900">{latestRun ? (latestRun.isFrozen ? 'Frozen' : 'Draft') : 'Not run'}</p>
                <p className="text-[9px] text-gray-500">Latest attainment</p>
              </div>
            </div>
          </Card>

          {isManager && (
            <Card className="lg:col-span-2">
              <CardHeader
                title="Enrolled students"
                description="Enrolment changes are audited and notify the affected student."
                action={user?.role === 'ADMIN' ? <Button size="sm" variant="secondary" onClick={() => setEnrollOpen(true)}><UserPlus size={12} /> Enrol</Button> : undefined}
              />
              {enrollments.length === 0 ? (
                <EmptyState title="No students enrolled" description="Enrol students before they can submit assessments." icon={<Users size={20} />} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                        <th className="px-4 py-2.5 font-bold">Roll number</th>
                        <th className="px-4 py-2.5 font-bold">Student</th>
                        <th className="px-4 py-2.5 font-bold">Programme</th>
                        <th className="px-4 py-2.5 font-bold">Enrolled</th>
                        <th className="px-4 py-2.5 font-bold">Status</th>
                        <th className="px-4 py-2.5 text-right font-bold">Change</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {enrollments.map((enrollment) => (
                        <tr key={enrollment.id} className="hover:bg-gray-50/60">
                          <td className="px-4 py-2.5 font-mono text-[10px] text-gray-600">{enrollment.student?.rollNo}</td>
                          <td className="px-4 py-2.5">
                            <p className="text-[10px] font-semibold text-gray-800">{enrollment.student?.user?.name}</p>
                            <p className="text-[9px] text-gray-400">{enrollment.student?.user?.email}</p>
                          </td>
                          <td className="px-4 py-2.5 text-[10px] text-gray-600">{enrollment.student?.program?.code}</td>
                          <td className="px-4 py-2.5 text-[10px] text-gray-600">{formatDate(enrollment.enrolledAt)}</td>
                          <td className="px-4 py-2.5"><StatusBadge status={enrollment.status} /></td>
                          <td className="px-4 py-2.5 text-right">
                            {user?.role === 'ADMIN' ? (
                              <InlineSelect
                                value={enrollment.status}
                                onChange={(event) => void updateEnrollment(enrollment, event.target.value)}
                                aria-label={`Enrolment status for ${enrollment.student?.rollNo}`}
                              >
                                <option value="ENROLLED">Enrolled</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="DROPPED">Dropped</option>
                                <option value="WITHDRAWN">Withdrawn</option>
                              </InlineSelect>
                            ) : (
                              <span className="text-[9px] text-gray-400">Admin only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === 'outcomes' && (
        <Card>
          <CardHeader
            title="Course learning outcomes"
            description={isManager ? 'CLO definitions are shared by every offering of this course.' : 'Approved learning outcomes published for this course.'}
            action={<Link to={`/courses/${offering.course.id}`}><Button size="sm" variant="secondary">Open CLO workspace</Button></Link>}
          />
          {clos.length === 0 ? (
            <EmptyState title="No approved CLOs" description="Author and approve CLOs before mapping assessments." icon={<Target size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {clos.map((clo) => (
                <li key={clo.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] font-bold text-gray-900">{clo.code}</span>
                        <StatusBadge status={clo.approvalStatus} />
                        <Badge tone="purple">{clo.bloomLevel}</Badge>
                        <Badge tone="blue">Mastery {formatPct(clo.masteryThreshold)}</Badge>
                      </div>
                      <p className="mt-1 max-w-3xl text-[11px] text-gray-600">{clo.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {clo.ploMappings.map((mapping) => (
                          <Badge key={mapping.ploId} tone="green">{mapping.plo?.code} · w{mapping.weight}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'materials' && (
        <MaterialsPanel offeringId={id} canManage={isManager} />
      )}

      {tab === 'assessments' && (
        <Card>
          <CardHeader
            title="Assessments"
            description={isManager ? 'Draft assessments are private. Publishing notifies enrolled students.' : 'Only published assessments are visible to you.'}
            action={isManager ? <Button size="sm" onClick={() => setAssessmentOpen(true)} disabled={approvedClos.length === 0}><Plus size={12} /> New assessment</Button> : undefined}
          />
          {assessments.length === 0 ? (
            <EmptyState
              title="No assessments"
              description={isManager ? 'Create an assessment, map every item to approved CLOs, then publish it.' : 'Your tutor has not published an assessment yet.'}
              icon={<BookOpen size={20} />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                    <th className="px-4 py-2.5 font-bold">Assessment</th>
                    <th className="px-4 py-2.5 font-bold">Type</th>
                    <th className="px-4 py-2.5 font-bold">Deadline</th>
                    <th className="px-4 py-2.5 font-bold">Marks</th>
                    <th className="px-4 py-2.5 font-bold">Items</th>
                    <th className="px-4 py-2.5 font-bold">Submissions</th>
                    <th className="px-4 py-2.5 font-bold">Status</th>
                    <th className="px-4 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {assessments.map((assessment) => (
                    <tr key={assessment.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3">
                        <Link to={`/assessments/${assessment.id}`} className="text-[11px] font-semibold text-gray-900 hover:underline">
                          {assessment.title}
                        </Link>
                        {assessment.resultsPublishedAt && <p className="text-[9px] text-emerald-600">Results published</p>}
                      </td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{assessment.type.replaceAll('_', ' ')}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{formatDate(assessment.dueAt, true)}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{Number(assessment.maxMarks)}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{assessment._count?.items ?? 0}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{assessment._count?.submissions ?? 0}</td>
                      <td className="px-4 py-3"><StatusBadge status={assessment.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Link to={`/assessments/${assessment.id}`}>
                            <Button variant="secondary" size="sm">Open</Button>
                          </Link>
                          {isManager && assessment.status === 'DRAFT' && (
                            <Button size="sm" onClick={() => void publish(assessment.id)}>Publish</Button>
                          )}
                          {isManager && assessment.status === 'PUBLISHED' && (assessment._count?.submissions ?? 0) > 0 && !assessment.resultsPublishedAt && (
                            <Button size="sm" variant="success" onClick={() => void publishResults(assessment.id)}>Publish results</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'attainment' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-gray-500">
              Latest run: {latestRun ? `${formatDate(latestRun.computedAt, true)} · policy ${latestRun.policyVersion}` : 'not calculated'}
            </p>
            <div className="flex gap-2">
              {latestRun && !latestRun.isFrozen && isManager && (
                <Button variant="secondary" size="sm" onClick={() => void freeze()}><Lock size={12} /> Freeze run</Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setRunsOpen(true)}>Run history</Button>
            </div>
          </div>
          <AttainmentPanel run={latestRun} onOpenRun={() => setRunsOpen(true)} />
        </div>
      )}

      {tab === 'plans' && isManager && (
        <PlansPanel offeringId={id} plans={plans} clos={approvedClos} onChanged={() => void reload()} onError={(message) => toast(message, 'error')} />
      )}

      <EnrollmentModal
        open={enrollOpen}
        offeringId={id}
        existing={enrollments}
        onClose={() => setEnrollOpen(false)}
        onChanged={() => void reload()}
        onError={(message) => toast(message, 'error')}
      />

      <AssessmentFormModal
        open={assessmentOpen}
        offeringId={id}
        clos={approvedClos}
        onClose={() => setAssessmentOpen(false)}
        onCreated={() => void reload()}
        onError={(message) => toast(message, 'error')}
      />

      <Modal
        open={settingsOpen}
        title="Manage offering"
        description="Status changes affect whether new submissions and enrolments are accepted."
        onClose={() => setSettingsOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={() => void saveSettings()} loading={saving}>Save changes</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Section name" htmlFor="manage-section" required>
            <Input id="manage-section" value={settings.sectionName} onChange={(event) => setSettings({ ...settings, sectionName: event.target.value })} />
          </Field>
          <Field label="Status" htmlFor="manage-status">
            <Select id="manage-status" value={settings.status} onChange={(event) => setSettings({ ...settings, status: event.target.value as typeof settings.status })}>
              <option value="PLANNED">Planned</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
          <Field label="Reporting period" htmlFor="manage-period">
            <Input id="manage-period" value={settings.reportingPeriod} onChange={(event) => setSettings({ ...settings, reportingPeriod: event.target.value })} />
          </Field>
          {user?.role === 'ADMIN' && tutors.length > 0 && (
            <p className="rounded-xl bg-gray-50 p-2.5 text-[9px] text-gray-500">
              Tutor reassignment is audited. Use the offering list and administrator account for institutional controls; this build keeps
              the assigned tutor stable once evidence exists.
            </p>
          )}
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </div>
      </Modal>

      <Modal open={runsOpen} title="Attainment run history" description="Runs are immutable snapshots. Freezing marks the accreditation evidence version." onClose={() => setRunsOpen(false)} size="lg">
        {runs.length === 0 ? (
          <EmptyState title="No runs recorded" icon={<Target size={20} />} />
        ) : (
          <ul className="divide-y divide-gray-50">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-[11px] font-semibold text-gray-800">
                    {formatDate(run.computedAt, true)} · {run.reportingPeriod ?? '—'}
                  </p>
                  <p className="text-[9px] text-gray-400">
                    Engine {run.engineVersion} · policy {run.policyVersion} · {run.computedBy?.name ?? 'System'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge tone={run.isFrozen ? 'green' : 'amber'}>{run.isFrozen ? 'Frozen' : 'Draft'}</Badge>
                  <Badge>{run._count?.cloResults ?? 0} CLOs</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
