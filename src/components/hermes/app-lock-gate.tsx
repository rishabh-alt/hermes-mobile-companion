import { useEffect, useState, type ReactNode } from "react";
import { Fingerprint, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptic } from "@/lib/hermes/haptics";
import {
  getPinLockoutRemainingMs,
  isAppCurrentlyLocked,
  lockAppNow,
  readAppLockRecord,
  unlockWithBiometric,
  verifyAndUnlockPin,
} from "@/lib/hermes/app-lock";

export function AppLockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => isAppCurrentlyLocked());
  const [pin, setPin] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const record = readAppLockRecord();

  useEffect(() => {
    const sync = () => setLocked(isAppCurrentlyLocked());
    window.addEventListener("hermes-applock-change", sync);
    window.addEventListener("storage", sync);
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
        lockAppNow();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("hermes-applock-change", sync);
      window.removeEventListener("storage", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!locked) return <>{children}</>;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setErrorText(null);
    const remainingMs = getPinLockoutRemainingMs();
    if (remainingMs > 0) {
      haptic("error");
      setErrorText(
        `Too many failed attempts. Try again in ${Math.ceil(remainingMs / 1000)}s or use biometrics.`,
      );
      return;
    }
    if (verifyAndUnlockPin(pin)) {
      setPin("");
      haptic("done");
    } else {
      haptic("error");
      const nextLockoutMs = getPinLockoutRemainingMs();
      setErrorText(
        nextLockoutMs > 0
          ? `Too many failed attempts. Locked for ${Math.ceil(nextLockoutMs / 1000)}s.`
          : "Incorrect PIN. Try again.",
      );
    }
  };

  return (
    <div className="flex h-[100dvh] w-full flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-xs space-y-5 rounded-3xl border border-border/70 bg-secondary/30 p-6 text-center shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Lock className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-base font-semibold">Hermes Console Locked</h1>
          <p className="text-xs text-muted-foreground">
            Enter your PIN to access your headless PC console.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–8 digit PIN"
            className="text-center font-mono text-base tracking-widest"
          />
          {errorText && <p className="text-xs text-destructive">{errorText}</p>}
          <Button type="submit" className="w-full" disabled={pin.trim().length < 4}>
            Unlock
          </Button>
        </form>

        {record?.biometricCredentialId && (
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 text-xs"
            onClick={async () => {
              setErrorText(null);
              const ok = await unlockWithBiometric();
              if (ok) {
                haptic("done");
              } else {
                haptic("error");
                setErrorText("Biometric verification cancelled or failed.");
              }
            }}
          >
            <Fingerprint className="h-4 w-4 text-primary" />
            Unlock with Biometrics
          </Button>
        )}
      </div>
    </div>
  );
}
