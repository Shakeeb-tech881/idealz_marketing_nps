"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/admin/form-field";
import type { AppSettings } from "@/lib/settings";
import type { Branch, Employee } from "@/lib/types";
import { saveBranchAction, saveEmployeeAction, saveSettingsAction } from "./actions";

type Errors = Record<string, string[] | undefined>;
const errs = (res: unknown): Errors => ((res as { fieldErrors?: Errors }).fieldErrors ?? {});

export function GeneralSettingsForm({ initial }: { initial: AppSettings }) {
  const [v, setV] = useState({
    company_name: initial.company_name,
    company_display_name: initial.company_display_name,
    company_logo_url: initial.company_logo_url ?? "",
    support_phone: initial.support_phone ?? "",
    survey_expiry_days: String(initial.survey_expiry_days),
    min_employee_sample: String(initial.min_employee_sample),
    min_branch_sample: String(initial.min_branch_sample),
    data_retention_months: String(initial.data_retention_months),
    sms_daily_limit: String(initial.sms_daily_limit),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const field = (k: keyof typeof v, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) => (
    <FormField label={label} htmlFor={`s-${k}`} error={errors[k]?.[0]} hint={hint}>
      <Input id={`s-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...props} />
    </FormField>
  );
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold">Company</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("company_name", "Legal company name")}
          {field("company_display_name", "Brand name (shown to customers)")}
          {field("company_logo_url", "Logo URL", { type: "url", placeholder: "https://…/logo.svg" }, "Public HTTPS image (e.g. Supabase Storage public bucket)")}
          {field("support_phone", "Customer support phone")}
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Surveys & analytics</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("survey_expiry_days", "Survey link expiry (days)", { type: "number", min: 1, max: 90 })}
          {field("min_employee_sample", "Min. responses to rank an employee", { type: "number", min: 1 })}
          {field("min_branch_sample", "Min. responses for reliable branch NPS", { type: "number", min: 1 })}
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Messaging & data protection</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("sms_daily_limit", "Daily SMS limit", { type: "number", min: 1 }, "Safety cap on live SMS per 24 hours")}
          {field("data_retention_months", "Data retention (months)", { type: "number", min: 0, max: 120 }, "Customer identifiers are anonymised this long after their last interaction. 0 = never.")}
          <FormField label="Timezone" htmlFor="tz" hint="All dates are stored in UTC and displayed in this zone">
            <Input id="tz" value="Asia/Colombo" disabled />
          </FormField>
        </div>
      </section>
      <div className="flex justify-end border-t border-border pt-4">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveSettingsAction(v);
              if (!res.ok) {
                setErrors(errs(res));
                return void toast.error(res.error);
              }
              setErrors({});
              toast.success("Settings saved");
              router.refresh();
            })
          }
        >
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Save settings
        </Button>
      </div>
    </div>
  );
}

export function BranchDialog({ branch }: { branch?: Branch }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: branch?.name ?? "", code: branch?.code ?? "", city: branch?.city ?? "", address: branch?.address ?? "", phone: branch?.phone ?? "", is_active: branch?.is_active ?? true });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={branch ? <Button variant="ghost" size="sm" /> : <Button size="sm" />}>
        {branch ? <><Pencil data-icon="inline-start" /> Edit</> : <><Plus data-icon="inline-start" /> Add branch</>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{branch ? "Edit branch" : "Add branch"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" htmlFor="b-name" required error={errors.name?.[0]}><Input id="b-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
          <FormField label="Code" htmlFor="b-code" required error={errors.code?.[0]} hint="Used in imports, e.g. COL03"><Input id="b-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></FormField>
          <FormField label="City" htmlFor="b-city"><Input id="b-city" value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></FormField>
          <FormField label="Phone" htmlFor="b-phone"><Input id="b-phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></FormField>
          <FormField label="Address" htmlFor="b-addr" className="sm:col-span-2"><Input id="b-addr" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></FormField>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} /> Active</label>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveBranchAction(branch?.id ?? null, v);
                if (!res.ok) {
                  setErrors(errs(res));
                  return void toast.error(res.error);
                }
                toast.success("Branch saved");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmployeeDialog({ employee, branches }: { employee?: Employee; branches: Branch[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ full_name: employee?.full_name ?? "", branch_id: employee?.branch_id ?? "", employee_code: employee?.employee_code ?? "", job_title: employee?.job_title ?? "", is_active: employee?.is_active ?? true });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={employee ? <Button variant="ghost" size="sm" /> : <Button size="sm" />}>
        {employee ? <><Pencil data-icon="inline-start" /> Edit</> : <><Plus data-icon="inline-start" /> Add employee</>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{employee ? "Edit employee" : "Add employee"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Full name" htmlFor="e-name" required error={errors.full_name?.[0]}><Input id="e-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></FormField>
          <FormField label="Branch" htmlFor="e-branch" required error={errors.branch_id?.[0]}>
            <NativeSelect id="e-branch" value={v.branch_id} onChange={(e) => setV({ ...v, branch_id: e.target.value })}>
              <option value="">Select…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField label="Employee code" htmlFor="e-code" error={errors.employee_code?.[0]} hint="Used in imports"><Input id="e-code" value={v.employee_code} onChange={(e) => setV({ ...v, employee_code: e.target.value })} /></FormField>
          <FormField label="Job title" htmlFor="e-title"><Input id="e-title" value={v.job_title} onChange={(e) => setV({ ...v, job_title: e.target.value })} /></FormField>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} /> Active</label>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveEmployeeAction(employee?.id ?? null, v);
                if (!res.ok) {
                  setErrors(errs(res));
                  return void toast.error(res.error);
                }
                toast.success("Employee saved");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
