import { useState, type FormEvent } from 'react';
import { Link2, Pencil, Plus, Target, Trash2, UserX } from 'lucide-react';
import { api, ApiError } from '../api/client';
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
  Textarea,
  useConfirm,
} from '../components/ui';
import type { Clo, CloPloMapping, Plo } from '../api/types';

const emptyForm = {
  programId: '',
  code: '',
  description: '',
  bloomDomain: 'COGNITIVE',
  accreditationRef: '',
  targetAttainment: 65,
};

export default function PLOs() {
  const { permissions } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [programId, setProgramId] = useState('');
  const programsQuery = useAsync(() => api.programs(), []);
  const plosQuery = useAsync(() => api.plos(programId ? { programId } : undefined), [programId]);
  const closQuery = useAsync(() => api.clos(programId ? { programId } : undefined), [programId]);
  const mappingsQuery = useAsync(() => api.mappings(programId ? { programId } : undefined), [programId]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Plo | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingClo, setMappingClo] = useState('');
  const [mappingPlo, setMappingPlo] = useState('');
  const [mappingWeight, setMappingWeight] = useState(3);
  const [mappingError, setMappingError] = useState('');

  const programs = programsQuery.data?.data ?? [];
  const plos: Plo[] = plosQuery.data?.data ?? [];
  const clos: Clo[] = closQuery.data?.data ?? [];
  const mappings: CloPloMapping[] = mappingsQuery.data?.data ?? [];
  const canManage = permissions?.manageProgramOutcomes;
  const selectedProgram = programs.find((program) => program.id === programId);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, programId: programId || programs[0]?.id || '' });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (plo: Plo) => {
    setEditing(plo);
    setForm({
      programId: plo.programId,
      code: plo.code,
      description: plo.description,
      bloomDomain: plo.bloomDomain,
      accreditationRef: plo.accreditationRef ?? '',
      targetAttainment: Number(plo.targetAttainment),
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.programId || !form.code.trim() || form.description.trim().length < 10) {
      setFormError('Programme, code and a description of at least 10 characters are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        programId: form.programId,
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        bloomDomain: form.bloomDomain,
        accreditationRef: form.accreditationRef.trim() || null,
        targetAttainment: Number(form.targetAttainment),
      };
      if (editing) {
        await api.updatePlo(editing.id, payload);
        toast('PLO updated.');
      } else {
        await api.createPlo(payload);
        toast('PLO created.');
      }
      setModalOpen(false);
      await plosQuery.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to save the PLO.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (plo: Plo) => {
    const confirmed = await confirm({
      title: 'Deactivate PLO',
      message: `Deactivate ${plo.code}? Existing attainment history is preserved.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deactivatePlo(plo.id);
      toast('PLO deactivated.');
      await plosQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to deactivate the PLO.', 'error');
    }
  };

  const addMapping = async (event: FormEvent) => {
    event.preventDefault();
    setMappingError('');
    if (!mappingClo || !mappingPlo) {
      setMappingError('Select both a CLO and a PLO.');
      return;
    }
    setSaving(true);
    try {
      await api.mapCloPlo({ cloId: mappingClo, ploId: mappingPlo, weight: mappingWeight });
      toast('CLO-to-PLO mapping saved.');
      setMappingOpen(false);
      await mappingsQuery.reload();
      await plosQuery.reload();
      await closQuery.reload();
    } catch (caught) {
      setMappingError(caught instanceof ApiError ? caught.message : 'Unable to save the mapping.');
    } finally {
      setSaving(false);
    }
  };

  const removeMapping = async (mapping: CloPloMapping) => {
    if (!mapping.id) return;
    const confirmed = await confirm({
      title: 'Remove PLO mapping',
      message: `Remove the mapping between ${mapping.clo?.code} and ${mapping.plo?.code}? Future attainment runs will no longer roll this CLO up to that PLO.`,
      confirmLabel: 'Remove mapping',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deleteMapping(mapping.id);
      toast('Mapping removed.');
      await mappingsQuery.reload();
      await plosQuery.reload();
      await closQuery.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to remove the mapping.', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Programme learning outcomes"
        description="PLOs define what graduates should achieve. CLOs map to PLOs with a contribution weight used by the attainment roll-up."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setMappingOpen(true); setMappingClo(clos[0]?.id ?? ''); setMappingPlo(plos[0]?.id ?? ''); setMappingError(''); }} disabled={!clos.length || !plos.length}>
                <Link2 size={14} /> Map CLO
              </Button>
              <Button onClick={openCreate} disabled={!programs.length}><Plus size={14} /> New PLO</Button>
            </div>
          ) : undefined
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <InlineSelect value={programId} onChange={(event) => setProgramId(event.target.value)} aria-label="Filter by programme">
          <option value="">All programmes I can access</option>
          {programs.map((program) => <option key={program.id} value={program.id}>{program.code} — {program.name}</option>)}
        </InlineSelect>
        <span className="text-[10px] text-gray-500">
          {plos.length} PLOs · {clos.length} CLOs · {mappings.length} mappings
        </span>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {plosQuery.loading ? (
            <Loading />
          ) : plosQuery.error ? (
            <ErrorState message={plosQuery.error} onRetry={plosQuery.reload} />
          ) : plos.length === 0 ? (
            <Card>
              <EmptyState
                title="No PLOs defined"
                description={selectedProgram ? `Define the graduate outcomes for ${selectedProgram.name}.` : 'Select a programme or create its first PLO.'}
                action={canManage ? <Button onClick={openCreate}>Create PLO</Button> : undefined}
                icon={<Target size={20} />}
              />
            </Card>
          ) : (
            plos.map((plo) => (
              <Card key={plo.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-mono text-[11px] font-bold text-gray-900">{plo.code}</p>
                      <StatusBadge status={plo.isActive ? 'APPROVED' : 'ARCHIVED'} />
                      <Badge tone="purple">{plo.bloomDomain}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-700">{plo.description}</p>
                    <p className="mt-1 text-[9px] text-gray-400">
                      {plo.program?.code} · target {Number(plo.targetAttainment).toFixed(1)}% · {plo.accreditationRef ?? 'No accreditation reference'} · {plo._count?.cloMappings ?? 0} CLO mappings
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(plo)} aria-label={`Edit ${plo.code}`}><Pencil size={12} /></Button>
                      {plo.isActive && <Button variant="ghost" size="sm" onClick={() => void deactivate(plo)} aria-label={`Deactivate ${plo.code}`}><UserX size={12} /></Button>}
                    </div>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>

        <Card>
          <CardHeader title="CLO → PLO mappings" description="Weight 1 = slight, 3 = substantial contribution." />
          {mappings.length === 0 ? (
            <EmptyState title="No mappings" description="Map course CLOs to programme PLOs to enable programme reports." icon={<Link2 size={20} />} />
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-100 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                    <th className="px-4 py-2.5 font-bold">CLO</th>
                    <th className="px-4 py-2.5 font-bold">PLO</th>
                    <th className="px-4 py-2.5 font-bold">Weight</th>
                    {canManage && <th className="px-4 py-2.5 text-right font-bold" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {mappings.map((mapping) => (
                    <tr key={mapping.id ?? `${mapping.cloId}-${mapping.ploId}`}>
                      <td className="px-4 py-2.5">
                        <p className="text-[10px] font-semibold text-gray-800">{mapping.clo?.code}</p>
                        <p className="text-[9px] text-gray-400">{mapping.clo?.course?.code}</p>
                      </td>
                      <td className="px-4 py-2.5 text-[10px] text-gray-700">{mapping.plo?.code}</td>
                      <td className="px-4 py-2.5"><Badge tone="blue">{mapping.weight}</Badge></td>
                      {canManage && (
                        <td className="px-4 py-2.5 text-right">
                          <Button variant="ghost" size="sm" onClick={() => void removeMapping(mapping)} aria-label="Remove mapping"><Trash2 size={12} /></Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={modalOpen}
        title={editing ? `Edit ${editing.code}` : 'Create programme learning outcome'}
        description="PLOs are programme-level and apply across every course in the programme."
        onClose={() => setModalOpen(false)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="plo-form" type="submit" loading={saving}>{editing ? 'Save changes' : 'Create PLO'}</Button>
          </>
        }
      >
        <form id="plo-form" onSubmit={submit} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Programme" htmlFor="plo-program" required>
              <Select id="plo-program" value={form.programId} onChange={(event) => setForm({ ...form, programId: event.target.value })} disabled={Boolean(editing)} required>
                <option value="">Select a programme</option>
                {programs.map((program) => <option key={program.id} value={program.id}>{program.code} — {program.name}</option>)}
              </Select>
            </Field>
            <Field label="Code" htmlFor="plo-code" required>
              <Input id="plo-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} disabled={Boolean(editing)} required />
            </Field>
          </div>
          <Field label="Outcome statement" htmlFor="plo-description" required>
            <Textarea id="plo-description" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Bloom domain" htmlFor="plo-domain">
              <Select id="plo-domain" value={form.bloomDomain} onChange={(event) => setForm({ ...form, bloomDomain: event.target.value })}>
                <option value="COGNITIVE">Cognitive</option>
                <option value="PSYCHOMOTOR">Psychomotor</option>
                <option value="AFFECTIVE">Affective</option>
              </Select>
            </Field>
            <Field label="Target attainment %" htmlFor="plo-target">
              <Input id="plo-target" type="number" min={0} max={100} step="0.1" value={form.targetAttainment} onChange={(event) => setForm({ ...form, targetAttainment: Number(event.target.value) })} />
            </Field>
            <Field label="Accreditation reference" htmlFor="plo-ref">
              <Input id="plo-ref" value={form.accreditationRef} onChange={(event) => setForm({ ...form, accreditationRef: event.target.value })} placeholder="PEC / ABET" />
            </Field>
          </div>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={mappingOpen}
        title="Map a CLO to a PLO"
        description="Only CLOs and PLOs in the same programme can be mapped; the API and database enforce this."
        onClose={() => setMappingOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMappingOpen(false)}>Cancel</Button>
            <Button form="mapping-form" type="submit" loading={saving}>Save mapping</Button>
          </>
        }
      >
        <form id="mapping-form" onSubmit={addMapping} className="space-y-3">
          <Field label="CLO" htmlFor="mapping-clo" required>
            <Select id="mapping-clo" value={mappingClo} onChange={(event) => setMappingClo(event.target.value)} required>
              <option value="">Select a CLO</option>
              {clos.filter((clo) => clo.approvalStatus === 'APPROVED').map((clo) => (
                <option key={clo.id} value={clo.id}>{clo.course?.code} · {clo.code} — {clo.description.slice(0, 60)}</option>
              ))}
            </Select>
          </Field>
          <Field label="PLO" htmlFor="mapping-plo" required>
            <Select id="mapping-plo" value={mappingPlo} onChange={(event) => setMappingPlo(event.target.value)} required>
              <option value="">Select a PLO</option>
              {plos.filter((plo) => plo.isActive).map((plo) => <option key={plo.id} value={plo.id}>{plo.code} — {plo.description.slice(0, 60)}</option>)}
            </Select>
          </Field>
          <Field label="Contribution weight" htmlFor="mapping-weight">
            <Select id="mapping-weight" value={mappingWeight} onChange={(event) => setMappingWeight(Number(event.target.value))}>
              <option value={1}>Slight (1)</option>
              <option value={2}>Moderate (2)</option>
              <option value={3}>Substantial (3)</option>
            </Select>
          </Field>
          {mappingError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{mappingError}</p>}
        </form>
      </Modal>
    </div>
  );
}
