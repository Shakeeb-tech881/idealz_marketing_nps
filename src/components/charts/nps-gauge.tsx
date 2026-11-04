import { formatNps } from "@/lib/nps";

/** Semi-circular NPS gauge (−100…+100). Shows N/A when there are no responses. */
export function NpsGauge({ nps, size = 220, label = "Net Promoter Score" }: { nps: number | null; size?: number; label?: string }) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = size * 0.55;
  const r = size * 0.42;
  const stroke = size * 0.085;
  const angle = (v: number) => Math.PI * (1 - (v + 100) / 200); // -100 → π (left), 100 → 0 (right)
  const pt = (v: number, rad = r) => [cx + rad * Math.cos(angle(v)), cy - rad * Math.sin(angle(v))] as const;
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(to);
    const large = Math.abs(angle(from) - angle(to)) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  const v = nps === null ? null : Math.max(-100, Math.min(100, nps));
  const color = v === null ? "var(--muted-foreground)" : v < 0 ? "var(--detractor)" : v < 30 ? "var(--passive)" : "var(--promoter)";
  return (
    <figure className="flex flex-col items-center" aria-label={`${label}: ${formatNps(nps)}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img">
        <path d={arc(-100, 100)} fill="none" stroke="#e8ebf0" strokeWidth={stroke} strokeLinecap="round" />
        {v !== null && v !== 0 && (
          <path d={v > 0 ? arc(0, v) : arc(v, 0)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        )}
        {/* zero tick */}
        {(() => {
          const [x1, y1] = pt(0, r - stroke / 2 - 4);
          const [x2, y2] = pt(0, r + stroke / 2 + 4);
          return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9aa5b4" strokeWidth={1.5} />;
        })()}
        <text x={cx} y={cy - r * 0.12} textAnchor="middle" className="tabular" style={{ fontSize: size * 0.2, fontWeight: 650, fill: "var(--foreground)" }}>
          {formatNps(nps)}
        </text>
        <text x={cx - r} y={cy + stroke * 1.1} textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted-foreground)" }}>
          −100
        </text>
        <text x={cx} y={cy - r - stroke * 0.85} textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted-foreground)" }}>
          0
        </text>
        <text x={cx + r} y={cy + stroke * 1.1} textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted-foreground)" }}>
          +100
        </text>
      </svg>
      <figcaption className="-mt-1 text-xs font-medium text-muted-foreground">{label}</figcaption>
    </figure>
  );
}
