import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { Clo } from '../../api/types';
import { Button, Field, Input, Modal, Select, Textarea } from '../ui';

interface CriterionForm {
  label: string;
  maxMarks: number;
}

interface ItemForm {
  label: string;
  prompt: string;
  maxMarks: number;
  mappings: Record<string, number>;
  rubricCriteria: CriterionForm[];
}

const newItem = (index: number): ItemForm => ({
  label: `Item ${index + 1}`,
  prompt: '',
  maxMarks: 20,
  mappings: {},
  rubricCriteria: [],
});

export function AssessmentFormModal({
  open,
  offeringId,
  clos,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  offeringId: string;
  clos: Clo[];
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('ASSIGNMENT');
  const [dueAt, setDueAt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submissionFormat, setSubmissionFormat] = useState('');
  const [passingMarks, setPassingMarks] = useState('');
  const [latePolicy, setLatePolicy] = useState('MARK_LATE');
  const [items, setItems] = useState<ItemForm[]>([newItem(0)]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle('');
    setType('ASSIGNMENT');
    setDueAt('');
    setInstructions('');
    setSubmissionFormat('');
    setPassingMarks('');
    setLatePolicy('MARK_LATE');
    setItems([newItem(0)]);
    setFormError('');
  };

  const updateItem = (index: number, patch: Partial<ItemForm>) => {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!title.trim()) {
      setFormError('A title is required.');
      return;
    }
    if (items.some((item) => !item.label.trim() || item.maxMarks <= 0)) {
      setFormError('Every item needs a label and a positive maximum mark.');
      return;
    }
    if (items.some((item) => Object.keys(item.mappings).length === 0)) {
      setFormError('Every assessment item must map to at least one approved CLO.');
      return;
    }
    if (
      items.some(
        (item) =>
          item.rubricCriteria.some((criterion) => !criterion.label.trim() || criterion.maxMarks <= 0) ||
          item.rubricCriteria.reduce((sum, criterion) => sum + Number(criterion.maxMarks || 0), 0) > item.maxMarks
      )
    ) {
      setFormError('Rubric criteria need a label and positive marks, and cannot exceed their item maximum.');
      return;
    }
    const totalMarks = items.reduce((sum, item) => sum + Number(item.maxMarks || 0), 0);
    const passing = passingMarks.trim() === '' ? null : Number(passingMarks);
    if (passing !== null && (!Number.isFinite(passing) || passing < 0 || passing > totalMarks)) {
      setFormError(`Passing marks must be between 0 and the assessment total of ${totalMarks}.`);
      return;
    }
    setSaving(true);
    try {
      await api.createAssessment({
        offeringId,
        title: title.trim(),
        type,
        instructions: instructions.trim() || null,
        submissionFormat: submissionFormat.trim() || null,
        passingMarks: passing,
        latePolicy,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        items: items.map((item) => ({
          label: item.label.trim(),
          prompt: item.prompt.trim() || null,
          maxMarks: Number(item.maxMarks),
          cloMappings: Object.entries(item.mappings).map(([cloId, weight]) => ({ cloId, weight })),
          ...(item.rubricCriteria.length
            ? {
                rubricCriteria: item.rubricCriteria.map((criterion) => ({
                  label: criterion.label.trim(),
                  maxMarks: Number(criterion.maxMarks),
                })),
              }
            : {}),
        })),
      });
      reset();
      onCreated();
      onClose();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to create the assessment.');
      onError(caught instanceof ApiError ? caught.message : 'Unable to create the assessment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create assessment"
      description="Assessments are created as drafts. Publishing requires every item to be mapped to an approved CLO."
      onClose={() => {
        reset();
        onClose();
      }}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button form="assessment-form" type="submit" loading={saving}>Create draft</Button>
        </>
      }
    >
      <form id="assessment-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_200px]">
          <Field label="Title" htmlFor="assessment-title" required>
            <Input id="assessment-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Applied ML project" required />
          </Field>
          <Field label="Type" htmlFor="assessment-type" required>
            <Select id="assessment-type" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="ASSIGNMENT">Assignment</option>
              <option value="QUIZ">Quiz</option>
              <option value="LAB">Lab</option>
              <option value="PRESENTATION">Presentation</option>
              <option value="MID_EXAM">Mid exam</option>
              <option value="PROJECT">Project</option>
              <option value="FINAL_EXAM">Final exam</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Deadline" htmlFor="assessment-due">
            <Input id="assessment-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Submission format" htmlFor="assessment-format" hint="e.g. PDF, code repository, in person">
            <Input
              id="assessment-format"
              value={submissionFormat}
              onChange={(event) => setSubmissionFormat(event.target.value)}
              placeholder="PDF upload"
            />
          </Field>
          <Field label="Passing marks" htmlFor="assessment-passing" hint="Optional threshold for this assessment.">
            <Input
              id="assessment-passing"
              type="number"
              min={0}
              step="0.01"
              value={passingMarks}
              onChange={(event) => setPassingMarks(event.target.value)}
              placeholder="e.g. 40"
            />
          </Field>
          <Field label="Late submission policy" htmlFor="assessment-late" required>
            <Select id="assessment-late" value={latePolicy} onChange={(event) => setLatePolicy(event.target.value)}>
              <option value="MARK_LATE">Accept and flag as late</option>
              <option value="ACCEPT">Accept without late flag</option>
              <option value="REJECT">Reject after the deadline</option>
            </Select>
          </Field>
        </div>
        <Field label="Instructions" htmlFor="assessment-instructions">
          <Textarea id="assessment-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={2} />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-gray-800">Assessment items</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => setItems((current) => [...current, newItem(current.length)])}>
              <Plus size={12} /> Add item
            </Button>
          </div>
          {items.map((item, index) => (
            <div key={index} className="rounded-2xl border border-gray-200 bg-gray-50/40 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Label" htmlFor={`item-label-${index}`} className="flex-1" required>
                  <Input id={`item-label-${index}`} value={item.label} onChange={(event) => updateItem(index, { label: event.target.value })} required />
                </Field>
                <Field label="Max marks" htmlFor={`item-marks-${index}`} className="w-28" required>
                  <Input
                    id={`item-marks-${index}`}
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={item.maxMarks}
                    onChange={(event) => updateItem(index, { maxMarks: Number(event.target.value) })}
                    required
                  />
                </Field>
                {items.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove item">
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
              <Field label="Question or task prompt" htmlFor={`item-prompt-${index}`} className="mt-2">
                <Input id={`item-prompt-${index}`} value={item.prompt} onChange={(event) => updateItem(index, { prompt: event.target.value })} />
              </Field>
              <div className="mt-2 rounded-xl border border-gray-100 bg-white/60 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-gray-600">Rubric criteria (optional)</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateItem(index, {
                        rubricCriteria: [...item.rubricCriteria, { label: `Criterion ${item.rubricCriteria.length + 1}`, maxMarks: 5 }],
                      })
                    }
                  >
                    <Plus size={11} /> Add criterion
                  </Button>
                </div>
                {item.rubricCriteria.length > 0 && (
                  <div className="mt-1.5 space-y-1.5">
                    {item.rubricCriteria.map((criterion, criterionIndex) => (
                      <div key={criterionIndex} className="flex items-center gap-1.5">
                        <Input
                          value={criterion.label}
                          onChange={(event) =>
                            updateItem(index, {
                              rubricCriteria: item.rubricCriteria.map((entry, entryIndex) =>
                                entryIndex === criterionIndex ? { ...entry, label: event.target.value } : entry
                              ),
                            })
                          }
                          aria-label={`Criterion ${criterionIndex + 1} label`}
                          placeholder="Criterion"
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={criterion.maxMarks}
                          onChange={(event) =>
                            updateItem(index, {
                              rubricCriteria: item.rubricCriteria.map((entry, entryIndex) =>
                                entryIndex === criterionIndex ? { ...entry, maxMarks: Number(event.target.value) } : entry
                              ),
                            })
                          }
                          aria-label={`Criterion ${criterionIndex + 1} maximum marks`}
                          className="w-20"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateItem(index, {
                              rubricCriteria: item.rubricCriteria.filter((_, entryIndex) => entryIndex !== criterionIndex),
                            })
                          }
                          aria-label="Remove rubric criterion"
                        >
                          <Trash2 size={11} />
                        </Button>
                      </div>
                    ))}
                    <p className="text-[9px] text-gray-400">
                      Criterion total {item.rubricCriteria.reduce((sum, criterion) => sum + Number(criterion.maxMarks || 0), 0).toFixed(2)} of{' '}
                      {item.maxMarks} marks
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-2">
                <p className="mb-1.5 text-[10px] font-semibold text-gray-600">Evidence mapping (select at least one)</p>
                {clos.length === 0 ? (
                  <p className="text-[10px] text-amber-700">No approved CLOs are available. Approve CLOs before creating assessments.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {clos.map((clo) => {
                      const selected = clo.id in item.mappings;
                      return (
                        <span key={clo.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] ${selected ? 'border-gray-300 bg-white' : 'border-gray-200 bg-white/60'}`}>
                          <input
                            id={`item-${index}-clo-${clo.id}`}
                            type="checkbox"
                            checked={selected}
                            onChange={(event) =>
                              updateItem(index, {
                                mappings: (() => {
                                  const next = { ...item.mappings };
                                  if (event.target.checked) next[clo.id] = 1;
                                  else delete next[clo.id];
                                  return next;
                                })(),
                              })
                            }
                            className="h-3 w-3 rounded border-gray-300"
                          />
                          <label htmlFor={`item-${index}-clo-${clo.id}`} className="font-semibold text-gray-700">{clo.code}</label>
                          {selected && (
                            <select
                              value={item.mappings[clo.id]}
                              onChange={(event) => updateItem(index, { mappings: { ...item.mappings, [clo.id]: Number(event.target.value) } })}
                              className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[9px]"
                              aria-label={`${clo.code} evidence weight`}
                            >
                              <option value={0.5}>0.5×</option>
                              <option value={1}>1×</option>
                              <option value={2}>2×</option>
                              <option value={3}>3×</option>
                            </select>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        <p className="text-[9px] text-gray-400">
          Total maximum marks: {items.reduce((sum, item) => sum + Number(item.maxMarks || 0), 0).toFixed(2)}. Item weights are used to
          combine evidence inside each CLO; they do not need to total 100.
        </p>
      </form>
    </Modal>
  );
}
