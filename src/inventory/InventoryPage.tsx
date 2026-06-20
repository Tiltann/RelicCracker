import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InventoryEntry } from "../types";

// ── Module-level background scan state ───────────────────────────────────────
// Lives outside the component so navigating away doesn't cancel the scan.

type ScanResult = { ok: true; items: InventoryEntry[] } | { ok: false; error: string };
type Listener   = (r: ScanResult) => void;

interface Cache { items: InventoryEntry[]; fetchedAt: number; }

const CACHE_KEY   = "rc_inventory";
const CONSENT_KEY = "rc_inv_consented";

function loadCache(): Cache | null {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"); } catch { return null; }
}
function saveCache(items: InventoryEntry[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items, fetchedAt: Date.now() })); } catch {}
}

let activeScan: Promise<void> | null = null;
const pending: Listener[] = [];

function isScanning() { return activeScan !== null; }

/** Start a scan (or join one already in progress). Returns an unsubscribe fn. */
function startOrJoinScan(onResult: Listener): () => void {
  pending.push(onResult);

  if (!activeScan) {
    activeScan = invoke<InventoryEntry[]>("get_inventory")
      .then(items => {
        saveCache(items);
        notify({ ok: true, items });
      })
      .catch(err => notify({ ok: false, error: String(err) }))
      .finally(() => { activeScan = null; });
  }

  return () => {
    const i = pending.indexOf(onResult);
    if (i >= 0) pending.splice(i, 1);
  };
}

function notify(result: ScanResult) {
  [...pending].forEach(fn => fn(result));
  pending.length = 0;
}

function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)     return "just now";
  if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONSENT_PHRASE  = "I understand scanning game memory may risk a ban";
const CATEGORY_ORDER  = ["Warframe Part", "Weapon Part", "Blueprint", "Other"];

type SortKey = "name" | "count" | "ducats";
type SortDir = "asc" | "desc";

// ── Sub-components ────────────────────────────────────────────────────────────

