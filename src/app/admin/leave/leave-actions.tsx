"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/admin/form-field";
import type { Branch, Employee } from "@/lib/types";
import { deleteLeaveAction, recordLeaveAction, setLeaveProofAction } from "./actions";

const KINDS = [
  { value: "informed", label: "Informed in advance", hint: "No penalty" },
  { value: "sudden_proof", label: "Sudden leave – proof received", hint: "No penalty (e.g. medical certificate)" },
  { value: "sudden_no_proof", label: "Sudden leave – no proof", hint: "−5 points per day on the grade until proof is received" },
] as const;

export function RecordLeaveDialog({ employees, branches, today }: { employees: Employee[]; branches: Branch[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ employee_id: "", from: today, to: today, kind: "sudden_no_proof", note: "" });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  function save() {
    start(async () => {
      const res = await recordLeaveAction(v);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.days} day${res.days === 1 ? "" : "s"} of leave recorded`);
      setOpen(false);
      setV({ employee_id: "", from: today, to: today, kind: "sudden_no_proof", note: "" });
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <CalendarPlus data-icon="inline-start" /> Record leave
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record leave</DialogTitle>
          <DialogDescription>One day or a range. Recording a day again replaces it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Sales rep" htmlFor="l-emp" required>
            <NativeSelect id="l-emp" value={v.employee_id} onChange={(e) => setV({ ...v, employee_id: e.target.value })}>
              <option value="">Choose…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}{branches.length > 1 ? ` – ${branchName.get(e.branch_id) ?? ""}` : ""}</option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="From" htmlFor="l-from" required>
              <Input id="l-from" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: e.target.value > v.to ? e.target.value : v.to })} />
            </FormField>
            <FormField label="To" htmlFor="l-to" required>
              <Input id="l-to" type="date" value={v.to} min={v.from} onChange={(e) => setV({ ...v, to: e.target.value })} />
            </FormField>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Type</legend>
            {KINDS.map((k) => (
              <label key={k.value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="l-kind" className="mt-1 accent-primary" checked={v.kind === k.value} onChange={() => setV({ ...v, kind: k.value })} />
                <span>{k.label} <span className="text-muted-foreground">– {k.hint}</span></span>
              </label>
            ))}
          </fieldset>
          <FormField label="Note" htmlFor="l-note" hint="e.g. “Medical certificate from Dr Perera, copy in HR file” – don't write medical details">
            <Textarea id="l-note" rows={2} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </FormField>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending || !v.employee_id}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProofButton({ id, proof }: { id: string; proof: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={proof ? "ghost" : "outline"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (proof && !confirm("Remove “proof received”? The penalty will apply again.")) return;
          const res = await setLeaveProofAction(id, !proof);
          if (!res.ok) return void toast.error(res.error);
          toast.success(proof ? "Proof removed" : "Proof received – no penalty for this day");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : !proof && <Check data-icon="inline-start" />}
      {proof ? "Undo proof" : "Proof received"}
    </Button>
  );
}

export function DeleteLeaveButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Delete"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!confirm("Delete this leave day? Use this only for mistakes.")) return;
          const res = await deleteLeaveAction(id);
          if (!res.ok) return void toast.error(res.error);
          toast.success("Leave day deleted");
          router.refresh();
        })
      }
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
