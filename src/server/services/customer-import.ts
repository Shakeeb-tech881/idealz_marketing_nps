import "server-only";
import { createClient } from "@/lib/supabase/server";
import { customerContactSchema, interactionSchema } from "@/lib/validation/customer";
import { MAX_IMPORT_ROWS, parseDate, parsePurchaseStatus, parseSource, type MappedRow } from "@/lib/import/fields";
import { todayColombo } from "@/lib/format";
import type { Branch, Employee, Profile } from "@/lib/types";
import { friendlyDbError, insertInteraction } from "./customers";

export interface ImportRowResult {
  row: number; // 1-based data row (excluding header)
  status: "valid" | "error" | "duplicate";
  messages: string[];
  returningCustomer?: boolean;
  preview?: { full_name: string; mobile: string; branch: string; employee: string | null; purchase_status: string; invoice_number: string | null };
}

interface Prepared {
  result: ImportRowResult;
  contact?: { full_name: string; mobile: string; email: string | null };
  interaction?: ReturnType<typeof interactionSchema.parse>;
}

async function prepare(actor: Profile, rows: MappedRow[]): Promise<Prepared[]> {
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`A single import is limited to ${MAX_IMPORT_ROWS} rows.`);
  const supabase = await createClient();
  const [{ data: branches }, { data: employees }] = await Promise.all([
    supabase.from("branches").select("id, name, code, is_active"),
    supabase.from("employees").select("id, branch_id, full_name, employee_code, is_active"),
  ]);
  const writableBranches = ((branches ?? []) as Branch[]).filter(
    (b) => b.is_active && (actor.role === "super_admin" || actor.role === "management" || b.id === actor.branch_id),
  );
  const findBranch = (v: string) => {
    const s = v.trim().toLowerCase();
    return writableBranches.find((b) => b.code.toLowerCase() === s || b.name.toLowerCase() === s);
  };
  const findEmployee = (v: string, branchId: string) => {
    const s = v.trim().toLowerCase();
    const inBranch = ((employees ?? []) as Employee[]).filter((e) => e.branch_id === branchId && e.is_active);
    return inBranch.find((e) => e.employee_code?.toLowerCase() === s) ?? inBranch.filter((e) => e.full_name.toLowerCase() === s).at(0);
  };

  const prepared: Prepared[] = rows.map((r, idx) => {
    const messages: string[] = [];
    const result: ImportRowResult = { row: idx + 1, status: "valid", messages };

    const contact = customerContactSchema.safeParse({ full_name: r.full_name ?? "", mobile: r.mobile ?? "", email: r.email ?? "" });
    if (!contact.success) contact.error.issues.forEach((i) => messages.push(`${String(i.path[0])}: ${i.message}`));

    const branch = r.branch ? findBranch(r.branch) : undefined;
    if (!r.branch) messages.push("branch: Branch is required");
    else if (!branch) messages.push(`branch: "${r.branch}" is not a branch you can import into`);

    let employeeId: string | null = null;
    let employeeName: string | null = null;
    if (r.employee && branch) {
      const e = findEmployee(r.employee, branch.id);
      if (!e) messages.push(`employee: "${r.employee}" was not found in ${branch.name}`);
      else { employeeId = e.id; employeeName = e.full_name; }
    }

    const status = parsePurchaseStatus(r.purchase_status);
    if (!status) messages.push(`purchase_status: "${r.purchase_status ?? ""}" must be Purchased or Not purchased`);

    const interactionDate = parseDate(r.interaction_date);
    const purchaseDate = parseDate(r.purchase_date);
    if (interactionDate === "invalid") messages.push("interaction_date: Unrecognised date (use YYYY-MM-DD or DD/MM/YYYY)");
    if (purchaseDate === "invalid") messages.push("purchase_date: Unrecognised date (use YYYY-MM-DD or DD/MM/YYYY)");
    const visit = (interactionDate !== "invalid" && interactionDate) || (purchaseDate !== "invalid" && purchaseDate) || todayColombo();
    if (visit > todayColombo()) messages.push("date: Dates cannot be in the future");
    if (status === "not_purchased" && r.invoice_number?.trim()) messages.push("invoice_number: Non-purchased records cannot have an invoice number");

    let interaction: Prepared["interaction"];
    if (messages.length === 0 && branch && status) {
      const ip = interactionSchema.safeParse({
        branch_id: branch.id,
        employee_id: employeeId ?? "",
        purchase_status: status,
        interaction_date: visit,
        purchase_date: purchaseDate && purchaseDate !== "invalid" ? purchaseDate : "",
        product_category: r.product_category ?? "",
        product_model: r.product_model ?? "",
        invoice_number: r.invoice_number ?? "",
        source: parseSource(r.source),
        notes: "",
      });
      if (!ip.success) ip.error.issues.forEach((i) => messages.push(`${String(i.path[0])}: ${i.message}`));
      else interaction = ip.data;
    }

    if (messages.length) result.status = "error";
    if (contact.success && branch) {
      result.preview = {
        full_name: contact.data.full_name,
        mobile: contact.data.mobile,
        branch: branch.name,
        employee: employeeName,
        purchase_status: status ?? "—",
        invoice_number: r.invoice_number?.trim() || null,
      };
    }
    return { result, contact: contact.success ? contact.data : undefined, interaction };
  });

  // In-file duplicates (same branch + invoice, or same mobile + date + branch + status without invoice)
  const seen = new Map<string, number>();
  for (const p of prepared) {
    if (p.result.status !== "valid" || !p.interaction || !p.contact) continue;
    const i = p.interaction;
    const key = i.invoice_number
      ? `inv|${i.branch_id}|${i.invoice_number.toUpperCase()}`
      : `visit|${i.branch_id}|${p.contact.mobile}|${i.interaction_date}|${i.purchase_status}`;
    if (seen.has(key)) {
      p.result.status = "duplicate";
      p.result.messages.push(`Duplicate of row ${seen.get(key)} in this file`);
    } else seen.set(key, p.result.row);
  }

  // Database duplicates: existing invoices, and same-day visits for existing customers.
  const valid = prepared.filter((p) => p.result.status === "valid" && p.interaction && p.contact);
  const invoices = [...new Set(valid.map((p) => p.interaction!.invoice_number).filter(Boolean))] as string[];
  const mobiles = [...new Set(valid.map((p) => p.contact!.mobile))];

  const existingInvoices = new Set<string>();
  for (let i = 0; i < invoices.length; i += 200) {
    const { data } = await supabase.from("customer_interactions").select("branch_id, invoice_number").in("invoice_number", invoices.slice(i, i + 200));
    (data ?? []).forEach((d) => existingInvoices.add(`${d.branch_id}|${String(d.invoice_number).toUpperCase()}`));
  }
  const existingCustomers = new Map<string, string>();
  for (let i = 0; i < mobiles.length; i += 200) {
    const { data } = await supabase.from("customers").select("id, mobile").in("mobile", mobiles.slice(i, i + 200));
    (data ?? []).forEach((d) => existingCustomers.set(d.mobile as string, d.id as string));
  }
  const existingVisits = new Set<string>();
  const customerIds = [...existingCustomers.values()];
  for (let i = 0; i < customerIds.length; i += 200) {
    const { data } = await supabase
      .from("customer_interactions")
      .select("customer_id, branch_id, interaction_date, purchase_status")
      .in("customer_id", customerIds.slice(i, i + 200));
    (data ?? []).forEach((d) => existingVisits.add(`${d.customer_id}|${d.branch_id}|${d.interaction_date}|${d.purchase_status}`));
  }

  for (const p of valid) {
    const i = p.interaction!;
    const custId = existingCustomers.get(p.contact!.mobile);
    p.result.returningCustomer = Boolean(custId);
    if (i.invoice_number && existingInvoices.has(`${i.branch_id}|${i.invoice_number.toUpperCase()}`)) {
      p.result.status = "duplicate";
      p.result.messages.push("Invoice already recorded for this branch");
    } else if (!i.invoice_number && custId && existingVisits.has(`${custId}|${i.branch_id}|${i.interaction_date}|${i.purchase_status}`)) {
      p.result.status = "duplicate";
      p.result.messages.push("Same customer, branch, date and purchase status already recorded");
    }
  }
  return prepared;
}

