"use client";

import { useRef, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScaleOption } from "@/lib/survey/definitions";

/** Interactive five-star rating stored as an integer 1–5. */
export function StarRating({ options, value, onChange, labelledBy }: { options: ScaleOption[]; value: number | undefined; onChange: (v: number) => void; labelledBy: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = hover ?? value ?? 0;
  const label = options.find((o) => o.value === shown)?.label;

  function onKey(e: React.KeyboardEvent, v: number) {
    let next = v;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, v + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, v - 1);
    else return;
    e.preventDefault();
    onChange(next);
    refs.current[next - 1]?.focus();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div role="radiogroup" aria-labelledby={labelledBy} className="flex gap-1.5 sm:gap-3" onMouseLeave={() => setHover(null)}>
        {options.map((o) => {
          const active = o.value <= shown;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[o.value - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === o.value}
              aria-label={`${o.value} star${o.value > 1 ? "s" : ""} – ${o.label}`}
              tabIndex={o.value === (value ?? 1) ? 0 : -1}
              onClick={() => onChange(o.value)}
              onMouseEnter={() => setHover(o.value)}
              onKeyDown={(e) => onKey(e, o.value)}
              className="rounded-lg p-1.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Star
                className={cn("size-10 sm:size-12 transition-colors", active ? "fill-amber-400 text-amber-400" : "fill-transparent text-slate-300")}
                strokeWidth={1.5}
              />
            </button>
          );
        })}
      </div>
      <p className={cn("h-5 text-sm font-medium", label ? "text-foreground" : "text-muted-foreground")} aria-live="polite">
        {label ? `${shown} of 5 · ${label}` : "Tap a star to rate"}
      </p>
    </div>
  );
}
