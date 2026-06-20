import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CompletionData, ItemLookupResult, PrimeComponent, PrimeSetInfo } from "../types";
import platIcon from "../assets/plat.png";
import ducatIcon from "../assets/ducat.png";

type Filter = "all" | "wanted" | "complete";

interface ComponentPrices {
  [name: string]: { median_plat: number | null; trend: "Up" | "Down" | "Flat" } | null;
}

export function CompletionsPage() {
  const [data, setData]       = useState<CompletionData | null>(null);
  const [filter, setFilter]   = useState<Filter>("all");
  const [search, setSearch]   = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const d = await invoke<CompletionData>("get_completion_data");
      setData(d);
    } finally {
      setLoading(false);
    }
  }

  async function toggleWanted(setName: string) {
    await invoke("toggle_wanted_set", { name: setName });
    setData(prev => {
      if (!prev) return prev;
      const isWanted = prev.wanted_sets.includes(setName);
      return {
        ...prev,
        wanted_sets: isWanted
          ? prev.wanted_sets.filter(s => s !== setName)
          : [...prev.wanted_sets, setName],
      };
    });
  }

  async function toggleOwned(itemName: string) {
    await invoke("toggle_owned_component", { name: itemName });
    setData(prev => {
      if (!prev) return prev;
      const isOwned = prev.owned_components.includes(itemName);
      return {
        ...prev,
        owned_components: isOwned
          ? prev.owned_components.filter(c => c !== itemName)
          : [...prev.owned_components, itemName],
      };
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: "#3a4050" }}>
        <span className="animate-pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-current" />
        Loading prime sets…
      </div>
    );
  }

  if (!data) return null;

  const wantedSet = new Set(data.wanted_sets);
  const ownedSet  = new Set(data.owned_components);

  function isComplete(set: PrimeSetInfo) {
    return set.components.every(c => ownedSet.has(c.name));
  }

  const lc = search.toLowerCase();
  const visible = data.prime_sets.filter(ps => {
    if (lc && !ps.name.toLowerCase().includes(lc)) return false;
    if (filter === "wanted"   && !wantedSet.has(ps.name)) return false;
    if (filter === "complete" && !isComplete(ps))          return false;
    return true;
  });

  const wantedCount   = data.prime_sets.filter(ps => wantedSet.has(ps.name)).length;
  const completeCount = data.prime_sets.filter(ps => wantedSet.has(ps.name) && isComplete(ps)).length;

  return (
    <div className="flex flex-col gap-5 animate-fade-up max-w-[860px]">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[20px] font-bold tracking-wide" style={{ color: "#d4c4a0" }}>Completions</h1>
          <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "#3a4050" }}>
            Prime Set Tracker
          </p>
        </div>
        {wantedCount > 0 && (
          <div className="text-[12px] px-3 py-1.5 rounded-[5px]"
               style={{ background: "#0e1016", border: "1px solid #1c1f27", color: "#7a8090" }}>
            {completeCount}/{wantedCount} wanted sets complete
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sets…"
          className="text-[13px] px-3 py-[6px] rounded-[5px] outline-none w-[220px]"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #1c1f27", color: "#d4c4a0" }}
        />

        <div className="flex rounded-[5px] overflow-hidden" style={{ border: "1px solid #1c1f27" }}>
          {(["all", "wanted", "complete"] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-[11px] px-3 py-[6px] capitalize cursor-pointer transition-colors"
              style={{
                background: filter === f ? "rgba(196,154,60,0.12)" : "transparent",
                color: filter === f ? "#c49a3c" : "#4a5060",
                borderLeft: f !== "all" ? "1px solid #1c1f27" : undefined,
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <span className="text-[11px]" style={{ color: "#3a4050" }}>
          {visible.length} set{visible.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Set list */}
      {visible.length === 0 && (
        <div className="flex items-center justify-center py-12 rounded-[8px]"
             style={{ background: "#0e1016", border: "1px solid #1c1f27", color: "#3a4050" }}>
          No sets match
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.map(ps => {
          const wanted    = wantedSet.has(ps.name);
          const complete  = isComplete(ps);
          const ownedCount = ps.components.filter(c => ownedSet.has(c.name)).length;
          const pct = ps.components.length > 0 ? ownedCount / ps.components.length : 0;

          return (
            <SetCard
              key={ps.name}
              set={ps}
              wanted={wanted}
              complete={complete}
              ownedCount={ownedCount}
              pct={pct}
              ownedSet={ownedSet}
              onToggleWanted={() => toggleWanted(ps.name)}
              onToggleOwned={toggleOwned}
            />
          );
        })}
      </div>
    </div>
  );
}

interface SetCardProps {
  set: PrimeSetInfo;
  wanted: boolean;
  complete: boolean;
  ownedCount: number;
  pct: number;
  ownedSet: Set<string>;
  onToggleWanted: () => void;
  onToggleOwned: (name: string) => void;
}

function SetCard({ set, wanted, complete, ownedCount, pct, ownedSet, onToggleWanted, onToggleOwned }: SetCardProps) {
  const [expanded, setExpanded]       = useState(false);
  const [prices, setPrices]           = useState<ComponentPrices>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!expanded || fetchedRef.current) return;
    fetchedRef.current = true;
    setPricesLoading(true);

    Promise.all(
      set.components.map(async comp => {
        try {
          const r = await invoke<ItemLookupResult>("lookup_item", { name: comp.name });
          return { name: comp.name, median_plat: r.median_plat, trend: r.trend };
        } catch {
          return { name: comp.name, median_plat: null, trend: "Flat" as const };
        }
      })
    ).then(results => {
      const map: ComponentPrices = {};
      for (const r of results) map[r.name] = { median_plat: r.median_plat, trend: r.trend };
      setPrices(map);
    }).finally(() => setPricesLoading(false));
  }, [expanded, set.components]);

  return (
    <div
      className="rounded-[6px] overflow-hidden transition-colors"
      style={{
        border: `1px solid ${wanted ? (complete ? "rgba(82,194,122,0.25)" : "rgba(196,154,60,0.2)") : "#1c1f27"}`,
        background: wanted ? (complete ? "rgba(82,194,122,0.03)" : "rgba(196,154,60,0.02)") : "#0e1016",
      }}
    >
      {/* Set header row */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Set image */}
        {set.image_url ? (
          <img
            src={set.image_url}
            alt=""
            className="w-[32px] h-[32px] shrink-0 rounded-[3px] object-contain"
            style={{ background: "rgba(255,255,255,0.03)" }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-[32px] h-[32px] shrink-0 rounded-[3px]"
               style={{ background: "rgba(255,255,255,0.03)" }} />
        )}

        {/* Chevron */}
        <span className="text-[10px] shrink-0 transition-transform duration-150"
              style={{ color: "#3a4050", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
          ▶
        </span>

        {/* Set name */}
        <span className="flex-1 text-[13px] font-semibold" style={{ color: wanted ? "#d4c4a0" : "#7a8090" }}>
          {set.name}
        </span>

        {/* Complete badge */}
        {complete && wanted && (
          <span className="text-[9px] font-bold uppercase tracking-[0.1em] px-[5px] py-[2px] rounded-[3px]"
                style={{ color: "#52c27a", background: "rgba(82,194,122,0.1)", border: "1px solid rgba(82,194,122,0.2)" }}>
            Complete
          </span>
        )}

        {/* Progress */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-[64px] h-[3px] rounded-full overflow-hidden" style={{ background: "#1c1f27" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pct * 100}%`,
                background: complete ? "#52c27a" : wanted ? "#c49a3c" : "#3a4050",
              }}
            />
          </div>
          <span className="text-[10px] tabular-nums w-[30px] text-right" style={{ color: "#5a6070" }}>
            {ownedCount}/{set.components.length}
          </span>
        </div>

        {/* Want toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggleWanted(); }}
          className="text-[10px] font-semibold px-2.5 py-[4px] rounded-[4px] border cursor-pointer transition-all shrink-0"
          style={wanted
            ? { color: "#c49a3c", background: "rgba(196,154,60,0.1)", border: "1px solid rgba(196,154,60,0.3)" }
            : { color: "#3a4050", background: "transparent", border: "1px solid #1c1f27" }
          }
          onMouseEnter={e => { if (!wanted) { e.currentTarget.style.color = "#c49a3c"; e.currentTarget.style.borderColor = "rgba(196,154,60,0.3)"; } }}
          onMouseLeave={e => { if (!wanted) { e.currentTarget.style.color = "#3a4050"; e.currentTarget.style.borderColor = "#1c1f27"; } }}
        >
          {wanted ? "Wanted" : "Want"}
        </button>
      </div>

      {/* Component list */}
      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-[4px]" style={{ borderTop: "1px solid #1c1f27" }}>
          {/* Column header */}
          <div className="flex items-center gap-2.5 mt-2 mb-1 pl-[44px]">
            <span className="flex-1 text-[9px] uppercase tracking-[0.1em]" style={{ color: "#2a3040" }}>Component</span>
            <span className="text-[9px] uppercase tracking-[0.1em] w-[52px] text-right" style={{ color: "#2a3040" }}>Plat</span>
            <span className="text-[9px] uppercase tracking-[0.1em] w-[44px] text-right" style={{ color: "#2a3040" }}>Ducats</span>
          </div>

          {set.components.map((comp: PrimeComponent) => {
            const owned = ownedSet.has(comp.name);
            const label = comp.name.startsWith(set.name + " ")
              ? comp.name.slice(set.name.length + 1)
              : comp.name;

            // Blueprints get the set image; other components use their own
            const isBlueprint = comp.name.toLowerCase().endsWith("blueprint");
            const imgSrc = isBlueprint ? set.image_url : (comp.image_url ?? set.image_url);

            const price = prices[comp.name];

            return (
              <div
                key={comp.name}
                className="flex items-center gap-2.5 mt-1 cursor-pointer group"
                onClick={() => onToggleOwned(comp.name)}
              >
                {/* Component image */}
                {imgSrc ? (
                  <img
                    src={imgSrc}
                    alt=""
                    className="w-[28px] h-[28px] shrink-0 rounded-[3px] object-contain"
                    style={{ background: "rgba(255,255,255,0.03)", opacity: owned ? 0.4 : 1 }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-[28px] h-[28px] shrink-0" />
                )}

                {/* Checkbox */}
                <span
                  className="w-[14px] h-[14px] rounded-[3px] shrink-0 flex items-center justify-center transition-colors"
                  style={{
                    background: owned ? "rgba(82,194,122,0.2)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${owned ? "rgba(82,194,122,0.5)" : "#2a3040"}`,
                  }}
                >
                  {owned && (
                    <svg width="8" height="7" viewBox="0 0 8 7" fill="none">
                      <path d="M1 3.5L3 5.5L7 1.5" stroke="#52c27a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>

                {/* Label */}
                <span
                  className="flex-1 text-[12px] transition-colors min-w-0 truncate"
                  style={{ color: owned ? "#52c27a" : "#5a6070", textDecoration: owned ? "line-through" : undefined }}
                >
                  {label}
                </span>

                {/* Plat price */}
                <div className="w-[52px] flex items-center justify-end gap-[3px] shrink-0">
                  {pricesLoading && !price ? (
                    <span className="text-[10px]" style={{ color: "#2a3040" }}>…</span>
                  ) : price?.median_plat != null ? (
                    <>
                      <img src={platIcon} alt="" className="w-[10px] h-[10px] shrink-0" style={{ opacity: owned ? 0.4 : 0.7 }} />
                      <span className="text-[11px] tabular-nums font-semibold"
                            style={{ color: owned ? "#3a4050" : "#9a9aa0" }}>
                        {price.median_plat}
                      </span>
                      {!owned && price.trend === "Up" && (
                        <span className="text-[9px] font-bold leading-none" style={{ color: "#52c27a" }}>↑</span>
                      )}
                      {!owned && price.trend === "Down" && (
                        <span className="text-[9px] font-bold leading-none" style={{ color: "#e05252" }}>↓</span>
                      )}
                    </>
                  ) : price ? (
                    <span className="text-[10px]" style={{ color: "#2a3040" }}>n/a</span>
                  ) : null}
                </div>

                {/* Ducats */}
                <div className="w-[44px] flex items-center justify-end gap-[3px] shrink-0">
                  {comp.ducats > 0 ? (
                    <>
                      <img src={ducatIcon} alt="" className="w-[10px] h-[10px] shrink-0" style={{ opacity: owned ? 0.4 : 0.7 }} />
                      <span className="text-[11px] tabular-nums font-semibold"
                            style={{ color: owned ? "#3a4050" : "#d4953a" }}>
                        {comp.ducats}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px]" style={{ color: "#2a3040" }}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
