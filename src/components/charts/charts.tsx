"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNps } from "@/lib/nps";

const AXIS = { fontSize: 11, fill: "#5b6779" };
const GRID = "#e8ebf0";
export const SERIES = { overall: "#0f2747", purchased: "#2a78d6", nonPurchased: "#eb6834" } as const;
const STATUS = { promoter: "#0ca30c", passive: "#e09a00", detractor: "#d03b3b" } as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted-foreground">
          {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-semibold text-foreground tabular">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

function NoData({ height = 260, message = "No responses in this period" }: { height?: number; message?: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground" style={{ height }}>
      {message}
    </div>
  );
}

export interface TrendDatum {
  label: string;
  overall: number | null;
  purchased: number | null;
  nonPurchased: number | null;
  responses: number;
  purchasedResponses: number;
  nonPurchasedResponses: number;
}

/** NPS over time — overall plus purchased / non-purchased segments (one y-axis, −100…100). */
export function NpsTrendChart({ data, segments = true, height = 280 }: { data: TrendDatum[]; segments?: boolean; height?: number }) {
  if (data.length === 0) return <NoData height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
        <YAxis domain={[-100, 100]} ticks={[-100, -50, 0, 50, 100]} tick={AXIS} tickLine={false} axisLine={false} />
        <ReferenceLine y={0} stroke="#b8c0cc" />
        <Tooltip
          cursor={{ stroke: "#b8c0cc", strokeDasharray: "3 3" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={String(label)}
                rows={[
                  { label: `Overall (n=${payload[0].payload.responses})`, value: formatNps(payload[0].payload.overall), color: SERIES.overall },
                  ...(segments
                    ? [
                        { label: `Purchased (n=${payload[0].payload.purchasedResponses})`, value: formatNps(payload[0].payload.purchased), color: SERIES.purchased },
                        { label: `Non-purchased (n=${payload[0].payload.nonPurchasedResponses})`, value: formatNps(payload[0].payload.nonPurchased), color: SERIES.nonPurchased },
                      ]
                    : []),
                ]}
              />
            ) : null
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Line name="Overall" type="monotone" dataKey="overall" stroke={SERIES.overall} strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} connectNulls />
        {segments && (
          <Line name="Purchased" type="monotone" dataKey="purchased" stroke={SERIES.purchased} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} connectNulls />
        )}
        {segments && (
          <Line name="Non-purchased" type="monotone" dataKey="nonPurchased" stroke={SERIES.nonPurchased} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} connectNulls />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface SegmentNpsDatum {
  name: string;
  nps: number | null;
  n: number;
  reliable: boolean;
}

/** Horizontal NPS bars per segment (branch / employee). Low-sample bars are muted and labelled. */
export function SegmentNpsChart({ data, height }: { data: SegmentNpsDatum[]; height?: number }) {
  const rows = data.filter((d) => d.nps !== null);
  if (rows.length === 0) return <NoData height={height ?? 200} />;
  const h = height ?? Math.max(160, rows.length * 38 + 40);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }} barCategoryGap={8}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[-100, 100]} ticks={[-100, -50, 0, 50, 100]} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ ...AXIS, fill: "#0b1b33" }} tickLine={false} axisLine={false} width={120} />
        <ReferenceLine x={0} stroke="#b8c0cc" />
        <Tooltip
          cursor={{ fill: "rgba(15,39,71,0.04)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={payload[0].payload.name}
                rows={[
                  { label: "NPS", value: formatNps(payload[0].payload.nps) },
                  { label: "Responses", value: String(payload[0].payload.n) },
                  ...(payload[0].payload.reliable ? [] : [{ label: "Sample", value: "Low – interpret with care" }]),
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="nps" radius={4} maxBarSize={22}>
          {rows.map((d) => (
            <Cell key={d.name} fill={SERIES.purchased} fillOpacity={d.reliable ? 1 : 0.35} />
          ))}
          <LabelList
            dataKey="nps"
            position="right"
            content={(p) => {
              const { x = 0, y = 0, width = 0, height: hh = 0, index = 0 } = p as { x?: number; y?: number; width?: number; height?: number; index?: number };
              const d = rows[index];
              const end = Number(x) + Math.max(0, Number(width));
              return (
                <text x={end + 6} y={Number(y) + Number(hh) / 2} dominantBaseline="central" fontSize={11} fill="#0b1b33" className="tabular">
                  {formatNps(d.nps)} <tspan fill="#5b6779">· n={d.n}</tspan>
                </text>
              );
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Distribution of a 1–5 rating question. */
export function RatingDistributionChart({ counts, labels, height = 200 }: { counts: number[]; labels: string[]; height?: number }) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return <NoData height={height} />;
  const data = counts.map((c, i) => ({ label: labels[i], value: c, pct: Math.round((c / total) * 1000) / 10 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "rgba(15,39,71,0.04)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox title={payload[0].payload.label} rows={[{ label: "Responses", value: `${payload[0].payload.value} (${payload[0].payload.pct}%)` }]} />
            ) : null
          }
        />
        <Bar dataKey="value" fill={SERIES.purchased} radius={[4, 4, 0, 0]} maxBarSize={44}>
          <LabelList dataKey="pct" position="top" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: "#5b6779" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 0–10 score distribution coloured by NPS category (with legend). */
export function NpsScoreChart({ data, height = 220 }: { data: { score: number; responses: number }[]; height?: number }) {
  if (data.every((d) => d.responses === 0)) return <NoData height={height} />;
  const color = (s: number) => (s >= 9 ? STATUS.promoter : s >= 7 ? STATUS.passive : STATUS.detractor);
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="score" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(15,39,71,0.04)" }}
            content={({ active, payload }) =>
              active && payload?.length ? <TooltipBox title={`Score ${payload[0].payload.score}`} rows={[{ label: "Responses", value: String(payload[0].payload.responses) }]} /> : null
            }
          />
          <Bar dataKey="responses" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.score} fill={color(d.score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: STATUS.detractor }} />Detractors 0–6</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: STATUS.passive }} />Passives 7–8</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: STATUS.promoter }} />Promoters 9–10</span>
      </div>
    </div>
  );
}

/** Horizontal bars for categorical counts (e.g. reasons for not purchasing, themes). */
export function HorizontalBarChart({ data, height, valueLabel = "Responses", color = SERIES.nonPurchased }: { data: { name: string; value: number; sub?: string }[]; height?: number; valueLabel?: string; color?: string }) {
  if (data.length === 0 || data.every((d) => d.value === 0)) return <NoData height={height ?? 200} />;
  const h = height ?? Math.max(160, data.length * 34 + 24);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ ...AXIS, fill: "#0b1b33" }} tickLine={false} axisLine={false} width={190} />
        <Tooltip
          cursor={{ fill: "rgba(15,39,71,0.04)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox title={payload[0].payload.name} rows={[{ label: valueLabel, value: String(payload[0].payload.value) }, ...(payload[0].payload.sub ? [{ label: "Detail", value: payload[0].payload.sub }] : [])]} />
            ) : null
          }
        />
        <Bar dataKey="value" fill={color} radius={4} maxBarSize={20}>
          <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: "#0b1b33" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Monthly response rate (%) — single measure on one axis; counts in tooltip. */
