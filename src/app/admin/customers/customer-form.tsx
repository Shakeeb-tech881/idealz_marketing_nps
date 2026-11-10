"use client";

import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/admin/form-field";
import { Panel } from "@/components/admin/panel";
import { interactionSchema, newCustomerSchema } from "@/lib/validation/customer";
import { CUSTOMER_SOURCES, GOOGLE_REVIEW_OPTIONS, PRODUCT_CATEGORIES, SALES_STEPS, type Branch, type Employee } from "@/lib/types";
import { addInteractionAction, createCustomerAction } from "./actions";

type FormIn = z.input<typeof newCustomerSchema>;
type FormOut = z.output<typeof newCustomerSchema>;

/** Current time in Sri Lanka as HH:MM, for the "Now" buttons. */
function nowColombo() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

const SALES_COUNTS = [
  { name: "android_phones", label: "Android phones" },
  { name: "apple_phones", label: "Apple iPhones" },
  { name: "other_devices", label: "Other devices", hint: "Tablets, laptops, watches…" },
  { name: "commission_accessories", label: "Commission accessories" },
  { name: "non_commission_accessories", label: "Non-commission accessories" },
] as const;

/** Rep scorecard fields: what was sold, time with the customer, sales steps, Google review. */
function SalesFields({
  register,
  errors,
  status,
  setValue,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  errors: Record<string, { message?: string } | undefined>;
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: (name: any, value: string, opts?: { shouldValidate?: boolean; shouldDirty?: boolean }) => void;
}) {
  const timeField = (name: "visit_start" | "visit_end", label: string) => (
    <FormField label={label} htmlFor={name} error={errors[name]?.message}>
      <div className="flex gap-2">
        <Input id={name} type="time" step={60} {...register(name)} />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setValue(name, nowColombo(), { shouldValidate: true, shouldDirty: true })}>
          <Clock data-icon="inline-start" /> Now
        </Button>
      </div>
    </FormField>
  );
  return (
    <div className="mt-6 space-y-4 border-t border-border pt-5">
      <div>
        <p className="text-sm font-medium">Sales rep scorecard</p>
        <p className="text-xs text-muted-foreground">Used to grade the salesperson. Leave counts at 0 if nothing was sold.</p>
      </div>
      {status === "purchased" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SALES_COUNTS.map((f) => (
            <FormField key={f.name} label={f.label} htmlFor={f.name} error={errors[f.name]?.message} hint={"hint" in f ? f.hint : undefined}>
              <Input id={f.name} type="number" inputMode="numeric" min={0} step={1} {...register(f.name)} />
            </FormField>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {timeField("visit_start", "Time customer was first served")}
        {timeField("visit_end", status === "purchased" ? "Time the sale closed" : "Time the customer left")}
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What the rep did</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {SALES_STEPS.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={s.value} className="size-4 rounded border-input accent-primary" {...register("sales_steps")} />
              {s.label}
            </label>
          ))}
        </div>
        {errors.sales_steps?.message && <p className="mt-1 text-xs text-destructive">{errors.sales_steps.message}</p>}
      </fieldset>
      <FormField label="Google review" htmlFor="google_review" error={errors.google_review?.message} hint="Ask every customer, happy or not. Google does not allow asking only happy customers or offering rewards for reviews." className="sm:max-w-sm">
        <NativeSelect id="google_review" {...register("google_review")}>
          {GOOGLE_REVIEW_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </NativeSelect>
      </FormField>
    </div>
  );
}

function InteractionFields({
  register,
  errors,
  branches,
  employees,
  branchId,
  status,
  lockEmployee = false,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  errors: Record<string, { message?: string } | undefined>;
  branches: Branch[];
  employees: Employee[];
  branchId: string;
  status: string;
  /** Staff: the salesperson is always themselves (also enforced on the server and in the database). */
  lockEmployee?: boolean;
}) {
  const emps = employees.filter((e) => e.branch_id === branchId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Branch" htmlFor="branch_id" required error={errors.branch_id?.message}>
        <NativeSelect id="branch_id" {...register("branch_id")}>
          <option value="">Select branch…</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </NativeSelect>
      </FormField>
      {lockEmployee ? (
        <FormField
          label="Employee / salesperson"
          htmlFor="employee_locked"
          hint={employees.length ? "Visits you record are credited to you." : "Your login is not linked to an employee record – ask a Super Admin (Users & Roles → Edit)."}
        >
          <input type="hidden" {...register("employee_id")} />
          <Input id="employee_locked" readOnly value={employees[0]?.full_name ?? "Not linked"} className="bg-muted/50" />
        </FormField>
      ) : (
        <FormField label="Employee / salesperson" htmlFor="employee_id" error={errors.employee_id?.message} hint={!branchId ? "Select a branch first" : undefined}>
          <NativeSelect id="employee_id" disabled={!branchId} {...register("employee_id")}>
            <option value="">Not specified</option>
            {emps.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name}{e.employee_code ? ` (${e.employee_code})` : ""}</option>
            ))}
          </NativeSelect>
        </FormField>
      )}
      <FormField label="Purchase status" htmlFor="purchase_status" required error={errors.purchase_status?.message}>
        <NativeSelect id="purchase_status" {...register("purchase_status")}>
          <option value="purchased">Purchased</option>
          <option value="not_purchased">Not purchased (visit / enquiry)</option>
        </NativeSelect>
      </FormField>
      <FormField label="Customer source" htmlFor="source" error={errors.source?.message}>
        <NativeSelect id="source" {...register("source")}>
          {CUSTOMER_SOURCES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={status === "purchased" ? "Visit date" : "Visit / contact date"} htmlFor="interaction_date" required error={errors.interaction_date?.message}>
        <Input id="interaction_date" type="date" {...register("interaction_date")} />
      </FormField>
      {status === "purchased" && (
        <FormField label="Purchase date" htmlFor="purchase_date" error={errors.purchase_date?.message} hint="Defaults to the visit date">
          <Input id="purchase_date" type="date" {...register("purchase_date")} />
        </FormField>
      )}
      <FormField label="Product category" htmlFor="product_category" error={errors.product_category?.message}>
        <NativeSelect id="product_category" {...register("product_category")}>
          <option value="">Not specified</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Product / model" htmlFor="product_model" error={errors.product_model?.message}>
        <Input id="product_model" placeholder="e.g. iPhone 16 Pro 256GB" {...register("product_model")} />
      </FormField>
      {status === "purchased" && (
        <FormField label="Invoice number" htmlFor="invoice_number" error={errors.invoice_number?.message} hint="Used to prevent duplicate records">
          <Input id="invoice_number" {...register("invoice_number")} />
        </FormField>
      )}
      <FormField label="Internal notes" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
        <Textarea id="notes" rows={2} {...register("notes")} />
      </FormField>
    </div>
  );
}

