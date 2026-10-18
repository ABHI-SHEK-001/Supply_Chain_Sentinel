import { useState, useEffect, useRef, useCallback } from 'react';

type AsyncFn<T> = (signal: AbortSignal) => Promise<T>;

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useApi<T>(fn: AsyncFn<T>, deps: unknown[] = []): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fn(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, loading, error, refetch };
}

export function usePolling<T>(
  fn: AsyncFn<T>,
  intervalMs: number,
  shouldPoll: boolean,
  deps: unknown[] = [],
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const poll = async () => {
      try {
        const result = await fn(controller.signal);
        if (mounted && !controller.signal.aborted) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (mounted && !controller.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
      if (mounted && shouldPoll && !controller.signal.aborted) {
        timerRef.current = setTimeout(poll, intervalMs);
      }
    };

    poll();

    return () => {
      mounted = false;
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPoll, intervalMs, tick, ...deps]);

  return { data, loading, error, refetch };
}
