import { readConfig } from "./config";

interface MinimalAudioContext {
  currentTime: number;
  destination: unknown;
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

/**
 * Plays a subtle, pleasant two-note completion chime using the Web Audio API.
 * Safe in headless/test environments and requires zero external audio assets.
 */
export function playCompletionChime(force = false): boolean {
  if (typeof window === "undefined") return false;
  if (!force) {
    const config = readConfig();
    if (!config.notificationPrefs?.completionChime) return false;
  }

  const win = window as unknown as {
    AudioContext?: new () => MinimalAudioContext;
    webkitAudioContext?: new () => MinimalAudioContext;
  };
  const AudioCtor = win.AudioContext ?? win.webkitAudioContext;
  if (!AudioCtor) return false;

  try {
    const ctx = new AudioCtor();
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

    if (typeof ctx.close === "function") {
      setTimeout(() => {
        void ctx.close?.().catch(() => undefined);
      }, 450);
    }
    return true;
  } catch {
    return false;
  }
}
