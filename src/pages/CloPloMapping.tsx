import { useMemo, useState } from 'react';
import { AlertTriangle, Link2, Trash2, Unlink } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { Clo, CloPloMapping, Plo } from '../api/types';
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
  InlineSelect,
  Loading,
  PageHeader,
  StatusBadge,
} from '../components/ui';

interface ProgramOption {
  id: string;
  code: string;
  name: string;
}

export default function CloPloMapping() {
  const { permissions } = useAuth();
  const { toast } = useToast();
  const closQuery = useAsync(() => api.clos(), []);
  const plosQuery = useAsync(() => api.plos(), []);
  const mappingsQuery = useAsync(() => api.mappings(), []);
  const [programId, setProgramId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const clos: Clo[] = closQuery.data?.data ?? [];
  const plos: Plo[] = plosQuery.data?.data ?? [];
  const mappings: CloPloMapping[] = mappingsQuery.data?.data ?? [];
  const canEdit = Boolean(permissions?.authorClos);

  const programs = useMemo<ProgramOption[]>(() => {
    const map = new Map<string, ProgramOption>();
    for (const plo of plos) {
      if (plo.program) map.set(plo.program.id, { id: plo.program.id, code: plo.program.code, name: plo.program.name });
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [plos]);

  const activeProgram = programId || programs[0]?.id || '';

  const programClos = useMemo(
    () =>
      clos
        .filter((clo) => (clo.course?.programId ?? '') === activeProgram)
        .sort((a, b) => `${a.course?.code}${a.code}`.localeCompare(`${b.course?.code}${b.code}`)),
    [clos, activeProgram]
  );
  const programPlos = useMemo(
    () => plos.filter((plo) => plo.programId === activeProgram).sort((a, b) => a.code.localeCompare(b.code)),
    [plos, activeProgram]
  );

  const mappingKey = (cloId: string, ploId: string) => `${cloId}:${ploId}`;
  const mappingIndex = useMemo(() => {
    const index = new Map<string, CloPloMapping>();
    for (const mapping of mappings) index.set(mappingKey(mapping.cloId, mapping.ploId), mapping);
    return index;
  }, [mappings]);

  const unmappedClos = programClos.filter(
    (clo) => !programPlos.some((plo) => mappingIndex.has(mappingKey(clo.id, plo.id)))
  );
  const unmappedPlos = programPlos.filter(
    (plo) => !programClos.some((clo) => mappingIndex.has(mappingKey(clo.id, plo.id)))
  );

  const reload = async () => {
    await Promise.all([mappingsQuery.reload(), plosQuery.reload(), closQuery.reload()]);
  };

  const addMapping = async (clo: Clo, plo: Plo) => {
    if (!canEdit) return;
    setBusy(mappingKey(clo.id, plo.id));
    try {
      await api.mapCloPlo({ cloId: clo.id, ploId: plo.id, weight: 3 });
      toast(`${clo.code} mapped to ${plo.code}.`);
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to save the mapping.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const changeWeight = async (clo: Clo, plo: Plo, weight: number) => {
    if (!canEdit) return;
    setBusy(mappingKey(clo.id, plo.id));
    try {
      await api.mapCloPlo({ cloId: clo.id, ploId: plo.id, weight });
      toast(`Contribution weight updated to ${weight}.`);
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to update the weight.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const removeMapping = async (clo: Clo, plo: Plo) => {
    if (!canEdit) return;
    const mapping = mappingIndex.get(mappingKey(clo.id, plo.id));
    if (!mapping?.id) return;
    setBusy(mappingKey(clo.id, plo.id));
    try {
      await api.deleteMapping(mapping.id);
      toast(`${clo.code} unmapped from ${plo.code}.`);
      await reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to remove the mapping.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const loading = closQuery.loading || plosQuery.loading || mappingsQuery.loading;
  const error = closQuery.error || plosQuery.error || mappingsQuery.error;

  return (
    <div>
      <PageHeader
        eyebrow="Outcomes"
        title="CLO–PLO mapping"
        description="Map each course learning outcome to the programme learning outcomes it provides evidence for. Weights feed the programme attainment roll-up. Changes are recorded in the audit log."
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <InlineSelect
          value={activeProgram}
          onChange={(event) => setProgramId(event.target.value)}
          aria-label="Filter by programme"
        >
          {programs.length === 0 && <option value="">No programmes available</option>}
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.code} — {program.name}
            </option>
          ))}
        </InlineSelect>
        <span className="text-[10px] text-gray-500">
          {programClos.length} CLOs · {programPlos.length} PLOs ·{' '}
          {mappings.filter((mapping) => programClos.some((clo) => clo.id === mapping.cloId)).length} mappings
        </span>
        {!canEdit && <Badge tone="amber">Read-only</Badge>}
      </Card>

      {loading ? (
        <Loading label="Loading outcome matrix…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : programs.length === 0 || programClos.length === 0 || programPlos.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to map yet"
            description={
              programs.length === 0
                ? 'No programme learning outcomes are visible to you.'
                : programClos.length === 0
                  ? 'You have no CLOs for this programme. Author CLOs in the CLO workspace first.'
                  : 'This programme has no PLOs defined. An administrator must define them.'
            }
            icon={<Link2 size={20} />}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Mapping matrix"
              description="Click an empty cell to map. A filled cell shows the contribution weight."
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
                      CLO
                    </th>
                    {programPlos.map((plo) => (
                      <th key={plo.id} className="px-2 py-2.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
                        {plo.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {programClos.map((clo) => {
                    const rowMapped = programPlos.some((plo) => mappingIndex.has(mappingKey(clo.id, plo.id)));
                    return (
                      <tr key={clo.id} className="hover:bg-gray-50/60">
                        <td className="sticky left-0 z-10 max-w-[260px] bg-white px-4 py-3 align-top">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] font-bold text-gray-900">{clo.code}</span>
                            <StatusBadge status={clo.approvalStatus} />
                          </div>
                          <p className="mt-0.5 text-[9px] text-gray-500">{clo.course?.code}</p>
                          <p className="mt-0.5 line-clamp-2 text-[9px] text-gray-400">{clo.description}</p>
                          {!rowMapped && (
                            <Badge tone="amber" className="mt-1">
                              <Unlink size={9} /> Unmapped
                            </Badge>
                          )}
                        </td>
                        {programPlos.map((plo) => {
                          const key = mappingKey(clo.id, plo.id);
                          const mapping = mappingIndex.get(key);
                          return (
                            <td key={plo.id} className="px-2 py-3 text-center align-middle">
                              {mapping ? (
                                <div className="flex flex-col items-center gap-1">
                                  <select
                                    aria-label={`${clo.code} to ${plo.code} weight`}
                                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700"
                                    value={mapping.weight}
                                    disabled={!canEdit || busy === key}
                                    onChange={(event) => void changeWeight(clo, plo, Number(event.target.value))}
                                  >
                                    <option value={1}>1×</option>
                                    <option value={2}>2×</option>
                                    <option value={3}>3×</option>
                                  </select>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-rose-500 hover:text-rose-700 disabled:opacity-50"
                                      disabled={busy === key}
                                      onClick={() => void removeMapping(clo, plo)}
                                    >
                                      <Trash2 size={9} /> Remove
                                    </button>
                                  )}
                                </div>
                              ) : canEdit ? (
                                <button
                                  type="button"
                                  className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[9px] font-semibold text-gray-400 hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-50"
                                  disabled={busy === key}
                                  onClick={() => void addMapping(clo, plo)}
                                  aria-label={`Map ${clo.code} to ${plo.code}`}
                                >
                                  + Map
                                </button>
                              ) : (
                                <span className="text-[10px] text-gray-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Coverage gaps" description="Outcomes with no mapping in this programme." />
              <div className="space-y-3 px-5 py-4">
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
                    <AlertTriangle size={11} /> Unmapped CLOs ({unmappedClos.length})
                  </p>
                  {unmappedClos.length === 0 ? (
                    <p className="mt-1 text-[10px] text-emerald-600">Every CLO maps to at least one PLO.</p>
                  ) : (
                    <ul className="mt-1.5 flex flex-wrap gap-1">
                      {unmappedClos.map((clo) => (
                        <li key={clo.id}>
                          <Badge tone="amber">{clo.course?.code} · {clo.code}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
                    <AlertTriangle size={11} /> PLOs with no CLO ({unmappedPlos.length})
                  </p>
                  {unmappedPlos.length === 0 ? (
                    <p className="mt-1 text-[10px] text-emerald-600">Every PLO receives evidence from at least one CLO.</p>
                  ) : (
                    <ul className="mt-1.5 flex flex-wrap gap-1">
                      {unmappedPlos.map((plo) => (
                        <li key={plo.id}>
                          <Badge tone="amber">{plo.code}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Programme PLOs" />
              <ul className="divide-y divide-gray-50">
                {programPlos.map((plo) => (
                  <li key={plo.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-mono text-[10px] font-bold text-gray-900">{plo.code}</p>
                      <Badge tone="blue">Target {Number(plo.targetAttainment).toFixed(1)}%</Badge>
                    </div>
                    <p className="mt-0.5 text-[10px] text-gray-600">{plo.description}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
