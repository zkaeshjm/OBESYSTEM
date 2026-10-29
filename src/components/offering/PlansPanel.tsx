import { useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardList, Plus } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { Clo, ImprovementPlan } from '../../api/types';
import { formatDate } from '../../hooks/useAsync';
import { Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, StatusBadge, Textarea } from '../ui';

export function PlansPanel({
  offeringId,
  plans,
  clos,
  onChanged,
  onError,
}: {
  offeringId: string;
  plans: ImprovementPlan[];
  clos: Clo[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ImprovementPlan | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cloId, setCloId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [evaluation, setEvaluation] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setCloId('');
    setDueDate('');
    setFormError('');
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!title.trim() || description.trim().length < 10) {
      setFormError('Provide a title and a description of at least 10 characters.');
      return;
    }
    setSaving(true);
    try {
      await api.createPlan(offeringId, {
        title: title.trim(),
        description: description.trim(),
        cloId: cloId || null,
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`).toISOString() : null,
      });
      reset();
      setCreateOpen(false);
      onChanged();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to create the improvement plan.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (plan: ImprovementPlan) => {
    setEditing(plan);
    setStatus(plan.status);
    setEvaluation(plan.evaluation ?? '');
    setFormError('');
  };

  const update = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setFormError('');
    setSaving(true);
    try {
      await api.updatePlan(editing.id, {
        status,
        evaluation: evaluation.trim() || null,
      });
      setEditing(null);
      onChanged();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Unable to update the improvement plan.';
      setFormError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Improvement action plans"
          description="Document actions for unmet outcomes and record the evaluation in a subsequent cycle."
          action={
            <Button size="sm" onClick={() => { reset(); setCreateOpen(true); }}>
              <Plus size={12} /> New plan
            </Button>
          }
        />
        {plans.length === 0 ? (
          <EmptyState
            title="No improvement plans"
            description="Use the gap report to identify an outcome below target, then record a concrete action and evaluation."
            icon={<ClipboardList size={20} />}
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {plans.map((plan) => (
              <li key={plan.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-bold text-gray-900">{plan.title}</p>
                      <StatusBadge status={plan.status} />
                      {plan.clo && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold text-gray-600">{plan.clo.code}</span>}
                    </div>
                    <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-gray-600">{plan.description}</p>
                    {plan.evaluation && (
                      <p className="mt-2 rounded-xl bg-emerald-50 p-2 text-[10px] text-emerald-800">
                        <span className="font-bold">Evaluation:</span> {plan.evaluation}
                      </p>
                    )}
                    <p className="mt-1.5 text-[9px] text-gray-400">
                      Created by {plan.createdBy?.name ?? 'staff'} · {formatDate(plan.createdAt)}
                      {plan.dueDate ? ` · due ${formatDate(plan.dueDate)}` : ''}
                      {plan.evaluatedAt ? ` · evaluated ${formatDate(plan.evaluatedAt)}` : ''}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(plan)}>
                    <CheckCircle2 size={12} /> Update
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={createOpen}
        title="Create improvement action plan"
        description="Record the gap being addressed, the action and the evaluation date."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button form="plan-create-form" type="submit" loading={saving}>Create plan</Button>
          </>
        }
      >
        <form id="plan-create-form" onSubmit={create} className="space-y-3">
          <Field label="Title" htmlFor="plan-title" required>
            <Input id="plan-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </Field>
          <Field label="Action and rationale" htmlFor="plan-description" required>
            <Textarea id="plan-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Related CLO" htmlFor="plan-clo">
              <Select id="plan-clo" value={cloId} onChange={(event) => setCloId(event.target.value)}>
                <option value="">No single CLO</option>
                {clos.map((clo) => <option key={clo.id} value={clo.id}>{clo.code}</option>)}
              </Select>
            </Field>
            <Field label="Due date" htmlFor="plan-due">
              <Input id="plan-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </Field>
          </div>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Update improvement plan"
        description={editing?.title}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button form="plan-update-form" type="submit" loading={saving}>Save update</Button>
          </>
        }
      >
        <form id="plan-update-form" onSubmit={update} className="space-y-3">
          <Field label="Status" htmlFor="plan-status">
            <Select id="plan-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </Field>
          <Field label="Evaluation" htmlFor="plan-evaluation" hint="Required before marking the plan completed.">
            <Textarea id="plan-evaluation" rows={4} value={evaluation} onChange={(event) => setEvaluation(event.target.value)} />
          </Field>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
