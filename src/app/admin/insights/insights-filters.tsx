"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { AGE_OPTIONS } from "@/lib/insights/filters";
import { PRODUCT_CATEGORIES, type Branch } from "@/lib/types";

/** Filters live in the URL so a filtered list can be shared, exported or turned into an offer. */
export function InsightsFilters({ branches }: { branches: Branch[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [model, setModel] = useState(sp.get("model") ?? "");

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    next.delete("page");
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    const t = setTimeout(() => {
      const patch: Record<string, string | null> = {};
      if ((sp.get("q") ?? "") !== q) patch.q = q.trim() || null;
      if ((sp.get("model") ?? "") !== model) patch.model = model.trim() || null;
      if (Object.keys(patch).length) update(patch);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, model]);

  const sel = (key: string) => sp.get(key) ?? "";
  const anyFilter = [...sp.keys()].some((k) => k !== "page");

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
      <label className="relative min-w-52 flex-1">
        <span className="sr-only">Search name or mobile</span>
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or mobile…" className="h-9 bg-white pl-9" />
      </label>
      <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model bought, e.g. iPhone 15" aria-label="Model bought" className="h-9 w-56 bg-white" />
      <NativeSelect className="w-36" aria-label="Brand bought" value={sel("brand")} onChange={(e) => update({ brand: e.target.value || null })}>
        <option value="">Any brand</option>
        <option value="apple">Apple</option>
        <option value="android">Android</option>
      </NativeSelect>
      <NativeSelect className="w-40" aria-label="Category bought" value={sel("category")} onChange={(e) => update({ category: e.target.value || null })}>
        <option value="">Any category</option>
        {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </NativeSelect>
      {branches.length > 1 && (
        <NativeSelect className="w-40" aria-label="Showroom" value={sel("branch")} onChange={(e) => update({ branch: e.target.value || null })}>
          <option value="">All showrooms</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </NativeSelect>
      )}
      <NativeSelect className="w-52" aria-label="Last purchase" value={sel("age")} onChange={(e) => update({ age: e.target.value || null })}>
        <option value="">Any last purchase date</option>
        {AGE_OPTIONS.map((m) => <option key={m} value={m}>Last purchase over {m} months ago</option>)}
      </NativeSelect>
      <NativeSelect className="w-44" aria-label="Latest feedback" value={sel("nps")} onChange={(e) => update({ nps: e.target.value || null })}>
        <option value="">Any feedback</option>
        <option value="promoter">Promoters (9–10)</option>
        <option value="passive">Passives (7–8)</option>
        <option value="detractor">Detractors (0–6)</option>
        <option value="none">No survey answer</option>
      </NativeSelect>
      <NativeSelect className="w-40" aria-label="Offer SMS" value={sel("offers")} onChange={(e) => update({ offers: e.target.value || null })}>
        <option value="">Offers: any</option>
        <option value="allowed">Can receive offers</option>
        <option value="opted_out">Stopped offers / SMS</option>
      </NativeSelect>
      <Input type="date" aria-label="Visited from" title="Visited from" className="h-9 w-38 bg-white" value={sel("from")} onChange={(e) => update({ from: e.target.value || null })} />
      <Input type="date" aria-label="Visited to" title="Visited to" className="h-9 w-38 bg-white" value={sel("to")} onChange={(e) => update({ to: e.target.value || null })} />
      {anyFilter && (
        <button type="button" className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => { setQ(""); setModel(""); start(() => router.push(pathname, { scroll: false })); }}>
          <X className="size-4" /> Clear
        </button>
      )}
      {pending && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
