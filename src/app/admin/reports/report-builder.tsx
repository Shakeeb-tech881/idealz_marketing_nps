"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, FileType2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Panel } from "@/components/admin/panel";
import { FormField } from "@/components/admin/form-field";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_CATEGORIES, type Branch, type Employee } from "@/lib/types";

export function ReportBuilder({ reports, branches, employees, defaultFrom, defaultTo }: { reports: { value: string; label: string; description: string }[]; branches: Branch[]; employees: Employee[]; defaultFrom: string; defaultTo: string }) {
  const [type, setType] = useState(reports[0].value);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [branch, setBranch] = useState("");
  const [employee, setEmployee] = useState("");
  const [surveyType, setSurveyType] = useState("");
  const [category, setCategory] = useState("");

  const href = (format: string) => {
    const p = new URLSearchParams({ type, format, range: "custom", from, to });
    if (branch) p.set("branch", branch);
    if (employee) p.set("employee", employee);
    if (surveyType) p.set("survey", surveyType); // `type` is the report type
    if (category) p.set("category", category);
    return `/api/reports?${p.toString()}`;
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title="1. Choose a report">
        <div className="grid gap-2 sm:grid-cols-2">
          {reports.map((r) => (
            <button key={r.value} onClick={() => setType(r.value)} className={cn("rounded-lg border p-3 text-left transition-colors", type === r.value ? "border-brand bg-brand-soft ring-1 ring-brand" : "border-border hover:bg-muted/50")}>
              <p className="text-sm font-medium">{r.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
            </button>
          ))}
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel title="2. Filters">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="From" htmlFor="r-from"><Input id="r-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></FormField>
            <FormField label="To" htmlFor="r-to"><Input id="r-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></FormField>
            {branches.length > 1 && (
              <FormField label="Branch" htmlFor="r-branch">
                <NativeSelect id="r-branch" value={branch} onChange={(e) => { setBranch(e.target.value); setEmployee(""); }}>
                  <option value="">All branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </NativeSelect>
              </FormField>
            )}
            <FormField label="Employee" htmlFor="r-emp">
              <NativeSelect id="r-emp" value={employee} onChange={(e) => setEmployee(e.target.value)}>
                <option value="">All employees</option>
                {(branch ? employees.filter((e) => e.branch_id === branch) : employees).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Customer type" htmlFor="r-type">
              <NativeSelect id="r-type" value={surveyType} onChange={(e) => setSurveyType(e.target.value)}>
                <option value="">All customers</option>
                <option value="purchased">Purchased</option>
                <option value="non_purchased">Non-purchased</option>
              </NativeSelect>
            </FormField>
            <FormField label="Product category" htmlFor="r-cat">
              <NativeSelect id="r-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            </FormField>
          </div>
        </Panel>
        <Panel title="3. Download">
          <div className="grid gap-2 sm:grid-cols-3">
            <a href={href("xlsx")} className={buttonVariants({ variant: "outline", className: "h-10" })}><FileSpreadsheet data-icon="inline-start" /> Excel</a>
            <a href={href("csv")} className={buttonVariants({ variant: "outline", className: "h-10" })}><FileType2 data-icon="inline-start" /> CSV</a>
            <a href={href("pdf")} className={buttonVariants({ variant: "outline", className: "h-10" })}><FileText data-icon="inline-start" /> PDF</a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Detail reports include up to 20,000 rows. Staff-level users see masked mobile numbers.</p>
        </Panel>
      </div>
    </div>
  );
}
