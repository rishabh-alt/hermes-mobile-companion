import { useEffect, useRef, useState } from "react";
import { HermesRpc, type RpcState } from "./rpc";
import type { HermesConfig } from "./types";

/**
 * Keeps one live gateway connection per configured Hermes address, so chat can
 * stream over the same channel Hermes Desktop uses.
 */
export function useHermesRpc(config: HermesConfig, enabled: boolean) {
  const ref = useRef<HermesRpc | null>(null);
  const [state, setState] = useState<RpcState>("idle");

  const key = `${config.baseUrl}|${config.token}|${config.activeProfile}|${config.profilePathPrefix}|${enabled ? "on" : "off"}`;

  useEffect(() => {
    if (!enabled || !config.baseUrl.trim()) {
      ref.current?.close();
      ref.current = null;
      setState("idle");
      return;
    }
    const rpc = new HermesRpc(config);
    ref.current = rpc;
    const off = rpc.onStateChange(setState);
    rpc.connect();
    return () => {
      off();
      rpc.close();
      if (ref.current === rpc) ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { rpc: ref, state };
}
