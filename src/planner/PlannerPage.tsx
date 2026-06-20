const FEATURES = [
  "Import relic inventory",
  "Expected plat/run calculation",
  "Void trace optimizer (Intact vs. Radiant)",
  "Best relic to run suggestions",
];

export function PlannerPage() {
  return (
    <div className="max-w-[700px]">
      <div className="mb-7">
        <h1 className="text-[22px] font-bold text-wf-text">Relic Planner</h1>
      </div>

      <div className="bg-wf-surface border border-wf-border rounded-xl px-10 py-12 text-center">
        <div className="text-[36px] text-wf-accent mb-4">◈</div>
        <h2 className="text-[18px] font-bold text-wf-text mb-3">Coming Soon</h2>
        <p className="text-wf-muted text-[14px] max-w-[440px] mx-auto mb-5 leading-relaxed">
          The Relic Planner will let you input which relics you own, see expected
          plat per run, and plan the most efficient farming routes.
        </p>
        <ul className="inline-flex flex-col gap-2 text-left">
          {FEATURES.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] text-wf-muted">
              <span className="text-wf-accent text-[10px] mt-[3px] shrink-0">◈</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
