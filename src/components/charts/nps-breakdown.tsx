import { cn } from "@/lib/utils";
import type { NpsResult } from "@/lib/nps";
import { formatPct } from "@/lib/format";

/** Promoters / passives / detractors as a single 100% bar with a labelled legend. */
export function NpsBreakdown({ result, className }: { result: NpsResult; className?: string }) {
  const segs = [
    { key: "detractor", label: "Detractors", sub: "0–6", n: result.detractors, pct: result.detractorPct, cls: "bg-detractor" },
    { key: "passive", label: "Passives", sub: "7–8", n: result.passives, pct: result.passivePct, cls: "bg-passive" },
    { key: "promoter", label: "Promoters", sub: "9–10", n: result.promoters, pct: result.promoterPct, cls: "bg-promoter" },
  ];
  return (
    <div className={cn("w-full", className)}>
      {result.total === 0 ? (
        <div className="h-3 w-full rounded-full bg-muted" aria-label="No responses" />
      ) : (
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segs.map((s) => `${s.label} ${formatPct(s.pct)}`).join(", ")}>
          {segs.map((s) =>
            s.n > 0 ? <div key={s.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", s.cls)} style={{ width: `${s.pct}%` }} title={`${s.label}: ${s.n} (${formatPct(s.pct)})`} /> : null,
          )}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {segs.map((s) => (
          <div key={s.key}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-2 rounded-full", s.cls)} aria-hidden />
              {s.label} <span className="text-muted-foreground/70">({s.sub})</span>
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular">
              {s.n.toLocaleString()} <span className="font-normal text-muted-foreground">· {formatPct(s.pct)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
