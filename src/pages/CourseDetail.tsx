import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Check, ClipboardCheck, Pencil, Plus, RotateCcw, Target, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync, formatDate, formatPct } from '../hooks/useAsync';
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
  Textarea,
  useConfirm,
} from '../components/ui';
import type { Clo } from '../api/types';

const BLOOM_LEVELS = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE'];
const emptyForm = { code: '', description: '', bloomLevel: 'UNDERSTAND', masteryThreshold: 50 };
type MappingState = Record<string, number>;

export default function CourseDetail() {
  const { id = '' } = useParams();
  const { user, permissions } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const courseQuery = useAsync(() => api.course(id), [id]);
  const plosQuery = useAsync(async () => {
    const response = await api.plos();
    return response;
  }, []);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Clo | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [mappings, setMappings] = useState<MappingState>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState<Clo | null>(null);
  const [rejectionNote, setRejectionNote] = useState('');
  const [criteriaFor, setCriteriaFor] = useState<Clo | null>(null);
  const [criteriaReadOnly, setCriteriaReadOnly] = useState(false);
  const [criteria, setCriteria] = useState<Array<{ id?: string; statement: string; weight: number }>>([]);
  const [criteriaHistory, setCriteriaHistory] = useState<Array<{ id?: string; statement: string; weight: number; createdAt?: string; supersededAt?: string | null }>>([]);
  const [criteriaError, setCriteriaError] = useState('');
  const [criteriaSaving, setCriteriaSaving] = useState(false);

  const course = courseQuery.data?.data;
  const clos = course?.clos ?? [];
  const programPlos = (plosQuery.data?.data ?? []).filter((plo) => plo.programId === course?.programId && plo.isActive);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, code: `CLO-${clos.length + 1}` });
    setMappings({});
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (clo: Clo) => {
    setEditing(clo);
    setForm({
      code: clo.code,
      description: clo.description,
      bloomLevel: clo.bloomLevel,
      masteryThreshold: Number(clo.masteryThreshold),
    });
    setMappings(Object.fromEntries(clo.ploMappings.map((mapping) => [mapping.ploId, mapping.weight])));
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.description.trim() || !form.code.trim()) {
      setFormError('CLO code and a measurable description are required.');
      return;
    }
    setSaving(true);
    try {
      const ploMappings = Object.entries(mappings).map(([ploId, weight]) => ({ ploId, weight }));
      if (editing) {
        await api.updateClo(editing.id, {
          description: form.description.trim(),
          bloomLevel: form.bloomLevel,
          masteryThreshold: Number(form.masteryThreshold),
          ploMappings,
        });
        toast('CLO updated.');
      } else {
        await api.createClo({
          courseId: id,
          code: form.code.trim().toUpperCase(),
          description: form.description.trim(),
          bloomLevel: form.bloomLevel,
          masteryThreshold: Number(form.masteryThreshold),
          ploMappings,
        });
        toast(user?.role === 'ADMIN' ? 'CLO created and approved.' : 'CLO submitted for administrator approval.');
      }
      setModalOpen(false);
      await courseQuery.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to save the CLO.');
    } finally {
      setSaving(false);
    }
  };

  const approve = async (clo: Clo) => {
    try {
      await api.approveClo(clo.id);
      toast(`${clo.code} approved.`);
      await courseQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to approve the CLO.', 'error');
    }
  };

  const reject = async (event: FormEvent) => {
    event.preventDefault();
    if (!rejecting) return;
    setSaving(true);
    try {
      await api.rejectClo(rejecting.id, rejectionNote.trim());
      toast(`${rejecting.code} returned for revision.`);
      setRejecting(null);
      setRejectionNote('');
      await courseQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to reject the CLO.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeClo = async (clo: Clo) => {
    const confirmed = await confirm({
      title: 'Delete CLO',
      message: `Delete ${clo.code}? This is refused when the CLO has assessment evidence or attainment history.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deleteClo(clo.id);
      toast('CLO deleted.');
      await courseQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to delete the CLO.', 'error');
    }
  };

  const openCriteria = async (clo: Clo) => {
    setCriteriaFor(clo);
    setCriteriaReadOnly(user?.role === 'TUTOR' && clo.approvalStatus === 'APPROVED');
    setCriteriaHistory([]);
    setCriteriaError('');
    try {
      const response = await api.cloMeasurementCriteria(clo.id, true);
      const active = response.data.filter((entry) => !entry.supersededAt);
      setCriteria(
        active.map((entry) => ({
          id: entry.id,
          statement: entry.statement,
          weight: entry.weight ?? 1,
        }))
      );
      setCriteriaHistory(
        response.data.map((entry) => ({
          id: entry.id,
          statement: entry.statement,
          weight: entry.weight ?? 1,
          createdAt: entry.createdAt,
          supersededAt: entry.supersededAt,
        }))
      );
    } catch (caught) {
      setCriteriaError(caught instanceof ApiError ? caught.message : 'Unable to load measurement criteria.');
      setCriteria([]);
      setCriteriaHistory([]);
    }
  };

  const saveCriteria = async (event: FormEvent) => {
    event.preventDefault();
    if (!criteriaFor || criteriaReadOnly) return;
    setCriteriaError('');
    const cleaned = criteria.filter((entry) => entry.statement.trim().length >= 5);
    if (cleaned.length !== criteria.length) {
      setCriteriaError('Every measurement criterion needs a statement of at least 5 characters.');
      return;
    }
    setCriteriaSaving(true);
    try {
      await api.saveCloMeasurementCriteria(
        criteriaFor.id,
        cleaned.map((entry) => ({ id: entry.id, statement: entry.statement.trim(), weight: entry.weight }))
      );
      toast(`Measurement criteria for ${criteriaFor.code} saved.`);
      setCriteriaFor(null);
      await courseQuery.reload();
    } catch (caught) {
      setCriteriaError(caught instanceof ApiError ? caught.message : 'Unable to save measurement criteria.');
    } finally {
      setCriteriaSaving(false);
    }
  };

  const toggleArchive = async (clo: Clo) => {
    if (!clo.archivedAt) {
      const confirmed = await confirm({
        title: 'Archive CLO',
        message: `Archive ${clo.code}? It will be hidden from active outcome and assessment lists. CLOs with evidence or attainment history cannot be archived.`,
        confirmLabel: 'Archive',
      });
      if (!confirmed) return;
    }
    try {
      if (clo.archivedAt) {
        await api.unarchiveClo(clo.id);
        toast(`${clo.code} restored.`);
      } else {
        await api.archiveClo(clo.id);
        toast(`${clo.code} archived.`);
      }
      await courseQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to update the CLO archive state.', 'error');
    }
  };

  if (courseQuery.loading) return <Loading />;
  if (courseQuery.error) return <ErrorState message={courseQuery.error} onRetry={courseQuery.reload} />;
  if (!course) return <ErrorState message="Course not found." />;

  const canAuthor = permissions?.authorClos && (user?.role === 'ADMIN' || clos.length === 0 || user?.role === 'TUTOR');

  return (
    <div>
      <Link to="/courses" className="mb-3 inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-900">
        <ArrowLeft size={12} /> Back to courses
      </Link>
      <PageHeader
        eyebrow={course.program ? `${course.program.code} · ${course.program.name}` : undefined}
        title={`${course.code} — ${course.title}`}
        description={course.description ?? 'Course definition and its measurable learning outcomes.'}
        actions={
          canAuthor ? (
            <Button onClick={openCreate}><Plus size={14} /> New CLO</Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Credit hours</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{course.creditHours}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Approved CLOs</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{clos.filter((clo) => clo.approvalStatus === 'APPROVED' && !clo.archivedAt).length} / {clos.filter((clo) => !clo.archivedAt).length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Offerings</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{course.offerings?.length ?? 0}</p>
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader title="Course learning outcomes" description="CLOs are course-level. Every offering of this course shares the approved outcomes." />
        {clos.length === 0 ? (
          <EmptyState title="No CLOs defined" description="Define measurable outcomes before creating assessments. CLOs authored by tutors require administrator approval." action={<Button onClick={openCreate}>Create CLO</Button>} icon={<Target size={20} />} />
        ) : (
          <div className="divide-y divide-gray-50">
            {clos.map((clo) => (
              <div key={clo.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-[11px] font-bold text-gray-900">{clo.code}</p>
                      <StatusBadge status={clo.approvalStatus} />
                      {clo.archivedAt && <StatusBadge status="ARCHIVED" />}
                      <Badge tone="purple">{clo.bloomLevel}</Badge>
                      <Badge tone="blue">Mastery {formatPct(clo.masteryThreshold)}</Badge>
                      {(clo._count?.itemMappings ?? 0) > 0 && <Badge>{clo._count?.itemMappings} evidence items</Badge>}
                    </div>
                    <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-gray-600">{clo.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {clo.ploMappings.length === 0 ? (
                        <span className="text-[9px] text-gray-400">Not mapped to a PLO</span>
                      ) : (
                        clo.ploMappings.map((mapping) => (
                          <Badge key={mapping.ploId} tone="green">
                            {mapping.plo?.code} · weight {mapping.weight}
                          </Badge>
                        ))
                      )}
                    </div>
                    {clo.rejectionNote && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-[9px] text-rose-700">Returned: {clo.rejectionNote}</p>}
                    {(clo.measurementCriteria?.length ?? 0) > 0 && (
                      <div className="mt-2 rounded-xl bg-emerald-50/60 p-2">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                          Measurement criteria ({clo.measurementCriteria!.length})
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {clo.measurementCriteria!.map((criterion, index) => (
                            <li key={criterion.id ?? index} className="text-[10px] text-gray-700">
                              <span className="font-semibold">{criterion.statement}</span>
                              {criterion.weight && criterion.weight !== 1 && (
                                <span className="ml-1 text-[9px] text-gray-400">weight {criterion.weight}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {user?.role === 'ADMIN' && clo.approvalStatus !== 'APPROVED' && (
                      <Button variant="success" size="sm" onClick={() => void approve(clo)}><Check size={12} /> Approve</Button>
                    )}
                    {user?.role === 'ADMIN' && clo.approvalStatus === 'PENDING' && (
                      <Button variant="secondary" size="sm" onClick={() => { setRejecting(clo); setRejectionNote(''); }}><X size={12} /> Reject</Button>
                    )}
                    {!clo.archivedAt && (user?.role === 'ADMIN' || (user?.role === 'TUTOR' && clo.approvalStatus !== 'APPROVED')) && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(clo)} aria-label={`Edit ${clo.code}`}><Pencil size={12} /></Button>
                    )}
                    {!clo.archivedAt && (user?.role === 'ADMIN' || user?.role === 'TUTOR') && (
                      <Button variant="ghost" size="sm" onClick={() => void openCriteria(clo)} aria-label={`Measurement criteria for ${clo.code}`}>
                        <ClipboardCheck size={12} />
                      </Button>
                    )}
                    {(user?.role === 'ADMIN' || user?.role === 'TUTOR') && (
                      <Button variant="ghost" size="sm" onClick={() => void toggleArchive(clo)} aria-label={`${clo.archivedAt ? 'Restore' : 'Archive'} ${clo.code}`}>
                        {clo.archivedAt ? <RotateCcw size={12} /> : <Archive size={12} />}
                      </Button>
                    )}
                    {user?.role === 'ADMIN' && !clo.archivedAt && (
                      <Button variant="ghost" size="sm" onClick={() => void removeClo(clo)} aria-label={`Delete ${clo.code}`}><Trash2 size={12} /></Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Delivered offerings" description="Where this course has been taught" />
        {!course.offerings?.length ? (
          <EmptyState title="This course has not been offered yet" />
        ) : (
          <ul className="divide-y divide-gray-50">
            {course.offerings.map((offering) => (
              <li key={offering.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <Link to={`/offerings/${offering.id}`} className="text-[11px] font-semibold text-gray-800 hover:underline">
                    {offering.sectionName} · {offering.semester.name}
                  </Link>
                  <p className="text-[9px] text-gray-400">{offering.tutor.name}</p>
                </div>
                <StatusBadge status={offering.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? `Edit ${editing.code}` : 'Create course learning outcome'}
        description="Write a measurable outcome and state how it contributes to the programme's PLOs."
        onClose={() => setModalOpen(false)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="clo-form" type="submit" loading={saving}>{editing ? 'Save changes' : 'Create CLO'}</Button>
          </>
        }
      >
        <form id="clo-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-[120px_1fr_150px]">
            <Field label="Code" htmlFor="clo-code" required>
              <Input id="clo-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} disabled={Boolean(editing)} required />
            </Field>
            <Field label="Bloom level" htmlFor="clo-bloom" required>
              <Select id="clo-bloom" value={form.bloomLevel} onChange={(event) => setForm({ ...form, bloomLevel: event.target.value })}>
                {BLOOM_LEVELS.map((level) => <option key={level} value={level}>{level.charAt(0) + level.slice(1).toLowerCase()}</option>)}
              </Select>
            </Field>
            <Field label="Mastery %" htmlFor="clo-threshold" hint="Student threshold" required>
              <Input id="clo-threshold" type="number" min={0} max={100} step="0.1" value={form.masteryThreshold} onChange={(event) => setForm({ ...form, masteryThreshold: Number(event.target.value) })} required />
            </Field>
          </div>
          <Field label="Measurable outcome" htmlFor="clo-description" hint="Start with an observable action: analyse, evaluate, design, apply…" required>
            <Textarea id="clo-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} required />
          </Field>

          <fieldset className="rounded-2xl border border-gray-200 p-3">
            <legend className="px-1 text-[11px] font-semibold text-gray-700">PLO contribution</legend>
            {programPlos.length === 0 ? (
              <p className="p-2 text-[10px] text-gray-400">No active PLOs are defined for this programme. An administrator can add them in the PLO framework.</p>
            ) : (
              <div className="space-y-1.5">
                {programPlos.map((plo) => {
                  const selected = plo.id in mappings;
                  return (
                    <div key={plo.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50/60 px-2.5 py-2">
                      <input
                        id={`plo-${plo.id}`}
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setMappings((current) => {
                            const next = { ...current };
                            if (event.target.checked) next[plo.id] = 3;
                            else delete next[plo.id];
                            return next;
                          })
                        }
                        className="h-3.5 w-3.5 rounded border-gray-300"
                      />
                      <label htmlFor={`plo-${plo.id}`} className="flex-1 text-[10px] font-medium text-gray-700">
                        <span className="font-bold">{plo.code}</span> — {plo.description}
                      </label>
                      {selected && (
                        <InlineSelect
                          value={mappings[plo.id]}
                          onChange={(event) => setMappings((current) => ({ ...current, [plo.id]: Number(event.target.value) }))}
                          aria-label={`${plo.code} mapping weight`}
                        >
                          <option value={1}>Slight (1)</option>
                          <option value={2}>Moderate (2)</option>
                          <option value={3}>Substantial (3)</option>
                        </InlineSelect>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </fieldset>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={Boolean(criteriaFor)}
        title={`Measurement criteria — ${criteriaFor?.code ?? ''}`}
        description={criteriaReadOnly
          ? 'These criteria are part of an approved CLO. You can view the preserved evidence definition; only an administrator may create a new version.'
          : 'Observable statements describing how achievement of this CLO is judged. Changes create a new preserved version and the audit log records the transition.'}
        onClose={() => { setCriteriaFor(null); setCriteriaReadOnly(false); }}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setCriteriaFor(null); setCriteriaReadOnly(false); }}>{criteriaReadOnly ? 'Close' : 'Cancel'}</Button>
            {!criteriaReadOnly && <Button form="criteria-form" type="submit" loading={criteriaSaving}>Save criteria</Button>}
          </>
        }
      >
        <form id="criteria-form" onSubmit={saveCriteria} className="space-y-3" noValidate>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-gray-600">
              {criteria.length} criteria · relative weight 1–5 per criterion
            </p>
              {!criteriaReadOnly && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCriteria((current) => [...current, { statement: '', weight: 1 }])}
                >
                  <Plus size={12} /> Add criterion
                </Button>
              )}
          </div>
          {criteria.length === 0 ? (
            <p className="rounded-xl bg-gray-50 p-3 text-[10px] text-gray-500">
              No measurement criteria yet. Add the observable evidence used to judge this outcome.
            </p>
          ) : (
            <div className="space-y-2">
              {criteria.map((entry, index) => (
                <div key={index} className="grid gap-2 rounded-2xl border border-gray-200 p-2.5 sm:grid-cols-[1fr_90px_32px]">
                  <Input
                    value={entry.statement}
                    placeholder="Observable criterion"
                    aria-label={`Criterion ${index + 1} statement`}
                    disabled={criteriaReadOnly}
                    onChange={(event) =>
                      setCriteria((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index ? { ...candidate, statement: event.target.value } : candidate
                        )
                      )
                    }
                  />
                  <Select
                    value={entry.weight}
                    aria-label={`Criterion ${index + 1} weight`}
                    disabled={criteriaReadOnly}
                    onChange={(event) =>
                      setCriteria((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index ? { ...candidate, weight: Number(event.target.value) } : candidate
                        )
                      )
                    }
                  >
                    <option value={1}>Weight 1</option>
                    <option value={2}>Weight 2</option>
                    <option value={3}>Weight 3</option>
                    <option value={4}>Weight 4</option>
                    <option value={5}>Weight 5</option>
                  </Select>
                  {!criteriaReadOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove criterion ${index + 1}`}
                      onClick={() => setCriteria((current) => current.filter((_, candidateIndex) => candidateIndex !== index))}
                    >
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {criteriaHistory.some((entry) => entry.supersededAt) && (
            <details className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3">
              <summary className="cursor-pointer text-[10px] font-semibold text-gray-700">
                Superseded definitions ({criteriaHistory.filter((entry) => entry.supersededAt).length})
              </summary>
              <div className="mt-2 space-y-2">
                {criteriaHistory.filter((entry) => entry.supersededAt).map((entry) => (
                  <div key={entry.id} className="rounded-xl bg-white p-2.5 text-[10px] text-gray-600">
                    <p className="font-semibold text-gray-700">{entry.statement}</p>
                    <p className="mt-0.5 text-[9px] text-gray-400">
                      Weight {entry.weight} · defined {formatDate(entry.createdAt)} · superseded {formatDate(entry.supersededAt)}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
          {criteriaError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{criteriaError}</p>}
        </form>
      </Modal>

      <Modal
        open={Boolean(rejecting)}
        title={`Return ${rejecting?.code ?? 'CLO'} for revision`}
        onClose={() => setRejecting(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" form="reject-form" type="submit" loading={saving}>Return CLO</Button>
          </>
        }
      >
        <form id="reject-form" onSubmit={reject} className="space-y-3">
          <Field label="Reason" htmlFor="rejection-note" hint="The tutor will receive this note." required>
            <Textarea id="rejection-note" rows={3} value={rejectionNote} onChange={(event) => setRejectionNote(event.target.value)} required />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
