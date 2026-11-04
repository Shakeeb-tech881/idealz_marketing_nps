"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { ScaleOption } from "@/lib/survey/definitions";

/** Five selectable emojis with labels. Stores the numeric value (1–5), never the emoji. */
export function EmojiScale({ options, value, onChange, labelledBy }: { options: ScaleOption[]; value: number | undefined; onChange: (v: number) => void; labelledBy: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusValue = value ?? options[0].value;

  function onKey(e: React.KeyboardEvent, idx: number) {
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(options.length - 1, idx + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, idx - 1);
    else return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-5 gap-2 sm:gap-3">
      {options.map((o, idx) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            tabIndex={o.value === focusValue ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, idx)}
            className={cn(
              "group flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-white px-1 py-3 transition-all",
              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "border-brand bg-brand-soft shadow-sm" : "border-border hover:border-brand/40 hover:bg-muted/50",
            )}
          >
            <span aria-hidden className={cn("text-3xl leading-none transition-transform sm:text-4xl", selected ? "scale-110" : "grayscale-[35%] group-hover:grayscale-0")}>
              {o.emoji}
            </span>
            <span className={cn("text-center text-[11px] leading-tight sm:text-xs", selected ? "font-semibold text-brand" : "text-muted-foreground")}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
