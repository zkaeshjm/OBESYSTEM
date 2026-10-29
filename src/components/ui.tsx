import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, ChevronDown, Loader2, X } from 'lucide-react';
import type { AttainmentStatus } from '../api/types';

/* --------------------------------- Button -------------------------------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-gray-900 text-white hover:bg-gray-800 border border-gray-900',
    secondary: 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50',
    ghost: 'bg-transparent text-gray-600 border border-transparent hover:bg-gray-100',
    danger: 'bg-rose-600 text-white border border-rose-600 hover:bg-rose-700',
    success: 'bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700',
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/30 disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2.5 text-xs'
      } ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------------------------------- Card --------------------------------- */
export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag className={`rounded-3xl border border-gray-200/90 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)] ${className}`}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
      <div>
        <h2 className="text-sm font-bold tracking-tight text-gray-900">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] text-gray-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------- PageHeader ------------------------------ */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-xs text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* --------------------------------- Fields -------------------------------- */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-[11px] font-semibold text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[10px] text-gray-400">{hint}</p>}
      {error && (
        <p role="alert" className="text-[10px] font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

const controlClass =
  'w-full rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-xs font-medium text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-900/5 disabled:opacity-60';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlClass} ${className}`} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${controlClass} appearance-none pr-8 ${className}`}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', rows = 4, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} rows={rows} className={`${controlClass} ${className}`} />;
}

/* ---------------------------------- Modal -------------------------------- */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }, 30);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 backdrop-blur-[2px] sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        className={`my-6 w-full ${widths[size]} rounded-3xl border border-gray-200 bg-white shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-sm font-bold text-gray-900">
              {title}
            </h2>
            {description && <p className="mt-1 text-[11px] text-gray-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/* ----------------------------- Confirm Dialog ---------------------------- */
const ConfirmContext = createContext<
  ((options: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>) | null
>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = (options: { title: string; message: string; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => setRequest({ ...options, resolve }));

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(request)}
        title={request?.title ?? 'Confirm'}
        onClose={() => {
          request?.resolve(false);
          setRequest(null);
        }}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                request?.resolve(false);
                setRequest(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={request?.danger ? 'danger' : 'primary'}
              onClick={() => {
                request?.resolve(true);
                setRequest(null);
              }}
            >
              {request?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-50 p-2 text-amber-600">
            <AlertTriangle size={18} />
          </div>
          <p className="text-xs leading-relaxed text-gray-600">{request?.message}</p>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider');
  return context;
}

/* --------------------------------- Badges -------------------------------- */
export function Badge({
  children,
  tone = 'gray',
  className = '',
}: {
  children: ReactNode;
  tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';
  className?: string;
}) {
  const tones = {
    gray: 'bg-gray-100 text-gray-600 border-gray-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function statusTone(status: AttainmentStatus | string): 'green' | 'amber' | 'red' | 'gray' {
  if (status === 'MET' || status === 'APPROVED' || status === 'ENROLLED' || status === 'GRADED' || status === 'COMPLETED' || status === 'DELIVERED' || status === 'ACTIVE') return 'green';
  if (status === 'AT_RISK' || status === 'PENDING' || status === 'IN_PROGRESS' || status === 'LATE' || status === 'SUBMITTED' || status === 'PLANNED') return 'amber';
  if (status === 'NOT_MET' || status === 'REJECTED' || status === 'DROPPED' || status === 'WITHDRAWN' || status === 'ARCHIVED' || status === 'FAILED' || status === 'CLOSED') return 'red';
  return 'gray';
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replaceAll('_', ' ')}</Badge>;
}

/* ----------------------------- States ----------------------------------- */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-14 text-xs font-medium text-gray-400">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 px-6 py-10 text-center">
      <AlertTriangle size={22} className="text-rose-500" />
      <p className="max-w-md text-xs font-medium text-rose-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 rounded-2xl bg-gray-50 p-3 text-gray-400">{icon}</div>}
      <p className="text-sm font-semibold text-gray-800">{title}</p>
      {description && <p className="max-w-md text-[11px] leading-relaxed text-gray-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ------------------------------- StatCard -------------------------------- */
export function StatCard({
  label,
  value,
  detail,
  icon,
  tone = 'gray',
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon?: ReactNode;
  tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-rose-50 text-rose-700',
    blue: 'bg-blue-50 text-blue-700',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900">{value}</p>
          {detail && <p className="mt-1 text-[10px] text-gray-500">{detail}</p>}
        </div>
        {icon && <div className={`rounded-xl p-2 ${tones[tone]}`}>{icon}</div>}
      </div>
    </Card>
  );
}

/* -------------------------------- Progress ------------------------------- */
export function ProgressBar({ value, tone = 'green' }: { value: number; tone?: 'green' | 'amber' | 'red' | 'blue' }) {
  const tones = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', blue: 'bg-blue-500' };
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* --------------------------------- Tabs ---------------------------------- */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-2xl border border-gray-200 bg-white p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
            value === tab.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 opacity-70">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Select -------------------------------- */
export function InlineSelect({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative inline-flex items-center">
      <select
        {...props}
        className={`appearance-none rounded-full border border-gray-200 bg-white py-1.5 pl-3 pr-7 text-[11px] font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-gray-900/10 ${className}`}
      >
        {children}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2.5 text-gray-400" aria-hidden />
    </div>
  );
}
