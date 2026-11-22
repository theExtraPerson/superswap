"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

// Install tile using beforeinstallprompt (Chrome/Edge) + iOS hint.
export function InstallTile() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // One-time adoption of the platform's display-mode state (no event fires
    // when the app was already installed before this mount).
    if (window.matchMedia("(display-mode: standalone)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstalled(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <section className="rounded-2xl border border-[#1d2c55] bg-[#0d1733] p-4 text-center">
      <p className="text-2xl">📲</p>
      <h3 className="font-bold text-sm mt-1">Install SuperSwap (PWA)</h3>
      <p className="text-[11px] text-[#6b7fae] mt-1">
        Add it to your home screen — your wallet, vaults and history one tap away.
      </p>
      {deferred ? (
        <button
          onClick={async () => {
            deferred.prompt();
            await deferred.userChoice;
            setDeferred(null);
          }}
          className="mt-3 rounded-xl bg-[#f5b301] px-5 py-2 text-sm font-bold text-[#1a1400]"
        >
          Install app
        </button>
      ) : (
        <p className="mt-3 text-[11px] text-[#9fb3e8]">
          Browser menu → “Add to Home screen” / “Install app”.
        </p>
      )}
    </section>
  );
}
