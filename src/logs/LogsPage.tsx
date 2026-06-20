import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { LogEntry } from "../types";

const MAX_ENTRIES = 500;

const LEVEL_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  info:  { color: "#7a8090", bg: "transparent",            label: "INFO" },
  warn:  { color: "#c49a3c", bg: "rgba(196,154,60,0.06)",  label: "WARN" },
  error: { color: "#e05252", bg: "rgba(224,82,82,0.06)",   label: "ERR" },
};

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const unsub = listen<LogEntry>("app-log", e => {
      setEntries(prev => {
        const next = [...prev, e.payload];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    });
    return () => { unsub.then(f => f()); };
  }, []);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, autoScroll]);

  function formatTime(ts: number) {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return (
    <div className="flex flex-col h-full gap-4 animate-fade-up">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[20px] font-bold tracking-wide" style={{ color: "#d4c4a0" }}>Logs</h1>
          <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "#3a4050" }}>
            Live Activity
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoScroll(v => !v)}
            className="text-[11px] px-3 py-1.5 rounded-[5px] border cursor-pointer transition-all duration-150"
            style={autoScroll
              ? { color: "#52c27a", background: "rgba(82,194,122,0.08)", border: "1px solid rgba(82,194,122,0.25)" }
              : { color: "#4a5060", background: "transparent", border: "1px solid #1c1f27" }
            }
          >
            {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
          </button>
          <button
            onClick={() => setEntries([])}
            className="text-[11px] px-3 py-1.5 rounded-[5px] border cursor-pointer transition-all"
            style={{ color: "#4a5060", background: "transparent", border: "1px solid #1c1f27" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#e05252"; e.currentTarget.style.borderColor = "rgba(224,82,82,0.3)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#4a5060"; e.currentTarget.style.borderColor = "#1c1f27"; }}
          >
            Clear
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto font-mono text-[11.5px] rounded-[8px] min-h-0"
        style={{ background: "#0a0c10", border: "1px solid #1c1f27" }}
      >
        {entries.length === 0 && (
          <div className="flex items-center justify-center h-full" style={{ color: "#2a3040" }}>
            Waiting for activity…
          </div>
        )}

        {entries.map((e, i) => {
          const s = LEVEL_STYLE[e.level] ?? LEVEL_STYLE.info;
          return (
            <div
              key={i}
              className="flex items-baseline gap-3 px-4 py-[4px] border-b"
              style={{
                background: s.bg,
                borderColor: "#12141a",
                animation: i === entries.length - 1 ? "fade-in 120ms ease both" : undefined,
              }}
            >
              <span className="shrink-0 tabular-nums" style={{ color: "#3a4050" }}>
                {formatTime(e.ts)}
              </span>
              <span
                className="shrink-0 text-[9px] font-bold uppercase tracking-[0.1em] w-[30px] text-right"
                style={{ color: s.color }}
              >
                {s.label}
              </span>
              <span style={{ color: s.color === "#7a8090" ? "#9a9fa8" : s.color, wordBreak: "break-word" }}>
                {e.msg}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
