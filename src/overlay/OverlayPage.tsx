import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { OverlayPayload } from "../types";
import { RewardCard } from "./RewardCard";

const NO_RESULTS_MS = 3_000;
type Mode = "rewards" | "no-results" | "loading";

export function OverlayPage() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [mode, setMode]       = useState<Mode>("loading");
  const [timeLeft, setTimeLeft] = useState(15_000);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function dismiss() {
    invoke("dismiss_overlay").catch(() => {});
  }

  function scheduleTimer(ms: number) {
    if (timerRef.current)   clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setTimeLeft(ms);
    timerRef.current = setTimeout(dismiss, ms);
    intervalRef.current = setInterval(() => {
      setTimeLeft(t => Math.max(0, t - 200));
    }, 200);
  }

  useEffect(() => {
    const unData = listen<OverlayPayload>("overlay-data", e => {
      setPayload(e.payload);
      setMode("rewards");
      scheduleTimer((e.payload.auto_dismiss_secs ?? 15) * 1000);
    });
    const unNoResults = listen("overlay-no-results", () => {
      setPayload(null);
      setMode("no-results");
      scheduleTimer(NO_RESULTS_MS);
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);

    return () => {
      unData.then(f => f());
      unNoResults.then(f => f());
      window.removeEventListener("keydown", onKey);
      if (timerRef.current)   clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode === "loading") return null;

  if (mode === "no-results") {
    return (
      <div className="flex items-center justify-center h-screen animate-fade-in">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-[6px] text-[12px]"
             style={{ background: "rgba(10,12,16,0.88)", border: "1px solid rgba(255,255,255,0.07)", color: "#6a7080" }}>
          No relics detected
        </div>
      </div>
    );
  }

  if (!payload) return null;

  const secs = Math.ceil(timeLeft / 1000);
  const pct  = timeLeft / ((payload.auto_dismiss_secs ?? 15) * 1000);

  return (
    <div className="flex flex-col h-screen">
      {/* Cards row */}
      <div className="flex items-stretch gap-[6px] px-[6px] pt-[6px] flex-1 min-h-0">
        {payload.rewards.map((reward, i) => (
          <RewardCard
            key={i}
            reward={reward}
            index={i}
            needed={(payload.needed_items ?? []).includes(reward.item_name)}
          />
        ))}
      </div>

      {/* Dismiss strip */}
      <div className="flex items-center gap-2 px-[8px] pb-[5px] pt-[3px] animate-fade-in"
           style={{ animationDelay: "350ms" }}>
        {/* Progress bar */}
        <div className="flex-1 h-[1.5px] rounded-full overflow-hidden"
             style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full rounded-full transition-all duration-200"
               style={{ width: `${pct * 100}%`, background: "rgba(196,154,60,0.4)" }} />
        </div>

        <button
          onClick={dismiss}
          className="flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-100"
          style={{ opacity: 0.45 }}
          title="Dismiss"
        >
          <kbd className="text-[9px] font-mono px-1 py-0.5 rounded text-white/50"
               style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}>
            {payload.dismiss_hotkey}
          </kbd>
          <span className="text-[9px] text-white/40 tabular-nums">{secs}s</span>
        </button>
      </div>
    </div>
  );
}
