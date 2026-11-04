"use server";

import { revalidatePath } from "next/cache";
import { AuthorisationError, requireRole } from "@/lib/auth";
import { addInteraction, createCustomerWithInteraction, setSmsOptOut, updateCustomerContact } from "@/server/services/customers";
import { commitImport, validateImport } from "@/server/services/customer-import";
import type { MappedRow } from "@/lib/import/fields";

type Fail = { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function guard<T>(fn: () => Promise<T>): Promise<T | Fail> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthorisationError) return { ok: false, error: e.message };
    console.error("[customers]", e);
    return { ok: false, error: e instanceof Error ? e.message : "Unexpected error" };
  }
}

export async function createCustomerAction(input: unknown) {
  return guard(async () => {
    const actor = await requireRole();
    const res = await createCustomerWithInteraction(actor, input);
    if (res.ok) revalidatePath("/admin/customers");
    return res;
  });
}

export async function addInteractionAction(customerId: string, input: unknown) {
  return guard(async () => {
    const actor = await requireRole();
    const res = await addInteraction(actor, customerId, input);
    if (res.ok) revalidatePath(`/admin/customers/${customerId}`);
    return res;
  });
}

export async function updateContactAction(customerId: string, input: unknown) {
  return guard(async () => {
    const actor = await requireRole();
    const res = await updateCustomerContact(actor, customerId, input);
    if (res.ok) revalidatePath(`/admin/customers/${customerId}`);
    return res;
  });
}

export async function setOptOutAction(customerId: string, optOut: boolean) {
  return guard(async () => {
    const actor = await requireRole();
    const res = await setSmsOptOut(actor, customerId, optOut);
    if (res.ok) revalidatePath(`/admin/customers/${customerId}`);
    return res;
  });
}

export async function validateImportAction(rows: MappedRow[]) {
  return guard(async () => {
    const actor = await requireRole();
    return { ok: true as const, data: await validateImport(actor, rows) };
  });
}

export async function commitImportAction(rows: MappedRow[]) {
  return guard(async () => {
    const actor = await requireRole();
    const data = await commitImport(actor, rows);
    revalidatePath("/admin/customers");
    return { ok: true as const, data };
  });
}