function ItemImage({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span className="w-8 h-8 rounded bg-wf-surface2 flex items-center justify-center text-[10px] text-wf-muted shrink-0">◈</span>
    );
  }
  return (
    <img src={url} alt="" width={32} height={32}
      className="w-8 h-8 object-contain rounded shrink-0"
      onError={() => setFailed(true)} />
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function InventoryPage() {
  const [items, setItems]         = useState<InventoryEntry[] | null>(() => loadCache()?.items ?? null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(() => loadCache()?.fetchedAt ?? null);
  const [loading, setLoading]     = useState(isScanning);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [sort, setSort]           = useState<SortKey>("ducats");
  const [dir, setDir]             = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [consented, setConsented] = useState(() => !!localStorage.getItem(CONSENT_KEY));
  const [consentInput, setConsentInput] = useState("");
  const [, tick] = useState(0); // for timeAgo updates

  // Re-join a scan that was started before this component mounted
  useEffect(() => {
    if (!isScanning()) return;
    const unsub = startOrJoinScan(result => {
      applyResult(result);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update the "X ago" label every 30s
  useEffect(() => {
    if (!fetchedAt) return;
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  function applyResult(result: ScanResult) {
    if (result.ok) {
      setItems(result.items);
      setFetchedAt(Date.now());
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  function handleScan() {
    if (loading) return;
    setLoading(true);
    setError(null);
    startOrJoinScan(applyResult);
  }

  function handleConsent() {
    localStorage.setItem(CONSENT_KEY, "1");
    setConsented(true);
    // Start the scan immediately after consenting
    handleScan();
  }

  function toggleSort(key: SortKey) {
    if (sort === key) setDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir(key === "name" ? "asc" : "desc"); }
  }

  function toggleGroup(cat: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  const filtered = (items ?? []).filter(
    it => !search || it.name.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => {
    const cmp = sort === "name" ? a.name.localeCompare(b.name)
              : sort === "count" ? a.count - b.count
              : a.ducats - b.ducats;
    return dir === "asc" ? cmp : -cmp;
  });

  const groups = CATEGORY_ORDER
    .map(cat => ({ cat, rows: filtered.filter(it => it.category === cat) }))
    .filter(g => g.rows.length > 0);

  const knownCats = new Set(CATEGORY_ORDER);
  const extra = filtered.filter(it => !knownCats.has(it.category));
  if (extra.length > 0) groups.push({ cat: "Other", rows: extra });

  const totalDucats = filtered.reduce((s, it) => s + it.ducats * it.count, 0);

  function SortBtn({ k, label }: { k: SortKey; label: string }) {
    const active = sort === k;
    return (
      <button onClick={() => toggleSort(k)}
        className={`flex items-center gap-1 cursor-pointer text-[12px] font-medium transition-colors ${
          active ? "text-wf-accent" : "text-wf-muted hover:text-wf-text"
        }`}>
        {label}
        {active && <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    );
  }

  // ── Consent gate (first time only) ─────────────────────────────────────────

  if (!consented) {
    return (
      <div className="flex flex-col h-full max-w-[640px]">
        <h1 className="text-[22px] font-bold text-wf-text mb-7">Inventory</h1>
        <div className="bg-wf-surface border border-wf-danger/40 rounded-lg p-6 flex flex-col gap-4">
          <p className="text-[13px] text-wf-danger font-semibold">Warning — Memory Scanning</p>
          <p className="text-[13px] text-wf-text leading-relaxed">
            Fetching your inventory requires scanning the Warframe process memory to extract
            the session auth token, then calling the official Warframe mobile API.
          </p>
          <p className="text-[13px] text-wf-muted leading-relaxed">
            This is the same approach used by <span className="text-wf-text">warframe-helper</span>.
            Digital Extremes has not explicitly banned this technique, but there is a theoretical
            risk. <span className="text-wf-text font-medium">Use at your own risk.</span>
          </p>
          <p className="text-[13px] text-wf-muted">Type the following phrase to confirm:</p>
          <p className="font-mono text-[12px] text-wf-accent bg-wf-accent/10 rounded px-3 py-2 select-all">
            {CONSENT_PHRASE}
          </p>
          <input
            className="bg-white/5 border border-white/[0.12] rounded-md text-wf-text px-3 py-2 text-[13px] outline-none focus:border-wf-accent/60 transition-colors"
            placeholder="Type the phrase above…"
            value={consentInput}
            onChange={e => setConsentInput(e.target.value)}
          />
          <button
            disabled={consentInput !== CONSENT_PHRASE}
            onClick={handleConsent}
            className={`text-[13px] font-semibold px-4 py-2 rounded-md transition-opacity cursor-pointer ${
              consentInput === CONSENT_PHRASE
                ? "bg-wf-accent text-black hover:opacity-90"
                : "bg-white/10 text-wf-muted cursor-not-allowed opacity-50"
            }`}
          >
            I understand, fetch inventory
          </button>
        </div>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-bold text-wf-text">Inventory</h1>
          {fetchedAt && !loading && (
            <span className="text-[12px] text-wf-muted" title={new Date(fetchedAt).toLocaleString()}>
              fetched {timeAgo(fetchedAt)}
            </span>
          )}
          {loading && (
            <span className="text-[12px] text-wf-muted animate-pulse">scanning memory…</span>
          )}
        </div>
        <button
          onClick={handleScan}
          disabled={loading}
          className={`text-[13px] font-semibold px-4 py-2 rounded-md border cursor-pointer transition-colors ${
            loading
              ? "opacity-60 cursor-not-allowed border-wf-border text-wf-muted"
              : "border-wf-accent/50 text-wf-accent hover:bg-wf-accent/10"
          }`}
        >
          {loading ? "Scanning…" : items ? "Refresh" : "Fetch Inventory"}
        </button>
      </div>

      {error && (
        <div className="bg-wf-danger/10 border border-wf-danger/30 rounded-lg px-4 py-3 mb-4 text-[13px] text-wf-danger">
          {error}
        </div>
      )}

      {!items && !loading && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center flex flex-col items-center gap-3">
            <span className="text-[40px] text-wf-muted/40">◈</span>
            <p className="text-[14px] text-wf-muted">
              Click <span className="text-wf-text">Fetch Inventory</span> to scan Warframe's memory.
            </p>
            <p className="text-[12px] text-wf-muted">Warframe must be running.</p>
          </div>
        </div>
      )}

      {/* Show stale data while a refresh is running */}
      {items && (
        <>
          <div className="flex items-center gap-4 mb-4">
            <input
              className="flex-1 bg-white/5 border border-white/[0.12] rounded-md text-wf-text px-3 py-[7px] text-[13px] outline-none focus:border-wf-accent/60 transition-colors"
              placeholder="Search items…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="text-[12px] text-wf-muted shrink-0">
              {filtered.length} items
              {totalDucats > 0 && (
                <span className="ml-2 text-wf-accent">{totalDucats.toLocaleString()} ducats</span>
              )}
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center px-4 py-2 border border-b-0 border-wf-border bg-wf-surface rounded-t-lg">
            <div className="flex-1"><SortBtn k="name" label="Item" /></div>
            <div className="w-16 text-right"><SortBtn k="count" label="Qty" /></div>
            <div className="w-24 text-right"><SortBtn k="ducats" label="Ducats ea." /></div>
            <div className="w-20 text-right text-[12px] font-medium text-wf-muted">Total</div>
          </div>

          <div className={`flex-1 overflow-y-auto rounded-b-lg border border-wf-border border-t-0 ${loading ? "opacity-60" : ""} transition-opacity`}>
            {groups.map(({ cat, rows }) => {
              const groupDucats = rows.reduce((s, it) => s + it.ducats * it.count, 0);
              const isCollapsed = collapsed.has(cat);
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleGroup(cat)}
                    className="w-full flex items-center gap-2 px-4 py-1.5 bg-wf-surface2 border-b border-wf-border text-[11px] font-semibold text-wf-muted uppercase tracking-wide cursor-pointer hover:bg-wf-surface transition-colors"
                  >
                    <span>{isCollapsed ? "▶" : "▼"}</span>
                    <span>{cat}</span>
                    <span className="font-normal normal-case tracking-normal ml-1">({rows.length})</span>
                    {groupDucats > 0 && (
                      <span className="ml-auto text-wf-accent font-normal normal-case tracking-normal">
                        {groupDucats.toLocaleString()} ducats
                      </span>
                    )}
                  </button>

                  {!isCollapsed && rows.map((it, i) => (
                    <div
                      key={it.item_type}
                      className={`flex items-center px-4 py-2 border-b border-wf-border/60 last:border-0 transition-colors ${
                        i % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"
                      } hover:bg-wf-surface2`}
                    >
                      <div className="flex-1 flex items-center gap-2.5 min-w-0">
                        <ItemImage url={it.image_url} />
                        <span className="text-[13px] text-wf-text truncate">{it.name}</span>
                      </div>
                      <div className="w-16 text-right text-[13px] text-wf-text tabular-nums shrink-0">{it.count}</div>
                      <div className="w-24 text-right text-[13px] tabular-nums shrink-0">
                        {it.ducats > 0 ? <span className="text-wf-accent">{it.ducats}</span> : <span className="text-wf-muted">—</span>}
                      </div>
                      <div className="w-20 text-right text-[13px] tabular-nums shrink-0">
                        {it.ducats > 0 ? <span className="text-wf-accent/80">{(it.ducats * it.count).toLocaleString()}</span> : <span className="text-wf-muted">—</span>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            {groups.length === 0 && (
              <div className="px-4 py-8 text-center text-wf-muted text-[13px]">
                No items match your search.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
