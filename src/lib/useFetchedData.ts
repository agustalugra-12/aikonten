import { useEffect, useMemo, useRef, useState } from "react";

// Data fetching helper yg menghindari pola "setState synchronous di dalam effect" yg
// dilaporkan eslint-plugin-react-hooks (react-hooks/set-state-in-effect). Loading
// di-derive dari key dependency, bukan di-set synchronous saat effect jalan.
type FetchState<T> = { key: string; data: T | null; error: string | null } | null;

export function useFetchedData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[]
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const key = JSON.stringify(deps);
  const [result, setResult] = useState<FetchState<T>>(null);
  const [refetchNonce, setRefetchNonce] = useState(0);
  const depKey = useMemo(() => JSON.stringify([key, refetchNonce]), [key, refetchNonce]);

  const resultRef = useRef(result);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    resultRef.current = result;
    fetcherRef.current = fetcher;
  }, [result, fetcher]);

  useEffect(() => {
    if (resultRef.current && resultRef.current.key === depKey) return;
    let cancelled = false;
    fetcherRef
      .current()
      .then((d) => {
        if (!cancelled) setResult({ key: depKey, data: d, error: null });
      })
      .catch((err) => {
        if (!cancelled)
          setResult({
            key: depKey,
            data: null,
            error: err instanceof Error ? err.message : String(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [depKey]);

  const data = result?.key === depKey ? result.data : null;
  const error = result?.key === depKey ? result.error : null;
  const loading = !result || result.key !== depKey;

  return {
    data,
    loading,
    error,
    refetch: () => setRefetchNonce((n) => n + 1),
  };
}
