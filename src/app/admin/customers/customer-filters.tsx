"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Branch, Employee } from "@/lib/types";

export function CustomerFilters({ branches, employees }: { branches: Branch[]; employees: Employee[] }) {
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
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) update({ q: q.trim() || null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const branch = sp.get("branch") ?? "";
  const emps = branch ? employees.filter((e) => e.branch_id === branch) : employees;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
      <label className="relative min-w-60 flex-1">
        <span className="sr-only">Search</span>
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile or invoice…" className="h-9 bg-white pl-9" />
      </label>
      {branches.length > 1 && (
        <NativeSelect className="w-44" aria-label="Branch" value={branch} onChange={(e) => update({ branch: e.target.value || null, employee: null })}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </NativeSelect>
      )}
      <NativeSelect className="w-44" aria-label="Employee" value={sp.get("employee") ?? ""} onChange={(e) => update({ employee: e.target.value || null })}>
        <option value="">All employees</option>
        {emps.map((e) => (
          <option key={e.id} value={e.id}>{e.full_name}</option>
        ))}
      </NativeSelect>
      <NativeSelect className="w-40" aria-label="Purchase status" value={sp.get("status") ?? ""} onChange={(e) => update({ status: e.target.value || null })}>
        <option value="">All statuses</option>
        <option value="purchased">Purchased</option>
        <option value="not_purchased">Not purchased</option>
      </NativeSelect>
      <NativeSelect className="w-40" aria-label="Survey status" value={sp.get("survey") ?? ""} onChange={(e) => update({ survey: e.target.value || null })}>
        <option value="">Any survey status</option>
        <option value="not_invited">Not invited</option>
        <option value="invited">Invited</option>
        <option value="completed">Completed</option>
      </NativeSelect>
      <Input type="date" aria-label="From date" className="h-9 w-38 bg-white" value={sp.get("from") ?? ""} onChange={(e) => update({ from: e.target.value || null })} />
      <Input type="date" aria-label="To date" className="h-9 w-38 bg-white" value={sp.get("to") ?? ""} onChange={(e) => update({ to: e.target.value || null })} />
      {pending && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
    </div>
  );
}
