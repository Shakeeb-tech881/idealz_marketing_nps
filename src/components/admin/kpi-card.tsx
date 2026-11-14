import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  accent?: "promoter" | "passive" | "detractor" | "series-1" | "series-2" | "brand";
  className?: string;
}) {
  const dot = {
    promoter: "bg-promoter",
    passive: "bg-passive",
    detractor: "bg-detractor",
    "series-1": "bg-series-1",
    "series-2": "bg-series-2",
    brand: "bg-brand",
  } as const;
  return (
    <div className={cn("glass rounded-2xl px-4 py-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {accent && <span className={cn("size-2 rounded-full", dot[accent])} aria-hidden />}
          {label}
        </p>
        {Icon && <Icon className="size-4 text-muted-foreground/70" aria-hidden />}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
