import { useCallback, useEffect, useRef, useState } from "react";
import { useHermesConfig } from "./config";
import { HermesError } from "./client";
import type { HermesConfig } from "./types";

export type GatewayState<T> = {
  data: T | null;
  loading: boolean;
  /** Set when the gateway simply doesn't offer this feature. */
  unavailable: boolean;
  error: string | null;
  configured: boolean;
  refresh: () => void;
  config: HermesConfig;
};

/**
 * Reads something from the connected Hermes gateway, with a clean
 * "not available on this gateway" state instead of an error.
 */
export function useGateway<T>(
  loader: (config: HermesConfig) => Promise<T>,
  deps: unknown[] = [],
): GatewayState<T> {
  const { config, ready, configured } = useHermesConfig();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!ready || !configured) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUnavailable(false);
    loaderRef
      .current(config)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof HermesError && err.status === 404) setUnavailable(true);
        else setError(err instanceof Error ? err.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The caller-owned dependency list intentionally extends the stable config key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, configured, config, nonce, ...deps]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, unavailable, error, configured, refresh, config };
}
