import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HistoryRow, RewardResult } from "../types";
import platIcon from "../assets/plat.png";
import ducatIcon from "../assets/ducat.png";

export function DashboardPage() {
  const [history, setHistory]       = useState<HistoryRow[]>([]);
  const [status, setStatus]         = useState<string>("");
  const [loading, setLoading]       = useState(true);
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<string>("get_watcher_status").then(setStatus).catch(() => {});
    loadHistory();

    const unsub = listen<HistoryRow>("session-added", e => {
      setHistory(prev => [e.payload, ...prev]);
    });
    const unStatus = listen<boolean>("warframe-status", () => {
      invoke<string>("get_watcher_status").then(setStatus).catch(() => {});
    });
    return () => { unsub.then(f => f()); unStatus.then(f => f()); };
  }, []);

  function loadHistory() {
    setLoading(true);
    invoke<HistoryRow[]>("get_history", { limit: 50, offset: 0 })
      .then(setHistory).catch(() => {}).finally(() => setLoading(false));
  }

  async function handleDelete(id: number) {
    await invoke("delete_session", { id });
    setHistory(prev => prev.filter(r => r.id !== id));
  }

  function armClear() {
    if (clearArmed) {
      handleClearAll();
    } else {
      setClearArmed(true);
      clearTimer.current = setTimeout(() => setClearArmed(false), 3000);
    }
  }

  async function handleClearAll() {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setClearArmed(false);
    await invoke("clear_history");
    setHistory([]);
  }

  const isActive = status.startsWith("Active");

  return (
    <div className="max-w-[920px] flex flex-col gap-5 animate-fade-up">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[20px] font-bold tracking-wide" style={{ color: "#d4c4a0" }}>
            Dashboard
          </h1>
          <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "#3a4050" }}>
            Session History
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[5px] text-[11.5px]"
               style={{
                 background: "#0e1016",
                 border: "1px solid #1c1f27",
                 color: isActive ? "#52c27a" : "#5a6070",
               }}>
            <span
              className={isActive ? "animate-pulse-dot" : ""}
              style={{
                display: "inline-block", width: "6px", height: "6px", borderRadius: "50%",
                background: isActive ? "#52c27a" : "#3a4050",
                boxShadow: isActive ? "0 0 6px #52c27a80" : undefined,
                flexShrink: 0,
              }}
            />
            {status || "Checking…"}
          </div>

          {history.length > 0 && (
            <button
              onClick={armClear}
              className="text-[11px] px-3 py-1.5 rounded-[5px] border cursor-pointer transition-all duration-150"
              style={clearArmed
                ? { color: "#e05252", background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.3)" }
                : { color: "#4a5060", background: "transparent", border: "1px solid #1c1f27" }
              }
            >
              {clearArmed ? "Confirm?" : "Clear all"}
            </button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {loading && (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "#3a4050" }}>
          <span className="animate-pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-current" />
          Loading…
        </div>
      )}

      {!loading && history.length === 0 && <EmptyState />}

      {history.length > 0 && (
        <div className="flex flex-col" style={{ border: "1px solid #1c1f27", borderRadius: "8px", overflow: "hidden" }}>
          {/* Table header */}
          <div className="grid grid-cols-[150px_68px_1fr_28px] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.09em]"
               style={{ background: "#0e1016", color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            <span>Time</span>
            <span>Source</span>
            <span>Rewards</span>
            <span />
          </div>

          {history.map((row, ri) => {
            const rewards: RewardResult[] = (() => {
              try { return JSON.parse(row.rewards_json); } catch { return []; }
            })();
            const best = rewards.find(r => r.is_best);

            return (
              <div
                key={row.id}
                className="grid grid-cols-[150px_68px_1fr_28px] px-3 py-2.5 group items-start transition-colors duration-100"
                style={{
                  borderBottom: ri < history.length - 1 ? "1px solid #14171e" : undefined,
                  animation: `fade-up 200ms ease ${ri * 30}ms both`,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#0e1016")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                {/* Time */}
                <span className="text-[11px] pt-[3px] whitespace-nowrap tabular-nums" style={{ color: "#3a4050" }}>
                  {new Date(row.session_at).toLocaleString(undefined, {
                    month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>

                {/* Source badge */}
                <div className="pt-[3px]">
                  <SourceBadge source={row.source} />
                </div>

                {/* Rewards */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {rewards.map((r, i) => <RewardChip key={i} reward={r} />)}
                  </div>
                  {best?.best_reason && (
                    <span className="text-[9.5px]" style={{ color: "#4a5060" }}>
                      ★ {best.best_reason}
                    </span>
                  )}
                </div>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(row.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[11px] leading-none pt-[3px] text-center"
                  style={{ color: "#5a6070" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#e05252")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#5a6070")}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, { color: string; bg: string; border: string }> = {
    log:    { color: "#52c27a", bg: "rgba(82,194,122,0.1)",  border: "rgba(82,194,122,0.2)" },
    ocr:    { color: "#5284e0", bg: "rgba(82,132,224,0.1)",  border: "rgba(82,132,224,0.2)" },
    screen: { color: "#5284e0", bg: "rgba(82,132,224,0.1)",  border: "rgba(82,132,224,0.2)" },
    manual: { color: "#9a7a50", bg: "rgba(154,122,80,0.1)",  border: "rgba(154,122,80,0.2)" },
    test:   { color: "#7a8090", bg: "rgba(122,128,144,0.1)", border: "rgba(122,128,144,0.2)" },
  };
  const s = styles[source] ?? styles.test;
  return (
    <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] rounded-[3px]"
          style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      {source}
    </span>
  );
}

function RewardChip({ reward }: { reward: RewardResult }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-[4px] rounded-[4px] text-[11px]"
      style={{
        background: reward.is_best ? "rgba(196,154,60,0.08)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${reward.is_best ? "rgba(196,154,60,0.3)" : "#1c1f27"}`,
      }}
      title={`${reward.rarity}${reward.vaulted ? " · Vaulted" : ""}${reward.best_reason ? ` · ${reward.best_reason}` : ""}`}
    >
      <span style={{ color: reward.is_best ? "#d4c4a0" : "#5a6070" }}>
        {reward.item_name}
      </span>

      {reward.median_plat != null && (
        <div className="flex items-center gap-[3px]">
          <img src={platIcon} alt="" className="w-[9px] h-[9px] shrink-0 opacity-70" />
          <span className="font-semibold tabular-nums"
                style={{ color: reward.is_best ? "#e4d090" : "#7a8090" }}>
            {reward.median_plat}
          </span>
        </div>
      )}

      {reward.ducats > 0 && (
        <div className="flex items-center gap-[2px]">
          <img src={ducatIcon} alt="" className="w-[9px] h-[9px] shrink-0 opacity-70" />
          <span className="tabular-nums" style={{ color: reward.is_best ? "#d4953a" : "#5a6070" }}>
            {reward.ducats}
          </span>
        </div>
      )}

      {reward.vaulted && (
        <span className="text-[8px] font-bold uppercase px-[3px] py-[1px] rounded-[2px]"
              style={{ color: "#e07070", background: "rgba(224,80,80,0.1)", border: "1px solid rgba(224,80,80,0.2)" }}>
          V
        </span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-14 rounded-[8px] gap-4 animate-fade-in"
         style={{ background: "#0e1016", border: "1px solid #1c1f27" }}>
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[13px]" style={{ color: "#3a4050" }}>No sessions yet</span>
        <span className="text-[11px] text-center max-w-[260px]" style={{ color: "#2a3040" }}>
          Open Warframe and crack a relic — the overlay will appear automatically.
        </span>
      </div>
      <div className="flex items-center gap-4">
        <HotkeyHint label="manual scan" hotkey="F9" />
        <HotkeyHint label="dismiss overlay" hotkey="F10" />
      </div>
    </div>
  );
}

function HotkeyHint({ label, hotkey }: { label: string; hotkey: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <kbd className="text-[9px] font-mono px-1.5 py-0.5 rounded"
           style={{ color: "#3a4050", background: "rgba(255,255,255,0.03)", border: "1px solid #1c1f27" }}>
        {hotkey}
      </kbd>
      <span className="text-[10px]" style={{ color: "#2a3040" }}>{label}</span>
    </div>
  );
}
