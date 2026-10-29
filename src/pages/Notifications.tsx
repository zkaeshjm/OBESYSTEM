import { useState, type FormEvent } from 'react';
import { Bell, CheckCheck, Megaphone, Send } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
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
  Tabs,
  Textarea,
} from '../components/ui';

export default function Notifications() {
  const { permissions } = useAuth();
  const { toast } = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [role, setRole] = useState('ALL');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const query = useAsync(() => api.notifications({ limit: 50, unreadOnly: unreadOnly ? 'true' : undefined }), [unreadOnly]);

  const notifications = query.data?.data ?? [];
  const unread = query.data?.meta.unread ?? 0;

  const markRead = async (id: string) => {
    try {
      await api.markRead(id);
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to update the notification.', 'error');
    }
  };

  const markAll = async () => {
    try {
      await api.markAllRead();
      toast('All notifications marked as read.');
      await query.reload();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Unable to update notifications.', 'error');
    }
  };

  const sendBroadcast = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!title.trim() || !body.trim()) {
      setFormError('A title and message are required.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { title: title.trim(), body: body.trim() };
      if (role !== 'ALL') payload.role = role;
      await api.broadcast(payload);
      toast('Notification delivered to the selected recipients.');
      setBroadcastOpen(false);
      setTitle('');
      setBody('');
      setRole('ALL');
      await query.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Unable to send the notification.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Database-backed notifications with per-recipient access control. Delivery state is shown exactly as stored."
        actions={
          <div className="flex gap-2">
            {unread > 0 && (
              <Button variant="secondary" onClick={() => void markAll()}>
                <CheckCheck size={14} /> Mark all read
              </Button>
            )}
            {permissions?.manageNotifications && (
              <Button onClick={() => setBroadcastOpen(true)}>
                <Megaphone size={14} /> Send announcement
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread', count: unread },
          ]}
          value={unreadOnly ? 'unread' : 'all'}
          onChange={(value) => setUnreadOnly(value === 'unread')}
        />
        <Badge tone={unread ? 'red' : 'gray'}>{unread} unread</Badge>
      </div>

      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            description="Assessment publications, deadline reminders, grade releases and enrolment changes appear here."
            icon={<Bell size={20} />}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <Card key={notification.id} className={`p-4 ${notification.readAt ? '' : 'border-blue-200 bg-blue-50/30'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[11px] font-bold text-gray-900">{notification.title}</p>
                    <Badge tone="purple">{notification.type.replaceAll('_', ' ')}</Badge>
                    <Badge tone={notification.deliveryStatus === 'DELIVERED' ? 'green' : notification.deliveryStatus === 'FAILED' ? 'red' : 'amber'}>
                      {notification.deliveryStatus}
                    </Badge>
                    {!notification.readAt && <Badge tone="red">Unread</Badge>}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{notification.body}</p>
                  <p className="mt-1.5 text-[9px] text-gray-400">
                    {new Date(notification.createdAt).toLocaleString()}
                    {notification.deliveredAt ? ` · delivered ${new Date(notification.deliveredAt).toLocaleString()}` : ' · not yet delivered'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {notification.link && (
                    <a href={notification.link} className="rounded-full border border-gray-200 px-2.5 py-1 text-[9px] font-semibold text-gray-600 hover:bg-white">
                      Open
                    </a>
                  )}
                  {!notification.readAt && (
                    <Button size="sm" variant="secondary" onClick={() => void markRead(notification.id)}>Mark read</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={broadcastOpen}
        title="Send an announcement"
        description="Recipients are resolved on the server. Delivery is in-app only and is recorded as delivered when persisted."
        onClose={() => setBroadcastOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBroadcastOpen(false)}>Cancel</Button>
            <Button form="broadcast-form" type="submit" loading={saving}><Send size={13} /> Send</Button>
          </>
        }
      >
        <form id="broadcast-form" onSubmit={sendBroadcast} className="space-y-3">
          <Field label="Title" htmlFor="broadcast-title" required>
            <Input id="broadcast-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </Field>
          <Field label="Message" htmlFor="broadcast-body" required>
            <Textarea id="broadcast-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} required />
          </Field>
          <Field label="Recipients" htmlFor="broadcast-role">
            <Select id="broadcast-role" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="ALL">All active accounts</option>
              <option value="ADMIN">Administrators</option>
              <option value="TUTOR">Tutors</option>
              <option value="STUDENT">Students</option>
            </Select>
          </Field>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[11px] font-medium text-rose-700">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
