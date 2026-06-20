import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { DevScanEvent, FileScanResult, LogWatcherEvent } from "../types";
import {
  REWARD_THRESHOLD,
  TMPL_X,
  TMPL_Y,
  TMPL_W,
  TMPL_H,
  REF_W,
  REF_H,
  DEFAULT_OCR_Y_MIN_PCT,
} from "../devConstants";

const MAX_ENTRIES = 40;

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ScanRow({
  e,
  expanded,
  onToggle,
}: {
  e: DevScanEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const scoreColor =
    e.sad_score === null
      ? "text-wf-muted"
      : e.template_matched
        ? "text-wf-success"
        : "text-wf-danger";

  return (
    <div className="border-b border-wf-border/40 last:border-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-1.5 flex items-center gap-3 font-mono text-[11px] hover:bg-wf-surface2 transition-colors cursor-pointer"
      >
        <span className="text-wf-muted w-[70px] shrink-0">{fmt(e.ts)}</span>
        <span className={`w-[90px] shrink-0 ${scoreColor}`}>
          SAD {e.sad_score !== null ? e.sad_score.toLocaleString() : "n/a"}
        </span>
        <span
          className={`w-[60px] shrink-0 ${e.template_matched ? "text-wf-success" : "text-wf-muted"}`}
        >
          {e.template_matched ? "match" : "miss"}
        </span>
        <span className="text-wf-muted w-[55px] shrink-0">
          {e.duration_ms}ms
        </span>
        {e.items_found.length > 0 && (
          <span className="text-wf-accent text-[10px]">
            {e.items_found.length} item{e.items_found.length !== 1 ? "s" : ""}
          </span>
        )}
        {e.ocr_lines.length > 0 && e.items_found.length === 0 && (
          <span className="text-wf-muted text-[10px]">
            {e.ocr_lines.length} lines, no match
          </span>
        )}
        {(expanded || e.ocr_lines.length > 0) && (
          <span className="ml-auto text-wf-muted text-[10px]">
            {expanded ? "hide" : "show"}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2 flex flex-col gap-1">
          {e.items_found.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {e.items_found.map((it, i) => (
                <span
                  key={i}
                  className="text-[10px] bg-wf-accent/15 text-wf-accent px-1.5 py-0.5 rounded"
                >
                  {it}
                </span>
              ))}
            </div>
          )}
          {e.ocr_lines.map((line, i) => (
            <div
              key={i}
              className="font-mono text-[10px] text-wf-muted leading-tight pl-2"
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScanDiagram({ ocrYMinPct }: { ocrYMinPct: number }) {
  const VW = 160,
    VH = 90;
  const tx = (TMPL_X / REF_W) * VW;
  const ty = (TMPL_Y / REF_H) * VH;
  const tw = (TMPL_W / REF_W) * VW;
  const th = (TMPL_H / REF_H) * VH;
  const oy = (ocrYMinPct / 100) * VH;
  const yMaxLine = 0.85 * VH; // mirrors y_max_frac=0.85 in ocr.rs

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-[160px] h-[90px] rounded border border-wf-border"
        style={{ background: "#0d0d0f" }}
      >
        {/* OCR active band */}
        <rect
          x={0}
          y={oy}
          width={VW}
          height={yMaxLine - oy}
          fill="rgba(82,130,224,0.12)"
          stroke="none"
        />
        <rect
          x={0}
          y={oy}
          width={VW}
          height={yMaxLine - oy}
          fill="none"
          stroke="#5284e0"
          strokeWidth="0.8"
        />
        {/* Template SAD region */}
        <rect
          x={tx}
          y={ty}
          width={tw}
          height={Math.max(th, 2)}
          fill="rgba(196,154,60,0.2)"
          stroke="#c49a3c"
          strokeWidth="0.8"
        />
        {/* Y-min line */}
        <line
          x1={0}
          y1={oy}
          x2={VW}
          y2={oy}
          stroke="#5284e0"
          strokeWidth="0.6"
          strokeDasharray="3,2"
        />
        <text x={2} y={oy - 1.5} fontSize="4" fill="#5284e0" opacity="0.7">
          {ocrYMinPct.toFixed(1)}%
        </text>
        {/* Y-max line */}
        <line
          x1={0}
          y1={yMaxLine}
          x2={VW}
          y2={yMaxLine}
          stroke="#5284e0"
          strokeWidth="0.6"
          strokeDasharray="3,2"
          opacity="0.5"
        />
        <text x={2} y={yMaxLine + 5} fontSize="4" fill="#5284e0" opacity="0.5">
          85%
        </text>
        <text
          x={tx + tw / 2}
          y={ty + 8}
          textAnchor="middle"
          fontSize="4"
          fill="#c49a3c"
        >
          SAD
        </text>
      </svg>
      <div className="flex flex-col gap-0.5 text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-wf-accent/40 border border-wf-accent shrink-0" />
          <span className="text-wf-muted">Template (SAD) - reward header</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-wf-info/20 border border-wf-info shrink-0" />
          <span className="text-wf-muted">OCR band (Y-min to 85%)</span>
        </div>
        <div className="text-wf-muted/60 mt-0.5">
          SAD threshold: {REWARD_THRESHOLD.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function PngScanner({ ocrYMin }: { ocrYMin: number }) {
  const [result, setResult] = useState<FileScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [overlaying, setOverlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState<string | null>(null);

  async function pick() {
    const path = await openDialog({
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
      multiple: false,
    });
    if (!path || typeof path !== "string") return;
    await runScan(path);
  }

  async function runScan(path: string) {
    setLastPath(path);
    setFileName(path.split(/[/\\]/).pop() ?? path);
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const r = await invoke<FileScanResult>("debug_scan_file", { path });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function showOverlay() {
    if (!lastPath) return;
    setOverlaying(true);
    try {
      await invoke("debug_overlay_from_file", { path: lastPath });
    } catch (e) {
      setError(String(e));
    } finally {
      setOverlaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-wf-muted uppercase text-[9px] tracking-widest font-semibold">
        Scan PNG
      </span>

      <button
        onClick={pick}
        disabled={loading}
        className="text-[11px] px-2 py-1 rounded border cursor-pointer transition-colors border-wf-border text-wf-muted hover:border-wf-accent/50 hover:text-wf-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Scanning" : "Pick image"}
      </button>

      {fileName && !loading && (
        <div className="text-[9px] text-wf-muted/60 truncate" title={fileName}>
          {fileName}
        </div>
      )}

      {error && (
        <div className="text-[10px] text-wf-danger leading-tight">{error}</div>
      )}

      {result && (
        <div className="flex flex-col gap-1.5">
          {/* DB status warning */}
          {result.db_item_count === 0 ? (
            <div className="text-[10px] text-wf-danger bg-wf-danger/10 border border-wf-danger/30 rounded px-2 py-1 leading-snug">
              DB not loaded yet, wait a moment and scan again
            </div>
          ) : (
            <div className="text-[9px] text-wf-muted/50">
              DB: {result.db_item_count.toLocaleString()} items
            </div>
          )}

          {/* Matched items */}
          <div>
            <div className="text-[9px] text-wf-muted uppercase tracking-wide mb-1">
              Matched ({result.matched_items.length})
            </div>
            {result.matched_items.length === 0 ? (
              <div className="text-[10px] text-wf-danger">No items matched</div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {result.matched_items.map((it, i) => (
                  <div
                    key={i}
                    className="text-[10px] text-wf-accent font-medium"
                  >
                    {it}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Show in overlay button */}
          {result.matched_items.length > 0 && (
            <button
              onClick={showOverlay}
              disabled={overlaying}
              className="text-[11px] px-2 py-1.5 rounded border cursor-pointer transition-colors border-wf-success/40 text-wf-success hover:bg-wf-success/10 hover:border-wf-success disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {overlaying ? "Opening" : "Show in overlay"}
            </button>
          )}

          {/* Raw OCR lines always visible */}
          <div>
            <div className="text-[9px] text-wf-muted uppercase tracking-wide mb-1">
              Raw OCR ({result.raw_lines.length} lines)
            </div>
            {result.raw_lines.length === 0 ? (
              <div className="text-[10px] text-wf-danger">
                No text read from image
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 pl-1 border-l border-wf-border/40 max-h-[90px] overflow-y-auto">
                {result.raw_lines.map((line, i) => (
                  <div
                    key={i}
                    className="font-mono text-[9px] text-wf-muted/80 leading-tight"
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="text-[9px] text-wf-muted/50 leading-relaxed mt-0.5">
        Y-min: {ocrYMin.toFixed(1)}%, Y-max: 100% (no clip in debug)
      </div>
    </div>
  );
}

const KIND_COLOR: Record<string, string> = {
  state:    "#3a4050",
  line:     "#5a6070",
  trigger:  "#c49a3c",
  debounce: "#e07840",
  reward:   "#52c27a",
  flush:    "#5284e0",
};

function LogWatcherMonitor() {
  const [events, setEvents]         = useState<LogWatcherEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<LogWatcherEvent>("log-watcher-event", e => {
      setEvents(prev => [...prev, e.payload].slice(-80));
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-wf-border/40 shrink-0">
        <span className="text-[9px] uppercase tracking-widest font-semibold text-wf-muted">EE.log</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(a => !a)}
            className="text-[9px] cursor-pointer transition-colors"
            style={{ color: autoScroll ? "#c49a3c" : "#3a4050" }}
            title="Toggle auto-scroll"
          >scroll</button>
          <button
            onClick={() => setEvents([])}
            className="text-[9px] text-wf-muted hover:text-wf-text cursor-pointer transition-colors"
          >clear</button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-[2px]">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[10px]" style={{ color: "#3a4050" }}>
            Waiting for EE.log…
          </div>
        ) : (
          events.map((ev, i) => (
            <div key={i} className="flex items-start gap-1.5 font-mono text-[10px] leading-tight">
              <span className="shrink-0" style={{ color: "#3a4050" }}>
                {new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className="shrink-0 w-[52px] text-right font-semibold" style={{ color: KIND_COLOR[ev.kind] ?? "#5a6070" }}>
                {ev.kind}
              </span>
              <span className="break-all" style={{ color: KIND_COLOR[ev.kind] ?? "#5a6070", opacity: ev.kind === "line" ? 0.65 : 1 }}>
                {ev.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function DevPanel() {
  const [entries, setEntries] = useState<DevScanEvent[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [ocrYMin, setOcrYMin] = useState(DEFAULT_OCR_Y_MIN_PCT);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<DevScanEvent>("dev-scan", (e) => {
      setEntries((prev) => [e.payload, ...prev].slice(0, MAX_ENTRIES));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const lastMatch = entries.find((e) => e.template_matched);

  return (
    <div className="shrink-0 border-t border-wf-accent/40 bg-wf-surface text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-wf-border/60">
        <span className="text-wf-accent font-semibold tracking-wide uppercase text-[10px]">
          Dev Mode
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-wf-accent shrink-0" />
        {lastMatch && (
          <span className="text-wf-muted">
            last match: {fmt(lastMatch.ts)}
            {lastMatch.items_found.length > 0 && (
              <>
                {" "}
                -{" "}
                <span className="text-wf-success">
                  {lastMatch.items_found.join(", ")}
                </span>
              </>
            )}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEntries([])}
            className="text-wf-muted hover:text-wf-text cursor-pointer transition-colors"
          >
            clear
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-wf-muted hover:text-wf-text cursor-pointer transition-colors px-1"
          >
            {collapsed ? "show" : "hide"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex" style={{ height: 300 }}>
          {/* Left column: diagram + threshold + PNG scanner */}
          <div className="w-[220px] shrink-0 p-3 border-r border-wf-border/60 flex flex-col gap-3 overflow-y-auto">
            <div className="flex flex-col gap-2">
              <span className="text-wf-muted uppercase text-[9px] tracking-widest font-semibold">
                Scan Regions
              </span>
              <ScanDiagram ocrYMinPct={ocrYMin} />
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-wf-muted">OCR Y-min</span>
                  <div className="flex items-center gap-1">
                    <span className="text-wf-text font-mono">
                      {ocrYMin.toFixed(2)}%
                    </span>
                    <button
                      onClick={() => {
                        setOcrYMin(DEFAULT_OCR_Y_MIN_PCT);
                        invoke("set_ocr_threshold", {
                          pct: DEFAULT_OCR_Y_MIN_PCT,
                        });
                      }}
                      className="text-wf-muted hover:text-wf-accent cursor-pointer transition-colors ml-1"
                      title="Reset to default"
                    >
                      reset
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="80"
                  step="0.5"
                  value={ocrYMin}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setOcrYMin(v);
                    invoke("set_ocr_threshold", { pct: v });
                  }}
                  className="w-full accent-wf-accent cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-wf-muted/60">
                  <span>0%</span>
                  <span>default {DEFAULT_OCR_Y_MIN_PCT.toFixed(1)}%</span>
                  <span>80%</span>
                </div>
              </div>
            </div>

            <div className="border-t border-wf-border/40 pt-3">
              <PngScanner ocrYMin={ocrYMin} />
            </div>
          </div>

          {/* Middle column: EE.log monitor */}
          <div className="w-[260px] shrink-0 border-r border-wf-border/60">
            <LogWatcherMonitor />
          </div>

          {/* Right column: live OCR scan events */}
          <div ref={logRef} className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-wf-muted text-[11px]">
                Waiting for scans… (Warframe must be running)
              </div>
            ) : (
              entries.map((e, i) => (
                <ScanRow
                  key={e.ts + i}
                  e={e}
                  expanded={expanded === i}
                  onToggle={() => setExpanded((x) => (x === i ? null : i))}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
