import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { CourseMaterial } from '../../api/types';
import { formatDate } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Loading, Modal, Textarea, useConfirm } from '../ui';

const emptyForm = { title: '', description: '', url: '', isPublished: false };

export function MaterialsPanel({ offeringId, canManage }: { offeringId: string; canManage: boolean }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<CourseMaterial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CourseMaterial | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.materials(offeringId);
      setItems(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load learning materials.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeringId]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (material: CourseMaterial) => {
    setEditing(material);
    setForm({
      title: material.title,
      description: material.description ?? '',
      url: material.url,
      isPublished: material.isPublished,
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!form.title.trim() || !form.url.trim()) {
      setFormError('Title and URL are required.');
      return;
    }
    if (!/^https?:\/\//i.test(form.url.trim())) {
      setFormError('Use an http(s) URL. File uploads are not stored in this database.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        url: form.url.trim(),
        isPublished: form.isPublished,
      };
      if (editing) await api.updateMaterial(editing.id, payload);
      else await api.createMaterial(offeringId, payload);
      toast(editing ? 'Learning material updated.' : 'Learning material added.');
      setModalOpen(false);
      await load();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to save the material.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (material: CourseMaterial) => {
    const confirmed = await confirm({
      title: 'Delete learning material',
      message: `Remove the link to ${material.title}? This does not delete any external file.`,
      confirmLabel: 'Delete link',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deleteMaterial(material.id);
      toast('Learning material removed.');
      await load();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to remove the material.', 'error');
    }
  };

  if (loading && items === null) return <Loading label="Loading learning materials…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <Card>
        <CardHeader
          title="Learning materials"
          description={canManage ? 'Publish links to readings, lecture notes and datasets. Only published items are visible to students.' : 'Materials published by your tutor.'}
          action={canManage ? <Button size="sm" onClick={openCreate}><Plus size={12} /> Add material</Button> : undefined}
        />
        {!items?.length ? (
          <EmptyState title="No learning materials" description={canManage ? 'Add a link to the course reading list or dataset.' : 'Your tutor has not published materials for this course yet.'} icon={<FileText size={20} />} />
        ) : (
          <ul className="divide-y divide-gray-50">
            {items.map((material) => (
              <li key={material.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[11px] font-semibold text-gray-800">{material.title}</p>
                    <Badge tone={material.isPublished ? 'green' : 'amber'}>{material.isPublished ? 'Published' : 'Draft'}</Badge>
                  </div>
                  {material.description && <p className="mt-0.5 max-w-3xl text-[10px] text-gray-500">{material.description}</p>}
                  <p className="mt-1 text-[9px] text-gray-400">
                    Added {formatDate(material.createdAt)} by {material.createdBy?.name ?? 'staff'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <a href={material.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[9px] font-semibold text-gray-600 hover:bg-gray-50">
                    Open <ExternalLink size={10} />
                  </a>
                  {canManage && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(material)} aria-label={`Edit ${material.title}`}><Pencil size={12} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => void remove(material)} aria-label={`Delete ${material.title}`}><Trash2 size={12} /></Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? 'Edit learning material' : 'Add learning material'}
        description="Only a link is stored. Upload files to institutional storage or the LMS and paste the controlled URL."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button form="material-form" type="submit" loading={saving}>Save material</Button>
          </>
        }
      >
        <form id="material-form" onSubmit={submit} className="space-y-3">
          <Field label="Title" htmlFor="material-title" required>
            <Input id="material-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
          </Field>
          <Field label="URL" htmlFor="material-url" hint="http(s) link only" required>
            <Input id="material-url" type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://…" required />
          </Field>
          <Field label="Description" htmlFor="material-description">
            <Textarea id="material-description" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-[11px] font-medium text-gray-700">
            <input type="checkbox" checked={form.isPublished} onChange={(event) => setForm({ ...form, isPublished: event.target.checked })} className="h-3.5 w-3.5 rounded border-gray-300" />
            Publish to enrolled students and notify them
          </label>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </>
  );
}
