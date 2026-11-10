"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { Branch, Employee } from "@/lib/types";

export function FeedbackFilters({ branches, employees }: { branches: Branch[]; employees: Employee[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    next.delete("page");
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }
  useEffect(() => {
    const t = setTimeout(() => (sp.get("q") ?? "") !== q && update({ q: q.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const quick: { label: string; patch: Record<string, string | null> }[] = [
    { label: "All", patch: { category: null, complaints: null, status: null } },
    { label: "Detractors", patch: { category: "detractor", complaints: null } },
    { label: "Complaints", patch: { complaints: "1", category: null } },
    { label: "Needs contact", patch: { status: "contact_required" } },
    { label: "New", patch: { status: "new" } },
  ];
  const branch = sp.get("branch") ?? "";
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {quick.map((qk) => {
          const active = Object.entries(qk.patch).every(([k, v]) => (sp.get(k) ?? null) === v) && (qk.label !== "All" || !sp.get("category"));
          return (
            <button key={qk.label} onClick={() => update(qk.patch)} className={cn("rounded-full border px-3 py-1 text-sm", active ? "border-brand bg-brand text-white" : "border-border bg-white text-muted-foreground hover:text-foreground")}>
              {qk.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Search</span>
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer name or mobile…" className="h-9 bg-white pl-9" />
        </label>
        <NativeSelect className="w-40" aria-label="NPS category" value={sp.get("category") ?? ""} onChange={(e) => update({ category: e.target.value || null })}>
          <option value="">All categories</option>
          <option value="promoter">Promoters</option>
          <option value="passive">Passives</option>
          <option value="detractor">Detractors</option>
        </NativeSelect>
        <NativeSelect className="w-40" aria-label="Customer type" value={sp.get("type") ?? ""} onChange={(e) => update({ type: e.target.value || null })}>
          <option value="">All customers</option>
          <option value="purchased">Purchased</option>
          <option value="non_purchased">Non-purchased</option>
        </NativeSelect>
        {branches.length > 1 && (
          <NativeSelect className="w-44" aria-label="Branch" value={branch} onChange={(e) => update({ branch: e.target.value || null, employee: null })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        )}
        {employees.length > 1 && (
          <NativeSelect className="w-44" aria-label="Employee" value={sp.get("employee") ?? ""} onChange={(e) => update({ employee: e.target.value || null })}>
            <option value="">All employees</option>
            {(branch ? employees.filter((e) => e.branch_id === branch) : employees).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </NativeSelect>
        )}
        <NativeSelect className="w-44" aria-label="Follow-up status" value={sp.get("status") ?? ""} onChange={(e) => update({ status: e.target.value || null })}>
          <option value="">Any follow-up status</option>
          <option value="new">New</option>
          <option value="under_review">Under review</option>
          <option value="contact_required">Contact required</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </NativeSelect>
        <Input type="date" aria-label="From" className="h-9 w-38 bg-white" value={sp.get("from") ?? ""} onChange={(e) => update({ from: e.target.value || null })} />
        <Input type="date" aria-label="To" className="h-9 w-38 bg-white" value={sp.get("to") ?? ""} onChange={(e) => update({ to: e.target.value || null })} />
        {pending && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
      </div>
    </div>
  );
}
