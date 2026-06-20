import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DevPanel } from "./DevPanel";
import type { Settings } from "../types";

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "flex items-center gap-2.5 px-3 py-[8px] text-[13px] border-l-[2px] transition-all duration-150 no-underline rounded-r-[4px]",
    isActive
      ? "text-wf-accent border-wf-accent bg-wf-accent/8 font-medium"
      : "text-wf-muted border-transparent hover:text-wf-text hover:bg-white/[0.04] hover:border-white/20",
  ].join(" ");

function IconDashboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="1" y="1" width="5" height="5" rx="1"/>
      <rect x="8" y="1" width="5" height="5" rx="1"/>
      <rect x="1" y="8" width="5" height="5" rx="1"/>
      <rect x="8" y="8" width="5" height="5" rx="1"/>
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="2"/>
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.75 2.75l1.06 1.06M10.19 10.19l1.06 1.06M2.75 11.25l1.06-1.06M10.19 3.81l1.06-1.06"/>
    </svg>
  );
}

function IconLogs() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2 3h10M2 7h7M2 11h5"/>
    </svg>
  );
}

function IconCompletions() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5.5"/>
      <path d="M4.5 7l1.75 1.75L9.5 5"/>
    </svg>
  );
}

export function Layout() {
  const [wfRunning, setWfRunning]             = useState<boolean | null>(null);
  const [devMode, setDevMode]                 = useState(false);
  const [completionsEnabled, setCompletionsEnabled] = useState(false);
  const [scanKey, setScanKey]                 = useState("F9");
  const [dismissKey, setDismissKey]           = useState("F10");
  const [updateTag, setUpdateTag]             = useState<string | null>(null);

  function loadSettings() {
    invoke<Settings>("get_settings").then(s => {
      setDevMode(s.dev_mode);
      setScanKey(s.scan_hotkey);
      setDismissKey(s.dismiss_hotkey);
      setCompletionsEnabled(s.completions_enabled ?? false);
    }).catch(() => {});
  }

  useEffect(() => {
    invoke<boolean>("get_warframe_status").then(setWfRunning).catch(() => {});
    loadSettings();
    invoke<string | null>("check_for_updates").then(tag => {
      if (tag) setUpdateTag(tag);
    }).catch(() => {});

    const unWf       = listen<boolean>("warframe-status", e => setWfRunning(e.payload));
    const unDev      = listen<boolean>("dev-mode", e => setDevMode(e.payload));
    const unSettings = listen("settings-saved", () => loadSettings());
    return () => { unWf.then(f => f()); unDev.then(f => f()); unSettings.then(f => f()); };
  }, []);

  const wfClosed = wfRunning === false;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <nav className="w-[175px] shrink-0 flex flex-col"
           style={{ background: "#0e1016", borderRight: "1px solid #1c1f27" }}>

        {/* Logo */}
        <div className="flex items-center gap-2 px-3.5 py-4 mb-1"
             style={{ borderBottom: "1px solid #1c1f27" }}>
          <div className="flex flex-col">
            <span className="text-[13px] font-bold tracking-wide"
                  style={{ color: "#d4c4a0", letterSpacing: "0.04em" }}>
              RelicCracker
            </span>
            <span className="text-[9px] uppercase tracking-[0.16em]"
                  style={{ color: "#4a5060" }}>
              Scanner
            </span>
          </div>
        </div>

        {/* Nav */}
        <ul className="list-none flex-1 flex flex-col gap-[2px] px-[6px] pt-2">
          <li>
            <NavLink to="/" end className={navClass}>
              <IconDashboard />
              Dashboard
            </NavLink>
          </li>
          <li>
            <NavLink to="/logs" className={navClass}>
              <IconLogs />
              Logs
            </NavLink>
          </li>
          {completionsEnabled && (
            <li>
              <NavLink to="/completions" className={navClass}>
                <IconCompletions />
                Completions
              </NavLink>
            </li>
          )}
          <li>
            <NavLink to="/settings" className={navClass}>
              <IconSettings />
              Settings
            </NavLink>
          </li>
        </ul>

        {/* Status footer */}
        <div className="px-3 pb-3 pt-2 flex flex-col gap-2"
             style={{ borderTop: "1px solid #1c1f27" }}>
          <div className="flex items-center gap-1.5">
            <span
              className={wfRunning ? "animate-pulse-dot" : ""}
              style={{
                display: "inline-block",
                width: "6px", height: "6px",
                borderRadius: "50%",
                background: wfRunning ? "#52c27a" : wfRunning === false ? "#e05252" : "#4a5060",
                boxShadow: wfRunning ? "0 0 5px #52c27a" : undefined,
                flexShrink: 0,
              }}
            />
            <span className="text-[10.5px]" style={{ color: "#5a6070" }}>
              {wfRunning ? "Warframe running" : wfRunning === false ? "Warframe closed" : "Checking…"}
            </span>
          </div>

          <div className="flex flex-col gap-[3px]">
            <HotkeyChip label="Scan" hotkey={scanKey} />
            <HotkeyChip label="Dismiss" hotkey={dismissKey} />
          </div>

          {updateTag && (
            <button
              onClick={() => openUrl("https://github.com/Tiltann/RelicCracker/releases/latest")}
              className="text-left w-full cursor-pointer"
              style={{ background: "none", border: "none", padding: 0 }}
            >
              <div className="flex items-center gap-1.5 px-2 py-[5px] rounded-[4px]"
                   style={{ background: "rgba(196,154,60,0.08)", border: "1px solid rgba(196,154,60,0.25)" }}>
                <span className="text-[9.5px] font-medium" style={{ color: "#c49a3c" }}>
                  {updateTag} available
                </span>
              </div>
            </button>
          )}
          {devMode && (
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-[2px] rounded-[3px] w-fit"
                  style={{ color: "#c49a3c", background: "rgba(196,154,60,0.1)", border: "1px solid rgba(196,154,60,0.2)" }}>
              Dev Mode
            </span>
          )}
        </div>
      </nav>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#0a0c10" }}>
        {wfClosed && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 text-[12px] animate-slide-right"
               style={{ background: "#0e1016", borderBottom: "1px solid #1c1f27", color: "#5a6070" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#e05252", flexShrink: 0, display: "inline-block" }} />
            Warframe is not running, monitoring paused.
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-7">
          <Outlet />
        </main>
        {devMode && <DevPanel />}
      </div>
    </div>
  );
}

function HotkeyChip({ label, hotkey }: { label: string; hotkey: string }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-[10px]" style={{ color: "#3a4050" }}>{label}</span>
      <kbd className="text-[9px] font-mono px-[5px] py-[1px] rounded-[3px] leading-none"
           style={{ color: "#6a7080", background: "rgba(255,255,255,0.04)", border: "1px solid #1c1f27" }}>
        {hotkey}
      </kbd>
    </div>
  );
}
