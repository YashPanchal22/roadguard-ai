import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../services/api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorCode?: string;
  hints: string[];
  reload: () => void;
}

/**
 * Run an async loader and expose loading / error / data plus a reload trigger.
 * The loader identity is compared by its dependency list, not by reference.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], options?: { enabled?: boolean }): AsyncState<T> {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [hints, setHints] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setErrorCode(undefined);
        setHints([]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const described = describeError(err);
        setError(described.message);
        setErrorCode(described.code);
        setHints(described.hints);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, loading, error, errorCode, hints, reload };
}
