"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { classifyNps } from "@/lib/nps";

const tone = {
  detractor: "data-[selected=true]:bg-detractor data-[selected=true]:border-detractor hover:border-detractor/60",
  passive: "data-[selected=true]:bg-passive data-[selected=true]:border-passive hover:border-passive/60",
  promoter: "data-[selected=true]:bg-promoter data-[selected=true]:border-promoter hover:border-promoter/60",
} as const;

const bar = { detractor: "bg-detractor/70", passive: "bg-passive/70", promoter: "bg-promoter/70" } as const;

/** 0–10 likelihood-to-recommend scale (11 boxes), keyboard accessible radio group. */
export function NpsScale({ value, onChange, labelledBy }: { value: number | undefined; onChange: (v: number) => void; labelledBy: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = value ?? 0;

  function onKey(e: React.KeyboardEvent, i: number) {
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(10, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 10;
    else return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-6 gap-2 sm:grid-cols-11 sm:gap-1.5">
        {Array.from({ length: 11 }, (_, i) => {
          const cat = classifyNps(i);
          const selected = value === i;
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${i}${i === 0 ? " – Not at all likely" : i === 10 ? " – Extremely likely" : ""}`}
              tabIndex={i === focusIndex ? 0 : -1}
              data-selected={selected}
              onClick={() => onChange(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative flex h-12 items-center justify-center rounded-lg border border-border bg-white text-base font-semibold text-foreground tabular transition-colors",
                "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[selected=true]:text-white data-[selected=true]:shadow-sm",
                tone[cat],
              )}
            >
              {i}
              <span aria-hidden className={cn("absolute inset-x-2 bottom-1 h-0.5 rounded-full", selected ? "bg-white/70" : bar[cat])} />
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between text-xs font-medium text-muted-foreground">
        <span>0 · Not at all likely</span>
        <span>10 · Extremely likely</span>
      </div>
    </div>
  );
}