export async function validateImport(actor: Profile, rows: MappedRow[]) {
  const prepared = await prepare(actor, rows);
  return summarise(prepared.map((p) => p.result));
}

export async function commitImport(actor: Profile, rows: MappedRow[]) {
  const prepared = await prepare(actor, rows);
  const supabase = await createClient();
  let imported = 0;
  for (const p of prepared) {
    if (p.result.status !== "valid" || !p.contact || !p.interaction) continue;
    const { data: customerId, error: cErr } = await supabase.rpc("ensure_customer", {
      p_full_name: p.contact.full_name,
      p_mobile: p.contact.mobile,
      p_email: p.contact.email,
    });
    if (cErr || !customerId) {
      p.result.status = "error";
      p.result.messages.push(friendlyDbError(cErr ?? { message: "Customer could not be created" }));
      continue;
    }
    const { error } = await insertInteraction(supabase, actor, customerId as string, p.interaction);
    if (error) {
      p.result.status = error.code === "23505" ? "duplicate" : "error";
      p.result.messages.push(friendlyDbError(error));
      continue;
    }
    imported++;
  }
  const summary = summarise(prepared.map((p) => p.result));
  await supabase.rpc("log_audit", {
    p_action: "customer.import",
    p_entity_type: "customer_interactions",
    p_entity_id: null,
    p_details: { rows: rows.length, imported, errors: summary.errors, duplicates: summary.duplicates },
  });
  return { ...summary, imported };
}

function summarise(results: ImportRowResult[]) {
  return {
    total: results.length,
    valid: results.filter((r) => r.status === "valid").length,
    errors: results.filter((r) => r.status === "error").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    returning: results.filter((r) => r.returningCustomer).length,
    results,
  };
}
