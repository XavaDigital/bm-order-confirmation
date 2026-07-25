'use client';

/**
 * Shared load-on-mount hook for admin views that fetch a single JSON resource:
 * `useState(data/loading)` + `useEffect(load)` + `getJson` + error handling +
 * manual `reload()` were previously copy-pasted per view.
 *
 * Error handling comes in two flavours, matching the two existing patterns:
 *   - `toast: true` (default) — antd `message.error(errorMessage)` toast
 *     (SizeChartsView / UsersView / GarmentTypesView). Requires an `<App>`
 *     ancestor, like any `App.useApp()` consumer.
 *   - `toast: false` — no toast; the view renders the returned `error` string
 *     inline (AuditLogTab / RosterPanel alert pattern).
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { App } from 'antd';
import { getJson } from '@/lib/api-fetch';

interface Options {
  errorMessage: string;
  /** Show an antd message toast on load failure (default true). */
  toast?: boolean;
}

export function useAdminResource<T>(
  url: string,
  { errorMessage, toast = true }: Options,
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setData: Dispatch<SetStateAction<T | null>>;
} {
  const { message } = App.useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getJson<T>(url, errorMessage));
    } catch {
      setError(errorMessage);
      if (toast) message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [url, errorMessage, toast, message]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load, setData };
}