export function NewCustomerForm({ branches, employees, defaultBranch, today, defaultEmployee = null, lockEmployee = false }: { branches: Branch[]; employees: Employee[]; defaultBranch: string | null; today: string; defaultEmployee?: string | null; lockEmployee?: boolean }) {
  const router = useRouter();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(newCustomerSchema),
    defaultValues: { full_name: "", mobile: "", email: "", branch_id: defaultBranch ?? "", employee_id: defaultEmployee ?? "", purchase_status: "purchased", interaction_date: today, purchase_date: "", product_category: "", product_model: "", invoice_number: "", source: "walk_in", notes: "", android_phones: 0, apple_phones: 0, other_devices: 0, commission_accessories: 0, non_commission_accessories: 0, visit_start: "", visit_end: "", sales_steps: [], google_review: "not_asked" },
  });
  const branchId = useWatch({ control: form.control, name: "branch_id" }) as string;
  const status = useWatch({ control: form.control, name: "purchase_status" }) as string;
  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(values: FormOut) {
    const res = await createCustomerAction(values);
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, v]) => v?.[0] && form.setError(k as keyof FormIn, { message: v[0] }));
      toast.error(res.error);
      return;
    }
    toast.success("Customer saved");
    router.push(`/admin/customers/${(res as { customerId: string }).customerId}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" noValidate>
      <Panel title="Customer" description="Matched by mobile number — existing customers are reused automatically.">
        <div className="space-y-4">
          <FormField label="Customer name" htmlFor="full_name" required error={errors.full_name?.message}>
            <Input id="full_name" autoComplete="off" {...form.register("full_name")} />
          </FormField>
          <FormField label="Mobile number" htmlFor="mobile" required error={errors.mobile?.message} hint="e.g. 077 123 4567">
            <Input id="mobile" type="tel" inputMode="tel" {...form.register("mobile")} />
          </FormField>
          <FormField label="Email address" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" {...form.register("email")} />
          </FormField>
        </div>
      </Panel>
      <Panel title="Purchase / visit" description="Each interaction can receive its own survey invitation.">
        <InteractionFields register={form.register} errors={errors} branches={branches} employees={employees} branchId={branchId} status={status} lockEmployee={lockEmployee} />
        <SalesFields register={form.register} errors={errors} status={status} setValue={form.setValue} />
        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" data-icon="inline-start" />} Save customer
          </Button>
        </div>
      </Panel>
    </form>
  );
}

type IIn = z.input<typeof interactionSchema>;
type IOut = z.output<typeof interactionSchema>;

export function AddInteractionForm({ customerId, branches, employees, defaultBranch, today, onDone, defaultEmployee = null, lockEmployee = false }: { customerId: string; branches: Branch[]; employees: Employee[]; defaultBranch: string | null; today: string; onDone?: () => void; defaultEmployee?: string | null; lockEmployee?: boolean }) {
  const router = useRouter();
  const form = useForm<IIn, unknown, IOut>({
    resolver: zodResolver(interactionSchema),
    defaultValues: { branch_id: defaultBranch ?? "", employee_id: defaultEmployee ?? "", purchase_status: "purchased", interaction_date: today, purchase_date: "", product_category: "", product_model: "", invoice_number: "", source: "walk_in", notes: "", android_phones: 0, apple_phones: 0, other_devices: 0, commission_accessories: 0, non_commission_accessories: 0, visit_start: "", visit_end: "", sales_steps: [], google_review: "not_asked" },
  });
  const branchId = useWatch({ control: form.control, name: "branch_id" }) as string;
  const status = useWatch({ control: form.control, name: "purchase_status" }) as string;
  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  async function onSubmit(values: IOut) {
    const res = await addInteractionAction(customerId, values);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Interaction added");
    form.reset();
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <InteractionFields register={form.register} errors={errors} branches={branches} employees={employees} branchId={branchId} status={status} lockEmployee={lockEmployee} />
      <SalesFields register={form.register} errors={errors} status={status} setValue={form.setValue} />
      <div className="mt-6 flex justify-end gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" data-icon="inline-start" />} Add interaction
        </Button>
      </div>
    </form>
  );
}
