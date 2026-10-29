import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  FileBarChart2,
  GraduationCap,
  ListChecks,
  Target,
  Users,
} from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useAsync, formatDate, formatPct } from '../hooks/useAsync';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  ProgressBar,
  StatCard,
  StatusBadge,
} from '../components/ui';
import type {
  AttainmentStatus,
  CloAttainment,
  CourseOffering,
  ImprovementPlan,
  Notification,
  Submission,
  AuditLog,
} from '../api/types';

interface DashboardCard {
  key: string;
  label: string;
  value: number;
  detail?: string;
}

interface StatusCounts {
  met: number;
  atRisk: number;
  notMet: number;
  insufficientData: number;
  total: number;
}

interface DashboardData {
  role: string;
  cards: DashboardCard[];
  notifications: Notification[];
  cloStatuses?: StatusCounts;
  offerings?: Array<
    CourseOffering & {
      attainmentRuns?: Array<{ id: string; computedAt: string; isFrozen: boolean }>;
    }
  >;
  recentRuns?: Array<{
    id: string;
    offeringId: string;
    isFrozen: boolean;
    computedAt: string;
    course: { code: string; title: string };
    semester: { name: string };
    statuses: StatusCounts;
  }>;
  recentAudit?: AuditLog[];
  pendingGrading?: Array<Submission & { assessment: { id: string; title: string; offering: { course: { code: string } } } }>;
  upcoming?: Array<{
    id: string;
    title: string;
    dueAt?: string | null;
    type: string;
    offering: { id?: string; course: { code: string; title?: string } };
    submissions?: Array<{ id: string; status: string }>;
    _count?: { submissions: number };
  }>;
  plans?: ImprovementPlan[];
  gaps?: Array<{ cloCode: string; description: string; course: string; attainmentPct: number; targetPct: number; status: string }>;
  enrollments?: Array<{
    id: string;
    offering: CourseOffering & { attainmentRuns?: Array<{ cloResults?: CloAttainment[] }> };
  }>;
  publishedResults?: Array<{
    id: string;
    title: string;
    resultsPublishedAt: string;
    offering: { course: { code: string } };
    submissions: Array<{
      id: string;
      status: string;
      overallFeedback?: string | null;
      grades: Array<{ marks: string | number; item: { maxMarks: string | number; label: string } }>;
    }>;
  }>;
  cloScores?: Array<{
    offeringId: string;
    course: string;
    cloCode: string;
    description: string;
    cohortAttainmentPct: number;
    cohortStatus: AttainmentStatus;
  }>;
}

const statusColors: Record<string, string> = {
  met: '#10b981',
  atRisk: '#f59e0b',
  notMet: '#f43f5e',
  insufficientData: '#9ca3af',
};

