import { readConfig } from "./config";

interface MinimalAudioContext {
  state?: "suspended" | "running" | "closed" | string;
  currentTime: number;
  destination: unknown;
  resume?: () => Promise<void>;
  createOscillator: () => {
    type: string;
    frequency: { setValueAtTime: (value: number, time: number) => void };
    connect: (target: unknown) => void;
    start: (when?: number) => void;
    stop: (when?: number) => void;
  };
  createGain: () => {
    gain: {
      setValueAtTime: (value: number, time: number) => void;
      exponentialRampToValueAtTime: (value: number, time: number) => void;
    };
    connect: (target: unknown) => void;
  };
  close?: () => Promise<void>;
}

let sharedContext: MinimalAudioContext | null = null;
let gestureListenersInstalled = false;

function getAudioConstructor(): (new () => MinimalAudioContext) | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as {
    AudioContext?: new () => MinimalAudioContext;
    webkitAudioContext?: new () => MinimalAudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext;
}

function getOrCreateAudioContext(): MinimalAudioContext | null {
  const AudioCtor = getAudioConstructor();
  if (!AudioCtor) return null;
  if (sharedContext && sharedContext.state !== "closed") {
    return sharedContext;
  }
  try {
    sharedContext = new AudioCtor();
    return sharedContext;
  } catch {
    return null;
  }
}

export function resetCompletionChimeAudioForTest(): void {
  sharedContext = null;
  gestureListenersInstalled = false;
}

export function unlockAudioContextOnGesture(): void {
  if (typeof window === "undefined" || gestureListenersInstalled) return;
  if (typeof window.addEventListener !== "function") return;
  gestureListenersInstalled = true;

  const unlock = () => {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === "suspended" && typeof ctx.resume === "function") {
      void ctx.resume().catch(() => undefined);
    }
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

// Install gesture listeners eagerly in browser environments so the shared AudioContext
// is unlocked on the user's first tap/keypress before a background turn finishes.
unlockAudioContextOnGesture();

/**
 * Plays a subtle, pleasant two-note completion chime using a shared Web Audio API context.
 * Safe in headless/test environments and requires zero external audio assets.
 */
export function playCompletionChime(force = false): boolean {
  if (typeof window === "undefined") return false;
  if (!force) {
    const config = readConfig();
    if (!config.notificationPrefs?.completionChime) return false;
  }

  unlockAudioContextOnGesture();
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      void ctx.resume().catch(() => undefined);
    }

    const now = ctx.currentTime;
    const notes: Array<[number, number, number]> = [
      [587.33, 0, 0.14], // D5
      [880.0, 0.11, 0.22], // A5
    ];

    for (const [freq, offset, duration] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.08, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + duration);
    }

    return true;
  } catch {
    return false;
  }
}
