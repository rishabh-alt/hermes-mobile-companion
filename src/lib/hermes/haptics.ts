import { readConfig } from "./config";

type Pattern = "tap" | "send" | "done" | "error";

const patterns: Record<Pattern, number | number[]> = {
  tap: 8,
  send: 12,
  done: [10, 40, 14],
  error: [24, 60, 24],
};

/**
 * Vibration on the web, and picked up automatically by Capacitor's
 * Haptics plugin bridge on Android when packaged.
 */
export function haptic(pattern: Pattern = "tap") {
  if (typeof window === "undefined") return;
  try {
    if (!readConfig().haptics) return;
    const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (native?.isNativePlatform?.()) {
      void import("@capacitor/haptics")
        .then(({ Haptics, ImpactStyle, NotificationType }) => {
          if (pattern === "done") return Haptics.notification({ type: NotificationType.Success });
          if (pattern === "error") return Haptics.notification({ type: NotificationType.Error });
          return Haptics.impact({
            style: pattern === "send" ? ImpactStyle.Medium : ImpactStyle.Light,
          });
        })
        .catch(() => undefined);
      return;
    }
    navigator.vibrate?.(patterns[pattern]);
  } catch {
    /* vibration unsupported */
  }
}
