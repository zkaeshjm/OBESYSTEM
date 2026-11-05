import { useState, type FormEvent } from 'react';
import { CheckCircle2, Plus, Settings2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { AttainmentPolicy } from '../api/types';
import { useAsync, formatDate } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  useConfirm,
} from '../components/ui';

interface PolicyConfig {
  cloMasteryThreshold: number;
  cohortAttainmentTarget: number;
  minCohortSize: number;
  atRiskBand: number;
  rounding: number;
  missingEvidence: 'exclude' | 'zero';
  includeUnapprovedClos: boolean;
  ploAggregation: 'weighted';
  ploWeighting: 'mapping_weight' | 'mapping_weight_and_cohort';
}

const defaults: PolicyConfig = {
  cloMasteryThreshold: 50,
  cohortAttainmentTarget: 65,
  minCohortSize: 5,
  atRiskBand: 5,
  rounding: 1,
  missingEvidence: 'exclude',
  includeUnapprovedClos: false,
  ploAggregation: 'weighted',
  ploWeighting: 'mapping_weight_and_cohort',
};

export default function Policies() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const query = useAsync(() => api.policies(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState<PolicyConfig>(defaults);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const policies = query.data?.data ?? [];

  const openCreate = () => {
    const latest = policies[0];
    const latestConfig = latest?.config as Partial<PolicyConfig> | undefined;
    setName('Institutional OBE policy');
    setVersion(`${new Date().getFullYear()}.${policies.length + 1}`);
    setDescription('');
    setConfig({ ...defaults, ...latestConfig });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!name.trim() || !version.trim()) {
      setFormError('Name and version are required.');
      return;
    }
    if (config.minCohortSize < 1 || config.atRiskBand < 0 || config.atRiskBand > 100) {
      setFormError('Cohort size and at-risk band must be valid.');
      return;
    }
    setSaving(true);
    try {
      await api.createPolicy({
        name: name.trim(),
        version: version.trim(),
        description: description.trim() || null,
        config: {
          ...config,
          cloMasteryThreshold: Number(config.cloMasteryThreshold),
          cohortAttainmentTarget: Number(config.cohortAttainmentTarget),
          minCohortSize: Number(config.minCohortSize),
          atRiskBand: Number(config.atRiskBand),
          rounding: Number(config.rounding),
        },
        isActive: true,
      });
      toast('Policy version created and activated. New runs will snapshot it.');
      setModalOpen(false);
      await query.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to create the policy.');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (policy: AttainmentPolicy) => {
    const confirmed = await confirm({
      title: 'Activate policy version',
      message: `Activate ${policy.version} for future attainment runs? Existing runs keep their original policy snapshot.`,
      confirmLabel: 'Activate',
    });
    if (!confirmed) return;
    try {
      await api.activatePolicy(policy.id);
      toast(`Policy ${policy.version} is now active.`);
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to activate the policy.', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Attainment policy"
        description="Institutional calculation policy, versioned and snapshotted into every attainment run. The defaults are a documented policy, not a universal OBE formula."
        actions={<Button onClick={openCreate}><Plus size={14} /> New version</Button>}
      />

      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : policies.length === 0 ? (
        <Card><EmptyState title="No policy configured" description="Create a policy before computing attainment." action={<Button onClick={openCreate}>Create policy</Button>} icon={<Settings2 size={20} />} /></Card>
      ) : (
        <div className="space-y-3">
          {policies.map((policy) => {
            const policyConfig = policy.config as unknown as PolicyConfig;
            return (
              <Card key={policy.id} className={`p-5 ${policy.isActive ? 'border-emerald-200 bg-emerald-50/20' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="text-sm font-bold text-gray-900">{policy.name}</h2>
                      <Badge tone="blue">v{policy.version}</Badge>
                      {policy.isActive ? (
                        <Badge tone="green"><CheckCircle2 size={10} /> Active</Badge>
                      ) : (
                        <Badge>Superseded</Badge>
                      )}
                    </div>
                    <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-gray-500">{policy.description ?? 'No description.'}</p>
                    <p className="mt-1 text-[9px] text-gray-400">
                      Created {formatDate(policy.createdAt, true)} by {policy.createdBy?.name ?? 'unknown'} · {policy._count?.runs ?? 0} runs
                    </p>
                  </div>
                  {!policy.isActive && (
                    <Button variant="secondary" size="sm" onClick={() => void activate(policy)}>Activate</Button>
                  )}
                </div>
                <dl className="mt-4 grid gap-3 text-[10px] sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">Default CLO mastery</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.cloMasteryThreshold}%</dd>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">Cohort target</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.cohortAttainmentTarget}%</dd>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">Minimum cohort</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.minCohortSize} students</dd>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">At-risk band</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.atRiskBand} points</dd>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">Missing evidence</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.missingEvidence === 'exclude' ? 'Excluded from cohort' : 'Scored zero'}</dd>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">Unapproved CLOs</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.includeUnapprovedClos ? 'Included' : 'Excluded'}</dd>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">PLO weighting</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.ploWeighting === 'mapping_weight_and_cohort' ? 'Mapping × cohort' : 'Mapping weight'}</dd>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <dt className="text-gray-400">Rounding</dt>
                    <dd className="font-bold text-gray-800">{policyConfig.rounding} decimal place(s)</dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="Create policy version"
        description="Creating and activating a new version does not change historical runs. Those retain their original snapshot."
        onClose={() => setModalOpen(false)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="policy-form" type="submit" loading={saving}>Create and activate</Button>
          </>
        }
      >
        <form id="policy-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Policy name" htmlFor="policy-name" required>
              <Input id="policy-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label="Version" htmlFor="policy-version" required>
              <Input id="policy-version" value={version} onChange={(event) => setVersion(event.target.value)} required />
            </Field>
          </div>
          <Field label="Description" htmlFor="policy-description">
            <Input id="policy-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Default CLO mastery %" htmlFor="policy-mastery" hint="Fallback only; each CLO stores its own threshold.">
              <Input id="policy-mastery" type="number" min={0} max={100} step="0.1" value={config.cloMasteryThreshold} onChange={(event) => setConfig({ ...config, cloMasteryThreshold: Number(event.target.value) })} />
            </Field>
            <Field label="Cohort target %" htmlFor="policy-target">
              <Input id="policy-target" type="number" min={0} max={100} step="0.1" value={config.cohortAttainmentTarget} onChange={(event) => setConfig({ ...config, cohortAttainmentTarget: Number(event.target.value) })} />
            </Field>
            <Field label="Minimum cohort size" htmlFor="policy-min">
              <Input id="policy-min" type="number" min={1} value={config.minCohortSize} onChange={(event) => setConfig({ ...config, minCohortSize: Number(event.target.value) })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="At-risk band (points)" htmlFor="policy-band">
              <Input id="policy-band" type="number" min={0} max={100} value={config.atRiskBand} onChange={(event) => setConfig({ ...config, atRiskBand: Number(event.target.value) })} />
            </Field>
            <Field label="Rounding (decimals)" htmlFor="policy-rounding">
              <Input id="policy-rounding" type="number" min={0} max={4} value={config.rounding} onChange={(event) => setConfig({ ...config, rounding: Number(event.target.value) })} />
            </Field>
            <Field label="Missing evidence" htmlFor="policy-missing">
              <Select id="policy-missing" value={config.missingEvidence} onChange={(event) => setConfig({ ...config, missingEvidence: event.target.value as PolicyConfig['missingEvidence'] })}>
                <option value="exclude">Exclude from eligible cohort</option>
                <option value="zero">Score as zero</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="PLO aggregation weight" htmlFor="policy-plo">
              <Select id="policy-plo" value={config.ploWeighting} onChange={(event) => setConfig({ ...config, ploWeighting: event.target.value as PolicyConfig['ploWeighting'] })}>
                <option value="mapping_weight_and_cohort">Mapping weight × eligible cohort</option>
                <option value="mapping_weight">Mapping weight only</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 self-end rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-[11px] font-medium text-gray-700">
              <input type="checkbox" checked={config.includeUnapprovedClos} onChange={(event) => setConfig({ ...config, includeUnapprovedClos: event.target.checked })} className="h-3.5 w-3.5 rounded border-gray-300" />
              Include unapproved CLOs in calculations
            </label>
          </div>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
