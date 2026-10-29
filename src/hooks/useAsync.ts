import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const load = useCallback(async () => {
    const requestVersion = ++version.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loader();
      if (requestVersion === version.current) setData(result);
    } catch (caught) {
      if (requestVersion === version.current) {
        setError(caught instanceof ApiError ? caught.message : 'Unable to load this data.');
      }
    } finally {
      if (requestVersion === version.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load, setData };
}

export function formatDate(value?: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function inputDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

export function formatPct(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(1)}%`;
}

export function roleLabel(role?: string) {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'TUTOR') return 'Tutor';
  if (role === 'STUDENT') return 'Student';
  return role ?? '';
}