function StatusChart({ counts }: { counts?: StatusCounts }) {
  if (!counts) return null;
  const data = [
    { name: 'Met', key: 'met', value: counts.met },
    { name: 'At risk', key: 'atRisk', value: counts.atRisk },
    { name: 'Not met', key: 'notMet', value: counts.notMet },
    { name: 'No data', key: 'insufficientData', value: counts.insufficientData },
  ];
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900">CLO cohort outcomes</h2>
          <p className="text-[10px] text-gray-500">Latest attainment run per offering</p>
        </div>
        <Badge tone="blue">{counts.total} CLOs</Badge>
      </div>
      {counts.total === 0 ? (
        <EmptyState title="No attainment runs yet" description="Compute attainment from an offering to populate this chart." icon={<Target size={20} />} />
      ) : (
        <div className="mt-3 grid grid-cols-[120px_1fr] items-center gap-2">
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.filter((item) => item.value > 0)} dataKey="value" nameKey="name" innerRadius={30} outerRadius={52} paddingAngle={3}>
                  {data
                    .filter((item) => item.value > 0)
                    .map((item) => (
                      <Cell key={item.key} fill={statusColors[item.key]} />
                    ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-1.5">
            {data.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5 text-gray-500">
                  <span className="h-2 w-2 rounded-full" style={{ background: statusColors[item.key] }} />
                  {item.name}
                </span>
                <span className="font-bold text-gray-800">{item.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function AdminView({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((card) => (
          <StatCard
            key={card.key}
            label={card.label}
            value={card.value}
            detail={card.detail}
            icon={
              card.key === 'students' ? <Users size={18} /> :
              card.key === 'programs' ? <GraduationCap size={18} /> :
              card.key === 'offerings' ? <ListChecks size={18} /> :
              card.key === 'attainment' ? <Target size={18} /> :
              card.key === 'plans' ? <AlertTriangle size={18} /> : <FileBarChart2 size={18} />
            }
            tone={card.key === 'plans' ? 'amber' : card.key === 'attainment' ? 'green' : 'blue'}
          />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Course offerings"
            description="Current and historical deliveries"
            action={<Link to="/offerings" className="text-[10px] font-semibold text-gray-500 hover:text-gray-900">View all</Link>}
          />
          {!data.offerings?.length ? (
            <EmptyState title="No offerings yet" description="Create a programme, course and offering to begin." icon={<ListChecks size={20} />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                    <th className="px-4 py-2.5 font-bold">Course</th>
                    <th className="px-4 py-2.5 font-bold">Session</th>
                    <th className="px-4 py-2.5 font-bold">Tutor</th>
                    <th className="px-4 py-2.5 font-bold">Students</th>
                    <th className="px-4 py-2.5 font-bold">Attainment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.offerings.slice(0, 8).map((offering) => (
                    <tr key={offering.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3">
                        <Link to={`/offerings/${offering.id}`} className="block text-[11px] font-semibold text-gray-900 hover:underline">
                          {offering.course.code} — {offering.course.title}
                        </Link>
                        <span className="text-[9px] text-gray-400">{offering.sectionName}</span>
                      </td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering.semester.name}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering.tutor.name}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-600">{offering._count?.enrollments ?? 0}</td>
                      <td className="px-4 py-3">
                        {offering.attainmentRuns?.[0] ? (
                          <Badge tone={offering.attainmentRuns[0].isFrozen ? 'green' : 'amber'}>
                            {offering.attainmentRuns[0].isFrozen ? 'Frozen' : 'Draft run'}
                          </Badge>
                        ) : (
                          <Badge>Not calculated</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <StatusChart counts={data.cloStatuses} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent attainment runs" description="Persisted calculations with provenance" />
          {!data.recentRuns?.length ? (
            <EmptyState title="Nothing calculated yet" icon={<Target size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.recentRuns.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link to={`/offerings/${run.offeringId}?tab=attainment`} className="block truncate text-[11px] font-semibold text-gray-800 hover:underline">
                      {run.course.code} — {run.course.title}
                    </Link>
                    <p className="text-[9px] text-gray-400">
                      {run.semester.name} · {formatDate(run.computedAt, true)} {run.isFrozen ? '· frozen' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge tone="green">{run.statuses.met} met</Badge>
                    {run.statuses.notMet > 0 && <Badge tone="red">{run.statuses.notMet} gap</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent audit activity" description="Administrative and academic actions" action={<Link to="/audit" className="text-[10px] font-semibold text-gray-500 hover:text-gray-900">Open log</Link>} />
          {!data.recentAudit?.length ? (
            <EmptyState title="No audit entries" icon={<FileBarChart2 size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.recentAudit.slice(0, 7).map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-800">
                      {entry.action} · {entry.entityType}
                    </p>
                    <p className="text-[9px] text-gray-400">
                      {entry.actor?.name ?? entry.actorEmail ?? 'System'} · {formatDate(entry.occurredAt, true)}
                    </p>
                  </div>
                  <Badge tone="gray">{entry.entityType}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function TutorView({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((card) => (
          <StatCard
            key={card.key}
            label={card.label}
            value={card.value}
            detail={card.detail}
            icon={
              card.key === 'offerings' ? <ListChecks size={18} /> :
              card.key === 'students' ? <Users size={18} /> :
              card.key === 'pending' ? <BookOpen size={18} /> :
              card.key === 'attainment' ? <Target size={18} /> :
              card.key === 'plans' ? <AlertTriangle size={18} /> : <FileBarChart2 size={18} />
            }
            tone={card.key === 'pending' ? 'amber' : card.key === 'attainment' ? 'green' : 'blue'}
          />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="My offerings" description="Only courses assigned to you" action={<Link to="/offerings" className="text-[10px] font-semibold text-gray-500 hover:text-gray-900">Open</Link>} />
          {!data.offerings?.length ? (
            <EmptyState title="No assignments yet" description="An administrator will assign your course offerings." icon={<BookOpen size={20} />} />
          ) : (
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              {data.offerings.map((offering) => (
                <Link
                  key={offering.id}
                  to={`/offerings/${offering.id}`}
                  className="rounded-2xl border border-gray-100 bg-gray-50/40 p-3 transition-colors hover:border-gray-200 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold text-gray-900">{offering.course.code}</p>
                      <p className="text-[10px] text-gray-600">{offering.course.title}</p>
                    </div>
                    <StatusBadge status={offering.status} />
                  </div>
                  <p className="mt-2 text-[9px] text-gray-400">
                    {offering.semester.name} · {offering.sectionName} · {offering._count?.enrollments ?? 0} students
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <StatusChart counts={data.cloStatuses} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Submissions to grade" description="Oldest first" />
          {!data.pendingGrading?.length ? (
            <EmptyState title="Nothing waiting" description="All submitted work has been graded." icon={<BookOpen size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.pendingGrading.map((submission) => (
                <li key={submission.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-800">{submission.student?.user?.name}</p>
                    <p className="text-[9px] text-gray-400">
                      {submission.assessment.title} · {submission.assessment.offering.course.code} · {formatDate(submission.submittedAt)}
                    </p>
                  </div>
                  <Link
                    to={`/assessments/${submission.assessment.id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[9px] font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Grade <ArrowUpRight size={10} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Outcome gaps" description="CLOs at risk or below target" />
          {!data.gaps?.length ? (
            <EmptyState title="No gaps recorded" description="Compute attainment or wait for the next evidence cycle." icon={<Target size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.gaps.map((gap, index) => (
                <li key={`${gap.course}-${gap.cloCode}-${index}`} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-gray-800">
                      {gap.cloCode} <span className="font-normal text-gray-400">· {gap.course}</span>
                    </p>
                    <StatusBadge status={gap.status} />
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[9px] text-gray-500">{gap.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar value={gap.attainmentPct} tone={gap.status === 'NOT_MET' ? 'red' : 'amber'} />
                    <span className="w-16 shrink-0 text-right text-[9px] font-semibold text-gray-600">
                      {formatPct(gap.attainmentPct)} / {formatPct(gap.targetPct)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming assessments" description="Published and due in the future" />
          {!data.upcoming?.length ? (
            <EmptyState title="No upcoming deadlines" icon={<CalendarClock size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.upcoming.map((assessment) => (
                <li key={assessment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <Link to={`/assessments/${assessment.id}`} className="text-[11px] font-semibold text-gray-800 hover:underline">
                      {assessment.title}
                    </Link>
                    <p className="text-[9px] text-gray-400">{assessment.offering.course.code} · due {formatDate(assessment.dueAt, true)}</p>
                  </div>
                  <Badge tone="blue">{assessment._count?.submissions ?? 0} submitted</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Improvement plans" description="Open continuous-improvement actions" action={<Link to="/offerings" className="text-[10px] font-semibold text-gray-500 hover:text-gray-900">Open</Link>} />
          {!data.plans?.length ? (
            <EmptyState title="No open plans" icon={<Target size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.plans.map((plan) => (
                <li key={plan.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-gray-800">{plan.title}</p>
                    <StatusBadge status={plan.status} />
                  </div>
                  <p className="mt-0.5 text-[9px] text-gray-400">
                    {plan.offering?.course?.code ?? ''} {plan.clo ? `· ${plan.clo.code}` : ''} {plan.dueDate ? `· due ${formatDate(plan.dueDate)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function StudentView({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((card) => (
          <StatCard
            key={card.key}
            label={card.label}
            value={card.value}
            detail={card.detail}
            icon={
              card.key === 'courses' ? <BookOpen size={18} /> :
              card.key === 'upcoming' ? <CalendarClock size={18} /> :
              card.key === 'results' ? <FileBarChart2 size={18} /> :
              card.key === 'outcomes' ? <Target size={18} /> : <GraduationCap size={18} />
            }
            tone={card.key === 'upcoming' ? 'amber' : card.key === 'outcomes' ? 'green' : 'blue'}
          />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardHeader title="My courses" description="Enrolled offerings and their delivery team" />
          {!data.enrollments?.length ? (
            <EmptyState title="No enrolments" description="Your programme administrator has not enrolled you in an offering yet." icon={<BookOpen size={20} />} />
          ) : (
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              {data.enrollments.map((enrollment) => (
                <Link
                  key={enrollment.id}
                  to={`/offerings/${enrollment.offering.id}`}
                  className="rounded-2xl border border-gray-100 bg-gray-50/40 p-3 hover:border-gray-200 hover:bg-white"
                >
                  <p className="text-[11px] font-bold text-gray-900">{enrollment.offering.course.code}</p>
                  <p className="text-[10px] text-gray-600">{enrollment.offering.course.title}</p>
                  <p className="mt-2 text-[9px] text-gray-400">
                    {enrollment.offering.semester.name} · {enrollment.offering.tutor.name}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Learning progress" description="Your CLO mastery from published evidence" action={<Link to="/reports" className="text-[10px] font-semibold text-gray-500 hover:text-gray-900">Reports</Link>} />
          {!data.cloScores?.length ? (
            <EmptyState title="No published outcome data" description="Progress appears after your tutor publishes results and attainment is calculated." icon={<Target size={20} />} />
          ) : (
            <ul className="max-h-80 divide-y divide-gray-50 overflow-y-auto">
              {data.cloScores.map((clo, index) => (
                <li key={`${clo.offeringId}-${clo.cloCode}-${index}`} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-gray-800">
                      {clo.cloCode} <span className="font-normal text-gray-400">· {clo.course}</span>
                    </p>
                    <StatusBadge status={clo.cohortStatus} />
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[9px] text-gray-500">{clo.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar value={clo.cohortAttainmentPct} tone={clo.cohortStatus === 'MET' ? 'green' : clo.cohortStatus === 'AT_RISK' ? 'amber' : 'red'} />
                    <span className="w-12 text-right text-[9px] font-semibold text-gray-600">{formatPct(clo.cohortAttainmentPct)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Open assessments" description="Published work available to you" />
          {!data.upcoming?.length ? (
            <EmptyState title="Nothing due" description="No published assessment is currently open." icon={<CalendarClock size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.upcoming.map((assessment) => (
                <li key={assessment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <Link to={`/assessments/${assessment.id}`} className="text-[11px] font-semibold text-gray-800 hover:underline">
                      {assessment.title}
                    </Link>
                    <p className="text-[9px] text-gray-400">
                      {assessment.offering.course.code} · due {formatDate(assessment.dueAt, true)}
                    </p>
                  </div>
                  {assessment.submissions?.length ? <Badge tone="green">Submitted</Badge> : <Badge tone="amber">Not submitted</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Published results" description="Grades and tutor feedback" />
          {!data.publishedResults?.length ? (
            <EmptyState title="No published results" description="Results appear here once your tutor publishes them." icon={<FileBarChart2 size={20} />} />
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.publishedResults.map((assessment) => {
                const submission = assessment.submissions[0];
                const total = submission?.grades.reduce((sum, grade) => sum + Number(grade.marks), 0) ?? 0;
                const max = submission?.grades.reduce((sum, grade) => sum + Number(grade.item.maxMarks), 0) ?? 0;
                return (
                  <li key={assessment.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link to={`/assessments/${assessment.id}`} className="text-[11px] font-semibold text-gray-800 hover:underline">
                          {assessment.title}
                        </Link>
                        <p className="text-[9px] text-gray-400">{assessment.offering.course.code}</p>
                      </div>
                      <span className="text-xs font-bold text-gray-900">{max ? `${total}/${max}` : '—'}</span>
                    </div>
                    {submission?.overallFeedback && <p className="mt-1 line-clamp-2 text-[9px] italic text-gray-500">“{submission.overallFeedback}”</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.dashboard(), []);
  const dashboard = data?.data as DashboardData | undefined;

  return (
    <div>
      <PageHeader
        eyebrow={`${user?.role === 'ADMIN' ? 'Institutional' : user?.role === 'TUTOR' ? 'Teaching' : 'Learning'} overview`}
        title={`Welcome, ${user?.name?.split(' ').slice(0, 2).join(' ') ?? ''}`}
        description="Every figure below is calculated from records stored in the OBE database. Empty states mean evidence has not been recorded yet."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[10px] font-medium text-gray-500">
            <CalendarClock size={13} />
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        }
      />
      {loading ? (
        <Loading label="Loading dashboard…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !dashboard ? (
        <EmptyState title="No dashboard data available" />
      ) : dashboard.role === 'ADMIN' ? (
        <AdminView data={dashboard} />
      ) : dashboard.role === 'TUTOR' ? (
        <TutorView data={dashboard} />
      ) : (
        <StudentView data={dashboard} />
      )}
    </div>
  );
}
