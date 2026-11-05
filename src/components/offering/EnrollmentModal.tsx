import { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { Enrollment, StudentProfile } from '../../api/types';
import { Badge, Button, EmptyState, Field, Input, Loading, Modal, useConfirm } from '../ui';

export function EnrollmentModal({
  open,
  offeringId,
  existing,
  onClose,
  onChanged,
  onError,
}: {
  open: boolean;
  offeringId: string;
  existing: Enrollment[];
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    api
      .students({ limit: 100 })
      .then((response) => {
        if (active) setStudents(response.data);
      })
      .catch((error) => {
        if (active) onError(error instanceof ApiError ? error.message : 'Unable to load students.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, onError]);

  const enrolledIds = useMemo(() => new Set(existing.filter((item) => item.status === 'ENROLLED').map((item) => item.studentId)), [existing]);
  const available = students.filter((student) => !enrolledIds.has(student.id));
  const filtered = available.filter((student) =>
    `${student.rollNo} ${student.user?.name ?? ''} ${student.user?.email ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );

  const enroll = async () => {
    if (selected.length === 0) return;
    const confirmed = await confirm({
      title: 'Enrol students',
      message: `Enrol ${selected.length} student(s) in this offering? They will be notified and their evidence will count toward attainment.`,
      confirmLabel: 'Enrol students',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await api.enroll(offeringId, selected);
      setSelected([]);
      onChanged();
      onClose();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Unable to enrol students.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Enrol students"
      description="Only active students can be enrolled. Duplicate enrolments are prevented by the database."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => void enroll()} loading={saving} disabled={selected.length === 0}>
            <UserPlus size={14} /> Enrol {selected.length || ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Search students" htmlFor="enrol-search">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
            <Input id="enrol-search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Roll number or name" />
          </div>
        </Field>

        {loading ? (
          <Loading label="Loading students…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={available.length ? 'No matching students' : 'All eligible students are enrolled'}
            description={available.length ? 'Adjust the search to find a student.' : 'Create student accounts in Users & students to add more.'}
          />
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {filtered.map((student) => (
              <li key={student.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-gray-100 px-3 py-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(student.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id)
                      )
                    }
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  <span className="flex-1">
                    <span className="block text-[11px] font-semibold text-gray-800">{student.user?.name}</span>
                    <span className="block text-[9px] text-gray-400">{student.rollNo} · {student.program?.code}</span>
                  </span>
                  {student.batch && <Badge>Batch {student.batch}</Badge>}
                </label>
              </li>
            ))}
          </ul>
        )}

        {existing.length > 0 && (
          <div className="rounded-2xl bg-gray-50 p-3">
            <p className="mb-1.5 text-[10px] font-bold text-gray-700">Currently enrolled ({enrolledIds.size})</p>
            <div className="flex flex-wrap gap-1">
              {existing.filter((item) => item.status === 'ENROLLED').map((item) => (
                <Badge key={item.id} tone="green">{item.student?.rollNo}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
