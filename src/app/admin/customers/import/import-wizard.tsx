"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { AlertCircle, CheckCircle2, Copy, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Panel } from "@/components/admin/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { IMPORT_FIELDS, MAX_IMPORT_ROWS, guessMapping, type ImportFieldKey, type MappedRow } from "@/lib/import/fields";
import { formatMobile } from "@/lib/phone";
import { commitImportAction, validateImportAction } from "../actions";

type Step = "upload" | "map" | "review" | "done";
type Validation = Awaited<ReturnType<typeof validateImportAction>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never;

async function parseFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    return { headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data };
  }
  if (name.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("The workbook has no worksheets.");
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => (headers[col - 1] = String(cell.text ?? "").trim()));
    const rows: Record<string, string>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      const rec: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        const cell = row.getCell(i + 1);
        const v = cell.value;
        if (v instanceof Date) rec[h] = v.toISOString().slice(0, 10);
        else rec[h] = String(cell.text ?? "").trim();
      });
      if (Object.values(rec).some((x) => x)) rows.push(rec);
    });
    return { headers: headers.filter(Boolean), rows };
  }
  throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const blob = new Blob(["﻿" + Papa.unparse(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportFieldKey, string>>>({});
  const [validation, setValidation] = useState<Validation | null>(null);
  const [result, setResult] = useState<(Validation & { imported: number }) | null>(null);
  const [filter, setFilter] = useState<"all" | "valid" | "error" | "duplicate">("all");
  const [pending, start] = useTransition();
  const [parseError, setParseError] = useState<string | null>(null);

  const mapped: MappedRow[] = useMemo(
    () => raw.map((r) => Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, mapping[f.key] ? (r[mapping[f.key]!] ?? "").toString() : ""])) as MappedRow),
    [raw, mapping],
  );
  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setParseError(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("File is larger than 10 MB.");
      const { headers, rows } = await parseFile(file);
      if (rows.length === 0) throw new Error("No data rows were found.");
      if (rows.length > MAX_IMPORT_ROWS) throw new Error(`The file has ${rows.length} rows. Please split it into files of at most ${MAX_IMPORT_ROWS} rows.`);
      setFileName(file.name);
      setHeaders(headers);
      setRaw(rows);
      setMapping(guessMapping(headers));
      setStep("map");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "The file could not be read.");
    }
  }

  function validate() {
    start(async () => {
      const res = await validateImportAction(mapped);
      if (!res.ok) return void toast.error(res.error);
      setValidation(res.data);
      setFilter("all");
      setStep("review");
    });
  }

  function commit() {
    if (!validation || validation.valid === 0) return;
    if (!confirm(`Import ${validation.valid} valid row${validation.valid === 1 ? "" : "s"}? Rows with errors or duplicates will be skipped.`)) return;
    start(async () => {
      const res = await commitImportAction(mapped);
      if (!res.ok) return void toast.error(res.error);
      setResult(res.data);
      setStep("done");
    });
  }

  function errorReport(v: Validation) {
    const rows = v.results.filter((r) => r.status !== "valid");
    downloadCsv(`import-errors-${fileName.replace(/\.[^.]+$/, "")}.csv`, [
      ["Row", "Status", "Problems", ...IMPORT_FIELDS.map((f) => f.label)],
      ...rows.map((r) => [r.row + 1, r.status, r.messages.join(" | "), ...IMPORT_FIELDS.map((f) => mapped[r.row - 1]?.[f.key] ?? "")]),
    ]);
  }

  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "map", label: "Map columns" },
    { key: "review", label: "Review" },
    { key: "done", label: "Summary" },
  ];
  const stepIdx = steps.findIndex((s) => s.key === step);

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s.key} className={cn("flex items-center gap-2 rounded-full border px-3 py-1", i === stepIdx ? "border-brand bg-brand text-white" : i < stepIdx ? "border-border bg-white text-foreground" : "border-border bg-white text-muted-foreground")}>
            <span className="tabular text-xs">{i + 1}</span> {s.label}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <Panel title="Upload a file" description="CSV (UTF-8) or Excel .xlsx · first row must contain column headers · up to 2,000 rows">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-12 text-center hover:bg-muted/50">
            <Upload className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">Choose a file or drag it here</span>
            <span className="text-xs text-muted-foreground">Required columns: customer name, mobile, branch (code or name), purchase status</span>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {parseError && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" /> {parseError}
            </p>
          )}
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-series-1 hover:underline"
            onClick={() =>
              downloadCsv("customer-import-template.csv", [
                IMPORT_FIELDS.map((f) => f.label),
                ["Nimal Perera", "0771234567", "", "COL03", "EMP001", "Purchased", "2026-11-01", "2026-11-01", "Smartphones", "iPhone 16 128GB", "INV-10234", "Walk-in"],
              ])
            }
          >
            <Download className="size-4" /> Download a template
          </button>
        </Panel>
      )}

      {step === "map" && (
        <Panel title="Map columns" description={`${fileName} · ${raw.length.toLocaleString()} rows · we matched columns automatically where we could`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key} className="space-y-1">
                <span className="text-sm font-medium">
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </span>
                <NativeSelect value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
                  <option value="">— Not in file —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </NativeSelect>
                {mapping[f.key] && raw[0] && <span className="block truncate text-xs text-muted-foreground">e.g. “{raw[0][mapping[f.key]!]}”</span>}
              </label>
            ))}
          </div>
          {missingRequired.length > 0 && <p className="mt-4 text-sm text-destructive">Map the required fields: {missingRequired.map((f) => f.label).join(", ")}</p>}
          <div className="mt-6 flex justify-between border-t border-border pt-4">
            <Button variant="outline" onClick={() => setStep("upload")}>Back</Button>
            <Button onClick={validate} disabled={missingRequired.length > 0 || pending}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Validate {raw.length.toLocaleString()} rows
            </Button>
          </div>
        </Panel>
      )}

      {step === "review" && validation && (
        <Panel
          title="Review before importing"
          description="Only valid rows will be imported. Returning customers (same mobile) are linked to their existing record."
          actions={validation.valid < validation.total && (
            <Button variant="outline" size="sm" onClick={() => errorReport(validation)}>
              <Download data-icon="inline-start" /> Error report
            </Button>
          )}
        >
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["all", "Total rows", validation.total, ""],
              ["valid", "Valid", validation.valid, "text-[#087a08]"],
              ["error", "Errors", validation.errors, "text-destructive"],
              ["duplicate", "Duplicates", validation.duplicates, "text-[#8a5f00]"],
            ] as const).map(([key, label, n, cls]) => (
              <button key={key} onClick={() => setFilter(key)} className={cn("rounded-lg border p-3 text-left", filter === key ? "border-brand ring-1 ring-brand" : "border-border")}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={cn("text-xl font-semibold tabular", cls)}>{n.toLocaleString()}</p>
              </button>
            ))}
          </div>
          <div className="max-h-[480px] overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted">
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Purchase</TableHead>
                  <TableHead>Problems</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {validation.results
                  .filter((r) => filter === "all" || r.status === filter)
                  .slice(0, 500)
                  .map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="tabular">{r.row + 1}</TableCell>
                      <TableCell>
                        {r.status === "valid" ? (
                          <span className="inline-flex items-center gap-1 text-[#087a08]"><CheckCircle2 className="size-3.5" /> Valid</span>
                        ) : r.status === "duplicate" ? (
                          <span className="inline-flex items-center gap-1 text-[#8a5f00]"><Copy className="size-3.5" /> Duplicate</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive"><AlertCircle className="size-3.5" /> Error</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.preview?.full_name ?? mapped[r.row - 1]?.full_name ?? "—"}
                        {r.returningCustomer && <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Returning</span>}
                      </TableCell>
                      <TableCell className="tabular">{r.preview ? formatMobile(r.preview.mobile) : mapped[r.row - 1]?.mobile}</TableCell>
                      <TableCell>{r.preview?.branch ?? mapped[r.row - 1]?.branch}</TableCell>
                      <TableCell>{r.preview?.purchase_status === "purchased" ? "Purchased" : r.preview?.purchase_status === "not_purchased" ? "Not purchased" : mapped[r.row - 1]?.purchase_status}</TableCell>
                      <TableCell className="max-w-80 text-xs whitespace-normal text-muted-foreground">{r.messages.join("; ")}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-6 flex justify-between border-t border-border pt-4">
            <Button variant="outline" onClick={() => setStep("map")}>Back to mapping</Button>
            <Button onClick={commit} disabled={pending || validation.valid === 0}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Import {validation.valid.toLocaleString()} valid rows
            </Button>
          </div>
        </Panel>
      )}

      {step === "done" && result && (
        <Panel title="Import complete">
          <div className="flex items-start gap-4">
            <span className="flex size-12 items-center justify-center rounded-full bg-promoter-soft text-promoter"><FileSpreadsheet className="size-6" /></span>
            <div className="space-y-1 text-sm">
              <p><strong className="tabular">{result.imported.toLocaleString()}</strong> interactions imported ({result.returning.toLocaleString()} for returning customers).</p>
              <p className="text-muted-foreground"><span className="tabular">{result.errors}</span> rows with errors and <span className="tabular">{result.duplicates}</span> duplicates were skipped.</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {(result.errors > 0 || result.duplicates > 0) && (
              <Button variant="outline" onClick={() => errorReport(result)}>
                <Download data-icon="inline-start" /> Download skipped rows
              </Button>
            )}
            <Link href="/admin/messaging" className={buttonVariants()}>Send survey invitations</Link>
            <Link href="/admin/customers" className={buttonVariants({ variant: "outline" })}>View customers</Link>
          </div>
        </Panel>
      )}
    </div>
  );
}
