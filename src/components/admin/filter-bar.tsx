"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RANGE_PRESETS } from "@/lib/analytics/filters";
import { PRODUCT_CATEGORIES } from "@/lib/types";

export interface FilterOptions {
  branches: { id: string; name: string }[];
  employees: { id: string; full_name: string; branch_id: string }[];
}

type FilterKey = "range" | "branch" | "employee" | "type" | "category";

/**
 * One row of filters above the content. All state lives in the URL so the
 * server renders the filtered data and links are shareable.
 */
export function FilterBar({
  options,
  show = ["range", "branch", "employee", "type", "category"],
  values,
  defaultRange = "90d",
}: {
  options: FilterOptions;
  show?: FilterKey[];
  values: { from: string; to: string; range: string; branch: string | null; employee: string | null; surveyType: string | null; category: string | null };
  defaultRange?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const employees = values.branch ? options.employees.filter((e) => e.branch_id === values.branch) : options.employees;
  const dirty = ["branch", "employee", "type", "category"].some((k) => sp.get(k)) || (sp.get("range") ?? defaultRange) !== defaultRange;

  return (
    <div className="glass mb-6 flex flex-wrap items-end gap-2 rounded-2xl p-3">
      {show.includes("range") && (
        <label className="flex min-w-36 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Period</span>
          <NativeSelect
            value={values.range}
            onChange={(e) => update(e.target.value === "custom" ? { range: "custom", from: values.from, to: values.to } : { range: e.target.value, from: null, to: null })}
          >
            {RANGE_PRESETS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {show.includes("range") && values.range === "custom" && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">From</span>
            <Input type="date" className="h-9 bg-white" value={values.from} max={values.to} onChange={(e) => e.target.value && update({ range: "custom", from: e.target.value, to: values.to })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">To</span>
            <Input type="date" className="h-9 bg-white" value={values.to} min={values.from} onChange={(e) => e.target.value && update({ range: "custom", from: values.from, to: e.target.value })} />
          </label>
        </>
      )}
      {show.includes("branch") && options.branches.length > 1 && (
        <label className="flex min-w-40 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Branch</span>
          <NativeSelect value={values.branch ?? ""} onChange={(e) => update({ branch: e.target.value || null, employee: null })}>
            <option value="">All branches</option>
            {options.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {show.includes("employee") && (
        <label className="flex min-w-40 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Employee</span>
          <NativeSelect value={values.employee ?? ""} onChange={(e) => update({ employee: e.target.value || null })}>
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {show.includes("type") && (
        <label className="flex min-w-44 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Purchase status / survey</span>
          <NativeSelect value={values.surveyType ?? ""} onChange={(e) => update({ type: e.target.value || null })}>
            <option value="">All customers</option>
            <option value="purchased">Purchased</option>
            <option value="non_purchased">Non-purchased</option>
          </NativeSelect>
        </label>
      )}
      {show.includes("category") && (
        <label className="flex min-w-40 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Product category</span>
          <NativeSelect value={values.category ?? ""} onChange={(e) => update({ category: e.target.value || null })}>
            <option value="">All categories</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      <div className="ml-auto flex items-center gap-2 self-center pt-4">
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => start(() => router.push(pathname, { scroll: false }))}>
            <RotateCcw data-icon="inline-start" /> Reset
          </Button>
        )}
      </div>
    </div>
  );
}
