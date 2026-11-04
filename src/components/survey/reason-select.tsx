"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_OTHER_REASON_LENGTH, NON_PURCHASE_REASONS } from "@/lib/survey/definitions";

export function ReasonSelect({
  value,
  other,
  onChange,
  onOtherChange,
  labelledBy,
  otherError,
}: {
  value: string | undefined;
  other: string;
  onChange: (v: string) => void;
  onOtherChange: (v: string) => void;
  labelledBy: string;
  otherError?: string;
}) {
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2 sm:grid-cols-2">
        {NON_PURCHASE_REASONS.map((r) => {
          const selected = value === r.value;
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(r.value)}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected ? "border-brand bg-brand-soft font-medium text-brand" : "border-border hover:border-brand/40 hover:bg-muted/50",
              )}
            >
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-brand bg-brand text-white" : "border-slate-300")}>
                {selected && <Check className="size-3" strokeWidth={3} />}
              </span>
              {r.label}
            </button>
          );
        })}
      </div>
      {value === "other" && (
        <div className="space-y-1.5">
          <label htmlFor="other-reason" className="text-sm font-medium">
            Please tell us the reason <span className="text-detractor">*</span>
          </label>
          <textarea
            id="other-reason"
            value={other}
            maxLength={MAX_OTHER_REASON_LENGTH}
            onChange={(e) => onOtherChange(e.target.value)}
            rows={3}
            aria-invalid={Boolean(otherError)}
            className="w-full rounded-xl border border-input bg-white px-3.5 py-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
            placeholder="Your reason…"
          />
          {otherError && <p className="text-sm text-destructive">{otherError}</p>}
        </div>
      )}
    </div>
  );
}
