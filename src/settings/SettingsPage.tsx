import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import type { Settings, ItemLookupResult } from "../types";
import platIcon from "../assets/plat.png";
import ducatIcon from "../assets/ducat.png";

type SaveState = "idle" | "saving" | "saved" | "error";

const inputCls =
  "bg-white/[0.04] border rounded-[5px] text-wf-text px-3 py-[7px] outline-none transition-colors text-[13px]"
  + " border-[#1c1f27] focus:border-wf-accent/50 placeholder:text-wf-muted/40";


function HotkeyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      const mods: string[] = [];
      if (e.ctrlKey)  mods.push("Ctrl");
      if (e.altKey)   mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey)  mods.push("Meta");

      const raw = e.key;
      if (["Control", "Alt", "Shift", "Meta"].includes(raw)) return;

      const key =
        raw === " " ? "Space"
        : raw.length === 1 ? raw.toUpperCase()
        : raw;

      if (mods.length === 0 && key.length === 1) return;

      onChange([...mods, key].join("+"));
      setRecording(false);
    }

    function onBlur() { setRecording(false); }

    window.addEventListener("keydown", onKey, true);
    ref.current?.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      ref.current?.removeEventListener("blur", onBlur);
    };
  }, [recording]);

  return (
    <button
      ref={ref}
      onClick={() => { setRecording(true); ref.current?.focus(); }}
      className="font-mono text-[13px] px-3 py-[7px] rounded-[5px] border cursor-pointer transition-all duration-150 min-w-[180px] text-left"
      style={recording
        ? { color: "#c49a3c", background: "rgba(196,154,60,0.08)", borderColor: "rgba(196,154,60,0.4)" }
        : { color: "#d4c4a0", background: "rgba(255,255,255,0.04)", borderColor: "#1c1f27" }
      }
    >
      {recording ? "Press keys…" : value}
    </button>
  );
}


