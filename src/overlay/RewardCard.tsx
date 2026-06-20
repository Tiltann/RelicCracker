import type { RewardResult } from "../types";
import platIcon from "../assets/plat.png";
import ducatIcon from "../assets/ducat.png";

const RARITY: Record<string, { label: string; color: string; glow: string; bar: string }> = {
  Common:   { label: "COM", color: "#9a7a50", glow: "rgba(154,122,80,0.25)",  bar: "linear-gradient(180deg,#b89060,#6a4a20)" },
  Uncommon: { label: "UNC", color: "#7aaac8", glow: "rgba(122,170,200,0.25)", bar: "linear-gradient(180deg,#90b8d8,#4a7090)" },
  Rare:     { label: "RARE", color: "#d4a820", glow: "rgba(212,168,32,0.35)",  bar: "linear-gradient(180deg,#e8c040,#9a6800)" },
};

interface Props {
  reward: RewardResult;
  index: number;
  needed?: boolean;
}

export function RewardCard({ reward, index, needed }: Props) {
  const r = RARITY[reward.rarity] ?? RARITY.Common;

  return (
    <div
      className="relative flex flex-col rounded-[5px] overflow-hidden flex-1 min-w-[142px] max-w-[185px] select-none"
      style={{
        background: "linear-gradient(160deg, #0e1118 0%, #090b0f 100%)",
        border: `1px solid rgba(255,255,255,0.07)`,
        boxShadow: reward.is_best
          ? `0 0 0 1px ${r.color}55, 0 4px 20px ${r.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`
          : `0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)`,
        animation: `card-in 240ms cubic-bezier(0.22,0.61,0.36,1) ${index * 55}ms both`,
      }}
    >
      {/* Rarity top bar */}
      <div className="h-[2.5px] w-full shrink-0" style={{ background: r.bar }} />

      {/* Corner accents */}
      <span className="absolute top-[5px] left-[5px] w-[7px] h-[7px] pointer-events-none"
            style={{ borderTop: `1px solid ${r.color}60`, borderLeft: `1px solid ${r.color}60` }} />
      <span className="absolute bottom-[5px] right-[5px] w-[7px] h-[7px] pointer-events-none"
            style={{ borderBottom: `1px solid ${r.color}60`, borderRight: `1px solid ${r.color}60` }} />

      {/* Content */}
      <div className="flex flex-col gap-[5px] px-[9px] pt-[6px] pb-[7px]">

        {/* Top row: rarity + BEST badge */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-[7.5px] font-bold tracking-[0.14em] uppercase leading-none"
                style={{ color: r.color }}>
            {r.label}
          </span>
          <div className="flex items-center gap-1">
            {needed && (
              <span
                className="text-[7px] font-black tracking-[0.1em] uppercase px-[5px] py-[1.5px] rounded-[3px] leading-none"
                style={{ color: "#52c27a", background: "rgba(82,194,122,0.15)", border: "1px solid rgba(82,194,122,0.3)" }}
              >
                NEED
              </span>
            )}
            {reward.is_best && (
              <span
                className="text-[7px] font-black tracking-[0.12em] uppercase px-[5px] py-[1.5px] rounded-[3px] leading-none"
                style={{
                  color: "#0a0c10",
                  background: `linear-gradient(90deg, ${r.color}, #e8c060)`,
                }}
              >
                BEST
              </span>
            )}
          </div>
        </div>

        {/* Item name */}
        <div
          className="text-[11px] font-semibold leading-[1.25] text-white/90 line-clamp-2"
          title={reward.item_name}
        >
          {reward.item_name}
        </div>

        {/* Best reason */}
        {reward.is_best && reward.best_reason && (
          <div className="text-[8.5px] leading-none" style={{ color: r.color + "bb" }}>
            {reward.best_reason}
          </div>
        )}

        {/* Price + ducats row */}
        <div className="flex items-center gap-[8px] flex-wrap">
          {/* Platinum price */}
          <div className="flex items-center gap-[4px]">
            <img src={platIcon} alt="plat" className="w-[13px] h-[13px] shrink-0" />
            {reward.median_plat != null ? (
              <span className="text-[15px] font-bold text-white tabular-nums leading-none">
                {reward.median_plat}
              </span>
            ) : (
              <span className="text-[13px] text-white/20 leading-none font-light">n/a</span>
            )}
            <TrendBadge trend={reward.trend} />
          </div>

          {/* Ducats */}
          {reward.ducats > 0 && (
            <>
              <span className="w-[1px] h-[10px] bg-white/10 shrink-0" />
              <div className="flex items-center gap-[3px]">
                <img src={ducatIcon} alt="ducats" className="w-[12px] h-[12px] shrink-0" />
                <span className="text-[11.5px] font-semibold tabular-nums leading-none"
                      style={{ color: "#d4953a" }}>
                  {reward.ducats}
                </span>
              </div>
            </>
          )}

          {/* Vaulted */}
          {reward.vaulted && (
            <span className="ml-auto text-[7px] font-bold uppercase tracking-[0.1em] px-[4px] py-[2px] rounded-[3px] leading-none"
                  style={{ color: "#e07070", background: "rgba(224,80,80,0.12)", border: "1px solid rgba(224,80,80,0.25)" }}>
              VAULT
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: RewardResult["trend"] }) {
  if (trend === "Up") return (
    <span className="text-[10px] font-bold leading-none" style={{ color: "#52c27a" }}>+</span>
  );
  if (trend === "Down") return (
    <span className="text-[10px] font-bold leading-none" style={{ color: "#e05252" }}>−</span>
  );
  return null;
}
