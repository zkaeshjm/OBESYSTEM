import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: Toast['kind']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: Toast['kind'] = 'success') => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, kind, message }]);
      window.setTimeout(() => remove(id), 5000);
    },
    [remove]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`flex items-start gap-3 rounded-2xl border p-3.5 shadow-lg ${
              item.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : item.kind === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-gray-200 bg-white text-gray-800'
            }`}
          >
            {item.kind === 'success' ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            ) : item.kind === 'error' ? (
              <XCircle size={18} className="mt-0.5 shrink-0" />
            ) : (
              <Info size={18} className="mt-0.5 shrink-0" />
            )}
            <p className="flex-1 text-xs font-medium leading-relaxed">{item.message}</p>
            <button
              type="button"
              onClick={() => remove(item.id)}
              className="rounded-lg p-1 hover:bg-black/5"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