function MarketLookup() {
  const [query, setQuery]         = useState("");
  const [result, setResult]       = useState<ItemLookupResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  async function search(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await invoke<ItemLookupResult>("lookup_item", { name: trimmed });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const trendLabel = result?.trend === "Up" ? "rising" : result?.trend === "Down" ? "falling" : "stable";
  const trendColor = result?.trend === "Up" ? "text-emerald-400" : result?.trend === "Down" ? "text-red-400" : "text-wf-muted";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search(query)}
          placeholder="Okina Prime Blade"
          className="flex-1 bg-black/30 border border-wf-border rounded-md text-wf-text text-[13px] px-3 py-[7px] outline-none focus:border-wf-accent/60 placeholder:text-wf-muted/40 transition-colors"
        />
        <button
          onClick={() => search(query)}
          disabled={loading || !query.trim()}
          className="text-[12px] px-4 py-[7px] rounded-md border cursor-pointer transition-colors border-wf-accent/50 text-wf-accent hover:bg-wf-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Looking up" : "Look up"}
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-wf-danger bg-wf-danger/10 border border-wf-danger/25 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-black/30 border border-wf-border rounded-md overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-wf-border/50 bg-white/[0.03]">
            <span className="text-[13px] font-semibold text-wf-text">{result.display_name}</span>
            <div className="flex items-center gap-2">
              {result.vaulted && (
                <span className="text-[9px] font-bold uppercase tracking-wide text-wf-danger/80 bg-wf-danger/10 border border-wf-danger/25 px-1.5 py-0.5 rounded">
                  Vaulted
                </span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${result.found_in_db ? "text-wf-success border-wf-success/30 bg-wf-success/10" : "text-wf-danger border-wf-danger/30 bg-wf-danger/10"}`}>
                {result.found_in_db ? "in DB" : "not in DB"}
              </span>
            </div>
          </div>

          {/* Data rows */}
          <div className="flex flex-col divide-y divide-wf-border/30">
            <Row label="Plat price">
              <div className="flex items-center gap-1.5">
                <img src={platIcon} alt="" className="w-[13px] h-[13px]" />
                {result.median_plat != null
                  ? <span className="text-[14px] font-bold text-white tabular-nums">{result.median_plat}</span>
                  : <span className="text-wf-muted text-[12px]">no data</span>}
                <span className={`text-[11px] ${trendColor}`}>{trendLabel}</span>
              </div>
            </Row>

            <Row label="Ducats">
              <div className="flex items-center gap-1.5">
                <img src={ducatIcon} alt="" className="w-[12px] h-[12px]" />
                <span className="text-[13px] font-semibold text-[#ffc850] tabular-nums">
                  {result.ducats > 0 ? result.ducats : <span className="text-wf-muted">0</span>}
                </span>
              </div>
            </Row>

            <Row label="WFM url_name">
              <span className="font-mono text-[11px] text-wf-muted">{result.url_name}</span>
            </Row>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[12px] text-wf-muted">{label}</span>
      {children}
    </div>
  );
}


export function SettingsPage() {
  const [settings, setSettings]           = useState<Settings | null>(null);
  const [autoDismiss, setAutoDismiss]     = useState<number>(15);
  const [scanDelayMs, setScanDelayMs]     = useState<number>(0);
  const [pollInterval, setPollInterval]   = useState<number>(2);
  const [scanHotkey, setScanHotkey]       = useState<string>("F9");
  const [dismissHotkey, setDismissHotkey] = useState<string>("F10");
  const [devMode, setDevMode]             = useState(false);
  const [gameLang, setGameLang]           = useState("en");
  const [eeLogPath, setEeLogPath]                   = useState<string>("");
  const [eeLogEnabled, setEeLogEnabled]             = useState(true);
  const [completionsEnabled, setCompletionsEnabled] = useState(false);
  const [saveState, setSaveState]                   = useState<SaveState>("idle");
  const [testing, setTesting]             = useState(false);
  const [ocrLines, setOcrLines]           = useState<string[] | null>(null);
  const [ocrLoading, setOcrLoading]       = useState(false);

  useEffect(() => {
    invoke<Settings>("get_settings").then((s) => {
      setSettings(s);
      setAutoDismiss(s.auto_dismiss_secs);
      setScanDelayMs(s.scan_delay_ms ?? 0);
      setPollInterval(s.poll_interval_secs ?? 2);
      setScanHotkey(s.scan_hotkey);
      setDismissHotkey(s.dismiss_hotkey);
      setDevMode(s.dev_mode ?? false);
      setGameLang(s.game_language ?? "en");
      setEeLogPath(s.ee_log_path ?? "");
      setEeLogEnabled(s.ee_log_enabled ?? true);
      setCompletionsEnabled(s.completions_enabled ?? false);
    });
  }, []);

  async function handleTestOverlay() {
    setTesting(true);
    try {
      await invoke("test_overlay");
    } finally {
      setTesting(false);
    }
  }

  async function handleDebugOcr() {
    setOcrLoading(true);
    setOcrLines(null);
    try {
      const lines = await invoke<string[]>("debug_ocr");
      setOcrLines(lines.length > 0 ? lines : ["(no text detected)"]);
    } catch (e) {
      setOcrLines([`Error: ${e}`]);
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleSave() {
    if (!settings) return;
    setSaveState("saving");

    const updated: Settings = {
      ...settings,
      auto_dismiss_secs: autoDismiss,
      scan_delay_ms: scanDelayMs,
      poll_interval_secs: pollInterval,
      scan_hotkey: scanHotkey,
      dismiss_hotkey: dismissHotkey,
      dev_mode: devMode,
      game_language: gameLang,
      ee_log_path: eeLogPath.trim() || null,
      ee_log_enabled: eeLogEnabled,
      completions_enabled: completionsEnabled,
    };

    try {
      await invoke("save_settings", { settings: updated });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 3000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 4000);
    }
  }

  if (!settings) {
    return <div className="text-wf-muted p-8 animate-pulse-dot">Loading settings…</div>;
  }

  return (
    <div className="flex flex-col h-full max-w-[680px] animate-fade-up">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-wide" style={{ color: "#d4c4a0" }}>Settings</h1>
        <p className="text-[11px] uppercase tracking-[0.1em] mt-0.5" style={{ color: "#3a4050" }}>Configuration</p>
      </div>

      <div className="flex flex-col gap-7 flex-1 overflow-y-auto">
        {/* ── Detection notice ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            Auto-Detection
          </h2>
          <div className="bg-wf-surface border border-wf-border rounded-lg p-4 flex flex-col gap-3">
            <p className="text-[13px] text-wf-muted leading-relaxed">
              RelicCracker captures your screen every 2 seconds while Warframe is open to
              detect the relic reward selection screen. Screenshots are processed locally
              and never stored or transmitted anywhere.
            </p>
            <p className="text-[13px] text-wf-muted leading-relaxed">
              Item name recognition (OCR) currently requires Windows. Screen capture and
              template detection work on Linux and macOS too.
            </p>
            {/* Poll interval + scan delay */}
            <div className="flex flex-col gap-4 pt-1 border-t border-wf-border/40">
              {/* Poll interval — 0 = off (manual only) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] text-wf-text">Auto-scan interval</span>
                    <span className="text-[11px] text-wf-muted">
                      How often to check for the reward screen, off = hotkey only
                    </span>
                  </div>
                  <span className="text-[13px] font-mono text-wf-text w-14 text-right shrink-0">
                    {pollInterval === 0 ? "off" : `${pollInterval}s`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={pollInterval}
                  onChange={(e) => setPollInterval(Number(e.target.value))}
                  className="w-full accent-wf-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-wf-muted/60">
                  <span>off</span>
                  <span>10s</span>
                </div>
              </div>

              {/* Scan delay */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] text-wf-text">Scan delay</span>
                    <span className="text-[11px] text-wf-muted">
                      Wait after detecting reward screen before reading text
                    </span>
                  </div>
                  <span className="text-[13px] font-mono text-wf-text w-14 text-right shrink-0">
                    {scanDelayMs === 0 ? "off" : `${(scanDelayMs / 1000).toFixed(1)}s`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3000}
                  step={100}
                  value={scanDelayMs}
                  onChange={(e) => setScanDelayMs(Number(e.target.value))}
                  className="w-full accent-wf-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-wf-muted/60">
                  <span>off</span>
                  <span>3.0s</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="w-2 h-2 rounded-full bg-wf-success shrink-0" />
                <span className="text-wf-muted">Screen monitor active</span>
              </div>
              <button
                className={`text-[12px] px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${
                  testing
                    ? "opacity-60 cursor-not-allowed border-wf-border text-wf-muted"
                    : "border-wf-accent/50 text-wf-accent hover:bg-wf-accent/10"
                }`}
                onClick={handleTestOverlay}
                disabled={testing}
              >
                {testing ? "Opening…" : "Test Overlay"}
              </button>
            </div>
          </div>
        </section>

        {/* ── Language ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            Game Language
          </h2>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-wf-text">Warframe client language</span>
            <span className="text-[11px] text-wf-muted">
              Must match your in-game language so OCR and item names align.
            </span>
            <select
              value={gameLang}
              onChange={e => setGameLang(e.target.value)}
              className="mt-1 w-[220px] rounded-[5px] text-[13px] px-3 py-[7px] outline-none transition-colors cursor-pointer"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #1c1f27", color: "#d4c4a0" }}
            >
              <option value="en">English</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="it">Italiano</option>
              <option value="pl">Polski</option>
              <option value="pt">Português</option>
              <option value="ru">Русский</option>
              <option value="ko">한국어</option>
              <option value="zh">中文 (简体)</option>
              <option value="tc">中文 (繁體)</option>
            </select>
          </div>
        </section>

        {/* ── EE.log ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            EE.log Watcher
          </h2>
          <div className="flex flex-col gap-4">
            {/* Toggle row */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-wf-text">Watch game log</span>
                <span className="text-[11px] text-wf-muted">
                  Reads Warframe's EE.log to detect the reward screen instantly, without OCR.
                  Recommended for Linux and macOS.
                </span>
              </div>
              <button
                role="switch"
                aria-checked={eeLogEnabled}
                onClick={() => setEeLogEnabled(v => !v)}
                className="relative shrink-0 w-10 h-5 rounded-full border transition-colors cursor-pointer ml-4"
                style={{
                  background: eeLogEnabled ? "rgba(82,194,122,0.25)" : "rgba(255,255,255,0.05)",
                  borderColor: eeLogEnabled ? "rgba(82,194,122,0.5)" : "#1c1f27",
                }}
              >
                <span
                  className="absolute top-0.5 rounded-full transition-all duration-150"
                  style={{
                    width: "14px", height: "14px",
                    background: eeLogEnabled ? "#52c27a" : "#3a4050",
                    left: eeLogEnabled ? "calc(100% - 16px)" : "2px",
                    boxShadow: eeLogEnabled ? "0 0 4px #52c27a80" : undefined,
                  }}
                />
              </button>
            </div>

            {/* Path config — only shown when enabled */}
            {eeLogEnabled && (
              <div className="flex flex-col gap-2 pl-1 border-l-2 transition-all" style={{ borderColor: "rgba(82,194,122,0.2)" }}>
                <span className="text-[12px] text-wf-muted">
                  Leave blank to auto-detect. Set a custom path if Warframe is installed in a non-standard location.
                </span>
                <div className="flex flex-col gap-1 text-[11px]" style={{ color: "#3a4050" }}>
                  <span>Windows: <span className="font-mono">%LOCALAPPDATA%\Temp\Warframe\EE.log</span></span>
                  <span>Linux: <span className="font-mono">~/.local/share/Steam/steamapps/compatdata/230410/pfx/.../Warframe/EE.log</span></span>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={eeLogPath}
                    onChange={e => setEeLogPath(e.target.value)}
                    placeholder="Auto-detect"
                    className={`flex-1 ${inputCls}`}
                    spellCheck={false}
                  />
                  <button
                    onClick={async () => {
                      const result = await openFilePicker({
                        filters: [{ name: "Log file", extensions: ["log"] }],
                        multiple: false,
                      });
                      if (result && typeof result === "string") setEeLogPath(result);
                    }}
                    className="text-[12px] px-3 py-[7px] rounded-[5px] border cursor-pointer transition-colors shrink-0"
                    style={{ border: "1px solid #1c1f27", color: "#7a8090", background: "rgba(255,255,255,0.03)" }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#d4c4a0"; e.currentTarget.style.borderColor = "#3a4050"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "#7a8090"; e.currentTarget.style.borderColor = "#1c1f27"; }}
                  >
                    Browse
                  </button>
                  {eeLogPath && (
                    <button
                      onClick={() => setEeLogPath("")}
                      className="text-[11px] cursor-pointer transition-colors shrink-0"
                      style={{ color: "#3a4050", background: "none", border: "none" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#7a8090")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#3a4050")}
                    >
                      clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Overlay ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            Overlay
          </h2>
          <label className="flex flex-col gap-1.5 text-[14px] text-wf-text w-fit">
            Auto-dismiss after
            <div className="flex items-center gap-2">
              <input
                type="number"
                className={`w-20 text-center ${inputCls}`}
                value={autoDismiss}
                min={3}
                max={120}
                onChange={(e) => setAutoDismiss(Number(e.target.value))}
              />
              <span className="text-[13px] text-wf-muted">seconds</span>
            </div>
          </label>
        </section>

        {/* ── Hotkeys ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            Hotkeys
          </h2>
          <p className="text-[13px] text-wf-muted">
            Click a binding, then press your desired combination.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between max-w-[420px]">
              <span className="text-[14px] text-wf-text">Scan (OCR)</span>
              <HotkeyInput value={scanHotkey} onChange={setScanHotkey} />
            </div>
            <div className="flex items-center justify-between max-w-[420px]">
              <span className="text-[14px] text-wf-text">Dismiss overlay</span>
              <HotkeyInput value={dismissHotkey} onChange={setDismissHotkey} />
            </div>
          </div>
        </section>
        {/* ── Dev Mode ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            Developer
          </h2>
          <label className="flex items-center justify-between max-w-[420px] cursor-pointer group">
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] text-wf-text">Dev Mode</span>
              <span className="text-[12px] text-wf-muted">
                Shows scan region overlays, SAD scores, raw OCR lines, and timing on every poll
              </span>
            </div>
            <button
              role="switch"
              aria-checked={devMode}
              onClick={() => setDevMode(v => !v)}
              className={`relative w-10 h-5 rounded-full border transition-colors cursor-pointer shrink-0 ${
                devMode
                  ? "bg-wf-accent border-wf-accent"
                  : "bg-wf-surface2 border-wf-border group-hover:border-wf-muted"
              }`}
            >
              <span
                className={`absolute top-[2px] left-[2px] w-4 h-4 rounded-full bg-white shadow transition-transform duration-150 ${
                  devMode ? "translate-x-[20px]" : ""
                }`}
              />
            </button>
          </label>
          {devMode && (
            <>
              <p className="text-[12px] text-wf-accent/80 bg-wf-accent/8 border border-wf-accent/25 rounded-md px-3 py-2 leading-relaxed">
                Dev panel visible at bottom of screen. Every 2s poll emits SAD score + template result.
                When OCR runs, raw lines and matched items are shown. Save to apply.
              </p>

              <div className="flex flex-col gap-2 pt-1">
                <span className="text-[11px] font-semibold text-wf-muted uppercase tracking-[0.08em]">
                  Market Lookup
                </span>
                <p className="text-[12px] text-wf-muted leading-relaxed">
                  Type any item name to see what ducats, plat price, and trend data the app would fetch.
                </p>
                <MarketLookup />
              </div>
            </>
          )}
        </section>

        {/* ── Completions ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            Completions (optional)
          </h2>
          <label className="flex items-center justify-between max-w-[420px] cursor-pointer group">
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] text-wf-text">Enable Completions tab</span>
              <span className="text-[12px] text-wf-muted">
                Track which Prime sets you need and mark components as owned. Overlay badges items you need.
              </span>
            </div>
            <button
              role="switch"
              aria-checked={completionsEnabled}
              onClick={() => setCompletionsEnabled(v => !v)}
              className="relative w-10 h-5 rounded-full border transition-colors cursor-pointer shrink-0 ml-4"
              style={{
                background: completionsEnabled ? "rgba(82,194,122,0.25)" : "rgba(255,255,255,0.05)",
                borderColor: completionsEnabled ? "rgba(82,194,122,0.5)" : "#1c1f27",
              }}
            >
              <span
                className="absolute top-0.5 rounded-full transition-all duration-150"
                style={{
                  width: "14px", height: "14px",
                  background: completionsEnabled ? "#52c27a" : "#3a4050",
                  left: completionsEnabled ? "calc(100% - 16px)" : "2px",
                  boxShadow: completionsEnabled ? "0 0 4px #52c27a80" : undefined,
                }}
              />
            </button>
          </label>
        </section>

        {/* ── OCR Debug ── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] pb-2" style={{ color: "#3a4050", borderBottom: "1px solid #1c1f27" }}>
            OCR Debug
          </h2>
          <p className="text-[13px] text-wf-muted">
            Captures the current screen and shows raw OCR text. Useful for checking why
            items aren't being detected.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDebugOcr}
              disabled={ocrLoading}
              className={`text-[12px] px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${
                ocrLoading
                  ? "opacity-60 cursor-not-allowed border-wf-border text-wf-muted"
                  : "border-wf-border text-wf-muted hover:border-wf-text hover:text-wf-text"
              }`}
            >
              {ocrLoading ? "Scanning…" : "Capture & OCR"}
            </button>
            {ocrLines && (
              <button
                onClick={() => setOcrLines(null)}
                className="text-[11px] text-wf-muted hover:text-wf-text cursor-pointer"
              >
                clear
              </button>
            )}
          </div>
          {ocrLines && (
            <div className="bg-black/30 border border-wf-border rounded-md p-3 max-h-[200px] overflow-y-auto">
              {ocrLines.map((line, i) => (
                <div key={i} className="font-mono text-[11px] text-wf-text leading-relaxed">
                  {line}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Save bar ── */}
      <div className="flex items-center gap-4 pt-4 mt-2" style={{ borderTop: "1px solid #1c1f27" }}>
        <button
          className="text-[13px] font-semibold px-5 py-2 rounded-[5px] cursor-pointer transition-all duration-150"
          style={{
            background: saveState === "saving" ? "rgba(196,154,60,0.4)" : "#c49a3c",
            color: "#0a0c10",
            opacity: saveState === "saving" ? 0.7 : 1,
          }}
          onClick={handleSave}
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? "Saving…" : "Save settings"}
        </button>
        {saveState === "saved" && (
          <span className="text-[12px] animate-fade-in" style={{ color: "#52c27a" }}>Saved.</span>
        )}
        {saveState === "error" && (
          <span className="text-[12px] animate-fade-in" style={{ color: "#e05252" }}>Failed to save.</span>
        )}
      </div>
    </div>
  );
}