export function ResponseRateChart({ data, height = 240 }: { data: { label: string; rate: number | null; dispatched: number; completed: number }[]; height?: number }) {
  if (data.length === 0) return <NoData height={height} message="No invitations sent in this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "rgba(15,39,71,0.04)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={payload[0].payload.label}
                rows={[
                  { label: "Response rate", value: payload[0].payload.rate === null ? "N/A" : `${payload[0].payload.rate}%` },
                  { label: "SMS sent", value: String(payload[0].payload.dispatched) },
                  { label: "Completed", value: String(payload[0].payload.completed) },
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="rate" fill={SERIES.purchased} radius={[4, 4, 0, 0]} maxBarSize={40}>
          <LabelList dataKey="rate" position="top" formatter={(v) => (v === null || v === undefined ? "" : `${v}%`)} style={{ fontSize: 11, fill: "#5b6779" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Purchased vs non-purchased NPS side by side. */
export function SegmentComparisonChart({ purchased, nonPurchased, height = 200 }: { purchased: { nps: number | null; n: number }; nonPurchased: { nps: number | null; n: number }; height?: number }) {
  const data = [
    { name: "Purchased", nps: purchased.nps, n: purchased.n, color: SERIES.purchased },
    { name: "Non-purchased", nps: nonPurchased.nps, n: nonPurchased.n, color: SERIES.nonPurchased },
  ];
  if (purchased.n === 0 && nonPurchased.n === 0) return <NoData height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={{ ...AXIS, fill: "#0b1b33" }} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis domain={[-100, 100]} ticks={[-100, -50, 0, 50, 100]} tick={AXIS} tickLine={false} axisLine={false} />
        <ReferenceLine y={0} stroke="#b8c0cc" />
        <Tooltip
          cursor={{ fill: "rgba(15,39,71,0.04)" }}
          content={({ active, payload }) =>
            active && payload?.length ? <TooltipBox title={payload[0].payload.name} rows={[{ label: "NPS", value: formatNps(payload[0].payload.nps) }, { label: "Responses", value: String(payload[0].payload.n) }]} /> : null
          }
        />
        <Bar dataKey="nps" radius={4} maxBarSize={64}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
          <LabelList dataKey="nps" position="top" formatter={(v) => formatNps(v === undefined ? null : (v as number | null))} style={{ fontSize: 12, fontWeight: 600, fill: "#0b1b33" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
